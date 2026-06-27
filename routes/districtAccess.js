// districtAccess — grant/revoke/list surface for user_school_access.
//
// Mounted at /api/districts in server.js. Three handlers:
//
//   GET    /:id/users/:userId/access
//   POST   /:id/users/:userId/access                 body: { school_tenant_id }
//   DELETE /:id/users/:userId/access/:schoolTenantId
//
// First production writer to user_school_access (PR B2). POST INSERTs
// directly + writes its own 'grant' audit row (M031's trigger only
// fires on DELETE). DELETE relies on M033's GUC-driven trigger to
// write the 'revoke' audit row; the route sets app.audit_action='revoke'
// inside the transaction so the single trigger emits the correct label.
//
// Authz model (§5 + DQ2 tight framing):
//   1. requireAuth                                  (middleware)
//   2. role === 'district_admin' AND
//      req.user.district_id === pathDistrictId      (else 403)
//   3. target user.district_id === pathDistrictId   (else 404)
//   4. school_tenant_id ∈ resolveAccessibleTenantIds(req.user)
//                                                   (else 404)
//
// district_tech_admin is NOT permitted. Platform-admin pathway is not
// part of this PR (operator backfill via scripts/ops/ template).
//
// Error mapping (§4 + DQ4 confirmed):
//   400  parseInt validation failure on any path/body integer
//   403  caller is not district_admin OR district mismatch
//   404  target user missing OR cross-district OR school out-of-scope OR
//        DELETE 0-rows-affected (race / not-currently-granted)
//   409  duplicate grant (SQLSTATE 23505)
//   500  unexpected error; req.user.id non-integer (server-side
//        contract violation, not user input)

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { mutationUserLimiter } = require('../middleware/rateLimiters');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INT4_MAX = 2147483647;

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// Strict boolean validator for the opt-out `enabled` body field. Only a real
// JSON boolean is accepted -- a string "false" or 0 is rejected with 400 rather
// than silently coerced, so the stored reminders_enabled state is never
// ambiguous.
function validateBool(value) {
  return typeof value === 'boolean' ? value : null;
}

