// routes/mtssCoordinators.js — grant/revoke surface for mtss_coordinators.
//
// Mounted at /api/mtss-coordinators in server.js.
//
// First production writer to mtss_coordinators (M038/M039/M040).
// POST INSERTs directly + writes its own 'grant' audit row (M039's
// trigger only fires on DELETE; 'grant' rows are app-written).
// DELETE relies on M040's GUC-driven trigger to write the 'revoke'
// audit row — the route sets app.audit_action='revoke' inside the
// transaction so the single trigger emits the correct label with
// actor capture.
//
// Mirrors routes/districtAccess.js pattern with two intentional
// divergences for the coordinator semantics:
//
//   1. Role gate is GRANT_ROLES (school_admin + district_admin) rather
//      than district_admin only. A coordinator designation is a
//      school-level action that school_admins must be able to perform
//      within their own building(s); district_admins can perform it
//      across their district. Both roles gate by the same accessible-
//      set membership check — no role-specific branching, one
//      predicate composes both.
//
//   2. Target eligibility check (new — not in districtAccess). Admins
//      and parents are ineligible to RECEIVE coordinator status; only
//      non-admin staff (teacher, counselor, interventionist, plus any
//      future non-admin staff role) qualify.
//
// Authz model:
//   1. requireAuth                                       (middleware)
//   2. role ∈ GRANT_ROLES                                (else 403)
//   3. school_tenant_id ∈ resolveAccessibleTenantIds(req.user)
//                                                        (else 403)
//   4. target user exists                                (else 404)
//   5. target.role ∉ INELIGIBLE_TARGET_ROLES             (else 400)
//   6. school_tenant_id ∈ resolveAccessibleTenantIds(target)
//                                                        (else 400)
//
// district_id on the coordinator row is SERVER-DERIVED from
// tenants.district_id (never read from req.body). Legacy single-
// tenant schools store NULL; district schools store the district id.
// M038's composite FK pair catches any drift between this derived
// value and the target user's district_id with SQLSTATE 23503 → 404.
//
// Error mapping:
//   400  parseInt validation failure on path/body integer
//        target user role is ineligible
//        target user not a member of school_tenant_id
//   403  caller is not in GRANT_ROLES OR school_tenant_id out of scope
//   404  target user missing OR (DELETE) 0-rows-affected OR composite-FK drift
//   409  duplicate grant (SQLSTATE 23505)
//   500  unexpected error; req.user.id non-integer (server-side
//        contract violation, not user input)

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INT4_MAX = 2147483647;

// Roles authorized to grant/revoke. Wider than districtAccess.js's
// district_admin-only because coordinator designation is a school-
// level action; school_admins must be able to designate within their
// own building. district_tech_admin and counselor/interventionist
// are NOT in this set — designation power is restricted to
// administrators.
const GRANT_ROLES = ['school_admin', 'district_admin'];

// Roles ineligible to RECEIVE a coordinator designation. Admins
// already have building-wide reach via ELEVATED_ROLES; parents are
// not staff. teacher, counselor, interventionist (and any future
// non-admin staff role) are eligible targets — counselor and
// interventionist are technically in ELEVATED_ROLES already and
// would gain nothing from a coordinator row in their home tenant,
// but they may legitimately be coordinator-of-record at a building
// other than their primary, and there's no upside to blocking that
// up front.
const INELIGIBLE_TARGET_ROLES = ['district_admin', 'school_admin', 'district_tech_admin', 'parent'];

