const express = require('express');
const router = express.Router();
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

const FORBIDDEN_BODY = { error: 'Not authorized' };

let pool;

const initializePool = (p) => { pool = p; };

// GET /api/intervention-bank/all
// Returns ALL bank interventions (tenant_id IS NULL, not legacy)
// with a flag showing which ones this tenant has activated
router.get('/all', async (req, res) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });

    const result = await pool.query(`
      SELECT
        it.id,
        it.name,
        it.description,
        it.area,
        it.tier,
        COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template,
        it.is_starter,
        CASE WHEN tib.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_activated,
        tib.activated_at
      FROM intervention_templates it
      LEFT JOIN tenant_intervention_bank tib
        ON tib.template_id = it.id AND tib.tenant_id = $1
      LEFT JOIN tenant_plan_template_overrides o
        ON o.template_id = it.id AND o.tenant_id = $1
      WHERE it.tenant_id IS NULL AND (it.is_legacy IS NULL OR it.is_legacy = FALSE)
      ORDER BY it.area, it.name
    `, [tenant_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching intervention bank:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/intervention-bank/activate
// Activate a bank intervention for a tenant.
//
// Tenant binding (§5): body.tenant_id must be in the caller's accessible-
// tenant set per resolveAccessibleTenantIds. Number()-coerced per the
// PR #204 lesson (FE at App.jsx:5872 sends user.tenant_id as a JS number;
// defense-in-depth accepts stringified-numeric inputs the same way).
//
// template_id bank-row validation: the template MUST live in the shared
// bank (intervention_templates.tenant_id IS NULL). Without this check, a
// caller could "activate" any tenant-owned template into their own bank
// membership row; the subsequent GET /all surfaces JOINs through
// intervention_templates by id, so the FE would render the foreign
// tenant's template content (name, description, area, tier) as the
// caller's "activated bank intervention" — a cross-tenant content
// exposure. The bank-row filter closes that path. Non-existent and
// non-bank template_id both collapse to a byte-identical 400 — no
// cross-tenant existence disclosure.
router.post('/activate', async (req, res) => {
  try {
    const { tenant_id, template_id } = req.body || {};

    // Coerce + validate body.tenant_id per the #204 lesson.
    const tenantIdInt = Number(tenant_id);
    if (!Number.isInteger(tenantIdInt) || tenantIdInt <= 0) {
      return res.status(400).json({ error: 'Invalid tenant_id' });
    }

    // Coerce + validate body.template_id.
    const templateIdInt = Number(template_id);
    if (!Number.isInteger(templateIdInt) || templateIdInt <= 0) {
      return res.status(400).json({ error: 'Invalid template_id' });
    }

    // Caller-scope check via §5 helper-consume.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantIdInt)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    // template_id must be a bank row (tenant_id IS NULL). Tenant-owned
    // templates are NOT activatable into the bank-membership table —
    // doing so would let a caller surface foreign-tenant template
    // content via the subsequent GET /all join (see header comment).
    const bankCheck = await pool.query(
      'SELECT 1 FROM intervention_templates WHERE id = $1 AND tenant_id IS NULL',
      [templateIdInt]
    );
    if (bankCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid template_id' });
    }

    // activated_by is server-derived from req.user.id, not body. Any body-
    // supplied user_id is intentionally ignored — the prior body-user_id
    // binding was spoofable: a caller could attribute the bank activation
    // to any user id, distorting the FERPA audit trail. Mirrors the PR-A
    // logged_by fix on intervention_logs and the PR-C plan_completed_by
    // fix on student_interventions.
    await pool.query(`
      INSERT INTO tenant_intervention_bank (tenant_id, template_id, activated_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, template_id) DO NOTHING
    `, [tenantIdInt, templateIdInt, req.user.id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error activating intervention:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/intervention-bank/deactivate
// Remove a bank intervention from a tenant's active list.
//
// Tenant binding (§5): body.tenant_id Number()-coerced and verified
// against resolveAccessibleTenantIds. Same shape as POST /activate.
//
// template_id bank-row validation: same shape as POST /activate. A
// caller deactivating a non-bank template_id would be a no-op against
// tenant_intervention_bank but signals abuse or FE drift; reject with
// 400 to keep the contract symmetric with /activate. Non-existent and
// non-bank template_id collapse to byte-identical 400.
//
// The existing active-students 409 gate (no deactivation if students
// have this intervention assigned) is preserved; it now runs after the
// tenant scope check, so cross-tenant probing cannot count another
// tenant's active assignments.
router.delete('/deactivate', async (req, res) => {
  try {
    const { tenant_id, template_id } = req.body || {};

    // Coerce + validate body.tenant_id per the #204 lesson.
    const tenantIdInt = Number(tenant_id);
    if (!Number.isInteger(tenantIdInt) || tenantIdInt <= 0) {
      return res.status(400).json({ error: 'Invalid tenant_id' });
    }

    // Coerce + validate body.template_id.
    const templateIdInt = Number(template_id);
    if (!Number.isInteger(templateIdInt) || templateIdInt <= 0) {
      return res.status(400).json({ error: 'Invalid template_id' });
    }

    // Caller-scope check via §5 helper-consume.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantIdInt)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    // template_id must be a bank row (tenant_id IS NULL). Matches the
    // POST /activate validation: bank membership is a relationship to
    // shared bank rows only; non-bank rows have no slot in
    // tenant_intervention_bank to deactivate.
    const bankCheck = await pool.query(
      'SELECT 1 FROM intervention_templates WHERE id = $1 AND tenant_id IS NULL',
      [templateIdInt]
    );
    if (bankCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid template_id' });
    }

    // Check if any students currently have this intervention assigned.
    // Runs AFTER the tenant gate so cross-tenant probing cannot count
    // another tenant's active assignments.
    const usage = await pool.query(`
      SELECT COUNT(*) as count
      FROM student_interventions si
      JOIN students s ON si.student_id = s.id
      WHERE si.intervention_template_id = $1
        AND s.tenant_id = $2
        AND si.status = 'active'
    `, [templateIdInt, tenantIdInt]);

    if (parseInt(usage.rows[0].count) > 0) {
      return res.status(409).json({
        error: 'Cannot deactivate — this intervention is currently assigned to active students',
        active_count: parseInt(usage.rows[0].count)
      });
    }

    await pool.query(`
      DELETE FROM tenant_intervention_bank
      WHERE tenant_id = $1 AND template_id = $2
    `, [tenantIdInt, templateIdInt]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating intervention:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;