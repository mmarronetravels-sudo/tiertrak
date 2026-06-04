const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { applyStudentAccessGate } = require('../middleware/canAccessStudent');
const { requireStudentReadAccess, requireInterventionReadAccess } = require('../middleware/authorizeInterventionAccess');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const FORBIDDEN_BODY = { error: 'Not authorized' };

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

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

// GET logs for a student.
//
// Tenant binding (§5): :studentId is gated by the canonical
// requireStudentReadAccess middleware — walks students.tenant_id and
// delegates to applyStudentAccessGate for staff branches (with
// resolveAccessibleTenantIds for §5 dual-path), and to parent_student_links
// membership for parents. Not-found and wrong-tenant collapse to a
// byte-identical 403 inside the middleware.
//
// Pre-fix this handler had NO tenant scope and projected u.full_name as
// logged_by_name + si.intervention_name for every log row by raw
// :studentId — any authenticated user could probe student ids cross-tenant
// and enumerate the staff logger-directory plus intervention names
// (R2 in the reads-tier scoping pass). The middleware now gates the read;
// URL pattern unchanged from the client's perspective.
router.get('/student/:studentId', requireStudentReadAccess, async (req, res) => {
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
    // §4B: integer user_id + err.message only. No body echo, no PII.
    console.error('[interventionLogs:getByStudent]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET logs for a specific intervention.
//
// Tenant binding (§5): :interventionId is the student_intervention id; the
// canonical requireInterventionReadAccess middleware walks
// student_interventions → students.tenant_id and gates via the same
// applyStudentAccessGate as the assignments-GET fix (PR #210). Parent role
// is supported via parent_student_links membership (read-side). Not-found
// and wrong-tenant collapse to a byte-identical 403 inside the middleware.
//
// Pre-fix this handler had NO tenant scope and projected u.full_name as
// logged_by_name for every log row by raw :interventionId — any
// authenticated user could probe student_intervention ids cross-tenant and
// enumerate the staff logger-directory (R2 in the reads-tier scoping
// pass; same shape as the HIGH-1 leak closed in PR #210). URL pattern
// unchanged from the client's perspective.
router.get('/intervention/:interventionId', requireInterventionReadAccess, async (req, res) => {
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
    // §4B: integer user_id + err.message only. No body echo, no PII.
    console.error('[interventionLogs:getByIntervention]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new intervention log.
//
// Tenant binding (§5): the student named in req.body.student_id is looked
// up; its tenant must be in the caller's accessible-tenant set per the
// dual-path helper. The decision is delegated to applyStudentAccessGate
// so dark mode (legacy tenant-membership) and strict mode (per-record
// caseload predicate from canStaffAccessStudent) are both supported.
// Not-found and wrong-tenant collapse to a byte-identical 403 to avoid
// cross-tenant existence disclosure.
//
// student_intervention_id is optional. When supplied, its student_id
// must match the body-supplied student_id — prevents a body-side-channel
// where a caller could attach a log to a student_intervention belonging
// to a different student/tenant.
router.post('/', async (req, res) => {
  try {
    if (req.user && req.user.role === 'parent') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const { student_intervention_id, student_id, log_date, time_of_day, location, notes } = req.body || {};

    // Validate required fields. logged_by is server-derived from req.user.id;
    // any body-supplied logged_by is intentionally ignored to prevent spoofing
    // the author of a log entry.
    if (!isPositiveInt(student_id) || !time_of_day || !location) {
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

    // Per-record tenant gate. Look up the student (tier needed for the
    // strict-mode caseload branch). 0 rows OR tenant-not-accessible OR
    // gate-deny all collapse to 403.
    const accessible = await resolveAccessibleTenantIds(req.user);
    const studentRes = await pool.query(
      'SELECT id, tenant_id, tier FROM students WHERE id = $1',
      [student_id]
    );
    if (studentRes.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentRow = studentRes.rows[0];
    const { decision } = await applyStudentAccessGate(req.user, studentRow, {
      legacyAllowed: accessible.includes(studentRow.tenant_id)
    });
    if (decision !== 'allow') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    // If student_intervention_id supplied, its student_id MUST match the
    // body's student_id. Composite check closes the cross-student/cross-
    // tenant side-channel where a body could attach a log to another
    // tenant's intervention row.
    if (student_intervention_id != null) {
      if (!isPositiveInt(student_intervention_id)) {
        return res.status(400).json({ error: 'Invalid student_intervention_id' });
      }
      const siRes = await pool.query(
        'SELECT 1 FROM student_interventions WHERE id = $1 AND student_id = $2',
        [student_intervention_id, student_id]
      );
      if (siRes.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid student_intervention_id' });
      }
    }

    const result = await pool.query(
      `INSERT INTO intervention_logs (student_intervention_id, student_id, logged_by, log_date, time_of_day, location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [student_intervention_id || null, student_id, req.user.id, log_date || new Date(), time_of_day, location, notes]
    );
    
    // Update the student's updated_at timestamp
    await pool.query(
      `UPDATE students SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [student_id]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    // §4B: integer user_id + err.message only. No body echo, no PII
    // (student_id is an integer; notes column never enters the log line).
    console.error('[interventionLogs:create]', 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;