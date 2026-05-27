const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();
const { requireAuth, requireTenantStaffAccess, requireStudentReadAccess } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { ELEVATED_ROLES } = require('../constants/roles');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================
// Tenant-binding doctrine (POST handlers in this file)
//
// Per Followup #125 (per-school binding), POST handlers compute the
// target tenant via resolveAndBindTargetTenant(req):
//   - Optional req.body.target_tenant_id (positive integer).
//   - Absent → falls back to req.user.tenant_id (backwards-compat
//     for the current single-tenant users whose JWT carries their
//     only accessible tenant).
//   - Present → validated against resolveAccessibleTenantIds(req.user);
//     not-in-set returns 403 before any INSERT, so a body-explicit
//     cross-tenant probe collapses to 403, not 400-FK.
//
// Supersedes the day-one rule "Routes NEVER read req.body.tenant_id"
// (master-index Followup 67) for the multi-school case only. The
// rule remains in force for any field NOT named target_tenant_id;
// GET handlers continue to derive scope from
// resolveAccessibleTenantIds(req.user) directly.
//
// Scope in THIS file:
//   - POST / (create student roster row) — in scope.
//   - POST /referral-monitoring — in scope. Includes a pre-INSERT
//     student-row tenant check; that check is rewritten to assert
//     the student belongs to the resolved targetTenantId (single
//     target school, not the caller's accessible-set — the helper
//     has already narrowed to one).
//   - PUT /:id, PATCH /:id/tier, /:id/archive, /:id/unarchive,
//     DELETE /:id, DELETE /referral-monitoring/:studentId — OUT of
//     scope. These operate on existing rows; tenant scoping is
//     already via resolveAccessibleTenantIds(req.user) on the
//     row's own tenant_id (§5 dual-path).
//
// Helper is duplicated module-local per Followup #132 (consolidation
// deferred to a chore PR post-PR-S3-D-4).
// ============================================================

// Role allowlists for the write-side of this router. Three tiers per
// PR-S3-D-sec operator decision:
//   - ROLES_WHO_CAN_EDIT: roster create + MTSS-tier writes + soft-delete/restore.
//     Mirrors routes/tier1-assessments.js:19-23 and
//     routes/mtssMeetings.js:19-24 (MEETING_WRITE_ROLES) — same membership,
//     route-local because no shared roles module exists yet.
//   - ADMIN_ROLES: PUT /:id demographic edits. Narrower than EDIT for
//     reasoning recorded in PR-S3-D-sec proposal. Mirrors
//     routes/prereferralForms.js:25 and routes/parentLinks.js:25.
//   - DELETE_ROLES: HARD DELETE /:id only. One-element array intentional —
//     documents the role-allowlist intent and supports future additions
//     without retrofitting (e.g., if product later widens to 'school_admin'
//     on a per-tenant flag, the const is the single place to edit).
const ROLES_WHO_CAN_EDIT = ['district_admin', 'school_admin', 'counselor', 'interventionist'];
const ADMIN_ROLES = ['school_admin', 'district_admin'];
const DELETE_ROLES = ['district_admin'];

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

/**
 * Resolve and validate the target tenant for a POST write handler.
 *
 * Per Followup #125 (per-school binding), POST handlers read an optional
 * target_tenant_id from req.body:
 *   - Absent → falls back to req.user.tenant_id (backwards-compat for
 *     the current single-tenant users whose JWT carries their only
 *     accessible tenant).
 *   - Present but not a positive integer → 400.
 *   - Present, positive integer, but not in
 *     resolveAccessibleTenantIds(req.user) → 403 (fires before any
 *     INSERT; a body-explicit cross-tenant probe collapses to 403,
 *     not 400-FK).
 *
 * Supersedes the day-one rule "Routes NEVER read req.body.tenant_id"
 * (master-index Followup 67) for the multi-school case only.
 *
 * @param {object} req - Express request. requireAuth must have already
 *   populated req.user; req.body may carry an optional target_tenant_id.
 * @returns {Promise<{targetTenantId: number|null, error: {status: number, body: object}|null}>}
 *   On success: { targetTenantId: <int>, error: null }.
 *   On failure: { targetTenantId: null, error: { status, body } } —
 *   caller should respond res.status(error.status).json(error.body).
 */
