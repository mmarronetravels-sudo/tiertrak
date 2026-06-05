const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { mutationUserLimiter } = require('./rateLimiters');
const { resolveAccessibleTenantIds } = require('./resolveAccessibleTenantIds');
const { applyStudentAccessGate } = require('./canAccessStudent');
const { INTERVENTION_MANAGER_ROLES } = require('../constants/roles');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const FORBIDDEN_BODY = { error: 'Not authorized' };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Role string is lowercase 'parent' per the users.role CHECK constraint
// (server.js bootstrap) and every comparison in the codebase. No normalization.

// Re-queries the users row on every request so role/tenant changes take
// effect immediately (e.g., demotion, role flip). Mirrors the pattern in
// routes/tier1-assessments.js:40-64.
const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { rows } = await pool.query(
      'SELECT id, role, tenant_id, district_id, school_wide_access FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Not authenticated' });

    req.user = rows[0];
    if (!SAFE_METHODS.has(req.method)) {
      return mutationUserLimiter(req, res, next);
    }
    next();
  } catch (err) {
    console.error('[requireAuth]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// Write-side intervention authorization: parent gate uses intervention_assignments
// (must have can_log_progress=TRUE), staff gate uses tenant match. Used by
// requireWriteAccessByBody and requireWriteAccessByLogId.
async function authorizeByInterventionId(req, res, studentInterventionId) {
  const interventionResult = await pool.query(
    `SELECT si.id, si.student_id, s.tenant_id, s.tier
     FROM student_interventions si
     JOIN students s ON s.id = si.student_id
     WHERE si.id = $1`,
    [studentInterventionId]
  );
  if (interventionResult.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const {
    student_id: interventionStudentId,
    tenant_id: interventionTenantId,
    tier: interventionStudentTier,
  } = interventionResult.rows[0];

  if (req.user.role === 'parent') {
    const assignmentResult = await pool.query(
      `SELECT 1 FROM intervention_assignments
       WHERE user_id = $1
         AND student_intervention_id = $2
         AND assignment_type = 'parent'
         AND can_log_progress = TRUE
       LIMIT 1`,
      [req.user.id, studentInterventionId]
    );
    if (assignmentResult.rows.length === 0) {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
  } else {
    // Staff branch: positive role gate first, then flag-gated through
    // applyStudentAccessGate. INTERVENTION_MANAGER_ROLES excludes
    // 'education_assistant' by design (M041 ROLE-MATRIX PLACEMENT) — an
    // EA may PASS canStaffAccessStudent (read) via the caseload table but
    // must NOT be authorized to WRITE interventions. The role check fires
    // before any further DB I/O for non-manager staff.
    if (!INTERVENTION_MANAGER_ROLES.includes(req.user.role)) {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
    const accessible = await resolveAccessibleTenantIds(req.user);
    const legacyAllowed = accessible.includes(interventionTenantId);
    const studentRow = {
      id: interventionStudentId,
      tenant_id: interventionTenantId,
      tier: interventionStudentTier,
    };
    const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
    if (gate.decision === 'deny') {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
  }

  req.intervention = {
    id: studentInterventionId,
    student_id: interventionStudentId,
    tenant_id: interventionTenantId
  };
  return { ok: true };
}

// Progress-log authorization — PARALLEL to authorizeByInterventionId but
// widens the staff arm to admit education_assistant via caseload coverage.
//
// Used by routes that "log progress" (record observations without changing
// the intervention's lifecycle): PATCH /interventions/:id/progress (#1),
// POST /progress-notes (#2; inline gate widening, not this wrapper), POST
// /weekly-progress (#3), POST /intervention-logs (#8; inline, not this
// wrapper).
//
// NOT used by management routes (assign, status/goal flips, archive/delete,
// monitoring-flag, plan edits) — those continue to call authorizeByInterventionId
// with the INTERVENTION_MANAGER_ROLES positive gate, keeping EA at 403.
//
// Staff/EA role check is INLINE (isManager || isEA) rather than a new
// constant — keeps INTERVENTION_MANAGER_ROLES narrow (excludes EA) so that
// constant's other consumers (FE canManageInterventions, staff-roster reads)
// are not accidentally widened. Operator-locked decision.
//
// Per-student access is delegated to applyStudentAccessGate, which routes
// through canStaffAccessStudent. That predicate has both the manager branch
// (ELEVATED_ROLES / teacher-caseload, S114) AND the EA branch
// (ea_caseload_students at the byte-identical column triple from PR-2/PR-3).
// No inline branching here — the predicate is the trust boundary.
//
// Parent arm is identical to authorizeByInterventionId — parents with an
// intervention_assignments row carrying can_log_progress=TRUE are permitted
// (existing semantics preserved).
async function authorizeProgressLogByInterventionId(req, res, studentInterventionId) {
  const interventionResult = await pool.query(
    `SELECT si.id, si.student_id, s.tenant_id, s.tier
     FROM student_interventions si
     JOIN students s ON s.id = si.student_id
     WHERE si.id = $1`,
    [studentInterventionId]
  );
  if (interventionResult.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const {
    student_id: interventionStudentId,
    tenant_id: interventionTenantId,
    tier: interventionStudentTier,
  } = interventionResult.rows[0];

  if (req.user.role === 'parent') {
    const assignmentResult = await pool.query(
      `SELECT 1 FROM intervention_assignments
       WHERE user_id = $1
         AND student_intervention_id = $2
         AND assignment_type = 'parent'
         AND can_log_progress = TRUE
       LIMIT 1`,
      [req.user.id, studentInterventionId]
    );
    if (assignmentResult.rows.length === 0) {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
  } else {
    // Staff/EA arm: widened role check vs authorizeByInterventionId.
    // INTERVENTION_MANAGER_ROLES OR education_assistant — no new constant
    // per operator decision. applyStudentAccessGate (via canStaffAccessStudent)
    // enforces per-student access for both: manager → ELEVATED_ROLES / teacher-
    // caseload; EA → ea_caseload_students membership.
    const isManager = INTERVENTION_MANAGER_ROLES.includes(req.user.role);
    const isEA = req.user.role === 'education_assistant';
    if (!isManager && !isEA) {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
    const accessible = await resolveAccessibleTenantIds(req.user);
    const legacyAllowed = accessible.includes(interventionTenantId);
    const studentRow = {
      id: interventionStudentId,
      tenant_id: interventionTenantId,
      tier: interventionStudentTier,
    };
    const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
    if (gate.decision === 'deny') {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
  }

  req.intervention = {
    id: studentInterventionId,
    student_id: interventionStudentId,
    tenant_id: interventionTenantId
  };
  return { ok: true };
}

// Read-side intervention authorization: parent gate uses parent_student_links
// (linked to the intervention's student is sufficient — no assignment row
// required), staff gate uses tenant match. Used by requireInterventionReadAccess.
async function authorizeReadByInterventionId(req, res, studentInterventionId) {
  const interventionResult = await pool.query(
    `SELECT si.id, si.student_id, s.tenant_id, s.tier
     FROM student_interventions si
     JOIN students s ON s.id = si.student_id
     WHERE si.id = $1`,
    [studentInterventionId]
  );
  if (interventionResult.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const {
    student_id: interventionStudentId,
    tenant_id: interventionTenantId,
    tier: interventionStudentTier,
  } = interventionResult.rows[0];

  if (req.user.role === 'parent') {
    const linkResult = await pool.query(
      `SELECT 1 FROM parent_student_links
       WHERE parent_user_id = $1 AND student_id = $2
       LIMIT 1`,
      [req.user.id, interventionStudentId]
    );
    if (linkResult.rows.length === 0) {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
  } else {
    // Staff branch: flag-gated through applyStudentAccessGate.
    const accessible = await resolveAccessibleTenantIds(req.user);
    const legacyAllowed = accessible.includes(interventionTenantId);
    const studentRow = {
      id: interventionStudentId,
      tenant_id: interventionTenantId,
      tier: interventionStudentTier,
    };
    const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
    if (gate.decision === 'deny') {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
  }

  req.intervention = {
    id: studentInterventionId,
    student_id: interventionStudentId,
    tenant_id: interventionTenantId
  };
  return { ok: true };
}

async function requireWriteAccessByBody(req, res, next) {
  try {
    const studentInterventionId = req.body?.student_intervention_id;
    if (!studentInterventionId) {
      return res.status(400).json({ error: 'Missing required field: student_intervention_id' });
    }
    const result = await authorizeByInterventionId(req, res, studentInterventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireWriteAccessByBody]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

async function requireWriteAccessByLogId(req, res, next) {
  try {
    const { id } = req.params;
    const logResult = await pool.query(
      'SELECT student_intervention_id FROM weekly_progress WHERE id = $1',
      [id]
    );
    if (logResult.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentInterventionId = logResult.rows[0].student_intervention_id;
    const result = await authorizeByInterventionId(req, res, studentInterventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireWriteAccessByLogId]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// Write middleware for routes shaped PATCH/PUT /resource/:interventionId.
// Mirrors requireWriteAccessByBody but sources the intervention id from the
// path param instead of the request body. Sets req.intervention = { id,
// student_id, tenant_id } for the route handler to use in defense-in-depth
// tenant-bound SQL.
async function requireWriteAccessByInterventionId(req, res, next) {
  try {
    const { interventionId } = req.params;
    if (!interventionId) {
      return res.status(400).json({ error: 'Missing required parameter: interventionId' });
    }
    const result = await authorizeByInterventionId(req, res, interventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireWriteAccessByInterventionId]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// Progress-log wrapper for routes shaped PATCH /resource/:interventionId.
// Mirrors requireWriteAccessByInterventionId but delegates to the widened
// authorizeProgressLogByInterventionId so that education_assistant with
// ea_caseload_students coverage passes. Mounted on PATCH /interventions/
// :interventionId/progress (#1) only; management PATCH routes (status, goal,
// monitoring-flag, archive, unarchive, delete) remain on the original
// requireWriteAccessByInterventionId and continue to 403 EA.
async function requireProgressLogAccessByInterventionId(req, res, next) {
  try {
    const { interventionId } = req.params;
    if (!interventionId) {
      return res.status(400).json({ error: 'Missing required parameter: interventionId' });
    }
    const result = await authorizeProgressLogByInterventionId(req, res, interventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireProgressLogAccessByInterventionId]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// Progress-log wrapper for routes shaped POST with student_intervention_id
// in req.body. Mirrors requireWriteAccessByBody but delegates to the widened
// authorizeProgressLogByInterventionId. Mounted on POST /weekly-progress
// (#3) only; PUT/DELETE /weekly-progress/:id stay on the original
// requireWriteAccessByLogId per operator decision.
//
// Note: no requireProgressLogAccessByLogId is added in this PR. The original
// plan listed three wrappers; only two log-progress routes consume wrappers,
// and the LogId shape would be unused. §9 — not designing for hypothetical
// future requirements. If a future operator decision admits PUT/DELETE on
// weekly-progress to EA, the wrapper lands in that PR.
async function requireProgressLogAccessByBody(req, res, next) {
  try {
    const studentInterventionId = req.body?.student_intervention_id;
    if (!studentInterventionId) {
      return res.status(400).json({ error: 'Missing required field: student_intervention_id' });
    }
    const result = await authorizeProgressLogByInterventionId(req, res, studentInterventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireProgressLogAccessByBody]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// Read middleware for routes shaped GET /resource/intervention/:interventionId.
// Wraps authorizeReadByInterventionId; sets req.intervention = { id, student_id,
// tenant_id } for the route handler to use in defense-in-depth tenant-bound SQL.
async function requireInterventionReadAccess(req, res, next) {
  try {
    const { interventionId } = req.params;
    if (!interventionId) {
      return res.status(400).json({ error: 'Missing required parameter: interventionId' });
    }
    const result = await authorizeReadByInterventionId(req, res, interventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireInterventionReadAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// Staff-only tenant gate for routes shaped GET /resource/.../:tenantId.
// Refuses parent role; requires Number(tenantId) to be in the caller's
// accessible-tenant set as resolved by resolveAccessibleTenantIds(req.user).
// Per §5 dual-path doctrine: legacy single-tenant users (district_id IS NULL)
// have accessible set [user.tenant_id] — single-tenant semantics preserved.
// District users (district_id IS NOT NULL) have accessible set sourced from
// user_school_access membership — multi-tenant within their accessible schools.
// Failure status preserved at 403 to maintain existing caller contract.
async function requireTenantStaffAccess(req, res, next) {
  try {
    const { tenantId } = req.params;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing required parameter: tenantId' });
    }
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(Number(tenantId))) return res.status(403).json(FORBIDDEN_BODY);
    return next();
  } catch (err) {
    console.error('[requireTenantStaffAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

async function requireStudentReadAccess(req, res, next) {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      return res.status(400).json({ error: 'Missing required parameter: studentId' });
    }

    const studentResult = await pool.query(
      'SELECT id, tenant_id, tier FROM students WHERE id = $1',
      [studentId]
    );
    if (studentResult.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentRow = studentResult.rows[0];

    if (req.user.role === 'parent') {
      const linkResult = await pool.query(
        `SELECT 1 FROM parent_student_links
         WHERE parent_user_id = $1 AND student_id = $2
         LIMIT 1`,
        [req.user.id, studentId]
      );
      if (linkResult.rows.length === 0) {
        return res.status(403).json(FORBIDDEN_BODY);
      }
    } else {
      // Staff branch: flag-gated through applyStudentAccessGate.
      const accessible = await resolveAccessibleTenantIds(req.user);
      const legacyAllowed = accessible.includes(studentRow.tenant_id);
      const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
      if (gate.decision === 'deny') {
        return res.status(403).json(FORBIDDEN_BODY);
      }
    }

    req.student = {
      id: Number(studentId),
      tenant_id: studentRow.tenant_id,
      tier: studentRow.tier,
    };
    return next();
  } catch (err) {
    console.error('[requireStudentReadAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

module.exports = {
  requireAuth,
  requireWriteAccessByBody,
  requireWriteAccessByLogId,
  requireWriteAccessByInterventionId,
  requireProgressLogAccessByInterventionId,
  requireProgressLogAccessByBody,
  requireStudentReadAccess,
  requireInterventionReadAccess,
  requireTenantStaffAccess
};
