const express = require('express');
const router = express.Router();

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// ============================================
// GET /api/admin/templates
// List all intervention templates with plan template status
// ============================================
router.get('/templates', async (req, res) => {
  try {
    const { tenant_id } = req.query;
    
    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }
    
    const result = await pool.query(`
      SELECT 
        id,
        name,
        area as category,
        tier,
        has_plan_template,
        CASE 
          WHEN plan_template IS NOT NULL THEN plan_template->>'name'
          ELSE NULL
        END as plan_name,
        CASE 
          WHEN plan_template IS NOT NULL THEN plan_template->>'version'
          ELSE NULL
        END as plan_version,
        CASE 
          WHEN plan_template IS NOT NULL THEN jsonb_array_length(plan_template->'sections')
          ELSE 0
        END as section_count
      FROM intervention_templates
      WHERE tenant_id = $1
      ORDER BY area, name
    `, [tenant_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// ============================================
// GET /api/admin/templates/:id
// Get single template with full plan_template data
// ============================================
router.get('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT 
        id,
        name,
        area as category,
        tier,
        description,
        has_plan_template,
        plan_template
      FROM intervention_templates
      WHERE id = $1
    `, [id]);
    
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
// Create or update plan template for an intervention
// ============================================
router.put('/templates/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_template } = req.body;
    
    // Validate plan_template structure
    if (!plan_template || !plan_template.name || !plan_template.sections) {
      return res.status(400).json({ error: 'Invalid plan template structure' });
    }
    
    // Ensure version is set
    if (!plan_template.version) {
      plan_template.version = '1.0';
    }
    
    const result = await pool.query(`
      UPDATE intervention_templates
      SET 
        plan_template = $1,
        has_plan_template = TRUE
      WHERE id = $2
      RETURNING id, name, plan_template, has_plan_template
    `, [JSON.stringify(plan_template), id]);
    
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
// Remove plan template from an intervention
// ============================================
router.delete('/templates/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      UPDATE intervention_templates
      SET 
        plan_template = NULL,
        has_plan_template = FALSE
      WHERE id = $1
      RETURNING id, name
    `, [id]);
    
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
// Duplicate plan template from another intervention
// ============================================
router.post('/templates/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const { sourceId } = req.body;
    
    // Get source template
    const sourceResult = await pool.query(`
      SELECT plan_template FROM intervention_templates WHERE id = $1 AND has_plan_template = TRUE
    `, [sourceId]);
    
    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source template not found or has no plan' });
    }
    
    // Get target intervention name
    const targetResult = await pool.query(`
      SELECT name FROM intervention_templates WHERE id = $1
    `, [id]);
    
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Target intervention not found' });
    }
    
    // Clone the template and update the name
    const clonedTemplate = { ...sourceResult.rows[0].plan_template };
    clonedTemplate.name = targetResult.rows[0].name;
    clonedTemplate.version = '1.0';
    
    const updateResult = await pool.query(`
      UPDATE intervention_templates
      SET 
        plan_template = $1,
        has_plan_template = TRUE
      WHERE id = $2
      RETURNING id, name, plan_template
    `, [JSON.stringify(clonedTemplate), id]);
    
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