async function resolveAndBindTargetTenant(req) {
  const bodyTarget = req.body ? req.body.target_tenant_id : undefined;
  if (bodyTarget === undefined || bodyTarget === null) {
    return { targetTenantId: req.user.tenant_id, error: null };
  }
  if (!isPositiveInt(bodyTarget)) {
    return { targetTenantId: null, error: { status: 400, body: { error: 'Invalid target_tenant_id' } } };
  }
  const accessible = await resolveAccessibleTenantIds(req.user);
  if (!accessible.includes(bodyTarget)) {
    return { targetTenantId: null, error: { status: 403, body: { error: 'Not authorized for target tenant' } } };
  }
  return { targetTenantId: bodyTarget, error: null };
}

// Get archive reason options
router.get('/archive-reasons', requireAuth, async (req, res) => {
  const reasons = [
    'Completed Interventions',
    'End of School Year',
    'Transferred Out',
    'No Longer Needs Support',
    'Other'
  ];
  res.json(reasons);
});

// Get all students for a tenant (with archive filter and role-based access)
// Path-tenant scoped: tenant membership verified via helper (§5 dual-path
// doctrine); SQL filter uses Number(req.params.tenantId) after membership
// check passes.
router.get('/tenant/:tenantId', requireAuth, async (req, res) => {
  try {
    const pathTenantId = Number(req.params.tenantId);
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(pathTenantId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { includeArchived, onlyArchived, search } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;
    const schoolWideAccess = req.user.school_wide_access === true;

    let query;
    let params;

    // Elevated-role users (constants/roles.js ELEVATED_ROLES) or users
    // with school_wide_access see all students in the tenant.
    if (ELEVATED_ROLES.includes(userRole) || schoolWideAccess) {
      query = `
        SELECT s.*, u.full_name as teacher_name
        FROM students s
        LEFT JOIN users u ON s.teacher_id = u.id
        WHERE s.tenant_id = $1
      `;
      params = [pathTenantId];
    }
    // Parents see only their linked children
    else if (userRole === 'parent') {
      query = `
        SELECT DISTINCT s.*, u.full_name as teacher_name
        FROM students s
        LEFT JOIN users u ON s.teacher_id = u.id
        INNER JOIN parent_student_links psl ON s.id = psl.student_id
        WHERE s.tenant_id = $1 AND psl.parent_user_id = $2
      `;
      params = [pathTenantId, userId];
    }
    // Teachers/staff see all Tier 1 students + their assigned Tier 2/3 students
    else {
      query = `
        SELECT DISTINCT s.*, u.full_name as teacher_name
        FROM students s
        LEFT JOIN users u ON s.teacher_id = u.id
        WHERE s.tenant_id = $1
          AND (
            s.tier = 1
            OR s.id IN (
              SELECT si.student_id
              FROM student_interventions si
              INNER JOIN intervention_assignments ia ON si.id = ia.student_intervention_id
              WHERE si.status = 'active' AND ia.user_id = $2
            )
          )
      `;
      params = [pathTenantId, userId];
    }
    
    // Archive filters
    if (onlyArchived === 'true') {
      query += ` AND s.archived = TRUE`;
    } else if (includeArchived !== 'true') {
      query += ` AND (s.archived = FALSE OR s.archived IS NULL)`;
    }

    // Search filter
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(s.first_name) LIKE LOWER($${params.length}) OR LOWER(s.last_name) LIKE LOWER($${params.length}))`;
    }
    
    query += ` ORDER BY s.archived ASC, s.last_name, s.first_name`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get student statistics including archive counts
// requireTenantStaffAccess (PR-S3-A swept) validated path :tenantId is in
// caller's accessible-tenant set. Path-tenant scoped: SQL filter uses
// Number(req.params.tenantId); middleware-membership-check validated.
router.get('/tenant/:tenantId/stats', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE archived = FALSE OR archived IS NULL) as active_count,
        COUNT(*) FILTER (WHERE archived = TRUE) as archived_count,
        COUNT(*) FILTER (WHERE tier = 1 AND (archived = FALSE OR archived IS NULL)) as tier1_count,
        COUNT(*) FILTER (WHERE tier = 2 AND (archived = FALSE OR archived IS NULL)) as tier2_count,
        COUNT(*) FILTER (WHERE tier = 3 AND (archived = FALSE OR archived IS NULL)) as tier3_count,
        COUNT(*) as total_count
      FROM students
      WHERE tenant_id = $1
    `, [Number(req.params.tenantId)]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get students by tier
// requireTenantStaffAccess (PR-S3-A swept) validated path :tenantId.
// Path-tenant scoped: SQL filter uses Number(req.params.tenantId).
router.get('/tenant/:tenantId/tier/:tier', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    const { tier } = req.params;
    const result = await pool.query(
      `SELECT s.*, u.full_name as teacher_name
       FROM students s
       LEFT JOIN users u ON s.teacher_id = u.id
       WHERE s.tenant_id = $1 AND s.tier = $2 AND (s.archived = FALSE OR s.archived IS NULL)
       ORDER BY s.last_name, s.first_name`,
      [Number(req.params.tenantId), tier]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function for referral flag reasons
function getFlagReasons(student) {
  const reasons = [];
  const interventions = parseInt(student.active_interventions);
  const logs = parseInt(student.total_logs);
  const avg = student.avg_rating ? parseFloat(student.avg_rating) : null;
  
  if (interventions >= 3) {
    reasons.push(`${interventions} active interventions`);
  }
  if (logs >= 4 && avg !== null && avg <= 2.0) {
    reasons.push(`Avg rating ${avg}/5 across ${logs} logs`);
  }
  if (interventions >= 2 && logs >= 2 && avg !== null && avg < 3.0) {
    reasons.push(`Low progress (${avg}/5) with ${interventions} interventions`);
  }
  return reasons;
}

// GET referral candidates - Tier 1 students who may need MTSS referral
router.get('/referral-candidates/:tenantId', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const pathTenantId = parseInt(req.params.tenantId, 10);
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(pathTenantId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await pool.query(`
      SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.external_id,
        s.grade,
        s.area,
        s.tier,
        COUNT(DISTINCT si.id) AS active_interventions,
        COUNT(DISTINCT wp.id) AS total_logs,
        ROUND(AVG(wp.rating)::numeric, 2) AS avg_rating,
        MIN(si.start_date) AS earliest_intervention,
        pf.id AS prereferral_id,
        pf.status AS prereferral_status
      FROM students s
      INNER JOIN student_interventions si
        ON s.id = si.student_id AND si.status = 'active'
      LEFT JOIN weekly_progress wp
        ON si.id = wp.student_intervention_id
      LEFT JOIN prereferral_forms pf
        ON s.id = pf.student_id AND pf.status IN ('draft', 'submitted', 'approved')
      WHERE s.tenant_id = $1
        AND s.tier = 1
        AND s.archived = false
        AND s.id NOT IN (SELECT student_id FROM referral_monitoring)
      GROUP BY s.id, s.first_name, s.last_name, s.external_id, s.grade, s.area, s.tier, pf.id, pf.status
      HAVING
        COUNT(DISTINCT si.id) >= 3
        OR (COUNT(DISTINCT wp.id) >= 4 AND AVG(wp.rating) <= 2.0)
        OR (COUNT(DISTINCT si.id) >= 2 AND COUNT(DISTINCT wp.id) >= 2 AND AVG(wp.rating) < 3.0)
      ORDER BY
        COALESCE(AVG(wp.rating), 0) ASC,
        COUNT(DISTINCT si.id) DESC
    `, [pathTenantId]);

    // Filter out students who already have submitted/approved pre-referral forms
    const candidates = result.rows.filter(s => 
      !s.prereferral_status || s.prereferral_status === 'draft'
    );

    res.json({
      count: candidates.length,
      candidates: candidates.map(s => ({
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        external_id: s.external_id,
        grade: s.grade,
        area: s.area,
        active_interventions: parseInt(s.active_interventions),
        total_logs: parseInt(s.total_logs),
        avg_rating: s.avg_rating ? parseFloat(s.avg_rating) : null,
        earliest_intervention: s.earliest_intervention,
        has_prereferral_draft: s.prereferral_status === 'draft',
        flag_reasons: getFlagReasons(s)
      }))
    });

  } catch (error) {
    console.error('Error fetching referral candidates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// GET monitored referral students with live stats
router.get('/referral-monitoring/:tenantId', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const pathTenantId = parseInt(req.params.tenantId, 10);
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(pathTenantId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const result = await pool.query(`
      SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.external_id,
        s.grade,
        s.area,
        s.tier,
        rm.id AS monitoring_id,
        rm.notes AS monitoring_notes,
        rm.created_at AS monitoring_since,
        u.full_name AS monitored_by_name,
        COUNT(DISTINCT si.id) AS active_interventions,
        COUNT(DISTINCT wp.id) AS total_logs,
        ROUND(AVG(wp.rating)::numeric, 2) AS avg_rating
      FROM referral_monitoring rm
      INNER JOIN students s ON rm.student_id = s.id
      LEFT JOIN users u ON rm.monitored_by = u.id
      LEFT JOIN student_interventions si
        ON s.id = si.student_id AND si.status = 'active'
      LEFT JOIN weekly_progress wp
        ON si.id = wp.student_intervention_id
      WHERE rm.tenant_id = $1
        AND s.tier = 1
        AND s.archived = false
      GROUP BY s.id, s.first_name, s.last_name, s.external_id, s.grade, s.area, s.tier,
               rm.id, rm.notes, rm.created_at, u.full_name
      ORDER BY COALESCE(AVG(wp.rating), 0) ASC
    `, [pathTenantId]);

    res.json({
      count: result.rows.length,
      monitored: result.rows.map(s => ({
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        external_id: s.external_id,
        grade: s.grade,
        area: s.area,
        monitoring_id: s.monitoring_id,
        monitoring_notes: s.monitoring_notes,
        monitoring_since: s.monitoring_since,
        monitored_by_name: s.monitored_by_name,
        active_interventions: parseInt(s.active_interventions),
        total_logs: parseInt(s.total_logs),
        avg_rating: s.avg_rating ? parseFloat(s.avg_rating) : null
      }))
    });

  } catch (error) {
    console.error('Error fetching monitored students:', error);
    res.status(500).json({ error: 'Failed to fetch monitored students' });
  }
});

// POST mark student as monitoring
router.post('/referral-monitoring', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    // Per Followup #125 — per-school binding. tenantId is the resolved
    // target tenant; the student-row tenant check below asserts the
    // student belongs to THAT school (single target), not the caller's
    // accessible-set (the helper has already narrowed to one).
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);
    const { student_id, notes } = req.body;
    if (!isPositiveInt(student_id)) {
      return res.status(400).json({ error: 'Invalid or missing student_id' });
    }
    // Tenant verification: student must belong to the resolved target tenant.
    const studentResult = await pool.query(
      'SELECT tenant_id FROM students WHERE id = $1',
      [student_id]
    );
    if (studentResult.rows.length === 0
        || studentResult.rows[0].tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    // Coerce notes to a safe shape: string, trimmed, length-limited.
    // staff-authored field but defensive coerce protects against
    // unexpected client payloads.
    const safeNotes = (notes != null)
      ? String(notes).trim().slice(0, 2000)
      : null;
    const result = await pool.query(`
      INSERT INTO referral_monitoring (student_id, tenant_id, monitored_by, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, student_id) DO UPDATE SET
        notes = $4,
        monitored_by = $3,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [student_id, tenantId, req.user.id, safeNotes]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error marking as monitoring:', error);
    res.status(500).json({ error: 'Failed to mark student for monitoring' });
  }
});

// DELETE remove from monitoring (to start referral or dismiss)
router.delete('/referral-monitoring/:studentId', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { studentId } = req.params;
    // Tenant clause makes cross-tenant DELETEs silent no-ops:
    // 0 rows affected, generic success response regardless. This
    // is more probe-resistant than a 403 because attackers cannot
    // enumerate student_ids by trying random ones and observing
    // different responses for "exists in another tenant" vs
    // "does not exist." Tenant scope widened to caller's accessible
    // set per §5 dual-path doctrine; legacy single-tenant semantics
    // preserved (accessible = [user.tenant_id]).
    const accessible = await resolveAccessibleTenantIds(req.user);
    await pool.query(
      'DELETE FROM referral_monitoring WHERE student_id = $1 AND tenant_id = ANY($2::int[])',
      [studentId, accessible]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing monitoring:', error);
    res.status(500).json({ error: 'Failed to remove monitoring' });
  }
});
// Get a single student with their interventions and notes
router.get('/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    const studentResult = await pool.query(
      `SELECT s.*, u.full_name as teacher_name 
       FROM students s
       LEFT JOIN users u ON s.teacher_id = u.id
       WHERE s.id = $1`,
      [req.student.id]
    );
    
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const interventionsResult = await pool.query(
      `SELECT si.*, u.full_name as assigned_by_name
       FROM student_interventions si
       LEFT JOIN users u ON si.assigned_by = u.id
       WHERE si.student_id = $1
       ORDER BY si.start_date DESC`,
      [req.student.id]
    );
    
    const notesResult = await pool.query(
      `SELECT pn.*, u.full_name as author_name
       FROM progress_notes pn
       LEFT JOIN users u ON pn.author_id = u.id
       WHERE pn.student_id = $1
       ORDER BY pn.created_at DESC`,
      [req.student.id]
    );
    
    res.json({
      ...studentResult.rows[0],
      interventions: interventionsResult.rows,
      progressNotes: notesResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new student.
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!ROLES_WHO_CAN_EDIT.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);
    const { first_name, last_name, grade, teacher_id, tier, area, secondary_area, risk_level, external_id } = req.body;
    // external_id: trim, empty-after-trim → null. Matches the normalize shape
    // used by routes/csvImport.js parse loop in commit 9f5c415.
    const externalIdNormalized = (typeof external_id === 'string' && external_id.trim() !== '')
      ? external_id.trim()
      : null;
    const result = await pool.query(
      `INSERT INTO students (tenant_id, first_name, last_name, grade, teacher_id, tier, area, secondary_area, risk_level, external_id, archived)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
       RETURNING *`,
      [tenantId, first_name, last_name, grade, teacher_id, tier || 1, area, secondary_area || null, risk_level || 'low', externalIdNormalized]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a student
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { id } = req.params;
    const { first_name, last_name, grade, teacher_id, tier, area, secondary_area, risk_level } = req.body;
    // external_id uses DIFFERENT semantics than the fields destructured above.
    // The other fields are NOT NULL constrained on the students table — an
    // omitted field in req.body destructures to undefined, pg writes NULL,
    // and PG's NOT NULL constraint raises a visible error. external_id is
    // nullable (Migration 035 — partial UNIQUE, NULL allowed), so the same
    // null-on-omit pattern would SILENTLY clear the column on every PUT that
    // doesn't include it (e.g., any pre-035 FE code path that doesn't yet
    // know about external_id). Preserve-on-omit guards that data-loss
    // hazard via CASE-WHEN in the UPDATE: undefined → keep existing value;
    // null or empty-string in body → clear; non-empty string → trimmed value.
    // Any future nullable PUT field should follow this pattern — null-on-omit
    // is unsafe for nullable columns. See fix/students-put-null-on-omit-
    // broader-investigation followup for the broader audit.
    const hasExternalId = Object.prototype.hasOwnProperty.call(req.body, 'external_id');
    const externalIdValue = hasExternalId
      ? (typeof req.body.external_id === 'string' && req.body.external_id.trim() !== ''
          ? req.body.external_id.trim()
          : null)
      : null;
    // Pre-flight tenant scope: 404 for both not-found and not-in-accessible
    // (leak-resistance, mirrors tier1-assessments.js:251 post-PR-S3-C).
    // Tenant-bound UPDATE WHERE is belt-and-suspenders against the
    // pre-flight/UPDATE TOCTOU window.
    const accessible = await resolveAccessibleTenantIds(req.user);
    const studentLookup = await pool.query(
      'SELECT tenant_id FROM students WHERE id = $1',
      [id]
    );
    if (studentLookup.rows.length === 0 || !accessible.includes(studentLookup.rows[0].tenant_id)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const result = await pool.query(
      `UPDATE students
       SET first_name = $1, last_name = $2, grade = $3, teacher_id = $4,
           tier = $5, area = $6, risk_level = $7, secondary_area = $8,
           external_id = CASE WHEN $9::boolean THEN $10::text ELSE external_id END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 AND tenant_id = ANY($12::int[])
       RETURNING *`,
      [first_name, last_name, grade, teacher_id, tier, area, risk_level, secondary_area || null, hasExternalId, externalIdValue, id, accessible]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update student tier only
router.patch('/:id/tier', requireAuth, async (req, res) => {
  try {
    if (!ROLES_WHO_CAN_EDIT.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { id } = req.params;
    const { tier } = req.body;
    const accessible = await resolveAccessibleTenantIds(req.user);
    const studentLookup = await pool.query(
      'SELECT tenant_id FROM students WHERE id = $1',
      [id]
    );
    if (studentLookup.rows.length === 0 || !accessible.includes(studentLookup.rows[0].tenant_id)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const result = await pool.query(
      `UPDATE students
       SET tier = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND tenant_id = ANY($3::int[])
       RETURNING *`,
      [tier, id, accessible]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Archive a student.
// archived_by is derived from req.user.id (server-side
// actor identity). body.archived_by (if present) is
// intentionally ignored — closes the actor-spoofing
// vector where a caller could claim to archive as
// anyone. Mirrors server-side actor-identity pattern
// at prereferralForms.js:518 — counselor_id is bound
// from req.user.id directly into a user-id column
// (one-step id-bind, parallel to this handler's
// archived_by binding).
router.patch('/:id/archive', requireAuth, async (req, res) => {
  try {
    if (!ROLES_WHO_CAN_EDIT.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { id } = req.params;
    const { archived_reason } = req.body;
    
    if (!archived_reason) {
      return res.status(400).json({ error: 'Archive reason is required' });
    }
    
    const validReasons = [
      'Completed Interventions',
      'End of School Year',
      'Transferred Out',
      'No Longer Needs Support',
      'Other'
    ];
    
    if (!validReasons.includes(archived_reason)) {
      return res.status(400).json({ error: 'Invalid archive reason' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    const studentLookup = await pool.query(
      'SELECT tenant_id FROM students WHERE id = $1',
      [id]
    );
    if (studentLookup.rows.length === 0 || !accessible.includes(studentLookup.rows[0].tenant_id)) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const result = await pool.query(
      `UPDATE students
       SET archived = TRUE,
           archived_at = CURRENT_TIMESTAMP,
           archived_by = $1,
           archived_reason = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND tenant_id = ANY($4::int[])
       RETURNING *`,
      [req.user.id, archived_reason, id, accessible]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unarchive (reactivate) a student
router.patch('/:id/unarchive', requireAuth, async (req, res) => {
  try {
    if (!ROLES_WHO_CAN_EDIT.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { id } = req.params;

    const accessible = await resolveAccessibleTenantIds(req.user);
    const studentLookup = await pool.query(
      'SELECT tenant_id FROM students WHERE id = $1',
      [id]
    );
    if (studentLookup.rows.length === 0 || !accessible.includes(studentLookup.rows[0].tenant_id)) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const result = await pool.query(
      `UPDATE students
       SET archived = FALSE,
           archived_at = NULL,
           archived_by = NULL,
           archived_reason = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND tenant_id = ANY($2::int[])
       RETURNING *`,
      [id, accessible]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a student
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!DELETE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { id } = req.params;
    // Atomic tenant-bound DELETE — no pre-flight needed; the WHERE clause
    // IS the auth gate. 0 rows affected → 404 (leak-resistant: same
    // response for not-found and not-in-accessible).
    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(
      'DELETE FROM students WHERE id = $1 AND tenant_id = ANY($2::int[]) RETURNING *',
      [id, accessible]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
