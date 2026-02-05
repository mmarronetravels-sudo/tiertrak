const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get archive reason options
router.get('/archive-reasons', async (req, res) => {
  const reasons = [
    'Completed Interventions',
    'End of School Year',
    'Transferred Out',
    'No Longer Needs Support',
    'Other'
  ];
  res.json(reasons);
});

// Get all students for a tenant (with archive filter and role-based access)
router.get('/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { includeArchived, onlyArchived, search } = req.query;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const schoolWideAccess = req.headers['x-school-wide-access'] === 'true';
    
    let query;
    let params;
    
    // Admin and users with school_wide_access see all students
    if (userRole === 'school_admin' || schoolWideAccess) {
      query = `
        SELECT s.*, u.full_name as teacher_name 
        FROM students s
        LEFT JOIN users u ON s.teacher_id = u.id
        WHERE s.tenant_id = $1
      `;
      params = [tenantId];
    }
    // Parents see only their linked children
    else if (userRole === 'parent') {
      query = `
        SELECT DISTINCT s.*, u.full_name as teacher_name 
        FROM students s
        LEFT JOIN users u ON s.teacher_id = u.id
        INNER JOIN parent_student_links psl ON s.id = psl.student_id
        WHERE s.tenant_id = $1 AND psl.parent_user_id = $2
      `;
      params = [tenantId, userId];
    }
    // Teachers/staff see all Tier 1 students + their assigned Tier 2/3 students
    else {
      query = `
        SELECT DISTINCT s.*, u.full_name as teacher_name 
        FROM students s
        LEFT JOIN users u ON s.teacher_id = u.id
        WHERE s.tenant_id = $1 
          AND (
            s.tier = 1
            OR s.id IN (
              SELECT si.student_id 
              FROM student_interventions si
              INNER JOIN intervention_assignments ia ON si.id = ia.student_intervention_id
              WHERE si.status = 'active' AND ia.user_id = $2
            )
          )
      `;
      params = [tenantId, userId];
    }
    
    // Archive filters
    if (onlyArchived === 'true') {
      query += ` AND s.archived = TRUE`;
    } else if (includeArchived !== 'true') {
      query += ` AND (s.archived = FALSE OR s.archived IS NULL)`;
    }

    // Search filter
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(s.first_name) LIKE LOWER($${params.length}) OR LOWER(s.last_name) LIKE LOWER($${params.length}))`;
    }
    
    query += ` ORDER BY s.archived ASC, s.last_name, s.first_name`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get student statistics including archive counts
router.get('/tenant/:tenantId/stats', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE archived = FALSE OR archived IS NULL) as active_count,
        COUNT(*) FILTER (WHERE archived = TRUE) as archived_count,
        COUNT(*) FILTER (WHERE tier = 1 AND (archived = FALSE OR archived IS NULL)) as tier1_count,
        COUNT(*) FILTER (WHERE tier = 2 AND (archived = FALSE OR archived IS NULL)) as tier2_count,
        COUNT(*) FILTER (WHERE tier = 3 AND (archived = FALSE OR archived IS NULL)) as tier3_count,
        COUNT(*) as total_count
      FROM students
      WHERE tenant_id = $1
    `, [tenantId]);
    
    res.json(result.rows[0]);
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
       WHERE s.tenant_id = $1 AND s.tier = $2 AND (s.archived = FALSE OR s.archived IS NULL)
       ORDER BY s.last_name, s.first_name`,
      [tenantId, tier]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function for referral flag reasons
function getFlagReasons(student) {
  const reasons = [];
  const interventions = parseInt(student.active_interventions);
  const logs = parseInt(student.total_logs);
  const avg = student.avg_rating ? parseFloat(student.avg_rating) : null;
  
  if (interventions >= 3) {
    reasons.push(`${interventions} active interventions`);
  }
  if (logs >= 4 && avg !== null && avg <= 2.0) {
    reasons.push(`Avg rating ${avg}/5 across ${logs} logs`);
  }
  if (interventions >= 2 && logs >= 2 && avg !== null && avg < 3.0) {
    reasons.push(`Low progress (${avg}/5) with ${interventions} interventions`);
  }
  return reasons;
}

// GET referral candidates - Tier 1 students who may need MTSS referral
router.get('/referral-candidates/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.first_name,
        s.last_name,
        s.grade,
        s.area,
        s.tier,
        COUNT(DISTINCT si.id) AS active_interventions,
        COUNT(DISTINCT wp.id) AS total_logs,
        ROUND(AVG(wp.rating)::numeric, 2) AS avg_rating,
        MIN(si.start_date) AS earliest_intervention,
        pf.id AS prereferral_id,
        pf.status AS prereferral_status
      FROM students s
      INNER JOIN student_interventions si 
        ON s.id = si.student_id AND si.status = 'active'
      LEFT JOIN weekly_progress wp 
        ON si.id = wp.student_intervention_id
      LEFT JOIN prereferral_forms pf 
        ON s.id = pf.student_id AND pf.status IN ('draft', 'submitted', 'approved')
      WHERE s.tenant_id = $1
        AND s.tier = 1
        AND s.archived = false
        AND s.id NOT IN (SELECT student_id FROM referral_monitoring)
      GROUP BY s.id, s.first_name, s.last_name, s.grade, s.area, s.tier, pf.id, pf.status
      HAVING 
        COUNT(DISTINCT si.id) >= 3
        OR (COUNT(DISTINCT wp.id) >= 4 AND AVG(wp.rating) <= 2.0)
        OR (COUNT(DISTINCT si.id) >= 2 AND COUNT(DISTINCT wp.id) >= 2 AND AVG(wp.rating) < 3.0)
      ORDER BY 
        COALESCE(AVG(wp.rating), 0) ASC,
        COUNT(DISTINCT si.id) DESC
    `, [tenantId]);

    // Filter out students who already have submitted/approved pre-referral forms
    const candidates = result.rows.filter(s => 
      !s.prereferral_status || s.prereferral_status === 'draft'
    );

    res.json({
      count: candidates.length,
      candidates: candidates.map(s => ({
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        grade: s.grade,
        area: s.area,
        active_interventions: parseInt(s.active_interventions),
        total_logs: parseInt(s.total_logs),
        avg_rating: s.avg_rating ? parseFloat(s.avg_rating) : null,
        earliest_intervention: s.earliest_intervention,
        has_prereferral_draft: s.prereferral_status === 'draft',
        flag_reasons: getFlagReasons(s)
      }))
    });

  } catch (error) {
    console.error('Error fetching referral candidates:', error);
    res.status(500).json({ error: error.message });
  }
});
// GET monitored referral students with live stats
router.get('/referral-monitoring/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.first_name,
        s.last_name,
        s.grade,
        s.area,
        s.tier,
        rm.id AS monitoring_id,
        rm.notes AS monitoring_notes,
        rm.created_at AS monitoring_since,
        u.full_name AS monitored_by_name,
        COUNT(DISTINCT si.id) AS active_interventions,
        COUNT(DISTINCT wp.id) AS total_logs,
        ROUND(AVG(wp.rating)::numeric, 2) AS avg_rating
      FROM referral_monitoring rm
      INNER JOIN students s ON rm.student_id = s.id
      LEFT JOIN users u ON rm.monitored_by = u.id
      LEFT JOIN student_interventions si 
        ON s.id = si.student_id AND si.status = 'active'
      LEFT JOIN weekly_progress wp 
        ON si.id = wp.student_intervention_id
      WHERE rm.tenant_id = $1
        AND s.tier = 1
        AND s.archived = false
      GROUP BY s.id, s.first_name, s.last_name, s.grade, s.area, s.tier, 
               rm.id, rm.notes, rm.created_at, u.full_name
      ORDER BY COALESCE(AVG(wp.rating), 0) ASC
    `, [tenantId]);

    res.json({
      count: result.rows.length,
      monitored: result.rows.map(s => ({
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        grade: s.grade,
        area: s.area,
        monitoring_id: s.monitoring_id,
        monitoring_notes: s.monitoring_notes,
        monitoring_since: s.monitoring_since,
        monitored_by_name: s.monitored_by_name,
        active_interventions: parseInt(s.active_interventions),
        total_logs: parseInt(s.total_logs),
        avg_rating: s.avg_rating ? parseFloat(s.avg_rating) : null
      }))
    });

  } catch (error) {
    console.error('Error fetching monitored students:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST mark student as monitoring
router.post('/referral-monitoring', async (req, res) => {
  try {
    const { student_id, tenant_id, monitored_by, notes } = req.body;
    
    const result = await pool.query(`
      INSERT INTO referral_monitoring (student_id, tenant_id, monitored_by, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (student_id) DO UPDATE SET 
        notes = $4, 
        monitored_by = $3,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [student_id, tenant_id, monitored_by, notes || null]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error marking as monitoring:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove from monitoring (to start referral or dismiss)
router.delete('/referral-monitoring/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    await pool.query('DELETE FROM referral_monitoring WHERE student_id = $1', [studentId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing monitoring:', error);
    res.status(500).json({ error: error.message });
  }
});
// Get a single student with their interventions and notes
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
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
    
    const interventionsResult = await pool.query(
      `SELECT si.*, u.full_name as assigned_by_name
       FROM student_interventions si
       LEFT JOIN users u ON si.assigned_by = u.id
       WHERE si.student_id = $1
       ORDER BY si.start_date DESC`,
      [id]
    );
    
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
      `INSERT INTO students (tenant_id, first_name, last_name, grade, teacher_id, tier, area, risk_level, archived) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE) 
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

// Archive a student
router.patch('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const { archived_reason, archived_by } = req.body;
    
    if (!archived_reason) {
      return res.status(400).json({ error: 'Archive reason is required' });
    }
    
    const validReasons = [
      'Completed Interventions',
      'End of School Year',
      'Transferred Out',
      'No Longer Needs Support',
      'Other'
    ];
    
    if (!validReasons.includes(archived_reason)) {
      return res.status(400).json({ error: 'Invalid archive reason' });
    }
    
    const result = await pool.query(
      `UPDATE students 
       SET archived = TRUE, 
           archived_at = CURRENT_TIMESTAMP,
           archived_by = $1,
           archived_reason = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [archived_by, archived_reason, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unarchive (reactivate) a student
router.patch('/:id/unarchive', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE students 
       SET archived = FALSE, 
           archived_at = NULL,
           archived_by = NULL,
           archived_reason = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
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
