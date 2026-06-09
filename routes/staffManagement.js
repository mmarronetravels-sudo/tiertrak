const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { ELEVATED_ROLES, INTERVENTION_MANAGER_ROLES, canAssignRole } = require('../constants/roles');
const { isOperator } = require('../middleware/platformAdminOnly');

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
  'interventionist',
  'education_assistant'
];

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

// GET /api/staff/:tenantId - List all staff for a tenant. Gated by
// requireAuth + caller-role gate (INTERVENTION_MANAGER_ROLES — every
// non-parent staff role; mirrors the FE's canManageInterventions
// consumer surface in AssignmentManager + Admin Panel Staff tab) +
// positive-int validation on :tenantId + §5 tenant scope check via
// resolveAccessibleTenantIds (404 'Not found' on miss) + redacted
// catch (generic 'Server error' body + structured '[staff:list] error
// code:' log). Closes the staffManagement.js GET route in Followup
// #116.
router.get('/:tenantId', requireAuth, async (req, res) => {
  try {
    if (!INTERVENTION_MANAGER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = parseInt(req.params.tenantId, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || tenantId > 2147483647) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    // §5 tenant scope check via resolveAccessibleTenantIds — consumed,
    // not inlined, per the §5 dual-path doctrine (legacy single-tenant
    // users vs district users on user_school_access). 404 'Not found'
    // rather than 403 for probe-resistance, matching PUT :226-229.
    // Placed BEFORE the SELECT so no PII query runs for out-of-scope
    // tenants. Empty-array return (legitimate for a district user
    // with no school grants yet) collapses to the same 404 — no
    // special-casing.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

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
    console.error('[staff:list] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/staff - Create a new staff member. Gated by requireAuth +
// canAssignRole canary (actor has any assignment authority → 403 if
// not) + role-validity (STAFF_ROLES → 400 on malformed) + canAssignRole
// rank check (operator bypass / strict-below-rank / school_admin peer
// exception → 403 on rank-rejection) + §5 target_tenant_id binding
// via resolveAndBindTargetTenant. district_id inherited from creator
// on district-scoped role INSERTs. Closes the POST half of Followup
// #116 + role-escalation finding from PR #129 triad re-review +
// delegated-role-assignment trust rule (operator > district_admin >
// district_tech_admin > school_admin > sub-roles, with school_admin
// peer exception).
router.post('/', requireAuth, async (req, res) => {
  try {
    // Operator status is recomputed server-side every request via the
    // PLATFORM_ADMIN_USER_IDS env allowlist. Never read from req.body
    // or any client-controlled field.
    const actorIsOperator = isOperator(req.user.id);

    // Actor-side gate: BEFORE body parse, to keep probe traffic out of
    // the input reader and the required-fields shape it would leak
    // (per S116 [[feedback_role_gate_before_input_parse_sweep]]).
    // 'parent' (the rank-floor) is the canary: every assignment-capable
    // non-operator actor can assign 'parent' (sub-roles can't); operators
    // bypass to true. So this single call holds iff the actor has any
    // assignment authority at all.
    if (!canAssignRole(req.user.role, 'parent', actorIsOperator)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { email, full_name, role } = req.body;
    if (!email || !full_name || !role) {
      return res.status(400).json({ error: 'Email, full name, and role are required' });
    }

    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    // Role-rank gate — condition (3) of the three-condition delegated-
    // assignment guard. Condition (1) (target tenant scope) is enforced
    // below by resolveAndBindTargetTenant. Condition (2) (self-mutation)
    // is N/A for POST since the target is being created. canAssignRole
    // encodes operator bypass + strict-below-rank + school_admin peer
    // exception.
    if (!canAssignRole(req.user.role, role, actorIsOperator)) {
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
    // district_id. For non-operator actors the rank gate above ensures
    // only a district_admin (with non-null district_id) reaches this
    // path with role IN district-scoped roles, so districtId is non-null
    // when needed. Operator bypass closes that invariant: a platform-
    // level operator (users.district_id IS NULL) could land a district-
    // scoped role row with null district_id, degrading the new user to
    // the legacy single-tenant scope path. The fail-safe immediately
    // below catches that case with a 400. Symmetric to routes/users.js
    // POST (C5). Proper fix tracked as follow-up: source target_district_id
    // explicitly from a body field or the target tenant's districts.id.
    const isDistrictScopedRole = ['district_admin', 'district_tech_admin'].includes(role);
    const districtId = isDistrictScopedRole ? req.user.district_id : null;

    // Fail-safe — operator edge case (see comment above). Rejects with
    // 400 rather than landing a mis-scoped district-scoped role row.
    if (isDistrictScopedRole && districtId == null) {
      return res.status(400).json({
        error: 'district_id is required for district-scoped role assignment; target_district_id is missing or cannot be derived from the creator'
      });
    }

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
// requireAuth + canAssignRole canary + positive-int :id + self-PUT
// block + STAFF_ROLES universe check (400 on malformed role) +
// (inside a single transaction against a SELECT ... FOR UPDATE-locked
// target row) §5 tenant-scope check, outranks check (actor must
// outrank target's CURRENT role), and new-role rank check (when role
// is changing).
//
// One locked read drives §5 scope, outranks, new-role rank, and the
// audit-row provenance (operator hold #3). UPDATE users + INSERT INTO
// user_role_change_audit run inside the same transaction — both or
// neither (M046 security review LOW-1, operator constraint b).
//
// Audit-row provenance per M046 security review: user_id,
// school_tenant_id, old_role, district_id are sourced from the locked
// target row; actor_user_id from req.user.id (JWT). Never from
// req.body. The audit row fires only when role is supplied AND
// differs from the target's current role.
//
// Closes the PUT half of Followup #116, PR #140 security-reviewer
// WARN-1, and the delegated-role-assignment trust rule.
router.put('/:id', requireAuth, async (req, res) => {
  let client = null;
  try {
    // Operator status — recomputed server-side every request from the
    // PLATFORM_ADMIN_USER_IDS env allowlist (operator hold #2). Never
    // from req.body or any client-controlled field.
    const actorIsOperator = isOperator(req.user.id);

    // Actor-side canary BEFORE body parse (per S116
    // [[feedback_role_gate_before_input_parse_sweep]]). 'parent' is
    // the rank-floor canary: only assignment-capable actors pass.
    if (!canAssignRole(req.user.role, 'parent', actorIsOperator)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    // Self-mutation guard — condition (2) of the three-condition
    // delegated-assignment guard (operator hold #1).
    if (id === req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { full_name, role } = req.body;

    if (role && !STAFF_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    // Single locked read drives §5 scope, outranks check, new-role
    // rank check, and audit-row provenance (operator hold #3). A
    // concurrent PUT cannot interleave with stale old_role state.
    client = await pool.connect();
    await client.query('BEGIN');

    const target = await client.query(
      `SELECT id, tenant_id, role, district_id
       FROM users WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const targetRow = target.rows[0];

    // Parents are not staff and are deletable/editable via /api/users/:id.
    if (targetRow.role === 'parent') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    // Condition (1) — §5 tenant scope via resolveAccessibleTenantIds,
    // consumed not inlined per the dual-path doctrine. 404 for
    // probe-resistance, matching the read paths in this file.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(targetRow.tenant_id)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    // Condition (3a) — outranks check. Actor must have authority over
    // the target's CURRENT role to edit any of their fields. Reusing
    // canAssignRole here means actor outranks target iff actor could
    // (re-)assign that role. Encodes operator bypass + strict-below-
    // rank + school_admin peer exception. Stricter than the prior
    // caller-role gate: a peer district_admin (or peer
    // district_tech_admin) can no longer edit another peer; aligns
    // with the spec's "strictly below" principle.
    if (!canAssignRole(req.user.role, targetRow.role, actorIsOperator)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Condition (3b) — new-role rank check. Fires only when role is
    // being changed (no-op PUTs with role == current target role skip
    // this check and the audit write below).
    const roleChanging = role && role !== targetRow.role;
    if (roleChanging) {
      if (!canAssignRole(req.user.role, role, actorIsOperator)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Fail-safe — symmetric to routes/users.js PUT (C6). Promoting the
    // target to a district-scoped role while the locked target row's
    // district_id is NULL would land role=district_admin (or
    // district_tech_admin) with district_id IS NULL. The PUT statement
    // below does not touch district_id, so the target keeps whatever
    // they already have — a NULL existing district leaves them in the
    // legacy single-tenant scope path. Triggers only when the new role
    // is district-scoped AND the target has no existing district; fires
    // AFTER the rank check so a 403 takes precedence when the actor
    // isn't authorized in the first place. Proper fix tracked as
    // follow-up: PUT should source target_district_id explicitly from
    // a body field or the target tenant's districts.id.
    if (roleChanging && ['district_admin', 'district_tech_admin'].includes(role) && targetRow.district_id == null) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'district_id is required for district-scoped role assignment; target_district_id is missing or the target has no existing district'
      });
    }

    // Recalculate school_wide_access if role changed. ELEVATED_ROLES
    // is the canonical 5-role allowlist exported from constants/roles.js.
    // Healing on name-only PUTs (re-check current row's role) is NOT
    // in scope here — banked as followup.
    const schoolWideAccess = role
      ? ELEVATED_ROLES.includes(role)
      : undefined;

    const result = await client.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           role = COALESCE($2, role),
           school_wide_access = COALESCE($3, school_wide_access)
       WHERE id = $4
       RETURNING id, email, full_name, role, school_wide_access`,
      [full_name || null, role || null, schoolWideAccess, id]
    );

    // Audit-row provenance — operator hold #3 + M046 security review
    // LOW-1: user_id, school_tenant_id, old_role, district_id sourced
    // from the locked target row; actor_user_id from req.user.id (JWT);
    // new_role from the validated request body. None from req.body for
    // the historical-state columns.
    if (roleChanging) {
      await client.query(
        `INSERT INTO user_role_change_audit
           (user_id, old_role, new_role, actor_user_id, school_tenant_id, district_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [targetRow.id, targetRow.role, role, req.user.id, targetRow.tenant_id, targetRow.district_id]
      );
    }

    await client.query('COMMIT');

    res.json(result.rows[0]);
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* swallow; original error wins */ }
    }
    console.error('[staff:put] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (client) {
      client.release();
    }
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
router.STAFF_ROLES = STAFF_ROLES;
module.exports = router;
