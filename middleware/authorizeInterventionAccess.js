const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const FORBIDDEN_BODY = { error: 'Not authorized' };

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
      'SELECT id, role, tenant_id FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Not authenticated' });

    req.user = rows[0];
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
    `SELECT si.id, si.student_id, s.tenant_id
     FROM student_interventions si
     JOIN students s ON s.id = si.student_id
     WHERE si.id = $1`,
    [studentInterventionId]
  );
  if (interventionResult.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const { student_id: interventionStudentId, tenant_id: interventionTenantId } =
    interventionResult.rows[0];

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
  } else if (req.user.tenant_id !== interventionTenantId) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
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
    `SELECT si.id, si.student_id, s.tenant_id
     FROM student_interventions si
     JOIN students s ON s.id = si.student_id
     WHERE si.id = $1`,
    [studentInterventionId]
  );
  if (interventionResult.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const { student_id: interventionStudentId, tenant_id: interventionTenantId } =
    interventionResult.rows[0];

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
  } else if (req.user.tenant_id !== interventionTenantId) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
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
// Refuses parent role and requires Number(tenantId) === req.user.tenant_id.
// The route SHOULD source its tenant from req.user.tenant_id (server-derived);
// the path param is used here only for the equality check.
async function requireTenantStaffAccess(req, res, next) {
  try {
    const { tenantId } = req.params;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing required parameter: tenantId' });
    }
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    if (Number(tenantId) !== req.user.tenant_id) return res.status(403).json(FORBIDDEN_BODY);
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
      'SELECT id, tenant_id FROM students WHERE id = $1',
      [studentId]
    );
    if (studentResult.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentTenantId = studentResult.rows[0].tenant_id;

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
    } else if (req.user.tenant_id !== studentTenantId) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

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
  requireStudentReadAccess,
  requireInterventionReadAccess,
  requireTenantStaffAccess
};
