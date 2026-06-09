const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { INTERVENTION_MANAGER_ROLES, canAssignRole } = require('../constants/roles');
const { isOperator } = require('../middleware/platformAdminOnly');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Valid roles (universe of valid role strings — used for malformed-input
// 400 rejection).
const VALID_ROLES = ['district_admin', 'school_admin', 'district_tech_admin', 'teacher', 'counselor', 'interventionist', 'parent', 'education_assistant'];

// Per-creator-role rules: which roles each creator can produce. Dict
// is the single source of truth for both the caller-allowed gate
// (Object.keys) and the per-call role-rank check. Closes role-
// escalation gap from PR #129 triad re-review (security-reviewer
// HIGH-1).
const CREATE_USER_RULES = {
  district_admin: VALID_ROLES,
  school_admin: ['school_admin', 'counselor', 'teacher', 'interventionist', 'parent', 'education_assistant']
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

// Get all users for a tenant. Gated by requireAuth + caller-role
// gate (Object.keys(CREATE_USER_RULES)) + positive-int :tenantId
// validation + §5 tenant-scope check via resolveAccessibleTenantIds
// (404 'Not found' on miss).
router.get('/tenant/:tenantId', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_USER_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = parseInt(req.params.tenantId, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || tenantId > 2147483647) {
      return res.status(400).json({ error: 'Invalid tenantId' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(
      `SELECT id, tenant_id, email, full_name, role, created_at, updated_at
       FROM users
       WHERE tenant_id = $1
       ORDER BY full_name`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[users:tenant] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET staff members for assignment dropdown (excludes parents). Gated
// by requireAuth + caller-role gate (INTERVENTION_MANAGER_ROLES,
// semantic peer of PR #144 /api/staff) + positive-int tenant_id
// validation + §5 tenant-scope check via resolveAccessibleTenantIds
// (404 'Not found' on miss). FE-dead near-duplicate of /api/staff —
// see banked chore/delete-routes-users-staff-dead-duplicate.
router.get('/staff', requireAuth, async (req, res) => {
  try {
    if (!INTERVENTION_MANAGER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || tenantId > 2147483647) {
      return res.status(400).json({ error: 'Invalid tenant_id' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(`
      SELECT id, full_name as name, email, role
      FROM users
      WHERE tenant_id = $1 AND role != 'parent'
      ORDER BY full_name
    `, [tenantId]);

    res.json(result.rows);
  } catch (error) {
    console.error('[users:staff] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET parents for a tenant (for parent assignment dropdown). Gated
// by requireAuth + caller-role gate (INTERVENTION_MANAGER_ROLES — FE-
// consumer-scope-grep finding: actual consumers are intervention-
// assignment parent-picker [App.jsx:6093] and admin parent-link
// management [App.jsx:5274]; both are staff/admin surfaces) +
// positive-int tenant_id validation + §5 tenant-scope check via
// resolveAccessibleTenantIds (404 'Not found' on miss).
//
// Expected 403 noise floor: fetchParentsList [App.jsx:665] fires
// unconditionally on every login including parent role; parent users
// will hit 403 here on login (catch-only console.error, no UI
// breakage). Cleanup tracked in chore/skip-fetchParentsList-for-
// parent-role (sibling FE PR, lands shortly after this).
router.get('/parents', requireAuth, async (req, res) => {
  try {
    if (!INTERVENTION_MANAGER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || tenantId > 2147483647) {
      return res.status(400).json({ error: 'Invalid tenant_id' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(`
      SELECT u.id, u.full_name as name, u.email,
        COALESCE(json_agg(
          json_build_object('student_id', psl.student_id, 'relationship', psl.relationship)
        ) FILTER (WHERE psl.id IS NOT NULL), '[]') as linked_students
      FROM users u
      LEFT JOIN parent_student_links psl ON u.id = psl.parent_user_id
      WHERE u.tenant_id = $1 AND u.role = 'parent'
      GROUP BY u.id
      ORDER BY u.full_name
    `, [tenantId]);

    res.json(result.rows);
  } catch (error) {
    console.error('[users:parents] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});
// Get users by role for a tenant. Gated by requireAuth + caller-role
// gate (Object.keys(CREATE_USER_RULES)) + positive-int :tenantId
// validation + :role validation against VALID_ROLES (400 on malformed)
// + §5 tenant-scope check via resolveAccessibleTenantIds (404 'Not
// found' on miss).
router.get('/tenant/:tenantId/role/:role', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_USER_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = parseInt(req.params.tenantId, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || tenantId > 2147483647) {
      return res.status(400).json({ error: 'Invalid tenantId' });
    }

    const { role } = req.params;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`
      });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(
      `SELECT id, tenant_id, email, full_name, role, created_at, updated_at
       FROM users
       WHERE tenant_id = $1 AND role = $2
       ORDER BY full_name`,
      [tenantId, role]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[users:tenant-role] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get a single user by ID. Gated by requireAuth + caller-role gate
// (Object.keys(CREATE_USER_RULES)) + positive-int :id validation +
// §5 tenant-scope check via resolveAccessibleTenantIds (404 'Not
// found' on miss).
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_USER_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    // §5 tenant scope check via resolveAccessibleTenantIds — consumed,
    // not inlined, per the §5 dual-path doctrine. 404 'Not found' on
    // miss for probe-resistance, matching DELETE :290-303 / PR #142.
    const target = await pool.query(
      'SELECT tenant_id FROM users WHERE id = $1',
      [id]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(target.rows[0].tenant_id)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(
      `SELECT id, tenant_id, email, full_name, role, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[users:get] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new user. Gated by requireAuth + canAssignRole canary
// (actor has any assignment authority → 403 if not) + role-validity
// (VALID_ROLES → 400 on malformed) + canAssignRole rank check
// (operator bypass / strict-below-rank / school_admin peer exception
// → 403 on rank-rejection) + §5 target_tenant_id binding via
// resolveAndBindTargetTenant. district_id inherited from creator on
// district-scoped role INSERTs. Closes POST half of Followup #116 +
// role-escalation finding from PR #129 triad re-review +
// delegated-role-assignment trust rule. Password-required (non-SSO)
// identity model preserved — staff onboarding via Google SSO uses
// POST /api/staff; this surface remains the password-required path
// (parents, etc.).
router.post('/', requireAuth, async (req, res) => {
  try {
    // Operator status is recomputed server-side every request via the
    // PLATFORM_ADMIN_USER_IDS env allowlist. Never read from req.body
    // or any client-controlled field.
    const actorIsOperator = isOperator(req.user.id);

    // Actor-side canary BEFORE body parse (per S116
    // [[feedback_role_gate_before_input_parse_sweep]]). 'parent' is
    // the rank-floor canary: every assignment-capable non-operator
    // actor can assign 'parent' (sub-roles can't); operators bypass.
    if (!canAssignRole(req.user.role, 'parent', actorIsOperator)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { email, password, full_name, role } = req.body;
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Email, password, full name, and role are required' });
    }

    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`
      });
    }

    // Role-rank gate — condition (3) of the three-condition delegated-
    // assignment guard. Condition (1) (target tenant scope) is enforced
    // below by resolveAndBindTargetTenant. Condition (2) (self-mutation)
    // is N/A for POST since the target is being created.
    if (!canAssignRole(req.user.role, role, actorIsOperator)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { targetTenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) {
      return res.status(bindError.status).json(bindError.body);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // district_id binding: district-scoped roles inherit creator's
    // district_id. For non-operator actors the rank gate above ensures
    // only a district_admin (with non-null district_id) reaches this
    // path with role IN district-scoped roles, so districtId is non-null
    // when needed. Operator bypass closes that invariant: a platform-
    // level operator (users.district_id IS NULL) could land a district-
    // scoped role row with null district_id, degrading the new user to
    // the legacy single-tenant scope path (resolveAccessibleTenantIds
    // returns [tenant_id] when district_id IS NULL). The fail-safe
    // immediately below catches that case with a 400; the proper fix —
    // sourcing target_district_id explicitly from a body field or the
    // target tenant's districts.id rather than inheriting the creator's
    // — is banked as a follow-up.
    const isDistrictScopedRole = ['district_admin', 'district_tech_admin'].includes(role);
    const districtId = isDistrictScopedRole ? req.user.district_id : null;

    // Fail-safe — operator edge case (see comment above). Rejects the
    // request with 400 rather than landing a mis-scoped district-scoped
    // role row whose access surface would silently degrade post-INSERT.
    // Triggers only when the role is district-scoped AND the derived
    // district_id is NULL; the non-operator path is unreachable here
    // because the rank gate above blocks it. Defense in depth.
    if (isDistrictScopedRole && districtId == null) {
      return res.status(400).json({
        error: 'district_id is required for district-scoped role assignment; target_district_id is missing or cannot be derived from the creator'
      });
    }

    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, district_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, email, full_name, role, created_at`,
      [targetTenantId, email, hashedPassword, full_name, role, districtId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A user with this email already exists for this tenant' });
    }
    console.error('[users.js POST] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a user. Gated by requireAuth + caller-role gate
// (Object.keys(CREATE_USER_RULES)) + positive-int :id validation +
// self-PUT block + role-validity (VALID_ROLES → 400) + role-rank gate
// (CREATE_USER_RULES[caller] → 403) + §5 tenant-scope check via
// resolveAccessibleTenantIds (404 'Not found' on miss).
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_USER_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (id === req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { email, full_name, role } = req.body;
    
    // Validate role if provided
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`
      });
    }

    if (role && !CREATE_USER_RULES[req.user.role].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // §5 tenant scope check via resolveAccessibleTenantIds — consumed,
    // not inlined, per the §5 dual-path doctrine. 404 'Not found' on
    // miss for probe-resistance, matching DELETE :290-303 / PR #142.
    const target = await pool.query(
      'SELECT tenant_id FROM users WHERE id = $1',
      [id]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(target.rows[0].tenant_id)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(
      `UPDATE users
       SET email = $1, full_name = $2, role = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, tenant_id, email, full_name, role, updated_at`,
      [email, full_name, role, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[users:put] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a user. Gated by requireAuth + role authz + §5 helper-consumed
// scope check. Cascade to user_school_access via M028 ON DELETE CASCADE
// is captured by M031's user_school_access_audit_after_delete trigger.
// Followup #118: SELECT + DELETE run in an explicit transaction so a
// transaction-local set_config('app.actor_user_id', ...) propagates into
// M032's trigger body for cascade-row actor capture.
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
      console.error('[users:delete]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );

    const target = await client.query(
      'SELECT id, tenant_id FROM users WHERE id = $1',
      [id]
    );
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(target.rows[0].tenant_id)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    // Explicit cleanup for ea_caseload_students rows pointing at this
    // user. M041 header lines 68-71: for district EAs the composite FK
    // (ea_user_id, district_id) → users(id, district_id) cascades on
    // DELETE FROM users below; for legacy EAs (district_id IS NULL)
    // MATCH SIMPLE skips that cascade, so app-layer cleanup is required
    // to avoid orphan caseload rows. Runs unconditionally — district
    // case is a 0-row no-op (FK cascade hasn't fired yet at this point).
    // The explicit DELETE fires M041's AFTER DELETE trigger on
    // ea_caseload_students, which captures actor via the app.actor_user_id
    // GUC set above and labels the audit row 'cascade_user_delete'
    // (label-of-record for all schema-cascade sources per M041 doctrine).
    await client.query(
      'DELETE FROM ea_caseload_students WHERE ea_user_id = $1',
      [id]
    );

    const result = await client.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[users:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Get all teachers for a tenant (convenience route for dropdowns).
// Gated by requireAuth + caller-role gate (INTERVENTION_MANAGER_ROLES
// — minimal-field-set teacher dropdown, natural consumer is
// intervention/student assignment surface) + positive-int :tenantId
// validation + §5 tenant-scope check via resolveAccessibleTenantIds
// (404 'Not found' on miss).
router.get('/tenant/:tenantId/teachers', requireAuth, async (req, res) => {
  try {
    if (!INTERVENTION_MANAGER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = parseInt(req.params.tenantId, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || tenantId > 2147483647) {
      return res.status(400).json({ error: 'Invalid tenantId' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(
      `SELECT id, full_name
       FROM users
       WHERE tenant_id = $1 AND role = 'teacher'
       ORDER BY full_name`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[users:tenant-teachers] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
