// canAccessStudent — canonical "can staff member U access student S?" predicate
// and its tenant-wide counterpart for list endpoints, plus a flag-gated
// applier that lets each call site enforce the new predicate or fall through
// to legacy behavior depending on STRICT_STUDENT_ACCESS_PREDICATE.
//
// One predicate, many enforcement sites. Sites:
//   List endpoints (Tier A — boolean "see everyone in this tenant?"):
//     - routes/students.js          GET /tenant/:tenantId
//     - routes/weeklyProgress.js    GET /missing/:tenantId
//     - routes/studentDocuments.js  GET /expiring/:tenantId
//   Per-record gates (Tier B — boolean "see this one student?"):
//     - middleware/authorizeInterventionAccess.js requireStudentReadAccess
//     - middleware/authorizeInterventionAccess.js authorizeByInterventionId
//     - middleware/authorizeInterventionAccess.js authorizeReadByInterventionId
//     - middleware/authorizeDocumentAccess.js resolveStudentAccess
//     - routes/interventions.js POST /assign (inline)
//     - routes/progressNotes.js POST / PUT /:id DELETE /:id (inline)
//
// THE PREDICATE (canStaffAccessStudent):
//   Tenant membership is a prerequisite. Then one of:
//     1. ELEVATED_ROLES (district_admin, district_tech_admin, school_admin,
//        counselor, interventionist) — always within accessible tenant
//     2. school_wide_access flag — always within accessible tenant
//     3. MTSS Coordinator designation for student's tenant — always within
//        designated tenant
//     4. Teacher caseload (role === 'teacher'):
//        - studentRow.tier === 1, OR
//        - active intervention_assignments row exists for (user.id, studentRow.id)
//
// Parent path is NOT in this helper — parent_student_links is a distinct
// gate doctrine, kept inline in the existing middleware. This helper applies
// only to staff branches. A parent passed through canStaffAccessStudent will
// always return false (no ELEVATED_ROLES membership, no school_wide_access,
// no coordinator row, role !== 'teacher').
//
// TEACHER PREDICATE RECONCILIATION (audit lesson):
//   The list endpoints have three different teacher predicates today:
//     - routes/students.js:163-181 — tier=1 OR active intervention_assignment
//     - routes/weeklyProgress.js:200-227 — active intervention_assignment ONLY
//     - routes/studentDocuments.js:285-309 — active intervention_assignment ONLY
//   None use students.teacher_id as a predicate (the LEFT JOIN on s.teacher_id
//   is for display only). The per-record predicate here aligns with students.js
//   (tier=1 OR assignment) because that's the "browse" list endpoint — the one
//   teachers actually use to navigate to records. weeklyProgress/studentDocuments
//   are narrower domain-specific action lists (things-you-need-to-do); their
//   tighter assignment-only shape is intentional and is preserved by their own
//   SQL, not this helper.
//
// FLAG-GATED APPLIER (applyStudentAccessGate / applyElevatedViewerGate):
//   process.env.STRICT_STUDENT_ACCESS_PREDICATE === 'true':
//     STRICT MODE — the new predicate is the trust boundary. Any error
//     during evaluation (including a missing mtss_coordinators table)
//     FAILS SAFE: decision = 'deny'. Logged with [access-predicate:strict-error].
//   Anything else (unset, 'false', '0', etc.):
//     DARK MODE — legacy decision wins. The new predicate runs in a
//     try/catch only to emit [access-flip:would-block] telemetry for
//     teachers whose access the strict path WOULD have denied. Any error
//     in telemetry is swallowed and logged with [access-flip:telemetry-error];
//     the request proceeds with the legacy decision regardless.
//
// MISSING-TABLE SAFETY (the mtss_coordinators table may not be applied
// in every environment at deploy time):
//   - Dark mode: predicate errors are caught and the request falls through
//     to the legacy decision. No request is broken.
//   - Strict mode: predicate errors fail safe (deny). The pre-deploy
//     checklist on the access-flip PR REQUIRES M038/M039/M040 to be
//     applied in prod before enabling strict mode, so this should never
//     fire in practice. The catch is defense-in-depth.
//
// LOG-LINE PII DISCIPLINE (§4B):
//   All log lines below carry only integer ids (user_id, student_id,
//   tenant_id, student_tier) plus err.message. No names, no body content,
//   no PII columns. Confirmed at design-pause time.

const { Pool } = require('pg');
const { ELEVATED_ROLES } = require('../constants/roles');
const { resolveAccessibleTenantIds } = require('./resolveAccessibleTenantIds');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function isStrict() {
  return process.env.STRICT_STUDENT_ACCESS_PREDICATE === 'true';
}