// Roles authorized to READ the per-school coordinator list. Declared
// separately from GRANT_ROLES (even though they happen to be the same
// set today) so a future widening of the read surface (e.g. allowing
// counselor/interventionist to see who the coordinators are) does not
// accidentally widen the grant/revoke surface.
const VIEW_ROLES = ['school_admin', 'district_admin'];

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// GET /by-school/:tenantId — list current coordinator designations
// for one building. Sole admin-side read surface; the FE admin
// toggle joins this to the staff list in memory by user_id.
//
// Authz model:
//   1. requireAuth                                       (middleware)
//   2. role ∈ VIEW_ROLES                                 (else 403)
//   3. tenantId ∈ resolveAccessibleTenantIds(req.user)
//                                                        (else 403)
//
// Projection includes granter_full_name via LEFT JOIN to users on
// mtss_coordinators.created_by. The granter may legitimately be a
// district_admin from outside the requesting school_admin's tenant;
// surfacing the name is intentional — the granter IS the audit
// subject and concealing them defeats the "Designated by [name] on
// [date]" display the toggle exists to provide. Same precedent as
// "Reviewed by" on discipline referrals. Projection is full_name
// ONLY — no email, no role, no district_id of the granter.
//
// LEFT JOIN handles the M038 created_by ON DELETE SET NULL case: if
// the granter has been deleted from users since the grant, granted_by
// is NULL and granter_full_name is NULL via the LEFT JOIN. FE
// degrades gracefully.
//
// Error mapping:
//   400  parseInt validation failure on :tenantId
//   403  caller is not in VIEW_ROLES OR tenant out of scope
//   500  unexpected; console.error carries route tag + err.message only
router.get('/by-school/:tenantId', requireAuth, async (req, res) => {
  try {
    if (!VIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = validateIntParam(req.params.tenantId);
    if (tenantId === null) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    // §5 dual-path consumed via helper, never inlined. Mirrors the
    // gate shape on routes/staffManagement.js:95-98 and
    // routes/disciplineReferrals.js queue endpoints.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(tenantId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(
      `SELECT
         mc.user_id,
         mc.school_tenant_id,
         mc.district_id,
         mc.created_by         AS granted_by,
         mc.created_at         AS granted_at,
         granter.full_name     AS granter_full_name
       FROM mtss_coordinators mc
       LEFT JOIN users granter ON granter.id = mc.created_by
       WHERE mc.school_tenant_id = $1
       ORDER BY mc.user_id`,
      [tenantId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[mtssCoordinators:byschool]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST / — grant a coordinator designation.
// Body: { user_id, school_tenant_id }. Explicit transaction on a
// single checked-out client so app.actor_user_id propagates into the
// app-written 'grant' audit row (M032 GUC doctrine). M039's trigger
// does NOT fire on INSERT, so the 'grant' audit row is app-written.
router.post('/', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const targetUserId = validateIntParam(req.body && req.body.user_id);
    if (targetUserId === null) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const schoolTenantId = validateIntParam(req.body && req.body.school_tenant_id);
    if (schoolTenantId === null) {
      return res.status(400).json({ error: 'Invalid school_tenant_id' });
    }

    if (!GRANT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[mtssCoordinators:post]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    // Caller-scope: school_tenant_id must be in caller's accessible set.
    // For school_admin → typically their one building (or several via
    // user_school_access). For district_admin → their district's buildings.
    // §5 dual-path resolved by the shared helper, never inlined.
    const callerAccessible = await resolveAccessibleTenantIds(req.user);
    if (!callerAccessible.includes(schoolTenantId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );

    // Load target user with the columns resolveAccessibleTenantIds needs.
    const targetRes = await client.query(
      'SELECT id, role, tenant_id, district_id FROM users WHERE id = $1',
      [targetUserId]
    );
    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const target = targetRes.rows[0];

    if (INELIGIBLE_TARGET_ROLES.includes(target.role)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Target user is not eligible for coordinator designation' });
    }

    // Target must already have school membership in school_tenant_id —
    // composes with §5 dual-path. The helper handles both legacy
    // single-tenant (tenant_id equality) and district (user_school_access
    // membership) paths.
    const targetAccessible = await resolveAccessibleTenantIds(target);
    if (!targetAccessible.includes(schoolTenantId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Target user is not a member of that school' });
    }

    // Server-derive district_id from tenants — never from req.body.
    // Legacy single-tenant school → NULL; district school → its
    // district_id. M038's composite FK catches any drift between this
    // value and the target user's district_id with SQLSTATE 23503 → 404
    // in the catch block below.
    const schoolRes = await client.query(
      'SELECT district_id FROM tenants WHERE id = $1',
      [schoolTenantId]
    );
    // schoolRes is guaranteed non-empty: callerAccessible was derived
    // from tenants rows, so a school_tenant_id in that set always
    // resolves to a tenants row.
    const districtId = schoolRes.rows[0].district_id;

    await client.query(
      `INSERT INTO mtss_coordinators (user_id, school_tenant_id, district_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [targetUserId, schoolTenantId, districtId, actorId]
    );

    await client.query(
      `INSERT INTO mtss_coordinators_audit
         (user_id, school_tenant_id, district_id, action, actor_user_id)
       VALUES ($1, $2, $3, 'grant', $4)`,
      [targetUserId, schoolTenantId, districtId, actorId]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Granted',
      user_id: targetUserId,
      school_tenant_id: schoolTenantId,
      district_id: districtId
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already designated' });
    }
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('[mtssCoordinators:post]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /users/:userId/schools/:schoolTenantId — revoke a coordinator
// designation. Sets both transaction-local GUCs (app.actor_user_id
// for attribution, app.audit_action='revoke' for label override)
// inside a single-client transaction, then DELETEs the row. M040's
// trigger fires AFTER DELETE inside the same transaction and reads
// both GUCs to write the audit row with action='revoke' and
// actor_user_id=<caller>.
//
// The BEGIN, both SET LOCAL calls via set_config(..., true), the
// DELETE, and COMMIT MUST run on the same checked-out client (not
// separate pool.query calls) — otherwise the GUC lands on a
// different session and the trigger reads '' which COALESCEs to
// 'cascade_user_delete' (silent attribution failure). Mirrors
// routes/districtAccess.js:190-264 doctrine.
router.delete('/users/:userId/schools/:schoolTenantId', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const targetUserId = validateIntParam(req.params.userId);
    if (targetUserId === null) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const schoolTenantId = validateIntParam(req.params.schoolTenantId);
    if (schoolTenantId === null) {
      return res.status(400).json({ error: 'Invalid school_tenant_id' });
    }

    if (!GRANT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[mtssCoordinators:delete]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    // Caller-scope: same predicate as POST. Composes school_admin and
    // district_admin without role-specific branching.
    const callerAccessible = await resolveAccessibleTenantIds(req.user);
    if (!callerAccessible.includes(schoolTenantId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );
    await client.query(
      "SELECT set_config('app.audit_action', 'revoke', true)"
    );

    const result = await client.query(
      `DELETE FROM mtss_coordinators
       WHERE user_id = $1 AND school_tenant_id = $2
       RETURNING user_id`,
      [targetUserId, schoolTenantId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json({
      message: 'Revoked',
      user_id: targetUserId,
      school_tenant_id: schoolTenantId
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[mtssCoordinators:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