// GET /:id/users/:userId/access — list a user's current grants in the
// district, filtered to schools the caller can themselves access.
// No transaction: read-only. Helper consumed against pool per §5
// doctrine (not against a checked-out client).
router.get('/:id/users/:userId/access', requireAuth, async (req, res) => {
  try {
    const districtId = validateIntParam(req.params.id);
    if (districtId === null) {
      return res.status(400).json({ error: 'Invalid district id' });
    }
    const userId = validateIntParam(req.params.userId);
    if (userId === null) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (req.user.role !== 'district_admin' || req.user.district_id !== districtId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const targetUser = await pool.query(
      'SELECT id, district_id FROM users WHERE id = $1',
      [userId]
    );
    if (targetUser.rows.length === 0 || targetUser.rows[0].district_id !== districtId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    const grants = await pool.query(
      `SELECT school_tenant_id, created_at
       FROM user_school_access
       WHERE user_id = $1 AND district_id = $2 AND school_tenant_id = ANY($3::int[])
       ORDER BY school_tenant_id`,
      [userId, districtId, accessible]
    );

    res.json({ grants: grants.rows });
  } catch (err) {
    console.error('[districtAccess:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /:id/users/:userId/access — grant a school-tenant to the user.
// Body: { school_tenant_id }. Explicit transaction so app.actor_user_id
// propagates into the app-written 'grant' audit row (M032 doctrine
// extended to the new writer). M031's trigger does NOT fire on INSERT;
// app-layer is the source of 'grant' audit rows.
router.post('/:id/users/:userId/access', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const districtId = validateIntParam(req.params.id);
    if (districtId === null) {
      return res.status(400).json({ error: 'Invalid district id' });
    }
    const userId = validateIntParam(req.params.userId);
    if (userId === null) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const schoolTenantId = validateIntParam(req.body && req.body.school_tenant_id);
    if (schoolTenantId === null) {
      return res.status(400).json({ error: 'Invalid school_tenant_id' });
    }

    if (req.user.role !== 'district_admin' || req.user.district_id !== districtId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[districtAccess:post]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );

    const targetUser = await client.query(
      'SELECT id, district_id FROM users WHERE id = $1',
      [userId]
    );
    if (targetUser.rows.length === 0 || targetUser.rows[0].district_id !== districtId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(schoolTenantId)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    await client.query(
      `INSERT INTO user_school_access (user_id, district_id, school_tenant_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, districtId, schoolTenantId, actorId]
    );

    await client.query(
      `INSERT INTO user_school_access_audit
         (user_id, district_id, school_tenant_id, action, actor_user_id)
       VALUES ($1, $2, $3, 'grant', $4)`,
      [userId, districtId, schoolTenantId, actorId]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Granted',
      user_id: userId,
      district_id: districtId,
      school_tenant_id: schoolTenantId
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already granted' });
    }
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('[districtAccess:post]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /:id/users/:userId/access/:schoolTenantId — revoke a single
// grant. Sets both GUCs inside the txn: app.actor_user_id for #118
// actor capture, app.audit_action='revoke' for M033 action-label
// override. M031's trigger fires AFTER DELETE and writes the audit
// row reading both GUCs.
router.delete('/:id/users/:userId/access/:schoolTenantId', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const districtId = validateIntParam(req.params.id);
    if (districtId === null) {
      return res.status(400).json({ error: 'Invalid district id' });
    }
    const userId = validateIntParam(req.params.userId);
    if (userId === null) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const schoolTenantId = validateIntParam(req.params.schoolTenantId);
    if (schoolTenantId === null) {
      return res.status(400).json({ error: 'Invalid school_tenant_id' });
    }

    if (req.user.role !== 'district_admin' || req.user.district_id !== districtId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[districtAccess:delete]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );
    await client.query(
      "SELECT set_config('app.audit_action', 'revoke', true)"
    );

    const targetUser = await client.query(
      'SELECT id, district_id FROM users WHERE id = $1',
      [userId]
    );
    if (targetUser.rows.length === 0 || targetUser.rows[0].district_id !== districtId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(schoolTenantId)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await client.query(
      `DELETE FROM user_school_access
       WHERE user_id = $1 AND school_tenant_id = $2 AND district_id = $3
       RETURNING user_id`,
      [userId, schoolTenantId, districtId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json({
      message: 'Revoked',
      user_id: userId,
      district_id: districtId,
      school_tenant_id: schoolTenantId
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[districtAccess:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// PUT /:id/overdue-log-reminders — district_admin sets the weekly overdue-logs
// email opt-out for their OWN district (gate item (a), migration-051).
//
// Body: { enabled: boolean, school_tenant_id?: positive int }
//   - enabled = false  -> opt OUT (suppress the reminder)
//   - enabled = true   -> re-enable (reminders on); reversible by design
//   - school_tenant_id present -> the decision applies to that ONE school
//     (which must belong to this district); absent -> district-wide decision.
//
// Authz (§5): identical gate to the grant/revoke handlers above --
// requireAuth + role === 'district_admin' + req.user.district_id === pathId.
// A district_admin governs reminder policy for their whole district, so the
// school-scope branch validates the target school by tenants.district_id ===
// pathId (NOT resolveAccessibleTenantIds, which restricts a user to the
// schools they personally hold a user_school_access grant for -- too narrow
// for a district-level config decision). The district_id match makes a
// cross-district write structurally impossible.
//
// §3 rate limiting: mutationUserLimiter (the sibling grant/revoke routes
// predate the limiter convention -- their gap is tracked as Followup #80; this
// new external-input mutation is covered from the start). The global /api CSRF
// enforce (server.js) already protects this state-changing PUT.
//
// §4B: the request, the 200 body, and all logs carry integers + a boolean
// only -- no student/staff names, emails, or intervention data. The opt-out
// table itself stores nothing but integer refs + state (see migration-051).
//
// Idempotent UPSERT on the per-scope partial-unique index: a repeated call
// just overwrites reminders_enabled + updated_by/updated_at.
router.put('/:id/overdue-log-reminders', requireAuth, mutationUserLimiter, async (req, res) => {
  try {
    const districtId = validateIntParam(req.params.id);
    if (districtId === null) {
      return res.status(400).json({ error: 'Invalid district id' });
    }
    const enabled = validateBool(req.body && req.body.enabled);
    if (enabled === null) {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    // school_tenant_id is optional: present -> school-scoped, absent -> district-wide.
    const hasSchool = req.body && req.body.school_tenant_id !== undefined && req.body.school_tenant_id !== null;
    let schoolTenantId = null;
    if (hasSchool) {
      schoolTenantId = validateIntParam(req.body.school_tenant_id);
      if (schoolTenantId === null) {
        return res.status(400).json({ error: 'Invalid school_tenant_id' });
      }
    }

    if (req.user.role !== 'district_admin' || req.user.district_id !== districtId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[districtAccess:optout]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    let row;
    if (schoolTenantId !== null) {
      // §5: the target school must be a school-tenant within THIS district.
      const school = await pool.query(
        "SELECT id FROM tenants WHERE id = $1 AND district_id = $2 AND type = 'school'",
        [schoolTenantId, districtId]
      );
      if (school.rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      const result = await pool.query(
        `INSERT INTO overdue_log_reminder_optouts
           (school_tenant_id, reminders_enabled, created_by, updated_by)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (school_tenant_id) WHERE school_tenant_id IS NOT NULL
         DO UPDATE SET reminders_enabled = EXCLUDED.reminders_enabled,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = CURRENT_TIMESTAMP
         RETURNING school_tenant_id, district_id, reminders_enabled`,
        [schoolTenantId, enabled, actorId]
      );
      row = result.rows[0];
    } else {
      const result = await pool.query(
        `INSERT INTO overdue_log_reminder_optouts
           (district_id, reminders_enabled, created_by, updated_by)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (district_id) WHERE district_id IS NOT NULL
         DO UPDATE SET reminders_enabled = EXCLUDED.reminders_enabled,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = CURRENT_TIMESTAMP
         RETURNING school_tenant_id, district_id, reminders_enabled`,
        [districtId, enabled, actorId]
      );
      row = result.rows[0];
    }

    res.json({ message: 'Updated', ...row });
  } catch (err) {
    console.error('[districtAccess:optout]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
