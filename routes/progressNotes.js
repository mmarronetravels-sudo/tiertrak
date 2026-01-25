const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get all progress notes for a student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT pn.*, u.full_name as author_name
       FROM progress_notes pn
       LEFT JOIN users u ON pn.author_id = u.id
       WHERE pn.student_id = $1
       ORDER BY pn.created_at DESC`,
      [studentId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new progress note
router.post('/', async (req, res) => {
  try {
    const { student_id, author_id, note, meeting_date } = req.body;
    const result = await pool.query(
      `INSERT INTO progress_notes (student_id, author_id, note, meeting_date) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [student_id, author_id, note, meeting_date || new Date().toISOString().split('T')[0]]
    );
    
    // Update the student's updated_at timestamp
    await pool.query(
      `UPDATE students SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [student_id]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a progress note
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const result = await pool.query(
      `UPDATE progress_notes 
       SET note = $1
       WHERE id = $2 
       RETURNING *`,
      [note, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Progress note not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a progress note
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM progress_notes WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Progress note not found' });
    }
    res.json({ message: 'Progress note deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;