// isElevatedViewerForTenant — can this staff user see EVERY student in this
// tenant? Composes ELEVATED_ROLES membership + school_wide_access +
// mtss_coordinators designation. Tenant-membership prerequisite is the
// caller's responsibility (typically already verified upstream).
//
// Returns Promise<boolean>. Throws on DB error.
async function isElevatedViewerForTenant(user, tenantId) {
  if (ELEVATED_ROLES.includes(user.role)) return true;
  if (user.school_wide_access === true) return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM mtss_coordinators WHERE user_id = $1 AND school_tenant_id = $2 LIMIT 1',
    [user.id, tenantId]
  );
  return rows.length > 0;
}

// canStaffAccessStudent — single-row predicate. studentRow must have
// { id, tenant_id, tier }. Throws on DB error.
async function canStaffAccessStudent(user, studentRow) {
  const accessible = await resolveAccessibleTenantIds(user);
  if (!accessible.includes(studentRow.tenant_id)) return false;

  if (await isElevatedViewerForTenant(user, studentRow.tenant_id)) return true;

  if (user.role === 'teacher') {
    if (studentRow.tier === 1) return true;
    const { rows } = await pool.query(
      `SELECT 1
         FROM intervention_assignments ia
         JOIN student_interventions si ON si.id = ia.student_intervention_id
        WHERE ia.user_id = $1
          AND si.student_id = $2
          AND si.status = 'active'
        LIMIT 1`,
      [user.id, studentRow.id]
    );
    if (rows.length > 0) return true;
  }

  return false;
}

// applyStudentAccessGate — flag-gated single-row decision.
//
// Caller computes the legacy decision (typically
// `accessible.includes(studentRow.tenant_id)`) and passes it as
// legacyAllowed. Helper returns { decision: 'allow' | 'deny' }.
//
//   Strict mode: predicate is the trust boundary; legacyAllowed is
//     ignored. Errors fail safe → 'deny'.
//   Dark mode: legacyAllowed wins. If legacyAllowed is true AND the
//     caller is a teacher AND the predicate would have denied, log
//     [access-flip:would-block]. Telemetry errors are swallowed.
async function applyStudentAccessGate(user, studentRow, { legacyAllowed }) {
  if (isStrict()) {
    try {
      const ok = await canStaffAccessStudent(user, studentRow);
      return { decision: ok ? 'allow' : 'deny' };
    } catch (err) {
      console.error(
        '[access-predicate:strict-error]',
        'user_id=', user.id,
        'student_id=', studentRow.id,
        'tenant_id=', studentRow.tenant_id,
        'err=', err.message
      );
      return { decision: 'deny' };
    }
  }

  if (legacyAllowed && user.role === 'teacher') {
    try {
      const ok = await canStaffAccessStudent(user, studentRow);
      if (!ok) {
        console.warn(
          '[access-flip:would-block]',
          'user_id=', user.id,
          'student_id=', studentRow.id,
          'tenant_id=', studentRow.tenant_id,
          'student_tier=', studentRow.tier
        );
      }
    } catch (err) {
      console.warn(
        '[access-flip:telemetry-error]',
        'user_id=', user.id,
        'student_id=', studentRow.id,
        'tenant_id=', studentRow.tenant_id,
        'err=', err.message
      );
    }
  }

  return { decision: legacyAllowed ? 'allow' : 'deny' };
}

// applyElevatedViewerGate — flag-gated list-endpoint decision.
//
// Caller computes the legacy elevation decision (typically
// `ELEVATED_ROLES.includes(role) || school_wide_access === true`) and
// passes it as legacyElevated. Helper returns { elevated: boolean }.
//
//   Strict mode: isElevatedViewerForTenant is the truth; legacyElevated
//     is ignored. Errors fail safe → elevated=false (falls back to the
//     narrower per-caseload branch of the list SQL).
//   Dark mode: legacyElevated wins. If legacyElevated is false AND the
//     caller is a teacher AND the strict path WOULD have elevated, log
//     [access-flip:would-widen]. Telemetry errors are swallowed.
async function applyElevatedViewerGate(user, tenantId, { legacyElevated }) {
  if (isStrict()) {
    try {
      const ok = await isElevatedViewerForTenant(user, tenantId);
      return { elevated: ok };
    } catch (err) {
      console.error(
        '[access-predicate:strict-error]',
        'user_id=', user.id,
        'tenant_id=', tenantId,
        'err=', err.message
      );
      return { elevated: false };
    }
  }

  if (!legacyElevated && user.role === 'teacher') {
    try {
      const ok = await isElevatedViewerForTenant(user, tenantId);
      if (ok) {
        console.warn(
          '[access-flip:would-widen]',
          'user_id=', user.id,
          'tenant_id=', tenantId
        );
      }
    } catch (err) {
      console.warn(
        '[access-flip:telemetry-error]',
        'user_id=', user.id,
        'tenant_id=', tenantId,
        'err=', err.message
      );
    }
  }

  return { elevated: legacyElevated };
}

module.exports = {
  isElevatedViewerForTenant,
  canStaffAccessStudent,
  applyStudentAccessGate,
  applyElevatedViewerGate,
};
