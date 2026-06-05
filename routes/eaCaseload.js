// routes/eaCaseload.js — grant/revoke/list surface for ea_caseload_students.
//
// Mounted at /api/ea-caseload in server.js. Step 3 of PR-3.
//
// First production writer to ea_caseload_students (M041). Structurally
// mirrors routes/mtssCoordinators.js (the M038/M039/M040 writer) with
// three task-specific divergences:
//
//   1. The grant unit is per-(EA, student) rather than per-(user, school).
//      POST body is { ea_user_id, student_id, school_tenant_id }; DELETE
//      path is /eas/:eaUserId/students/:studentId. The school_tenant_id
//      is server-validated against the existing row on DELETE rather
//      than carried in the URL.
//
//   2. Target eligibility is a POSITIVE allowlist (target.role must be
//      'education_assistant') rather than a negative INELIGIBLE list.
//      An EA caseload row only makes sense for an EA; designating any
//      other role would be a category error.
//
//   3. The list endpoint takes a 2-key path (/by-ea/:eaUserId/school/:tenantId)
//      rather than mtssCoordinators's by-school enumeration. The admin UI
//      drills in per-EA. A by-school enumeration could be added later
//      without disturbing this surface.
//
// Authz model (all three endpoints):
//   1. requireAuth                                       (middleware)
//   2. role ∈ GRANT_ROLES or VIEW_ROLES                  (else 403)
//   3. school_tenant_id ∈ resolveAccessibleTenantIds(req.user)
//                                                        (else 403)
//   POST adds:
//   4. target user exists with role === 'education_assistant' (else 400 / 404)
//   5. school_tenant_id ∈ resolveAccessibleTenantIds(target)
//                                                        (else 400)
//   6. student exists with tenant_id === school_tenant_id (else 400)
//   DELETE adds:
//   4. existing row exists for (ea_user_id, student_id)  (else 404)
//   5. row.school_tenant_id ∈ resolveAccessibleTenantIds(caller)
//                                                        (else 404)
//
// district_id on the caseload row is SERVER-DERIVED from tenants.district_id
// (never read from req.body). Legacy single-tenant schools store NULL;
// district schools store the district id. M041's composite FK pair catches
// any drift between this derived value and the target user's district_id
// with SQLSTATE 23503 → 404.
//
// M041 FUTURE-WRITERS CONTRACT (header lines 117-156):
//
//   Two transaction-local GUCs participate in audit-row generation:
//     1. app.actor_user_id — set on every grant + revoke; captured into
//        ea_caseload_students_audit.actor_user_id by the trigger on DELETE
//        and by the app-written INSERT on grant.
//     2. app.audit_action='revoke' — set ONLY on explicit revoke; trigger
//        defaults to 'cascade_user_delete' when this GUC is unset.
//
//   The 'grant' action is NOT written by the trigger (trigger only fires
//   AFTER DELETE). The POST handler writes its own action='grant' audit
//   row inside the same transaction, mirroring mtssCoordinators.js
//   lines 258-263.
//
//   GUC scope contract: both are transaction-local (third arg `true` to
//   set_config). The BEGIN, every SET LOCAL, the INSERT/DELETE, and
//   COMMIT MUST run on a SINGLE checked-out client (not pool.query) or
//   the GUC and the write land on different sessions and the trigger
//   reads '' which COALESCEs to 'cascade_user_delete'.
//
// Error mapping:
//   400  parseInt validation failure
//        target user role is not 'education_assistant'
//        target user not a member of school_tenant_id
//        student not a member of school_tenant_id
//   403  caller is not in GRANT_ROLES/VIEW_ROLES OR school out of scope
//   404  target user missing
//        DELETE: row not found OR composite-FK drift OR caller can't
//        access the row's school (collapsed for non-disclosure parity)
//   409  duplicate grant (SQLSTATE 23505 on PK (ea_user_id, student_id))
//   500  unexpected error; req.user.id non-integer (server-side contract
//        violation, not user input)
//
// PII discipline (§4B):
//   - All console.error log lines carry route tag + err.message only.
//     No body content, no PII. ea_user_id/student_id/tenant_id are
//     integers, safe to log.
//   - GET projection minimized per operator §4B sign-off: id columns +
//     audit-subject metadata (granter_full_name, granted_at, granted_by)
//     + display columns from students (first_name, last_name, grade).
//     Explicitly NOT projected: students.tier, risk_level, external_id,
//     dob, parent_email, address, archived, intervention/document
//     history.

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

// Roles authorized to grant/revoke caseload assignments. School-level
// action that school_admins must perform within their building;
// district_admins span their district. Mirrors mtssCoordinators
// GRANT_ROLES exactly.
const GRANT_ROLES = ['school_admin', 'district_admin'];

