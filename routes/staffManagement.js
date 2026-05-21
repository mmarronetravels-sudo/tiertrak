const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { ELEVATED_ROLES } = require('../constants/roles');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// Staff roles (not parent). Createable-as-staff list (universe of
// valid role strings).
const STAFF_ROLES = [
  'district_admin',
  'district_tech_admin',
  'school_admin',
  'counselor',
  'teacher',
  'interventionist'
];

// Per-creator-role rules: which roles each creator can produce. Dict
// is the single source of truth for both the caller-allowed gate
// (Object.keys) and the per-call role-rank check. Closes role-
// escalation gap from PR #129 triad re-review (security-reviewer
// HIGH-1).
const CREATE_STAFF_RULES = {
  district_admin: STAFF_ROLES,
  school_admin: ['school_admin', 'counselor', 'teacher', 'interventionist']
};

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// Per Followup #125 (per-school binding), POST handlers read an optional
// target_tenant_id from req.body:
//   - Absent → falls back to req.user.tenant_id (backwards-compat for
//     legacy single-tenant users whose JWT carries their only accessible
//     tenant).
//   - Present but not a positive integer → 400.
//   - Present, positive integer, but not in
//     resolveAccessibleTenantIds(req.user) → 403 (fires before any
//     INSERT; a body-explicit cross-tenant probe collapses to 403, not
//     400-FK).
//
// Pattern E shape mirrored from routes/student504.js. Module-local copy
// — banked as new followup chore/consolidate-target-tenant-helper
// alongside Followup #108.
async function resolveAndBindTargetTenant(req) {
  const bodyTarget = req.body ? req.body.target_tenant_id : undefined;
  if (bodyTarget === undefined || bodyTarget === null) {
    return { targetTenantId: req.user.tenant_id, error: null };
  }
  if (!isPositiveInt(bodyTarget)) {
    return { targetTenantId: null, error: { status: 400, body: { error: 'Invalid target_tenant_id' } } };
  }
  const accessible = await resolveAccessibleTenantIds(req.user);
  if (!accessible.includes(bodyTarget)) {
    return { targetTenantId: null, error: { status: 403, body: { error: 'Not authorized for target tenant' } } };
  }
  return { targetTenantId: bodyTarget, error: null };
}

