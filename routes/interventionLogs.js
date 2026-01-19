const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Valid options for dropdowns
const TIME_OF_DAY_OPTIONS = ['Before School', 'Morning', 'Mid-Morning', 'Lunch', 'Afternoon', 'After School'];
const LOCATION_OPTIONS = ['Classroom', 'Hallway', 'Cafeteria', 'Playground', 'Gym', 'Library', 'Office', 'Counselor Office', 'Special Education Room', 'Other'];

// Get dropdown options (for frontend)
router.get('/options', (req, res) => {
  res.json({
    timeOfDay: TIME_OF_DAY_OPTIONS,
    location: LOCATION_OPTIONS
  });
});

// Get all logs for a student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT il.*, u.full_name as logged_by_name, si.intervention_name
       FROM intervention_logs il
       LEFT JOIN users u ON il.logged_by = u.id
       LEFT JOIN student_interventions si ON il.student_intervention_id = si.id
       WHERE il.student_id = $1
       ORDER BY il.log_date DESC, il.created_at DESC`,
      [studentId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all logs for a specific intervention
router.get('/intervention/:interventionId', async (req, res) => {
  try {
    const { interventionId } = req.params;
    const result = await pool.query(
      `SELECT il.*, u.full_name as logged_by_name
       FROM intervention_logs il
       LEFT JOIN users u ON il.logged_by = u.id
       WHERE il.student_intervention_id = $1
       ORDER BY il.log_date DESC, il.created_at DESC`,
      [interventionId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new intervention log
router.post('/', async (req, res) => {
  try {
    const { student_intervention_id, student_id, logged_by, log_date, time_of_day, location, notes } = req.body;
    
    // Validate required fields
    if (!student_id || !logged_by || !time_of_day || !location) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate time_of_day
    if (!TIME_OF_DAY_OPTIONS.includes(time_of_day)) {
      return res.status(400).json({ error: `Invalid time of day. Must be one of: ${TIME_OF_DAY_OPTIONS.join(', ')}` });
    }
    
    // Validate location
    if (!LOCATION_OPTIONS.includes(location)) {
      return res.status(400).json({ error: `Invalid location. Must be one of: ${LOCATION_OPTIONS.join(', ')}` });
    }
    
    const result = await pool.query(
      `INSERT INTO intervention_logs (student_intervention_id, student_id, logged_by, log_date, time_of_day, location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [student_intervention_id || null, student_id, logged_by, log_date || new Date(), time_of_day, location, notes]
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

// Update an intervention log
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { log_date, time_of_day, location, notes } = req.body;
    
    // Validate time_of_day if provided
    if (time_of_day && !TIME_OF_DAY_OPTIONS.includes(time_of_day)) {
      return res.status(400).json({ error: `Invalid time of day. Must be one of: ${TIME_OF_DAY_OPTIONS.join(', ')}` });
    }
    
    // Validate location if provided
    if (location && !LOCATION_OPTIONS.includes(location)) {
      return res.status(400).json({ error: `Invalid location. Must be one of: ${LOCATION_OPTIONS.join(', ')}` });
    }
    
    const result = await pool.query(
      `UPDATE intervention_logs
       SET log_date = $1, time_of_day = $2, location = $3, notes = $4
       WHERE id = $5
       RETURNING *`,
      [log_date, time_of_day, location, notes, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention log not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an intervention log
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM intervention_logs WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention log not found' });
    }
    res.json({ message: 'Intervention log deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;