// Roles authorized to READ the per-EA caseload list. Declared separately
// from GRANT_ROLES so a future widening of the read surface (e.g.,
// allowing counselor to inspect EA assignments) does not accidentally
// widen the grant/revoke surface.
const VIEW_ROLES = ['school_admin', 'district_admin'];

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// GET /by-ea/:eaUserId/school/:tenantId — list one EA's caseload at one
// building.
//
// Authz model:
//   1. requireAuth                                       (middleware)
//   2. role ∈ VIEW_ROLES                                 (else 403)
//   3. tenantId ∈ resolveAccessibleTenantIds(req.user)
//                                                        (else 403)
//   4. target EA exists with role === 'education_assistant'
//                                                        (else 404)
//   5. tenantId ∈ resolveAccessibleTenantIds(target)     (else 404)
//
// Steps 4-5 collapse cross-school/missing-EA probes to 404 for non-
// disclosure parity (the caller learns "no such EA in this school"
// without learning whether the EA exists elsewhere).
//
// Projection (operator §4B sign-off):
//   ea_caseload_students columns (ea_user_id, student_id,
//     school_tenant_id, created_at, created_by) — caseload row identity
//     + audit-subject metadata.
//   students columns (first_name, last_name, grade) — display only.
//   granter.full_name AS granter_full_name — LEFT JOIN on users via
//     created_by; nullable per M041 ON DELETE SET NULL.
// Explicitly NOT projected: tier, risk_level, external_id, dob,
//   parent_email, address, archived, history.
//
// Defense-in-depth: the JOIN to students filters on
// s.tenant_id = ec.school_tenant_id even though M041's
// (student_id, school_tenant_id) → students(id, tenant_id) composite FK
// already guarantees it. Belt-and-suspenders against composite-FK drift.
//
// Error mapping:
//   400  parseInt validation failure
//   403  caller is not in VIEW_ROLES OR tenant out of scope
//   404  EA missing OR EA not in this school
//   500  unexpected; console.error carries route tag + err.message only
router.get('/by-ea/:eaUserId/school/:tenantId', requireAuth, async (req, res) => {
  try {
    if (!VIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const eaUserId = validateIntParam(req.params.eaUserId);
    if (eaUserId === null) {
      return res.status(400).json({ error: 'Invalid ea_user_id' });
    }
    const tenantId = validateIntParam(req.params.tenantId);
    if (tenantId === null) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    // §5 dual-path consumed via helper, never inlined. Caller-scope
    // first; if the caller can't see this school, refuse without
    // touching the EA's row.
    const callerAccessible = await resolveAccessibleTenantIds(req.user);
    if (!callerAccessible.includes(tenantId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Target-scope: load the EA's role + tenant fields, then validate
    // membership via the same helper. Collapses missing-EA and wrong-
    // school cases to 404 for non-disclosure parity.
    const targetRes = await pool.query(
      'SELECT id, role, tenant_id, district_id FROM users WHERE id = $1',
      [eaUserId]
    );
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const target = targetRes.rows[0];
    if (target.role !== 'education_assistant') {
      return res.status(404).json({ error: 'Not found' });
    }
    const targetAccessible = await resolveAccessibleTenantIds(target);
    if (!targetAccessible.includes(tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(
      `SELECT
         ec.ea_user_id,
         ec.student_id,
         ec.school_tenant_id,
         ec.created_at        AS granted_at,
         ec.created_by        AS granted_by,
         s.first_name,
         s.last_name,
         s.grade,
         granter.full_name    AS granter_full_name
       FROM ea_caseload_students ec
       JOIN students s
         ON s.id = ec.student_id
        AND s.tenant_id = ec.school_tenant_id
       LEFT JOIN users granter ON granter.id = ec.created_by
       WHERE ec.ea_user_id = $1
         AND ec.school_tenant_id = $2
       ORDER BY s.last_name, s.first_name`,
      [eaUserId, tenantId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[eaCaseload:by-ea]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST / — grant an EA caseload assignment.
// Body: { ea_user_id, student_id, school_tenant_id }.
//
// Single checked-out client per M041 GUC contract. INSERT into
// ea_caseload_students + app-written 'grant' audit row in the same
// transaction. M041's trigger fires AFTER DELETE only, so the 'grant'
// row is app-written (mirrors mtssCoordinators.js lines 258-263).
router.post('/', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const eaUserId = validateIntParam(req.body && req.body.ea_user_id);
    if (eaUserId === null) {
      return res.status(400).json({ error: 'Invalid ea_user_id' });
    }
    const studentId = validateIntParam(req.body && req.body.student_id);
    if (studentId === null) {
      return res.status(400).json({ error: 'Invalid student_id' });
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
      console.error('[eaCaseload:post]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    // Caller-scope: school_tenant_id must be in caller's accessible set.
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

    // Target must be an Education Assistant. Positive role gate (not
    // INELIGIBLE list) because a caseload row only makes sense for an
    // EA; designating any other role would be a category error.
    const targetRes = await client.query(
      'SELECT id, role, tenant_id, district_id FROM users WHERE id = $1',
      [eaUserId]
    );
    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const target = targetRes.rows[0];
    if (target.role !== 'education_assistant') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Target user is not an Education Assistant' });
    }

    // Target must already have school membership in school_tenant_id —
    // composes with §5 dual-path. Helper handles both legacy single-
    // tenant (tenant_id equality) and district (user_school_access
    // membership) paths.
    const targetAccessible = await resolveAccessibleTenantIds(target);
    if (!targetAccessible.includes(schoolTenantId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Target user is not a member of that school' });
    }

    // Student must exist in this school. The M041 composite FK
    // (student_id, school_tenant_id) -> students(id, tenant_id) already
    // catches a cross-building student with SQLSTATE 23503 → 404, but
    // pre-INSERT validation produces a clearer 400 message for the
    // common UX path.
    const studentRes = await client.query(
      'SELECT id, tenant_id FROM students WHERE id = $1',
      [studentId]
    );
    if (studentRes.rows.length === 0 || studentRes.rows[0].tenant_id !== schoolTenantId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Student is not a member of that school' });
    }

    // Server-derive district_id from tenants — never from req.body.
    // Legacy single-tenant school → NULL; district school → its
    // district_id. M041's composite FK catches any drift between this
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
      `INSERT INTO ea_caseload_students
         (ea_user_id, student_id, school_tenant_id, district_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [eaUserId, studentId, schoolTenantId, districtId, actorId]
    );

    await client.query(
      `INSERT INTO ea_caseload_students_audit
         (ea_user_id, student_id, school_tenant_id, district_id, action, actor_user_id)
       VALUES ($1, $2, $3, $4, 'grant', $5)`,
      [eaUserId, studentId, schoolTenantId, districtId, actorId]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Granted',
      ea_user_id: eaUserId,
      student_id: studentId,
      school_tenant_id: schoolTenantId,
      district_id: districtId
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already assigned' });
    }
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('[eaCaseload:post]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /eas/:eaUserId/students/:studentId — revoke an EA caseload
// assignment. The row's school_tenant_id is NOT in the URL; it's loaded
// from the existing row, then validated against caller scope. The DELETE
// itself binds school_tenant_id in the WHERE clause as defense-in-depth
// against any TOCTOU between the SELECT and DELETE on the same client.
//
// Both transaction-local GUCs (app.actor_user_id + app.audit_action=
// 'revoke') are set on the same checked-out client inside the same
// transaction as the DELETE. M041's trigger fires AFTER DELETE and reads
// both GUCs to write the audit row with action='revoke' and
// actor_user_id=<caller>. Mirrors mtssCoordinators.js DELETE doctrine.
router.delete('/eas/:eaUserId/students/:studentId', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const eaUserId = validateIntParam(req.params.eaUserId);
    if (eaUserId === null) {
      return res.status(400).json({ error: 'Invalid ea_user_id' });
    }
    const studentId = validateIntParam(req.params.studentId);
    if (studentId === null) {
      return res.status(400).json({ error: 'Invalid student_id' });
    }

    if (!GRANT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[eaCaseload:delete]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    // Load the existing row to learn school_tenant_id, then verify the
    // caller can access that school. Missing row + caller-can't-access
    // both collapse to 404 for non-disclosure parity.
    const existingRes = await pool.query(
      'SELECT school_tenant_id FROM ea_caseload_students WHERE ea_user_id = $1 AND student_id = $2',
      [eaUserId, studentId]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const rowSchoolTenantId = existingRes.rows[0].school_tenant_id;

    const callerAccessible = await resolveAccessibleTenantIds(req.user);
    if (!callerAccessible.includes(rowSchoolTenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );
    await client.query(
      "SELECT set_config('app.audit_action', 'revoke', true)"
    );

    // Defense-in-depth: bind school_tenant_id in the DELETE WHERE so a
    // TOCTOU between the SELECT and DELETE on the same client would
    // still produce a 404 rather than a cross-school revoke.
    const result = await client.query(
      `DELETE FROM ea_caseload_students
       WHERE ea_user_id = $1 AND student_id = $2 AND school_tenant_id = $3
       RETURNING ea_user_id`,
      [eaUserId, studentId, rowSchoolTenantId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json({
      message: 'Revoked',
      ea_user_id: eaUserId,
      student_id: studentId,
      school_tenant_id: rowSchoolTenantId
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[eaCaseload:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
