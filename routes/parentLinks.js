const express = require('express');
const router = express.Router();
const {
  requireAuth,
  requireTenantStaffAccess,
  requireStudentReadAccess
} = require('../middleware/authorizeInterventionAccess');

let pool;

const initializePool = (p) => {
  pool = p;
};

const FORBIDDEN_BODY = { error: 'Not authorized' };

// Admin-only allowlist for write routes (POST, DELETE). Counselors are
// excluded — current FE callers (frontend/src/App.jsx:1345
// handleAddParent, frontend/src/App.jsx:1376 handleLinkParent,
// frontend/src/App.jsx:1402 handleUnlinkParent) are admin-panel actions.
// Parent role is implicitly excluded by virtue of the allowlist (no
// separate parent-block needed where this is used). Narrower-then-loosen
// — widen if a counselor use case for parent-roster management appears.
const ADMIN_ROLES = ['school_admin', 'district_admin'];

// Load a parent_student_links row by id and assert it belongs to the
// caller's tenant. parent_student_links has no tenant_id column so we
// JOIN to students to derive the tenant. Returns { ok: true, row } or
// { ok: false, status, body } so the caller can respond with a byte-
// identical 403 for both "row not found" and "wrong tenant" — preventing
// existence-disclosure across tenants. Mirrors loadFormAndAssertTenant
// from PR #59 (routes/prereferralForms.js:30-42); the only deviation is
// the JOIN and the dropped status column (parent_student_links has no
// status-guard concept).
async function loadLinkAndAssertTenant(linkId, user) {
  const result = await pool.query(
    `SELECT psl.id, s.tenant_id
     FROM parent_student_links psl
     JOIN students s ON psl.student_id = s.id
     WHERE psl.id = $1`,
    [linkId]
  );
  if (result.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  if (result.rows[0].tenant_id !== user.tenant_id) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  return { ok: true, row: result.rows[0] };
}

// GET parents for a student
// requireStudentReadAccess permits parents-of-linked-students through (per
// its general use across read routes), but parent-link metadata — i.e. the
// list of which parents are attached to a student — is FERPA-protected and
// not appropriate for the parent surface even when the parent is one of
// those linked. Handler-level parent-block overrides the middleware's
// parent permission for this specific route. Mirrors PR #59 prereferral
// /student/:studentId framing.
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const result = await pool.query(`
      SELECT psl.*, u.full_name as parent_name, u.email as parent_email
      FROM parent_student_links psl
      JOIN users u ON psl.parent_user_id = u.id
      JOIN students s ON psl.student_id = s.id
      WHERE psl.student_id = $1 AND s.tenant_id = $2
      ORDER BY psl.relationship
    `, [req.params.studentId, req.user.tenant_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching parent links:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET students for a parent (used by parent portal)
// Parents-only self-parity: only the parent themselves can list their own
// linked students. Staff have no current FE caller for this surface
// (frontend/src/App.jsx:6135 is the parent-portal caller). Narrower-then-
// loosen — widen later if a staff use case appears.
//
// SQL sources parent_user_id from req.user.id (server-derived, not the URL
// param) so a future regression that loosens the parity assert above cannot
// leak another parent's children. The s.tenant_id = $2 clause is defense-
// in-depth against the edge case of a parent_student_links row whose
// student belongs to a different tenant than the parent's own users.tenant_id
// — should not happen by construction, but the clause makes it impossible
// to leak through this read.
router.get('/parent/:parentUserId', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'parent'
        || Number(req.params.parentUserId) !== req.user.id) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const result = await pool.query(`
      SELECT s.*, psl.relationship
      FROM students s
      JOIN parent_student_links psl ON s.id = psl.student_id
      WHERE psl.parent_user_id = $1 AND s.tenant_id = $2
      ORDER BY s.last_name, s.first_name
    `, [req.user.id, req.user.tenant_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching parent students:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST link parent to student
// Order of operations is load-bearing for probe-resistance:
//   1. requireAuth (middleware) — 401 if not authenticated
//   2. ADMIN_ROLES gate — 403 if not school_admin/district_admin
//   3. body validation — 400 if student_id/parent_user_id malformed
//   4. two-tenant cross-check (single EXISTS query) — byte-identical 403
//      collapsing five failure modes: student missing, student wrong
//      tenant, parent missing, parent wrong tenant, parent role != 'parent'
//   5. 2-parent cap — 400 if already at 2 (operates on a tenant-verified
//      student, so the message no longer leaks foreign-tenant existence)
//   6. INSERT with ON CONFLICT — 409 if exact pair already linked
// Pre-commit-3 ordering had the cap query running BEFORE any tenant
// verification, which leaked the existence of foreign-tenant students
// to a Parkview admin probing Lincoln student IDs and could have created
// cross-tenant parent_student_links rows. Reorder is the security fix.
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const studentId = Number(req.body.student_id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ error: 'Missing or invalid required field: student_id' });
    }
    const parentUserId = Number(req.body.parent_user_id);
    if (!Number.isInteger(parentUserId) || parentUserId <= 0) {
      return res.status(400).json({ error: 'Missing or invalid required field: parent_user_id' });
    }
    const relationship = req.body.relationship || 'parent';

    // Two-tenant cross-check: student must belong to caller's tenant AND
    // parent_user_id must belong to caller's tenant with role='parent'.
    // Five failure modes collapse to one byte-identical 403 — a probe
    // gives no information beyond "request denied."
    const crossCheck = await pool.query(`
      SELECT 1
      WHERE EXISTS (
              SELECT 1 FROM students
              WHERE id = $1 AND tenant_id = $3
            )
        AND EXISTS (
              SELECT 1 FROM users
              WHERE id = $2 AND tenant_id = $3 AND role = 'parent'
            )
    `, [studentId, parentUserId, req.user.tenant_id]);

    if (crossCheck.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    // 2-parent cap. Operates on a tenant-verified student post-cross-check,
    // so the 400 message is informative without leaking foreign-tenant
    // existence (no caller can reach this line for a non-own-tenant student).
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM parent_student_links WHERE student_id = $1',
      [studentId]
    );
    if (parseInt(countResult.rows[0].count, 10) >= 2) {
      return res.status(400).json({ error: 'Student already has 2 parent accounts linked' });
    }

    const result = await pool.query(`
      INSERT INTO parent_student_links (parent_user_id, student_id, relationship)
      VALUES ($1, $2, $3)
      ON CONFLICT (parent_user_id, student_id) DO NOTHING
      RETURNING *
    `, [parentUserId, studentId, relationship]);

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'This parent is already linked to this student' });
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error linking parent:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove parent link
// Order of operations:
//   1. requireAuth (middleware) — 401 if not authenticated
//   2. ADMIN_ROLES gate — 403 if not school_admin/district_admin
//   3. loadLinkAndAssertTenant helper — byte-identical 403 for both
//      "link does not exist" and "link belongs to another tenant"
//   4. DELETE with USING + s.tenant_id = $2 — atomic defense-in-depth.
//      Even if a TOCTOU race between helper and DELETE moved the linked
//      student to another tenant in the interim, the USING JOIN refuses
//      the cross-tenant mutation.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const auth = await loadLinkAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const result = await pool.query(`
      DELETE FROM parent_student_links psl
      USING students s
      WHERE psl.id = $1
        AND psl.student_id = s.id
        AND s.tenant_id = $2
      RETURNING psl.id
    `, [req.params.id, req.user.tenant_id]);

    if (result.rows.length === 0) {
      // Helper assert passed but the DELETE returned no rows. Only
      // reachable via a TOCTOU race (row deleted by a concurrent
      // request, or student moved to another tenant between helper
      // and DELETE). Idempotent post-state: the row is gone either
      // way, so we report success rather than surface the race.
      return res.json({ success: true });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing parent link:', error);
    res.status(500).json({ error: error.message });
  }
});
// GET all parent-student links for a tenant (for Admin panel)
// requireTenantStaffAccess parity-asserts the URL :tenantId against
// req.user.tenant_id and excludes parent role. SQL sources tenant_id from
// req.user.tenant_id (server-derived) — the URL param is decorative and
// trusted only after the middleware's equality check.
router.get('/tenant/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        psl.id,
        psl.parent_user_id,
        psl.student_id,
        psl.relationship,
        u.full_name as parent_name,
        u.email as parent_email,
        s.first_name || ' ' || s.last_name as student_name
      FROM parent_student_links psl
      JOIN users u ON psl.parent_user_id = u.id
      JOIN students s ON psl.student_id = s.id
      WHERE s.tenant_id = $1
      ORDER BY u.full_name, s.last_name
    `, [req.user.tenant_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tenant parent links:', error);
    res.status(500).json({ error: error.message });
  }
});module.exports = router;
module.exports.initializePool = initializePool;
