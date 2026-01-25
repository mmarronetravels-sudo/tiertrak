const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to get the Monday of a given week
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

    query += ' ORDER BY wp.week_of DESC, si.intervention_name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching weekly progress:', err);
    res.status(500).json({ error: 'Failed to fetch weekly progress' });
  }
});

// Get progress logs for a specific intervention
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
    const currentWeek = getWeekStart(new Date());
    
    const result = await pool.query(`
      SELECT 
        si.id as intervention_id,
        si.intervention_name,
        si.start_date,
        s.id as student_id,
        s.first_name,
        s.last_name,
        s.tier,
        s.area
      FROM student_interventions si
      JOIN students s ON si.student_id = s.id
      WHERE s.tenant_id = $1
        AND s.archived = FALSE
        AND si.status = 'active'
        AND si.start_date <= $2
        AND NOT EXISTS (
          SELECT 1 FROM weekly_progress wp 
          WHERE wp.student_intervention_id = si.id 
          AND wp.week_of = $2
        )
      ORDER BY s.last_name, s.first_name, si.intervention_name
    `, [tenantId, currentWeek]);
    
    res.json({
      week_of: currentWeek,
      missing_count: result.rows.length,
      interventions: result.rows
    });
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
    
    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate || new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const studentResult = await pool.query(`
      SELECT s.*, u.full_name as teacher_name, t.name as school_name
      FROM students s
      LEFT JOIN users u ON s.teacher_id = u.id
      LEFT JOIN tenants t ON s.tenant_id = t.id
      WHERE s.id = $1
    `, [studentId]);
    
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const interventionsResult = await pool.query(`
      SELECT 
        si.*,
        u.full_name as assigned_by_name,
        (
          SELECT json_agg(
            json_build_object(
              'week_of', wp.week_of,
              'status', wp.status,
              'rating', wp.rating,
              'response', wp.response,
              'notes', wp.notes,
              'logged_by_name', lu.full_name
            ) ORDER BY wp.week_of
          )
          FROM weekly_progress wp
          LEFT JOIN users lu ON wp.logged_by = lu.id
          WHERE wp.student_intervention_id = si.id
            AND wp.week_of BETWEEN $2 AND $3
        ) as progress_logs,
        (
          SELECT AVG(rating)::numeric(3,2)
          FROM weekly_progress
          WHERE student_intervention_id = si.id
            AND week_of BETWEEN $2 AND $3
            AND rating IS NOT NULL
        ) as avg_rating,
        (
          SELECT COUNT(*)
          FROM weekly_progress
          WHERE student_intervention_id = si.id
            AND week_of BETWEEN $2 AND $3
        ) as total_logs,
        (
          SELECT COUNT(*)
          FROM weekly_progress
          WHERE student_intervention_id = si.id
            AND week_of BETWEEN $2 AND $3
            AND status = 'Implemented as Planned'
        ) as implemented_count
      FROM student_interventions si
      LEFT JOIN users u ON si.assigned_by = u.id
      WHERE si.student_id = $1
        AND (si.status = 'active' OR si.end_date >= $2)
      ORDER BY si.start_date
    `, [studentId, start, end]);
    
    const notesResult = await pool.query(`
      SELECT pn.*, u.full_name as author_name
      FROM progress_notes pn
      LEFT JOIN users u ON pn.author_id = u.id
      WHERE pn.student_id = $1
        AND pn.created_at BETWEEN $2 AND $3
      ORDER BY pn.created_at DESC
    `, [studentId, start, end]);
    
    res.json({
      student: studentResult.rows[0],
      date_range: { start, end },
      interventions: interventionsResult.rows,
      progress_notes: notesResult.rows,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error generating progress summary:', err);
    res.status(500).json({ error: 'Failed to generate progress summary' });
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
      SET status = COALESCE($1, status),
          rating = COALESCE($2, rating),
          response = COALESCE($3, response),
          notes = COALESCE($4, notes),
          updated_at = CURRENT_TIMESTAMP
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

    res.json({ message: 'Progress log deleted', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting weekly progress:', err);
    res.status(500).json({ error: 'Failed to delete weekly progress log' });
  }
});

// Get dropdown options for progress logging
router.get('/options', async (req, res) => {
  res.json({
    status_options: [
      'Implemented as Planned',
      'Partially Implemented',
      'Not Implemented',
      'Student Absent'
    ],
    response_options: [
      'Positive',
      'Neutral',
      'Resistant'
    ],
    rating_scale: {
      1: 'No Progress',
      2: 'Minimal Progress',
      3: 'Some Progress',
      4: 'Good Progress',
      5: 'Significant Progress'
    }
  });
});

module.exports = router;