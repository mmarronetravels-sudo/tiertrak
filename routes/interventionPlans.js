const express = require('express');
const router = express.Router();
const { requireAuth, requireWriteAccessByInterventionId } = require('../middleware/authorizeInterventionAccess');
const { platformAdminOnly } = require('../middleware/platformAdminOnly');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// ============================================
// PLAN TEMPLATES
// ============================================

// Get all intervention templates that (for this tenant) have a plan template
router.get('/templates', async (req, res) => {
  try {
    const { tenant_id } = req.query;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const result = await pool.query(
      `SELECT it.id, it.name, it.area,
              COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template
       FROM intervention_templates it
       LEFT JOIN tenant_plan_template_overrides o
         ON o.template_id = it.id AND o.tenant_id = $1
       WHERE (it.tenant_id = $1 OR it.tenant_id IS NULL)
         AND COALESCE(o.has_plan_template, it.has_plan_template) = TRUE
       ORDER BY it.name`,
      [tenant_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching plan templates:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get plan template for a specific intervention by name (tenant-scoped)
router.get('/templates/by-name/:interventionName', async (req, res) => {
  try {
    const { interventionName } = req.params;
    const { tenant_id } = req.query;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    // Prefer a tenant-owned template over a bank row so a tenant's customized
    // duplicate (same name) wins when both exist.
    const result = await pool.query(
      `SELECT COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template,
              COALESCE(o.plan_template, it.plan_template) AS plan_template
       FROM intervention_templates it
       LEFT JOIN tenant_plan_template_overrides o
         ON o.template_id = it.id AND o.tenant_id = $1
       WHERE it.name = $2
         AND (it.tenant_id = $1 OR it.tenant_id IS NULL)
       ORDER BY (it.tenant_id = $1) DESC
       LIMIT 1`,
      [tenant_id, interventionName]
    );

    if (result.rows.length === 0 || !result.rows[0].has_plan_template) {
      return res.json({ hasPlan: false, template: null });
    }

    res.json({
      hasPlan: true,
      template: result.rows[0].plan_template
    });
  } catch (error) {
    console.error('Error fetching plan template:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get plan template by intervention template ID (tenant-scoped)
router.get('/templates/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { tenant_id } = req.query;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const result = await pool.query(
      `SELECT it.id, it.name,
              COALESCE(o.plan_template, it.plan_template) AS plan_template,
              COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template
       FROM intervention_templates it
       LEFT JOIN tenant_plan_template_overrides o
         ON o.template_id = it.id AND o.tenant_id = $1
       WHERE it.id = $2
         AND (it.tenant_id = $1 OR it.tenant_id IS NULL)`,
      [tenant_id, templateId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = result.rows[0];
    res.json({
      hasPlan: template.has_plan_template,
      template: template.plan_template,
      name: template.name
    });
  } catch (error) {
    console.error('Error fetching plan template:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// STUDENT INTERVENTION PLANS
// ============================================

// Get plan data for a student intervention
router.get('/student-interventions/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT
        si.id,
        si.intervention_name,
        si.plan_data,
        si.plan_status,
        si.plan_completed_at,
        si.plan_completed_by,
        u.full_name AS completed_by_name,
        COALESCE(o.plan_template, it.plan_template) AS plan_template,
        COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template
       FROM student_interventions si
       JOIN students s ON si.student_id = s.id
       LEFT JOIN users u ON si.plan_completed_by = u.id
       LEFT JOIN LATERAL (
         SELECT it_inner.id, it_inner.plan_template, it_inner.has_plan_template
         FROM intervention_templates it_inner
         WHERE it_inner.name = si.intervention_name
           AND (it_inner.tenant_id = s.tenant_id OR it_inner.tenant_id IS NULL)
         ORDER BY (it_inner.tenant_id = s.tenant_id) DESC
         LIMIT 1
       ) it ON TRUE
       LEFT JOIN tenant_plan_template_overrides o
         ON o.template_id = it.id AND o.tenant_id = s.tenant_id
       WHERE si.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      intervention_name: row.intervention_name,
      plan_data: row.plan_data,
      plan_status: row.plan_status || 'not_applicable',
      plan_completed_at: row.plan_completed_at,
      completed_by_name: row.completed_by_name,
      has_plan_template: row.has_plan_template || false,
      plan_template: row.plan_template
    });
  } catch (error) {
    console.error('Error fetching plan data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Save plan data (auto-save/draft).
//
// Tenant binding (§5): :interventionId is the student_intervention id; the
// canonical requireWriteAccessByInterventionId middleware walks
// student_interventions → students.tenant_id and gates via the same
// applyStudentAccessGate as PR-A/PR-B. Not-found and wrong-tenant collapse
// to a byte-identical 403 inside the middleware. Sets req.intervention =
// {id, student_id, tenant_id} for downstream defense-in-depth.
router.put('/student-interventions/:interventionId/plan', requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { interventionId: id } = req.params;
    const { plan_data } = req.body;
    
    // Check if this intervention has a plan template
    const checkResult = await pool.query(
      `SELECT si.id, it.has_plan_template
       FROM student_interventions si
       LEFT JOIN intervention_templates it ON si.intervention_name = it.name
       WHERE si.id = $1`,
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }
    
    // Determine status - if saving data, it's at least a draft
    const newStatus = 'draft';
    
    const result = await pool.query(
      `UPDATE student_interventions 
       SET plan_data = $1, 
           plan_status = CASE 
             WHEN plan_status = 'complete' THEN 'complete'
             ELSE $2
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, plan_data, plan_status, updated_at`,
      [JSON.stringify(plan_data), newStatus, id]
    );
    
    res.json({
      message: 'Plan saved',
      ...result.rows[0]
    });
  } catch (error) {
    // §4B: integer user_id + err.message only. No body echo (plan_data
    // is free-text PII), no name/student leakage.
    console.error('[interventionPlans:savePlan]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark plan as complete.
//
// Tenant binding (§5): same shape as PUT — :interventionId is the
// student_intervention id; requireWriteAccessByInterventionId gates the
// caller against the chain → students.tenant_id.
router.post('/student-interventions/:interventionId/plan/complete', requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { interventionId: id } = req.params;
    const { plan_data } = req.body;

    // plan_completed_by is server-derived from req.user.id (set by
    // mount-level requireAuth from PR #200). Any body-supplied user_id
    // is intentionally ignored — the prior body-user_id binding was
    // spoofable: a caller could mark the plan as completed by any user
    // id, distorting the FERPA audit trail of who finalized the plan.
    const result = await pool.query(
      `UPDATE student_interventions
       SET plan_data = $1,
           plan_status = 'complete',
           plan_completed_at = CURRENT_TIMESTAMP,
           plan_completed_by = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, plan_data, plan_status, plan_completed_at`,
      [JSON.stringify(plan_data), req.user.id, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }
    
    res.json({
      message: 'Plan marked as complete',
      ...result.rows[0]
    });
  } catch (error) {
    // §4B: integer user_id + err.message only. No body echo, no PII.
    console.error('[interventionPlans:completePlan]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reopen plan (change from complete back to draft).
//
// Tenant binding (§5): same shape as PUT and /complete.
router.post('/student-interventions/:interventionId/plan/reopen', requireWriteAccessByInterventionId, async (req, res) => {
  try {
    const { interventionId: id } = req.params;
    
    const result = await pool.query(
      `UPDATE student_interventions 
       SET plan_status = 'draft',
           plan_completed_at = NULL,
           plan_completed_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, plan_status`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }
    
    res.json({
      message: 'Plan reopened for editing',
      ...result.rows[0]
    });
  } catch (error) {
    // §4B: integer user_id + err.message only. No body echo, no PII.
    console.error('[interventionPlans:reopenPlan]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all interventions for a student that have plan templates
router.get('/students/:studentId/plans', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(
      `SELECT
        si.id,
        si.intervention_name,
        si.plan_data,
        si.plan_status,
        si.plan_completed_at,
        si.start_date,
        si.status AS intervention_status,
        u.full_name AS completed_by_name,
        COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template,
        COALESCE(o.plan_template, it.plan_template) AS plan_template
       FROM student_interventions si
       JOIN students s ON si.student_id = s.id
       LEFT JOIN users u ON si.plan_completed_by = u.id
       LEFT JOIN LATERAL (
         SELECT it_inner.id, it_inner.plan_template, it_inner.has_plan_template
         FROM intervention_templates it_inner
         WHERE it_inner.name = si.intervention_name
           AND (it_inner.tenant_id = s.tenant_id OR it_inner.tenant_id IS NULL)
         ORDER BY (it_inner.tenant_id = s.tenant_id) DESC
         LIMIT 1
       ) it ON TRUE
       LEFT JOIN tenant_plan_template_overrides o
         ON o.template_id = it.id AND o.tenant_id = s.tenant_id
       WHERE si.student_id = $1
         AND COALESCE(o.has_plan_template, it.has_plan_template) = TRUE
       ORDER BY si.start_date DESC`,
      [studentId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student plans:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// ADMIN: Manage Plan Templates
// ============================================

// Bulk update plan templates in the shared bank (tenant_id IS NULL).
// Gated to platform admins via the PLATFORM_ADMIN_USER_IDS env-allowlist
// and scoped to bank rows only — tenant-owned templates that share a
// name with a bank template are NEVER overwritten. Mirrors the bank-only
// WHERE clause emitted by scripts/seedPlanTemplates.js.
//
// PII discipline (§4B): plan_template contents are operator-curated bank
// payloads, not student data. No request-body echo in error responses;
// console.error carries user_id (integer) + err.message only.
router.post('/admin/templates/bulk-update', requireAuth, platformAdminOnly, async (req, res) => {
  try {
    const { templates } = req.body || {};

    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: 'templates must be an array' });
    }

    const results = [];

    for (const template of templates) {
      if (!template || typeof template.name !== 'string' || !template.name.trim()) {
        return res.status(400).json({ error: 'each template requires a non-empty name' });
      }
      if (template.plan_template === undefined || template.plan_template === null) {
        return res.status(400).json({ error: 'each template requires a plan_template' });
      }

      const result = await pool.query(
        `UPDATE intervention_templates
         SET plan_template = $1,
             has_plan_template = true
         WHERE name = $2 AND tenant_id IS NULL
         RETURNING id, name, tenant_id`,
        [JSON.stringify(template.plan_template), template.name]
      );

      if (result.rows.length > 0) {
        results.push(result.rows[0]);
      }
    }

    res.json({
      message: `Updated ${results.length} bank template(s)`,
      updated: results
    });
  } catch (error) {
    console.error('[interventionPlans:bulkUpdate]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
