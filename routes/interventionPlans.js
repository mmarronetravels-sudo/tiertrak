const express = require('express');
const router = express.Router();

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// ============================================
// PLAN TEMPLATES
// ============================================

// Get all intervention templates that have plan templates
router.get('/templates', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, area, has_plan_template 
       FROM intervention_templates 
       WHERE has_plan_template = true
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching plan templates:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get plan template for a specific intervention by name
router.get('/templates/by-name/:interventionName', async (req, res) => {
  try {
    const { interventionName } = req.params;
    
    const result = await pool.query(
      `SELECT plan_template, has_plan_template 
       FROM intervention_templates 
       WHERE name = $1 AND has_plan_template = true
       LIMIT 1`,
      [interventionName]
    );
    
    if (result.rows.length === 0) {
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

// Get plan template by intervention template ID
router.get('/templates/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const result = await pool.query(
      `SELECT id, name, plan_template, has_plan_template 
       FROM intervention_templates 
       WHERE id = $1`,
      [templateId]
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
        u.full_name as completed_by_name,
        it.plan_template,
        it.has_plan_template
       FROM student_interventions si
       LEFT JOIN users u ON si.plan_completed_by = u.id
       LEFT JOIN intervention_templates it ON si.intervention_name = it.name
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

// Save plan data (auto-save/draft)
router.put('/student-interventions/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
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
    console.error('Error saving plan data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark plan as complete
router.post('/student-interventions/:id/plan/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_data, user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const result = await pool.query(
      `UPDATE student_interventions 
       SET plan_data = $1, 
           plan_status = 'complete',
           plan_completed_at = CURRENT_TIMESTAMP,
           plan_completed_by = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, plan_data, plan_status, plan_completed_at`,
      [JSON.stringify(plan_data), user_id, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }
    
    res.json({
      message: 'Plan marked as complete',
      ...result.rows[0]
    });
  } catch (error) {
    console.error('Error completing plan:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reopen plan (change from complete back to draft)
router.post('/student-interventions/:id/plan/reopen', async (req, res) => {
  try {
    const { id } = req.params;
    
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
    console.error('Error reopening plan:', error);
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
        si.status as intervention_status,
        u.full_name as completed_by_name,
        it.has_plan_template,
        it.plan_template
       FROM student_interventions si
       LEFT JOIN users u ON si.plan_completed_by = u.id
       LEFT JOIN intervention_templates it ON si.intervention_name = it.name
       WHERE si.student_id = $1 AND it.has_plan_template = true
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

// Update plan template for an intervention
router.put('/admin/templates/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { plan_template, has_plan_template } = req.body;
    
    const result = await pool.query(
      `UPDATE intervention_templates 
       SET plan_template = $1,
           has_plan_template = $2
       WHERE id = $3
       RETURNING id, name, has_plan_template`,
      [JSON.stringify(plan_template), has_plan_template, templateId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({
      message: 'Template updated',
      ...result.rows[0]
    });
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk update: Set plan templates for multiple interventions by name
router.post('/admin/templates/bulk-update', async (req, res) => {
  try {
    const { templates } = req.body;
    // templates is an array of { name, plan_template }
    
    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: 'templates must be an array' });
    }
    
    const results = [];
    
    for (const template of templates) {
      const result = await pool.query(
        `UPDATE intervention_templates 
         SET plan_template = $1,
             has_plan_template = true
         WHERE name = $2
         RETURNING id, name`,
        [JSON.stringify(template.plan_template), template.name]
      );
      
      if (result.rows.length > 0) {
        results.push(result.rows[0]);
      }
    }
    
    res.json({
      message: `Updated ${results.length} templates`,
      updated: results
    });
  } catch (error) {
    console.error('Error bulk updating templates:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
