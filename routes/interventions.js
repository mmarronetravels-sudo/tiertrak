const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const {
  requireAuth,
  requireStudentReadAccess,
  requireWriteAccessByInterventionId,
  requireTenantStaffAccess
} = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { applyStudentAccessGate } = require('../middleware/canAccessStudent');
require('dotenv').config();

const FORBIDDEN_BODY = { error: 'Not authorized' };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get all intervention templates for a tenant (includes system defaults).
//
// Tenant binding (§5): :tenantId path param must be in the caller's
// accessible-tenant set per resolveAccessibleTenantIds. requireTenantStaffAccess
// is the canonical middleware that does this check (used by /staff/:tenantId,
// /discipline-referrals/queue/:tenantId, etc.). Failure collapses to 404 to
// avoid existence disclosure across tenants.
//
// Pre-fix: anonymous-reachable per the PR #206 prep audit; live prod probe
// confirmed 200 anonymously. PR #206 closed anonymous access; this PR adds
// the per-handler tenant scope so authenticated cross-tenant probing is
// also denied.
router.get('/templates/tenant/:tenantId', requireTenantStaffAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      -- Activated bank interventions
      SELECT it.*, 'bank' as source
      FROM intervention_templates it
      JOIN tenant_intervention_bank tib ON tib.template_id = it.id
      WHERE tib.tenant_id = $1 AND it.tenant_id IS NULL
      
      UNION ALL
      
      -- Custom tenant interventions (not legacy)
      SELECT it.*, 'custom' as source
      FROM intervention_templates it
      WHERE it.tenant_id = $1 AND (it.is_legacy IS NULL OR it.is_legacy = FALSE)
      
      ORDER BY area, name
    `, [tenantId]);

    res.json(result.rows);
  } catch (error) {
    // §4B: integer user_id + err.message only. No body echo, no PII.
    console.error('[interventions:listTemplates]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a custom intervention template for a tenant.
//
// Tenant binding (§5): body.tenant_id must be in the caller's accessible-
// tenant set per resolveAccessibleTenantIds. The body field is Number()-
// coerced before validation per the PR #204 lesson (FE may send stringified
// integers from form values). Out-of-scope and non-integer collapse to a
// byte-identical 403 — no existence disclosure across tenants.
router.post('/templates', async (req, res) => {
  try {
    const { tenant_id, name, description, area, tier } = req.body || {};

    // Coerce + validate body.tenant_id per the #204 lesson. FE at App.jsx:1693
    // sends user.tenant_id (JS number from /me response); defense-in-depth
    // accepts stringified-numeric inputs the same way.
    const tenantIdInt = Number(tenant_id);
    if (!Number.isInteger(tenantIdInt) || tenantIdInt <= 0) {
      return res.status(400).json({ error: 'Invalid tenant_id' });
    }

    // Caller-scope check via §5 helper-consume.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantIdInt)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const result = await pool.query(
      `INSERT INTO intervention_templates (tenant_id, name, description, area, tier, is_system_default)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [tenantIdInt, name, description, area, tier]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    // §4B: integer user_id + err.message only. No body echo, no PII.
    console.error('[interventions:createTemplate]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a custom intervention template (cannot delete system defaults).
//
// Tenant binding (§5): load the row's tenant_id, then verify it's in the
// caller's accessible-tenant set. Bank rows (tenant_id IS NULL) keep the
// existing 403 message — they're operator-curated content that no per-
// tenant caller can delete. Not-found and wrong-tenant collapse to a
// byte-identical 403 with FORBIDDEN_BODY (mirrors PR-A/B/C pattern).
//
// The :id path param is Number()-coerced per the PR #204 lesson.
router.delete('/templates/:id', async (req, res) => {
  try {
    const idInt = Number(req.params.id);
    if (!Number.isInteger(idInt) || idInt <= 0) {
      return res.status(400).json({ error: 'Invalid template id' });
    }

    // Load row to inspect tenant_id + bank-status.
    const check = await pool.query(
      'SELECT tenant_id FROM intervention_templates WHERE id = $1',
      [idInt]
    );
    if (check.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const rowTenantId = check.rows[0].tenant_id;
    if (rowTenantId === null) {
      // Bank row — preserve existing user-facing message for the FE; not a
      // tenant-isolation 403, but a product-rule 403.
      return res.status(403).json({ error: 'Bank interventions cannot be deleted. Use the Intervention Bank tab to remove them from your school.' });
    }

    // Caller-scope check via §5 helper-consume.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(rowTenantId)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const result = await pool.query(
      'DELETE FROM intervention_templates WHERE id = $1 AND is_system_default = FALSE RETURNING *',
      [idInt]
    );
    if (result.rows.length === 0) {
      // Row was loaded above but the DELETE returned no rows: only
      // reachable via is_system_default=TRUE (the WHERE filter rejects)
      // or a TOCTOU race (concurrent delete). 404 matches the FE
      // user-facing expectation.
      return res.status(404).json({ error: 'Template not found or cannot delete system default' });
    }
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    // §4B: integer user_id + err.message only. No body echo, no PII.
    console.error('[interventions:deleteTemplate]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign an intervention to a student
router.post('/assign', requireAuth, async (req, res) => {
  try {
    // Role gate: only school staff can assign. Parents are explicitly
    // rejected. Sourced from req.user.role (cookie/JWT-verified) rather
    // than the prior x-user-role header (client-spoofable).
    if (req.user.role === 'parent') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { student_id, intervention_template_id, intervention_name, notes, log_frequency = 'weekly', start_date, end_date, no_progress_monitoring_required } = req.body;

    // Student access: load tenant + tier, then route the staff branch
    // through applyStudentAccessGate (flag-gated). §5 dual-path
    // resolution is internal to the helper via resolveAccessibleTenantIds;
    // we still compute legacyAllowed here so dark mode preserves
    // today's tenant-only decision while strict mode enforces the
    // canonical predicate (admin / counselor / interventionist / MTSS
    // Coordinator / teacher-caseload).
    const studentResult = await pool.query(
      'SELECT id, tenant_id, tier FROM students WHERE id = $1',
      [student_id]
    );
    if (studentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const studentRow = studentResult.rows[0];
    const accessible = await resolveAccessibleTenantIds(req.user);
    const legacyAllowed = accessible.includes(studentRow.tenant_id);
    const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
    if (gate.decision === 'deny') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const cleanStartDate = start_date || new Date().toISOString().split('T')[0];
    const cleanEndDate = end_date === '' ? null : end_date || null;
    // Strict-coerce: only literal boolean true sets the flag. Anything else
    // (undefined, null, "true" string, 1) becomes false. Column is NOT NULL
    // DEFAULT false in the schema (Migration 023).
    const noProgressMonitoringRequired = no_progress_monitoring_required === true;
    // assigned_by is server-derived from the JWT-verified caller, not the body.
    const result = await pool.query(
      `INSERT INTO student_interventions (student_id, intervention_template_id, assigned_by, intervention_name, notes, log_frequency, start_date, end_date, no_progress_monitoring_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [student_id, intervention_template_id, req.user.id, intervention_name, notes, log_frequency, cleanStartDate, cleanEndDate, noProgressMonitoringRequired]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an intervention's progress
router.patch('/:interventionId/progress', requireAuth, requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { progress } = req.body;
    const result = await pool.query(
      `UPDATE student_interventions
       SET progress = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND student_id IN (SELECT id FROM students WHERE tenant_id = $3)
       RETURNING *`,
      [progress, req.intervention.id, req.intervention.tenant_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an intervention's status
router.patch('/:interventionId/status', requireAuth, requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { status } = req.body;

    const updateFields = { status };
    if (status === 'completed' || status === 'discontinued') {
      updateFields.end_date = new Date();
    }

    const result = await pool.query(
      `UPDATE student_interventions
       SET status = $1, end_date = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
         AND student_id IN (SELECT id FROM students WHERE tenant_id = $4)
       RETURNING *`,
      [status, updateFields.end_date || null, req.intervention.id, req.intervention.tenant_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all interventions for a student
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT si.*,
              u.full_name as assigned_by_name,
              CASE
                WHEN $2 = 'parent' THEN (ia.id IS NOT NULL)
                ELSE TRUE
              END AS current_user_can_log
       FROM student_interventions si
       LEFT JOIN users u ON si.assigned_by = u.id
       LEFT JOIN intervention_assignments ia
         ON ia.student_intervention_id = si.id
        AND ia.user_id = $3
        AND ia.assignment_type = 'parent'
        AND ia.can_log_progress = TRUE
       WHERE si.student_id = $1
       ORDER BY si.start_date DESC`,
      [studentId, req.user.role, req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[GET /interventions/student/:studentId]', error.message);
    res.status(500).json({ error: 'Failed to fetch interventions' });
  }
});


// Set or update intervention goal
router.patch('/:interventionId/goal', requireAuth, requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { goal_description, goal_target_date, goal_target_rating } = req.body;

    const result = await pool.query(`
      UPDATE student_interventions
      SET goal_description = $1,
          goal_target_date = $2,
          goal_target_rating = $3
      WHERE id = $4
        AND student_id IN (SELECT id FROM students WHERE tenant_id = $5)
      RETURNING *
    `, [goal_description, goal_target_date, goal_target_rating, req.intervention.id, req.intervention.tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating intervention goal:', err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// Toggle the "no progress monitoring required" flag on an intervention.
// Mirrors /progress, /status, /goal: requireAuth + requireWriteAccessByInterventionId,
// UPDATE bound to req.intervention.id with defense-in-depth tenant guard via
// the students subquery. Body must be a literal boolean — we strict-validate
// rather than coerce so a malformed flip (e.g., {flag: "true"}) errors out
// instead of silently writing the wrong value.
router.patch('/:interventionId/monitoring-flag', requireAuth, requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { no_progress_monitoring_required } = req.body;
    if (typeof no_progress_monitoring_required !== 'boolean') {
      return res.status(400).json({ error: 'no_progress_monitoring_required must be a boolean' });
    }

    const result = await pool.query(`
      UPDATE student_interventions
      SET no_progress_monitoring_required = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND student_id IN (SELECT id FROM students WHERE tenant_id = $3)
      RETURNING *
    `, [no_progress_monitoring_required, req.intervention.id, req.intervention.tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating monitoring flag:', err);
    res.status(500).json({ error: 'Failed to update monitoring flag' });
  }
});

// Archive an intervention (soft delete — preserves all data)
router.put('/student-interventions/:interventionId/archive', requireAuth, requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { archive_reason } = req.body;
    // archived_by is server-derived from the JWT-verified caller, not the body.
    const result = await pool.query(`
      UPDATE student_interventions
      SET status = 'archived',
          archived_at = CURRENT_TIMESTAMP,
          archived_by = $1,
          archive_reason = $2,
          end_date = CURRENT_DATE
      WHERE id = $3
        AND student_id IN (SELECT id FROM students WHERE tenant_id = $4)
      RETURNING *
    `, [req.user.id, archive_reason || null, req.intervention.id, req.intervention.tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving intervention:', error);
    res.status(500).json({ error: error.message });
  }
});


// Unarchive an intervention (restore to active)
router.put('/student-interventions/:interventionId/unarchive', requireAuth, requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE student_interventions
      SET status = 'active',
          archived_at = NULL,
          archived_by = NULL,
          archive_reason = NULL,
          end_date = NULL
      WHERE id = $1
        AND student_id IN (SELECT id FROM students WHERE tenant_id = $2)
      RETURNING *
    `, [req.intervention.id, req.intervention.tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error unarchiving intervention:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete an intervention permanently (admin only — for mistakes)
router.delete('/student-interventions/:interventionId', requireAuth, requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const interventionId = req.intervention.id;
    const tenantId = req.intervention.tenant_id;
    // Cascading deletes — all keyed off the middleware-verified intervention id.
    // Defense-in-depth tenant guards on each statement so any future bypass
    // still fails closed.
    const tenantGuard = `student_intervention_id IN (
      SELECT si.id FROM student_interventions si
      JOIN students s ON s.id = si.student_id
      WHERE s.tenant_id = $2
    )`;
    await pool.query(
      `DELETE FROM weekly_progress WHERE student_intervention_id = $1 AND ${tenantGuard}`,
      [interventionId, tenantId]
    );
    await pool.query(
      `DELETE FROM intervention_assignments WHERE student_intervention_id = $1 AND ${tenantGuard}`,
      [interventionId, tenantId]
    );
    await pool.query(
      `DELETE FROM mtss_meeting_interventions WHERE student_intervention_id = $1 AND ${tenantGuard}`,
      [interventionId, tenantId]
    );

    const result = await pool.query(
      `DELETE FROM student_interventions
       WHERE id = $1
         AND student_id IN (SELECT id FROM students WHERE tenant_id = $2)
       RETURNING *`,
      [interventionId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }

    res.json({ success: true, message: 'Intervention permanently deleted' });
  } catch (error) {
    console.error('Error deleting intervention:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
