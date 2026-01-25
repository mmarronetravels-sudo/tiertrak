const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to get the Monday of a given week
function getWeekStart(date) {
  // Parse date string manually to avoid timezone issues
  let year, month, day;
  
  if (typeof date === 'string') {
    [year, month, day] = date.split('-').map(Number);
  } else {
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }
  
  // Create date at noon (avoids any daylight saving issues too)
  const d = new Date(year, month - 1, day, 12, 0, 0);
  
  // Calculate Monday of this week
  const dayOfWeek = d.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Sunday = go back 6, else go to Monday
  d.setDate(d.getDate() + diff);
  
  // Return as YYYY-MM-DD string (no timezone conversion)
  const resultYear = d.getFullYear();
  const resultMonth = String(d.getMonth() + 1).padStart(2, '0');
  const resultDay = String(d.getDate()).padStart(2, '0');
  
  return `${resultYear}-${resultMonth}-${resultDay}`;
}

// Get dropdown options
router.get('/options', (req, res) => {
  res.json({
    status: ['Implemented as Planned', 'Partially Implemented', 'Not Implemented', 'Student Absent'],
    response: ['Positive', 'Neutral', 'Resistant'],
    ratingScale: [
      { value: 1, label: 'No Progress' },
      { value: 2, label: 'Minimal Progress' },
      { value: 3, label: 'Some Progress' },
      { value: 4, label: 'Good Progress' },
      { value: 5, label: 'Significant Progress' }
    ]
  });
});

// Get all weekly progress logs for a student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { interventionId, startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        wp.*,
        si.intervention_name,
        si.goal_description,
        si.goal_target_date,
        si.goal_target_rating,
        u.full_name as logged_by_name
      FROM weekly_progress wp
      JOIN student_interventions si ON wp.student_intervention_id = si.id
      LEFT JOIN users u ON wp.logged_by = u.id
      WHERE wp.student_id = $1
    `;
    const params = [studentId];
    let paramIndex = 2;

    if (interventionId) {
      query += ` AND wp.student_intervention_id = $${paramIndex}`;
      params.push(interventionId);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND wp.week_of >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND wp.week_of <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY wp.week_of DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching weekly progress:', err);
    res.status(500).json({ error: 'Failed to fetch weekly progress' });
  }
});

// Get weekly progress for a specific intervention
router.get('/intervention/:interventionId', async (req, res) => {
  try {
    const { interventionId } = req.params;
    const result = await pool.query(`
      SELECT 
        wp.*,
        u.full_name as logged_by_name
      FROM weekly_progress wp
      LEFT JOIN users u ON wp.logged_by = u.id
      WHERE wp.student_intervention_id = $1
      ORDER BY wp.week_of DESC
    `, [interventionId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching intervention progress:', err);
    res.status(500).json({ error: 'Failed to fetch intervention progress' });
  }
});

// Get interventions missing this week's log for a tenant
router.get('/missing/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const currentWeek = getWeekStart(new Date().toISOString().split('T')[0]);

    const result = await pool.query(`
      SELECT 
        si.id,
        si.intervention_name,
        si.student_id,
        s.first_name,
        s.last_name,
        s.tier
      FROM student_interventions si
      JOIN students s ON si.student_id = s.id
      WHERE s.tenant_id = $1
        AND si.status = 'active'
        AND s.archived = false
        AND NOT EXISTS (
          SELECT 1 FROM weekly_progress wp 
          WHERE wp.student_intervention_id = si.id 
          AND wp.week_of = $2
        )
      ORDER BY s.last_name, s.first_name
    `, [tenantId, currentWeek]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching missing logs:', err);
    res.status(500).json({ error: 'Failed to fetch missing logs' });
  }
});

// Get progress summary for a student (for reports)
router.get('/summary/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    let query = `
      SELECT 
        si.intervention_name,
        si.goal_description,
        si.goal_target_date,
        si.goal_target_rating,
        COUNT(wp.id) as total_logs,
        AVG(wp.rating) as avg_rating,
        COUNT(CASE WHEN wp.status = 'Implemented as Planned' THEN 1 END) as implemented_count,
        COUNT(CASE WHEN wp.status = 'Student Absent' THEN 1 END) as absent_count,
        MIN(wp.week_of) as first_log,
        MAX(wp.week_of) as last_log
      FROM student_interventions si
      LEFT JOIN weekly_progress wp ON si.id = wp.student_intervention_id
      WHERE si.student_id = $1
    `;
    const params = [studentId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND wp.week_of >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND wp.week_of <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` GROUP BY si.id, si.intervention_name, si.goal_description, si.goal_target_date, si.goal_target_rating`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching progress summary:', err);
    res.status(500).json({ error: 'Failed to fetch progress summary' });
  }
});

// Create a weekly progress log
router.post('/', async (req, res) => {
  try {
    const { 
      student_intervention_id, 
      student_id,
      week_of, 
      status, 
      rating, 
      response, 
      notes, 
      logged_by 
    } = req.body;

    if (!student_intervention_id || !student_id || !week_of || !status) {
      return res.status(400).json({ 
        error: 'Missing required fields: student_intervention_id, student_id, week_of, status' 
      });
    }

    const normalizedWeek = getWeekStart(week_of);

    const result = await pool.query(`
      INSERT INTO weekly_progress 
        (student_intervention_id, student_id, week_of, status, rating, response, notes, logged_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (student_intervention_id, week_of) 
      DO UPDATE SET
        status = EXCLUDED.status,
        rating = EXCLUDED.rating,
        response = EXCLUDED.response,
        notes = EXCLUDED.notes,
        logged_by = EXCLUDED.logged_by,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [student_intervention_id, student_id, normalizedWeek, status, rating, response, notes, logged_by]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating weekly progress:', err);
    res.status(500).json({ error: 'Failed to create weekly progress log' });
  }
});

// Update a weekly progress log
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rating, response, notes } = req.body;

    const result = await pool.query(`
      UPDATE weekly_progress 
      SET status = $1, rating = $2, response = $3, notes = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `, [status, rating, response, notes, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Progress log not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating weekly progress:', err);
    res.status(500).json({ error: 'Failed to update weekly progress log' });
  }
});

// Delete a weekly progress log
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM weekly_progress WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Progress log not found' });
    }

    res.json({ message: 'Progress log deleted successfully' });
  } catch (err) {
    console.error('Error deleting weekly progress:', err);
    res.status(500).json({ error: 'Failed to delete weekly progress log' });
  }
});

module.exports = router;