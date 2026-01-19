const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Get all students for a tenant
router.get('/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const result = await pool.query(
      `SELECT s.*, u.full_name as teacher_name 
       FROM students s
       LEFT JOIN users u ON s.teacher_id = u.id
       WHERE s.tenant_id = $1 
       ORDER BY s.last_name, s.first_name`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get students by tier
router.get('/tenant/:tenantId/tier/:tier', async (req, res) => {
  try {
    const { tenantId, tier } = req.params;
    const result = await pool.query(
      `SELECT s.*, u.full_name as teacher_name 
       FROM students s
       LEFT JOIN users u ON s.teacher_id = u.id
       WHERE s.tenant_id = $1 AND s.tier = $2
       ORDER BY s.last_name, s.first_name`,
      [tenantId, tier]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single student with their interventions and notes
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get student info
    const studentResult = await pool.query(
      `SELECT s.*, u.full_name as teacher_name 
       FROM students s
       LEFT JOIN users u ON s.teacher_id = u.id
       WHERE s.id = $1`,
      [id]
    );
    
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    // Get interventions
    const interventionsResult = await pool.query(
      `SELECT si.*, u.full_name as assigned_by_name
       FROM student_interventions si
       LEFT JOIN users u ON si.assigned_by = u.id
       WHERE si.student_id = $1
       ORDER BY si.start_date DESC`,
      [id]
    );
    
    // Get progress notes
    const notesResult = await pool.query(
      `SELECT pn.*, u.full_name as author_name
       FROM progress_notes pn
       LEFT JOIN users u ON pn.author_id = u.id
       WHERE pn.student_id = $1
       ORDER BY pn.created_at DESC`,
      [id]
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

// Create a new student
router.post('/', async (req, res) => {
  try {
    const { tenant_id, first_name, last_name, grade, teacher_id, tier, area, risk_level } = req.body;
    const result = await pool.query(
      `INSERT INTO students (tenant_id, first_name, last_name, grade, teacher_id, tier, area, risk_level) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [tenant_id, first_name, last_name, grade, teacher_id, tier || 1, area, risk_level || 'low']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a student
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, grade, teacher_id, tier, area, risk_level } = req.body;
    const result = await pool.query(
      `UPDATE students 
       SET first_name = $1, last_name = $2, grade = $3, teacher_id = $4, 
           tier = $5, area = $6, risk_level = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 
       RETURNING *`,
      [first_name, last_name, grade, teacher_id, tier, area, risk_level, id]
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
router.patch('/:id/tier', async (req, res) => {
  try {
    const { id } = req.params;
    const { tier } = req.body;
    const result = await pool.query(
      `UPDATE students 
       SET tier = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 
       RETURNING *`,
      [tier, id]
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
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM students WHERE id = $1 RETURNING *',
      [id]
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