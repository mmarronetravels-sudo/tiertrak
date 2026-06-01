const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();
const {
  requireAuth,
  requireStudentReadAccess,
} = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { applyStudentAccessGate } = require('../middleware/canAccessStudent');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================
// progressNotes — closes the live prod auth hole. Pre-fix: all four
// handlers were mounted without requireAuth and the route file had
// zero auth references (confirmed via grep on main pre-PR). Any
// unauthenticated caller could read, create, edit, or delete any
// student's staff progress notes across any tenant.
//
// This PR's scope is auth-hole-only — mirrors the sibling
// routes/weeklyProgress.js gate shape using EXISTING middleware:
//   - GET /student/:studentId  → requireAuth + requireStudentReadAccess
//   - POST /                   → requireAuth + inline staff-tenant check
//   - PUT /:id                 → requireAuth + note→student tenant check
//   - DELETE /:id              → requireAuth + note→student tenant check
//
// The new canonical access predicate (feat/student-access-predicate,
// pending) is NOT introduced here — progressNotes inherits it when
// requireStudentReadAccess and the staff-tenant inline checks are
// updated there. This PR keeps that change off the diff.
//
// Banked followups (out of scope per the auth-hole-only directive):
//   F-A — author_id is body-readable on POST (impersonation surface).
//         Should be server-derived from req.user.id.
//   F-B — error.message echoed in response bodies (information
//         disclosure via pg error text). Should redact to generic
//         "Server error" with console.error tag + err.message only.
//   F-C — meeting_date is unvalidated on POST (no shape regex,
//         no future-date guard). Mirrors the discipline-referral
//         hygiene followup family.
//   F-D — PUT has no ownership check (any staff in tenant can edit
//         any author's note). Same on DELETE. Owner-or-admin
//         tightening is a separate behavior change.
// ============================================================

const FORBIDDEN_BODY = { error: 'Not authorized' };

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// Get all progress notes for a student.
// Auth chain: requireAuth → requireStudentReadAccess. The latter
// admits parents-by-link (FERPA-aligned: parents have a right to see
// staff observations of their child) and staff-by-accessible-tenant.
// requireStudentReadAccess sets req.student = { id, tenant_id }.
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
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

// Create a new progress note.
// Staff-only write surface. Parents are 403 (staff observations are
// not parent-authored). Inline tenant check mirrors the staff branch
// of requireStudentReadAccess.
router.post('/', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const { student_id, author_id, note, meeting_date } = req.body;

    const sid = parseInt(student_id, 10);
    if (!isPositiveInt(sid)) {
      return res.status(400).json({ error: 'Invalid student_id' });
    }

    // Student access: load tenant + tier, then route through
    // applyStudentAccessGate (flag-gated). Dark mode preserves the
    // tenant-only decision; strict mode enforces the canonical predicate.
    // Not-found collapses to 403 for existence-non-disclosure parity.
    const studentRes = await pool.query(
      'SELECT id, tenant_id, tier FROM students WHERE id = $1',
      [sid]
    );
    if (studentRes.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentRow = studentRes.rows[0];
    const accessible = await resolveAccessibleTenantIds(req.user);
    const legacyAllowed = accessible.includes(studentRow.tenant_id);
    const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
    if (gate.decision === 'deny') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const result = await pool.query(
      `INSERT INTO progress_notes (student_id, author_id, note, meeting_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sid, author_id, note, meeting_date || new Date().toISOString().split('T')[0]]
    );

    // Update the student's updated_at timestamp
    await pool.query(
      `UPDATE students SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [sid]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a progress note.
// Lookup chain: note → student → tenant. Not-found on the note
// collapses to 403 (existence-non-disclosure parity with
// requireWriteAccessByLogId in middleware/authorizeInterventionAccess.js).
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const noteRes = await pool.query(
      'SELECT student_id FROM progress_notes WHERE id = $1',
      [id]
    );
    if (noteRes.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const studentRes = await pool.query(
      'SELECT id, tenant_id, tier FROM students WHERE id = $1',
      [noteRes.rows[0].student_id]
    );
    if (studentRes.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentRow = studentRes.rows[0];
    const accessible = await resolveAccessibleTenantIds(req.user);
    const legacyAllowed = accessible.includes(studentRow.tenant_id);
    const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
    if (gate.decision === 'deny') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const { note } = req.body;
    const result = await pool.query(
      `UPDATE progress_notes
       SET note = $1
       WHERE id = $2
       RETURNING *`,
      [note, id]
    );
    if (result.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a progress note. Same gate shape as PUT.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const noteRes = await pool.query(
      'SELECT student_id FROM progress_notes WHERE id = $1',
      [id]
    );
    if (noteRes.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const studentRes = await pool.query(
      'SELECT id, tenant_id, tier FROM students WHERE id = $1',
      [noteRes.rows[0].student_id]
    );
    if (studentRes.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentRow = studentRes.rows[0];
    const accessible = await resolveAccessibleTenantIds(req.user);
    const legacyAllowed = accessible.includes(studentRow.tenant_id);
    const gate = await applyStudentAccessGate(req.user, studentRow, { legacyAllowed });
    if (gate.decision === 'deny') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const result = await pool.query(
      'DELETE FROM progress_notes WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    res.json({ message: 'Progress note deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
