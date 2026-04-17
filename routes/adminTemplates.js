const express = require('express');
const router = express.Router();

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// Returns true if the template row is a shared/bank row (tenant_id IS NULL)
// and therefore edits from a tenant admin must be written to the per-tenant
// override table rather than mutating the shared row.
const isBankTemplate = async (templateId) => {
  const { rows } = await pool.query(
    `SELECT tenant_id FROM intervention_templates WHERE id = $1`,
    [templateId]
  );
  if (rows.length === 0) return null;
  return rows[0].tenant_id === null;
};

// Confirms a tenant-owned template belongs to the caller's tenant before
// we allow a write against it.
const templateBelongsToTenant = async (templateId, tenantId) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM intervention_templates WHERE id = $1 AND tenant_id = $2`,
    [templateId, tenantId]
  );
  return rows.length > 0;
};

// ============================================
// GET /api/admin/templates?tenant_id=...
// List all intervention templates visible to this tenant (bank + tenant-owned),
// with plan status resolved against the tenant's overrides.
// ============================================
router.get('/templates', async (req, res) => {
  try {
    const { tenant_id } = req.query;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const result = await pool.query(`
      SELECT
        it.id,
        it.name,
        it.area AS category,
        it.tier,
        COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template,
        CASE
          WHEN COALESCE(o.plan_template, it.plan_template) IS NOT NULL
            THEN COALESCE(o.plan_template, it.plan_template)->>'name'
          ELSE NULL
        END AS plan_name,
        CASE
          WHEN COALESCE(o.plan_template, it.plan_template) IS NOT NULL
            THEN COALESCE(o.plan_template, it.plan_template)->>'version'
          ELSE NULL
        END AS plan_version,
        CASE
          WHEN COALESCE(o.plan_template, it.plan_template) IS NOT NULL
            THEN jsonb_array_length(COALESCE(o.plan_template, it.plan_template)->'sections')
          ELSE 0
        END AS section_count,
        (it.tenant_id IS NULL) AS is_bank_template,
        (o.tenant_id IS NOT NULL) AS has_tenant_override
      FROM intervention_templates it
      LEFT JOIN tenant_plan_template_overrides o
        ON o.template_id = it.id AND o.tenant_id = $1
      WHERE (it.tenant_id = $1 OR it.tenant_id IS NULL)
      ORDER BY it.area, it.name
    `, [tenant_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// ============================================
// GET /api/admin/templates/:id?tenant_id=...
// Get single template with the plan_template that this tenant should see.
// ============================================
router.get('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id } = req.query;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const result = await pool.query(`
      SELECT
        it.id,
        it.name,
        it.area AS category,
        it.tier,
        it.description,
        COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template,
        COALESCE(o.plan_template, it.plan_template) AS plan_template,
        (it.tenant_id IS NULL) AS is_bank_template,
        (o.tenant_id IS NOT NULL) AS has_tenant_override
      FROM intervention_templates it
      LEFT JOIN tenant_plan_template_overrides o
        ON o.template_id = it.id AND o.tenant_id = $1
      WHERE it.id = $2
        AND (it.tenant_id = $1 OR it.tenant_id IS NULL)
    `, [tenant_id, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// ============================================
// PUT /api/admin/templates/:id/plan
// Create or update plan template for an intervention, scoped to the caller's
// tenant. Writes to the override table when the target is a bank row.
// Body: { tenant_id, user_id?, plan_template }
// ============================================
router.put('/templates/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, user_id, plan_template } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    if (!plan_template || !plan_template.name || !plan_template.sections) {
      return res.status(400).json({ error: 'Invalid plan template structure' });
    }

    if (!plan_template.version) {
      plan_template.version = '1.0';
    }

    const bank = await isBankTemplate(id);
    if (bank === null) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (bank) {
      const result = await pool.query(`
        INSERT INTO tenant_plan_template_overrides
          (tenant_id, template_id, plan_template, has_plan_template, updated_by, updated_at)
        VALUES ($1, $2, $3, TRUE, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, template_id) DO UPDATE
          SET plan_template = EXCLUDED.plan_template,
              has_plan_template = TRUE,
              updated_by = EXCLUDED.updated_by,
              updated_at = CURRENT_TIMESTAMP
        RETURNING tenant_id, template_id, plan_template, has_plan_template
      `, [tenant_id, id, JSON.stringify(plan_template), user_id || null]);

      return res.json({
        message: 'Plan template saved successfully',
        template: result.rows[0]
      });
    }

    const owns = await templateBelongsToTenant(id, tenant_id);
    if (!owns) {
      return res.status(403).json({ error: 'Not permitted to edit this template' });
    }

    const result = await pool.query(`
      UPDATE intervention_templates
      SET plan_template = $1,
          has_plan_template = TRUE
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, name, plan_template, has_plan_template
    `, [JSON.stringify(plan_template), id, tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      message: 'Plan template saved successfully',
      template: result.rows[0]
    });
  } catch (error) {
    console.error('Error saving plan template:', error);
    res.status(500).json({ error: 'Failed to save plan template' });
  }
});

// ============================================
// DELETE /api/admin/templates/:id/plan
// Remove plan template for the caller's tenant. For bank rows, this removes
// the override (restoring the bank default). For tenant-owned rows, it
// clears plan_template on the row.
// Body: { tenant_id }
// ============================================
router.delete('/templates/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const bank = await isBankTemplate(id);
    if (bank === null) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (bank) {
      // Upsert an "override says no plan" row so the tenant can hide a bank
      // plan from their own view without affecting other tenants.
      const result = await pool.query(`
        INSERT INTO tenant_plan_template_overrides
          (tenant_id, template_id, plan_template, has_plan_template, updated_at)
        VALUES ($1, $2, NULL, FALSE, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, template_id) DO UPDATE
          SET plan_template = NULL,
              has_plan_template = FALSE,
              updated_at = CURRENT_TIMESTAMP
        RETURNING tenant_id, template_id
      `, [tenant_id, id]);

      return res.json({
        message: 'Plan template removed for this tenant',
        template: result.rows[0]
      });
    }

    const owns = await templateBelongsToTenant(id, tenant_id);
    if (!owns) {
      return res.status(403).json({ error: 'Not permitted to edit this template' });
    }

    const result = await pool.query(`
      UPDATE intervention_templates
      SET plan_template = NULL,
          has_plan_template = FALSE
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, name
    `, [id, tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      message: 'Plan template removed successfully',
      template: result.rows[0]
    });
  } catch (error) {
    console.error('Error removing plan template:', error);
    res.status(500).json({ error: 'Failed to remove plan template' });
  }
});

// ============================================
// POST /api/admin/templates/:id/duplicate
// Duplicate plan template from another intervention into the caller's tenant.
// The source's plan is read with the tenant's override applied, and the
// destination is written to the override (for bank rows) or to the
// intervention_templates row (for tenant-owned rows).
// Body: { tenant_id, user_id?, sourceId }
// ============================================
router.post('/templates/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, user_id, sourceId } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    if (!sourceId) {
      return res.status(400).json({ error: 'sourceId is required' });
    }

    // Pull the source plan as the tenant currently sees it (override wins)
    const sourceResult = await pool.query(`
      SELECT COALESCE(o.plan_template, it.plan_template) AS plan_template,
             COALESCE(o.has_plan_template, it.has_plan_template) AS has_plan_template
      FROM intervention_templates it
      LEFT JOIN tenant_plan_template_overrides o
        ON o.template_id = it.id AND o.tenant_id = $1
      WHERE it.id = $2
        AND (it.tenant_id = $1 OR it.tenant_id IS NULL)
    `, [tenant_id, sourceId]);

    if (
      sourceResult.rows.length === 0 ||
      !sourceResult.rows[0].has_plan_template ||
      !sourceResult.rows[0].plan_template
    ) {
      return res.status(404).json({ error: 'Source template not found or has no plan' });
    }

    const targetResult = await pool.query(
      `SELECT name, tenant_id FROM intervention_templates
       WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)`,
      [id, tenant_id]
    );

    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Target intervention not found' });
    }

    const clonedTemplate = { ...sourceResult.rows[0].plan_template };
    clonedTemplate.name = targetResult.rows[0].name;
    clonedTemplate.version = '1.0';

    const targetIsBank = targetResult.rows[0].tenant_id === null;

    if (targetIsBank) {
      const result = await pool.query(`
        INSERT INTO tenant_plan_template_overrides
          (tenant_id, template_id, plan_template, has_plan_template, updated_by, updated_at)
        VALUES ($1, $2, $3, TRUE, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, template_id) DO UPDATE
          SET plan_template = EXCLUDED.plan_template,
              has_plan_template = TRUE,
              updated_by = EXCLUDED.updated_by,
              updated_at = CURRENT_TIMESTAMP
        RETURNING tenant_id, template_id, plan_template
      `, [tenant_id, id, JSON.stringify(clonedTemplate), user_id || null]);

      return res.json({
        message: 'Plan template duplicated successfully',
        template: result.rows[0]
      });
    }

    const updateResult = await pool.query(`
      UPDATE intervention_templates
      SET plan_template = $1,
          has_plan_template = TRUE
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, name, plan_template
    `, [JSON.stringify(clonedTemplate), id, tenant_id]);

    res.json({
      message: 'Plan template duplicated successfully',
      template: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Error duplicating template:', error);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

// ============================================
// GET /api/admin/field-types
// Get available field types and their options
// ============================================
router.get('/field-types', async (req, res) => {
  const fieldTypes = [
    {
      type: 'text',
      label: 'Single Line Text',
      description: 'Short text input',
      hasOptions: false,
      hasRows: false,
      example: { id: 'example', type: 'text', label: 'Example', placeholder: 'Enter text...', required: false }
    },
    {
      type: 'textarea',
      label: 'Multi-Line Text',
      description: 'Long text input',
      hasOptions: false,
      hasRows: true,
      example: { id: 'example', type: 'textarea', label: 'Example', placeholder: 'Enter details...', rows: 4, required: false }
    },
    {
      type: 'number',
      label: 'Number',
      description: 'Numeric input',
      hasOptions: false,
      hasRows: false,
      example: { id: 'example', type: 'number', label: 'Example', placeholder: '0', required: false }
    },
    {
      type: 'date',
      label: 'Date',
      description: 'Date picker',
      hasOptions: false,
      hasRows: false,
      example: { id: 'example', type: 'date', label: 'Example', required: false }
    },
    {
      type: 'select',
      label: 'Dropdown',
      description: 'Single selection from options',
      hasOptions: true,
      hasRows: false,
      example: { id: 'example', type: 'select', label: 'Example', options: ['Option 1', 'Option 2'], required: false }
    },
    {
      type: 'checkbox',
      label: 'Checkbox',
      description: 'Single yes/no checkbox',
      hasOptions: false,
      hasRows: false,
      example: { id: 'example', type: 'checkbox', label: 'Example', required: false }
    },
    {
      type: 'checkboxGroup',
      label: 'Checkbox Group',
      description: 'Multiple checkboxes',
      hasOptions: true,
      hasRows: false,
      example: { id: 'example', type: 'checkboxGroup', label: 'Example', options: ['Option 1', 'Option 2'], required: false }
    },
    {
      type: 'signature',
      label: 'Signature',
      description: 'Type name to sign',
      hasOptions: false,
      hasRows: false,
      example: { id: 'example', type: 'signature', label: 'Signature', required: false }
    }
  ];
  res.json(fieldTypes);
});

module.exports = router;
module.exports.initializePool = initializePool;
