const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get all intervention templates for a tenant (includes system defaults)
router.get('/templates/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const result = await pool.query(
      `SELECT * FROM intervention_templates 
       WHERE tenant_id = $1 OR is_system_default = TRUE
       ORDER BY is_system_default DESC, name`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a custom intervention template for a tenant
router.post('/templates', async (req, res) => {
  try {
    const { tenant_id, name, description, area, tier } = req.body;
    const result = await pool.query(
      `INSERT INTO intervention_templates (tenant_id, name, description, area, tier, is_system_default) 
       VALUES ($1, $2, $3, $4, $5, FALSE) 
       RETURNING *`,
      [tenant_id, name, description, area, tier]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a custom intervention template (cannot delete system defaults)
router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM intervention_templates WHERE id = $1 AND is_system_default = FALSE RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found or cannot delete system default' });
    }
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Assign an intervention to a student
router.post('/assign', async (req, res) => {
  try {
    const { student_id, intervention_template_id, assigned_by, intervention_name, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO student_interventions (student_id, intervention_template_id, assigned_by, intervention_name, notes) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [student_id, intervention_template_id, assigned_by, intervention_name, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an intervention's progress
router.patch('/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { progress } = req.body;
    const result = await pool.query(
      `UPDATE student_interventions 
       SET progress = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 
       RETURNING *`,
      [progress, id]
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
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const updateFields = { status };
    if (status === 'completed' || status === 'discontinued') {
      updateFields.end_date = new Date();
    }
    
    const result = await pool.query(
      `UPDATE student_interventions 
       SET status = $1, end_date = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 
       RETURNING *`,
      [status, updateFields.end_date || null, id]
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
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT si.*, u.full_name as assigned_by_name
       FROM student_interventions si
       LEFT JOIN users u ON si.assigned_by = u.id
       WHERE si.student_id = $1
       ORDER BY si.start_date DESC`,
      [studentId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Set or update intervention goal
router.patch('/:id/goal', async (req, res) => {
  try {
    const { id } = req.params;
    const { goal_description, goal_target_date, goal_target_rating } = req.body;

    const result = await pool.query(`
      UPDATE student_interventions
      SET goal_description = $1,
          goal_target_date = $2,
          goal_target_rating = $3
      WHERE id = $4
      RETURNING *
    `, [goal_description, goal_target_date, goal_target_rating, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating intervention goal:', err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});
module.exports = router;