// GET /api/staff/:tenantId - List all staff for a tenant
router.get('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const result = await pool.query(
      `SELECT id, email, full_name, role, school_wide_access, google_id,
              created_at
       FROM users 
       WHERE tenant_id = $1 AND role != 'parent'
       ORDER BY 
         CASE role
           WHEN 'district_admin' THEN 1
           WHEN 'district_tech_admin' THEN 2
           WHEN 'school_admin' THEN 3
           WHEN 'counselor' THEN 4
           WHEN 'interventionist' THEN 5
           WHEN 'teacher' THEN 6
         END,
         full_name ASC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/staff - Create a new staff member. Gated by requireAuth +
// caller-role gate (Object.keys(CREATE_STAFF_RULES)) + role-validity
// (STAFF_ROLES → 400 on malformed) + role-rank gate
// (CREATE_STAFF_RULES[caller] → 403 on rank-rejection) + §5
// target_tenant_id binding via resolveAndBindTargetTenant. district_id
// inherited from creator on district-scoped role INSERTs. Closes the
// POST half of Followup #116 + role-escalation finding from PR #129
// triad re-review.
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_STAFF_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { email, full_name, role } = req.body;
    if (!email || !full_name || !role) {
      return res.status(400).json({ error: 'Email, full name, and role are required' });
    }

    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    if (!CREATE_STAFF_RULES[req.user.role].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { targetTenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) {
      return res.status(bindError.status).json(bindError.body);
    }

    // Check if email already exists at the target tenant. Per-tenant
    // scoping (rather than global) closes the cross-tenant email-
    // enumeration oracle flagged in PR #129 triad re-review (tenant-
    // isolation-auditor HIGH on staffManagement.js, Followup #142). The
    // schema's UNIQUE(tenant_id, email) constraint is the source of
    // truth; this app-layer check is a pre-INSERT early-out for the
    // common case. The 23505 race-catch below handles concurrent
    // same-tenant inserts.
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [email, targetTenantId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Set school_wide_access based on role. ELEVATED_ROLES is the
    // canonical 5-role allowlist exported from constants/roles.js.
    const schoolWideAccess = ELEVATED_ROLES.includes(role);

    // district_id binding: district-scoped roles inherit creator's
    // district_id. The role-rank gate above ensures only district_admin
    // (which has non-null district_id) can reach this path with role IN
    // district-scoped roles, so districtId is non-null when needed.
    const districtId = ['district_admin', 'district_tech_admin'].includes(role) ? req.user.district_id : null;

    // Insert without password — they'll use Google SSO
    const result = await pool.query(
      `INSERT INTO users (email, full_name, role, tenant_id, school_wide_access, district_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, full_name, role, school_wide_access, created_at`,
      [email.toLowerCase().trim(), full_name.trim(), role, targetTenantId, schoolWideAccess, districtId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    console.error('[staff:post] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/staff/:id - Update a staff member's role or name. Gated by
// requireAuth + caller-role gate (Object.keys(CREATE_STAFF_RULES)) +
// self-PUT block + role-validity (STAFF_ROLES → 400) + role-rank gate
// (CREATE_STAFF_RULES[caller] → 403 on rank-rejection). Closes the PUT
// half of Followup #116 and PR #140 security-reviewer WARN-1.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_STAFF_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (id === req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { full_name, role } = req.body;

    if (role && !STAFF_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    if (role && !CREATE_STAFF_RULES[req.user.role].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // §5 tenant scope check via resolveAccessibleTenantIds — consumed,
    // not inlined, per the §5 dual-path doctrine (legacy single-tenant
    // users vs district users on user_school_access). 404 'Not found'
    // rather than 403 for probe-resistance, matching DELETE :249 / :257.
    // Parents are not staff and are deletable/editable via /api/users/:id.
    const target = await pool.query(
      'SELECT id, tenant_id, role FROM users WHERE id = $1',
      [id]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (target.rows[0].role === 'parent') {
      return res.status(404).json({ error: 'Not found' });
    }
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(target.rows[0].tenant_id)) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Recalculate school_wide_access if role changed. ELEVATED_ROLES is
    // the canonical 5-role allowlist exported from constants/roles.js.
    // Healing on name-only PUTs (re-check current row's role) is NOT in
    // scope here — banked as followup.
    const schoolWideAccess = role
      ? ELEVATED_ROLES.includes(role)
      : undefined;

    const result = await pool.query(
      `UPDATE users 
       SET full_name = COALESCE($1, full_name),
           role = COALESCE($2, role),
           school_wide_access = COALESCE($3, school_wide_access)
       WHERE id = $4
       RETURNING id, email, full_name, role, school_wide_access`,
      [full_name || null, role || null, schoolWideAccess, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating staff:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/staff/:id - Remove a staff member. Gated by requireAuth +
// role authz + §5 helper-consumed scope check. Parents are not staff
// (404 'Not found' on this route); they are deletable via /api/users/:id.
// Cascade to user_school_access via M028 ON DELETE CASCADE is captured by
// M031's trigger. Followup #118: SELECT + DELETE run in an explicit
// transaction so a transaction-local set_config('app.actor_user_id', ...)
// propagates into M032's trigger body for cascade-row actor capture.
router.delete('/:id', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (id === req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const ADMIN_DELETE_ROLES = ['district_admin', 'school_admin'];
    if (!ADMIN_DELETE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[staff:delete]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );

    const target = await client.query(
      'SELECT id, tenant_id, role FROM users WHERE id = $1',
      [id]
    );
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (target.rows[0].role === 'parent') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(target.rows[0].tenant_id)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await client.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json({ message: 'Staff member removed' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[staff:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.initializePool = initializePool;
module.exports = router;
