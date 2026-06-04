const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth, requireStudentReadAccess } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { ELEVATED_ROLES } = require('../constants/roles');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================
// 504 staff routes — PR 1 scaffold (handlers stubbed)
//
// All handlers return 501 in PR 1; full implementations land in PR 2.
// The stubs exist so the architecture is locked in and visible to
// reviewers before any business logic ships:
//
//   - Every handler runs requireAuth (parent-route variants live in
//     routes/parent504.js, not this file).
//   - target_tenant_id binding contract (POST handlers): the resolved
//     target tenant is computed via resolveAndBindTargetTenant(req).
//     Optional req.body.target_tenant_id (positive integer). Absent
//     → falls back to req.user.tenant_id (backwards-compat for the
//     current single-tenant users whose JWT carries their only
//     accessible tenant). Present → validated against
//     resolveAccessibleTenantIds(req.user); not-in-set returns 403
//     before any INSERT, so a body-explicit cross-tenant probe
//     collapses to 403, not 400-FK. Per Followup #125 (per-school) —
//     this supersedes the day-one rule "Routes NEVER read
//     req.body.tenant_id" (master-index Followup 67) for the
//     multi-school case only. The rule remains in force for any
//     field NOT named target_tenant_id; GET handlers continue to
//     derive scope from resolveAccessibleTenantIds(req.user) directly.
//   - INSERT statements set created_by from req.user.id for the 4
//     form-bearing tables that carry it (cycles + the 3 form types).
//   - Composite-FK schema (Migration 021) rejects cross-tenant child
//     references at the SQL layer regardless of any application bug
//     in these handlers — defense-in-depth behind the helper's
//     accessible-set check.
//
// Form letter mapping documented in migration-021-504-foundation.sql:
//   Form C → /consents
//   Form I → /eligibility-determinations
//   Form J → /plans
// Route paths are semantic (not letter-based) so future readers do
// not need the C/I/J mapping in their head to navigate.
//
// requireAuth is imported from middleware/authorizeInterventionAccess.js,
// which still also lives duplicated in middleware/authorizeDocumentAccess.js
// per Session 27 Followup 1. PR 1 adds two new consumers (this file
// + routes/parent504.js) without consolidating; Followup 1 remains open.
// ============================================================

// Middleware-style guard composed into every staff route definition
// alongside requireAuth. Parent-role callers belong on routes/parent504.js;
// routing them here is a misconfiguration, not a data exposure (the guard
// 403s before any query runs). Pattern matches project precedent for
// auth-gated routes (Session 25 PR #8 / Session 28 PR #14): middleware
// composition in the route definition rather than function-call-inside-
// handler — reduces forgetting risk on the 9 staff handlers and is
// grep-able as a structural commitment.
// R4-A: narrow the 504 process surface (cycles, consents, eligibility-
// determinations, draft plans, full staff plan bundle, active-form-set)
// from "any non-parent staff" to ELEVATED_ROLES only. Replaces the prior
// refuseParentRole middleware which let teachers reach the process
// endpoints via curl/devtools even though the FE hid them.
//
// Operator-confirmed: all 504-process staff in production are coded as
// counselor / interventionist / school_admin (administrator). No 504-process
// staff are coded as 'teacher'. ELEVATED_ROLES (district_admin,
// district_tech_admin, school_admin, counselor, interventionist) gates the
// process tier with no lockout in prod.
//
// Teacher access to finalized 504 accommodations remains intact via the
// separate R4-B endpoint GET /plans/student/:studentId, gated by
// requireStudentReadAccess + canStaffAccessStudent's caseload predicate
// (STRICT_STUDENT_ACCESS_PREDICATE is LIVE in prod as of S114).
//
// Returns the byte-identical { error: 'Not authorized' } shape used
// file-wide so role-deny is indistinguishable from any other gate-deny
// path.
function requireElevated504Role(req, res, next) {
  if (!ELEVATED_ROLES.includes(req.user && req.user.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}

// pg SQLSTATE codes used in handler error branches
// (https://www.postgresql.org/docs/current/errcodes-appendix.html).
const PG_FK_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

const ALLOWED_CONSENT_STATUS = new Set(['pending', 'granted', 'denied', 'revoked']);
const ALLOWED_ELIGIBILITY_STATUS = new Set(['pending', 'eligible', 'not_eligible']);
const ALLOWED_PLAN_STATUS = new Set(['draft', 'active', 'expired', 'discontinued']);

function isValidIsoTimestamp(v) {
  return typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
      .test(v);
}

// effective_date and review_date are DATE columns on student_504_plans,
// not TIMESTAMP. Strict YYYY-MM-DD shape; PG validates calendar legality.
function isValidDateOnly(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// accommodations is a JSONB column on student_504_plans (migration-022,
// reshape from the dropped student_504_accommodations table). Form J
// stores per-domain text keyed by educational/extracurricular/assessments
// per the form-set module — but the schema accepts any JSON object, so
// validate object-ness here, not internal shape.
function isPlainJsonObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Schema-derived length caps. Keeping them named so handlers don't drift
// if migration-021 column types ever change.
const FORM_SET_ID_MAX = 100;
const FORM_SET_VERSION_MAX = 50;

// Free-text cap. Matches the only existing free-text size-limit pattern
// in the route directory (routes/tier1-assessments.js:355, notes capped
// at 300). Applied here to parent_signature_text and staff_signature_text
// to follow the established precedent.
const SIGNATURE_TEXT_MAX = 300;

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

/**
 * Resolve and validate the target tenant for a POST write handler.
 *
 * Per Followup #125 (per-school binding), POST handlers read an optional
 * target_tenant_id from req.body:
 *   - Absent → falls back to req.user.tenant_id (backwards-compat for
 *     the current single-tenant users whose JWT carries their only
 *     accessible tenant).
 *   - Present but not a positive integer → 400.
 *   - Present, positive integer, but not in
 *     resolveAccessibleTenantIds(req.user) → 403 (fires before any
 *     INSERT; a body-explicit cross-tenant probe collapses to 403,
 *     not 400-FK).
 *
 * Supersedes the day-one rule "Routes NEVER read req.body.tenant_id"
 * (master-index Followup 67) for the multi-school case only.
 *
 * @param {object} req - Express request. requireAuth must have already
 *   populated req.user; req.body may carry an optional target_tenant_id.
 * @returns {Promise<{targetTenantId: number|null, error: {status: number, body: object}|null}>}
 *   On success: { targetTenantId: <int>, error: null }.
 *   On failure: { targetTenantId: null, error: { status, body } } —
 *   caller should respond res.status(error.status).json(error.body).
 */
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

// ============================================================
// Tenant configuration — active form set
// ============================================================

// GET /active-form-set — return this tenant's currently active 504 form set.
//
// Drives the staff Section 504 tab visibility gate (Followup #26): tenants
// that have not been provisioned with a tenant_form_sets row should not see
// the 504 tab at all, since none of the staff workflows (start cycle, write
// Form C/I/J) can succeed for them. The frontend treats any non-OK from
// this endpoint — including 404 — as "tab off."
//
// Mirrors the SELECT shape used by parent504.js GET /procedural-safeguards:
// same tenant scoping, same is_active filter, same most-recently-created
// tiebreaker for the "multiple active rows" edge case the schema permits
// (tenant_form_sets has UNIQUE (tenant_id, form_set_id) but no constraint
// limiting one active row per tenant). A schema-level fix is tracked
// separately and intentionally NOT in scope for this endpoint.
//
// Differences from the parent route's tenant_form_sets read:
//   - requireElevated504Role gated (R4-A). Parents AND teachers have no use
//     for the staff tab visibility gate; routing them here is a
//     misconfiguration, not a data exposure (the guard 403s before any
//     query runs). Pre-R4-A this was refuseParentRole, which let teachers
//     reach the endpoint via curl/devtools even though the FE hides it.
//   - Returns BOTH form_set_id AND form_set_version, since the staff FE
//     uses both fields when POSTing to /cycles. This lets the FE drop the
//     compile-time form-set-identity import and treat the DB as the
//     source of truth.
//
// CLAUDE.md compliance:
//   - §4B: tenant_form_sets carries no PII (tenant_id is an internal id;
//     form_set_id and form_set_version are published policy identifiers
//     shared across tenants). Nothing logged on the success path.
//   - §5: tenantId is derived from req.user.tenant_id (JWT claim) — never
//     read from req.body, req.query, or req.params. Cross-tenant read is
//     impossible via this handler.
router.get('/active-form-set', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(
      `SELECT form_set_id, form_set_version
       FROM tenant_form_sets
       WHERE tenant_id = ANY($1::int[]) AND is_active = TRUE
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [accessible]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active form set for tenant' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[student504 GET /active-form-set] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// Cycles — POST, GET by student, GET by id
// ============================================================

// POST /cycles — create a new 504 cycle for a student.
//
// tenant_id and created_by are server-derived from the JWT (req.user) —
// never read from req.body. Composite FK student_504_cycles
// (student_id, tenant_id) → students(id, tenant_id) rejects cross-tenant
// student references at the SQL layer regardless of any application bug.
//
// form_set_id + form_set_version are validated against tenant_form_sets
// scoped on req.user.tenant_id with is_active=TRUE before insertion.
// tenant_form_sets has UNIQUE (tenant_id, form_set_id) but no constraint
// limiting one active row per tenant, so multiple form sets may be active
// concurrently — body inputs are validated against the row that matches.
router.post('/cycles', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    // Per Followup #125 — per-school binding. tenantId is the resolved
    // target tenant; the tenant_form_sets lookup below therefore
    // validates the form set is active for the target school.
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);
    const userId = req.user.id;
    const { student_id, form_set_id, form_set_version } = req.body || {};

    if (!isPositiveInt(student_id)) {
      return res.status(400).json({ error: 'Invalid or missing student_id' });
    }
    if (typeof form_set_id !== 'string' || form_set_id.length === 0 || form_set_id.length > FORM_SET_ID_MAX) {
      return res.status(400).json({ error: 'Invalid or missing form_set_id' });
    }
    if (typeof form_set_version !== 'string' || form_set_version.length === 0 || form_set_version.length > FORM_SET_VERSION_MAX) {
      return res.status(400).json({ error: 'Invalid or missing form_set_version' });
    }

    // SELECT-then-INSERT TOCTOU is accepted: a tenant admin deactivating
    // this form set between the two queries produces a stale-form-set
    // cycle, not a tenant boundary violation (§5) or PII exposure (§4B).
    const formSetCheck = await pool.query(
      `SELECT 1 FROM tenant_form_sets
       WHERE tenant_id = $1 AND form_set_id = $2 AND form_set_version = $3 AND is_active = TRUE
       LIMIT 1`,
      [tenantId, form_set_id, form_set_version]
    );
    if (formSetCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid form set or version for this tenant' });
    }

    const result = await pool.query(
      `INSERT INTO student_504_cycles
         (tenant_id, student_id, form_set_id, form_set_version, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, student_id, form_set_id, form_set_version,
                 status, created_by, created_at, updated_at`,
      [tenantId, student_id, form_set_id, form_set_version, userId]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err && err.code === PG_FK_VIOLATION) {
      // Composite FK rejected (student_id, tenant_id). Generic 400 — do not
      // surface PG's detail string, which can include identifying values.
      return res.status(400).json({ error: 'Invalid student reference' });
    }
    // Avoid logging err.message; PG error bodies can carry column values
    // that count as PII per CLAUDE.md §4B. SQLSTATE alone is safe.
    console.error('[student504 POST /cycles] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /cycles/student/:studentId — list cycles for a student.
//
// Result is empty if the studentId does not exist in this tenant — that's
// indistinguishable from "no cycles yet," which is the intended non-leaky
// behavior (no probe for cross-tenant student existence).
router.get('/cycles/student/:studentId', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const studentId = Number(req.params.studentId);
    if (!isPositiveInt(studentId)) {
      return res.status(400).json({ error: 'Invalid studentId' });
    }

    const result = await pool.query(
      `SELECT id, tenant_id, student_id, form_set_id, form_set_version,
              status, created_by, created_at, updated_at
       FROM student_504_cycles
       WHERE student_id = $1 AND tenant_id = ANY($2::int[])
       ORDER BY created_at DESC`,
      [studentId, accessible]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('[student504 GET /cycles/student/:studentId] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /cycles/:cycleId — cycle bundle: cycle row + child forms + team.
//
// Explicit-projection discipline (Q1a in the PR 2 contract): every column
// in every aggregation is named, so a future ALTER TABLE on any of the
// child tables cannot widen this response shape without an intentional
// edit here. determination_notes IS staff-only sensitive content per the
// permission tier matrix in migration-021-504-foundation.sql; it IS
// reachable on this staff route per the same matrix, but the parent
// route family (routes/parent504.js) does not expose this resource at
// all. tenant scoping is enforced both on the outer cycle row and on
// every inner subquery so a cross-tenant child row is unreachable even
// if an FK ever drifted.
router.get('/cycles/:cycleId', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const cycleId = Number(req.params.cycleId);
    if (!isPositiveInt(cycleId)) {
      return res.status(400).json({ error: 'Invalid cycleId' });
    }

    const result = await pool.query(
      `SELECT
         c.id,
         c.tenant_id,
         c.student_id,
         c.form_set_id,
         c.form_set_version,
         c.status,
         c.created_by,
         c.created_at,
         c.updated_at,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', ec.id,
             'cycle_id', ec.cycle_id,
             'consent_status', ec.consent_status,
             'parent_signature_text', ec.parent_signature_text,
             'parent_signature_at', ec.parent_signature_at,
             'staff_signature_text', ec.staff_signature_text,
             'staff_signature_at', ec.staff_signature_at,
             'created_by', ec.created_by,
             'created_at', ec.created_at,
             'updated_at', ec.updated_at
           ) ORDER BY ec.created_at)
           FROM student_504_evaluation_consents ec
           WHERE ec.cycle_id = c.id AND ec.tenant_id = c.tenant_id
         ), '[]'::json) AS consents,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', ed.id,
             'cycle_id', ed.cycle_id,
             'eligibility_status', ed.eligibility_status,
             'determination_notes', ed.determination_notes,
             'determined_at', ed.determined_at,
             'created_by', ed.created_by,
             'created_at', ed.created_at,
             'updated_at', ed.updated_at
           ) ORDER BY ed.created_at)
           FROM student_504_eligibility_determinations ed
           WHERE ed.cycle_id = c.id AND ed.tenant_id = c.tenant_id
         ), '[]'::json) AS eligibility_determinations,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', p.id,
             'cycle_id', p.cycle_id,
             'plan_status', p.plan_status,
             'effective_date', p.effective_date,
             'review_date', p.review_date,
             'accommodations', p.accommodations,
             'created_by', p.created_by,
             'created_at', p.created_at,
             'updated_at', p.updated_at
           ) ORDER BY p.created_at)
           FROM student_504_plans p
           WHERE p.cycle_id = c.id AND p.tenant_id = c.tenant_id
         ), '[]'::json) AS plans,
         COALESCE((
           -- Staff projection. Parent reads of student_504_team_members
           -- require a narrower projection per PR 2 contract Q1(a) —
           -- do not copy this shape into a parent route.
           SELECT json_agg(json_build_object(
             'id', tm.id,
             'cycle_id', tm.cycle_id,
             'user_id', tm.user_id,
             'member_name', tm.member_name,
             'member_role', tm.member_role,
             'created_at', tm.created_at
           ) ORDER BY tm.created_at)
           FROM student_504_team_members tm
           WHERE tm.cycle_id = c.id AND tm.tenant_id = c.tenant_id
         ), '[]'::json) AS team_members
       FROM student_504_cycles c
       WHERE c.id = $1 AND c.tenant_id = ANY($2::int[])`,
      [cycleId, accessible]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[student504 GET /cycles/:cycleId] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// Form C — Evaluation Consents
// ============================================================

// POST /consents — record a Notice and Consent to Evaluate (Form C).
//
// tenant_id and created_by are server-derived from the JWT (req.user) —
// never read from req.body. Composite FK student_504_evaluation_consents
// (cycle_id, tenant_id) → student_504_cycles(id, tenant_id) rejects
// cross-tenant cycle references at the SQL layer regardless of any
// application bug here.
//
// staff_signature_text advisory (PR 2 contract Q2): this column is
// parent-visible at write time. The Form C document is delivered to
// parents (printed or exported) with the staff signature block on it,
// so whatever a staff user writes here will be seen by a parent. Staff
// must not include staff-only commentary, eligibility reasoning, or
// other §4B-tier-restricted content in this field. No new server-side
// validation is added beyond what other free-text fields use; this is
// a UX/policy rule the frontend Form C surface enforces.
router.post('/consents', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    // Per Followup #125 — per-school binding. tenantId below is the
    // resolved target tenant for this write.
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);
    const userId = req.user.id;
    const {
      cycle_id,
      consent_status,
      parent_signature_text,
      parent_signature_at,
      staff_signature_text,
      staff_signature_at,
    } = req.body || {};

    if (!isPositiveInt(cycle_id)) {
      return res.status(400).json({ error: 'Invalid or missing cycle_id' });
    }
    if (consent_status !== undefined && consent_status !== null && !ALLOWED_CONSENT_STATUS.has(consent_status)) {
      return res.status(400).json({ error: 'Invalid consent_status' });
    }
    if (parent_signature_text !== undefined && parent_signature_text !== null) {
      if (typeof parent_signature_text !== 'string') {
        return res.status(400).json({ error: 'Invalid parent_signature_text' });
      }
      if (parent_signature_text.length > SIGNATURE_TEXT_MAX) {
        return res.status(400).json({ error: `parent_signature_text exceeds ${SIGNATURE_TEXT_MAX} characters` });
      }
    }
    if (staff_signature_text !== undefined && staff_signature_text !== null) {
      if (typeof staff_signature_text !== 'string') {
        return res.status(400).json({ error: 'Invalid staff_signature_text' });
      }
      if (staff_signature_text.length > SIGNATURE_TEXT_MAX) {
        return res.status(400).json({ error: `staff_signature_text exceeds ${SIGNATURE_TEXT_MAX} characters` });
      }
    }
    if (parent_signature_at !== undefined && parent_signature_at !== null && !isValidIsoTimestamp(parent_signature_at)) {
      return res.status(400).json({ error: 'Invalid parent_signature_at' });
    }
    if (staff_signature_at !== undefined && staff_signature_at !== null && !isValidIsoTimestamp(staff_signature_at)) {
      return res.status(400).json({ error: 'Invalid staff_signature_at' });
    }

    const result = await pool.query(
      `INSERT INTO student_504_evaluation_consents
         (cycle_id, tenant_id, consent_status,
          parent_signature_text, parent_signature_at,
          staff_signature_text, staff_signature_at, created_by)
       VALUES ($1, $2, COALESCE($3, 'pending'), $4, $5, $6, $7, $8)
       RETURNING id, cycle_id, tenant_id, consent_status,
                 parent_signature_text, parent_signature_at,
                 staff_signature_text, staff_signature_at,
                 created_by, created_at, updated_at`,
      [
        cycle_id,
        tenantId,
        consent_status ?? null,
        parent_signature_text ?? null,
        parent_signature_at ?? null,
        staff_signature_text ?? null,
        staff_signature_at ?? null,
        userId,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err && err.code === PG_FK_VIOLATION) {
      return res.status(400).json({ error: 'Invalid cycle reference' });
    }
    if (err && err.code === PG_CHECK_VIOLATION) {
      return res.status(400).json({ error: 'Invalid value for a constrained field' });
    }
    console.error('[student504 POST /consents] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /consents/:id — fetch one consent record.
//
// Explicit projection (no SELECT *) so a future ALTER TABLE on
// student_504_evaluation_consents cannot widen this response shape
// without an intentional edit. Tenant-scoped on req.user.tenant_id;
// 404 for both "doesn't exist" and "wrong tenant" — non-leaky.
router.get('/consents/:id', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await pool.query(
      `SELECT id, cycle_id, tenant_id, consent_status,
              parent_signature_text, parent_signature_at,
              staff_signature_text, staff_signature_at,
              created_by, created_at, updated_at
       FROM student_504_evaluation_consents
       WHERE id = $1 AND tenant_id = ANY($2::int[])`,
      [id, accessible]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[student504 GET /consents/:id] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// Form I — Eligibility Determinations
// ============================================================

// POST /eligibility-determinations — record a Form I determination.
//
// tenant_id and created_by are server-derived from the JWT (req.user) —
// never read from req.body. Composite FK
// student_504_eligibility_determinations (cycle_id, tenant_id) →
// student_504_cycles(id, tenant_id) rejects cross-tenant cycle
// references at the SQL layer.
//
// determination_notes is STAFF-ONLY per the §4B permission tier matrix
// in migration-021-504-foundation.sql. Reachable on this staff route;
// the parent route family (routes/parent504.js) does NOT expose this
// resource at all and therefore cannot leak this column. No length cap
// is applied here: the field is intended for eligibility reasoning
// paragraphs and the codebase's only existing free-text cap
// (routes/tier1-assessments.js:355, 300 chars on tier1 notes) is too
// short for that semantic. Other "notes" fields in the codebase
// (mtssMeetings.notes, progressNotes.note, interventionPlans, etc.)
// are uncapped, which is the majority house style being followed.
router.post('/eligibility-determinations', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    // Per Followup #125 — per-school binding. tenantId below is the
    // resolved target tenant for this write.
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);
    const userId = req.user.id;
    const {
      cycle_id,
      eligibility_status,
      determination_notes,
      determined_at,
    } = req.body || {};

    if (!isPositiveInt(cycle_id)) {
      return res.status(400).json({ error: 'Invalid or missing cycle_id' });
    }
    if (eligibility_status !== undefined && eligibility_status !== null && !ALLOWED_ELIGIBILITY_STATUS.has(eligibility_status)) {
      return res.status(400).json({ error: 'Invalid eligibility_status' });
    }
    if (determination_notes !== undefined && determination_notes !== null && typeof determination_notes !== 'string') {
      return res.status(400).json({ error: 'Invalid determination_notes' });
    }
    if (determined_at !== undefined && determined_at !== null && !isValidIsoTimestamp(determined_at)) {
      return res.status(400).json({ error: 'Invalid determined_at' });
    }

    const result = await pool.query(
      `INSERT INTO student_504_eligibility_determinations
         (cycle_id, tenant_id, eligibility_status,
          determination_notes, determined_at, created_by)
       VALUES ($1, $2, COALESCE($3, 'pending'), $4, $5, $6)
       RETURNING id, cycle_id, tenant_id, eligibility_status,
                 determination_notes, determined_at,
                 created_by, created_at, updated_at`,
      [
        cycle_id,
        tenantId,
        eligibility_status ?? null,
        determination_notes ?? null,
        determined_at ?? null,
        userId,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err && err.code === PG_FK_VIOLATION) {
      return res.status(400).json({ error: 'Invalid cycle reference' });
    }
    if (err && err.code === PG_CHECK_VIOLATION) {
      return res.status(400).json({ error: 'Invalid value for a constrained field' });
    }
    console.error('[student504 POST /eligibility-determinations] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /eligibility-determinations/:id — fetch one Form I determination.
//
// Explicit projection (Q1a) — even though the PR #20 stub note said
// "full SELECT * is acceptable on the staff route," the projection-
// discipline rule applies on staff routes too: a future ALTER TABLE
// on student_504_eligibility_determinations should not be able to
// widen this response shape without an intentional edit. Projection
// includes determination_notes (staff-only, reachable here per the
// §4B tier matrix). Tenant-scoped on req.user.tenant_id; 404 covers
// both "not found" and "wrong tenant" — non-leaky. The parent route
// family does NOT expose this resource at all.
router.get('/eligibility-determinations/:id', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await pool.query(
      `SELECT id, cycle_id, tenant_id, eligibility_status,
              determination_notes, determined_at,
              created_by, created_at, updated_at
       FROM student_504_eligibility_determinations
       WHERE id = $1 AND tenant_id = ANY($2::int[])`,
      [id, accessible]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[student504 GET /eligibility-determinations/:id] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// Form J — Plans
// ============================================================

// POST /plans — create the 504 Accommodation Plan record (Form J).
//
// tenant_id and created_by are server-derived from the JWT (req.user) —
// never read from req.body. Composite FK student_504_plans
// (cycle_id, tenant_id) → student_504_cycles(id, tenant_id) rejects
// cross-tenant cycle references at the SQL layer.
//
// accommodations advisory (parent-visible at write time): the
// accommodations JSONB column is the canonical storage for what
// parents read via GET /api/parent-504/accommodations/student/:studentId
// (commit 5). Whatever a staff user writes here will be seen by the
// parent of any student linked to this plan's cycle. Staff must not
// include staff-only commentary, eligibility reasoning, or other §4B-
// tier-restricted content in any accommodations text. Same UX/policy
// rule as staff_signature_text on /consents (PR 2 contract Q2);
// grep-able via "parent-visible at write time."
//
// accommodations storage shape: a JSONB column on student_504_plans
// (migration-022 reshape from the dropped student_504_accommodations
// child table). No json_agg sub-collection here — the column is
// stored and returned as a single JSONB value, keyed by Form J domain
// (educational / extracurricular / assessments) per the form-set
// module. Validation enforces object-ness only; internal key shape is
// a frontend/form-set concern.
router.post('/plans', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    // Per Followup #125 — per-school binding. tenantId below is the
    // resolved target tenant for this write.
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);
    const userId = req.user.id;
    const {
      cycle_id,
      plan_status,
      effective_date,
      review_date,
      accommodations,
    } = req.body || {};

    if (!isPositiveInt(cycle_id)) {
      return res.status(400).json({ error: 'Invalid or missing cycle_id' });
    }
    if (plan_status !== undefined && plan_status !== null && !ALLOWED_PLAN_STATUS.has(plan_status)) {
      return res.status(400).json({ error: 'Invalid plan_status' });
    }
    if (effective_date !== undefined && effective_date !== null && !isValidDateOnly(effective_date)) {
      return res.status(400).json({ error: 'Invalid effective_date' });
    }
    if (review_date !== undefined && review_date !== null && !isValidDateOnly(review_date)) {
      return res.status(400).json({ error: 'Invalid review_date' });
    }
    if (accommodations !== undefined && accommodations !== null && !isPlainJsonObject(accommodations)) {
      return res.status(400).json({ error: 'Invalid accommodations (must be a JSON object)' });
    }

    const accommodationsParam = (accommodations === undefined || accommodations === null)
      ? null
      : JSON.stringify(accommodations);

    const result = await pool.query(
      `INSERT INTO student_504_plans
         (cycle_id, tenant_id, plan_status, effective_date, review_date,
          accommodations, created_by)
       VALUES ($1, $2, COALESCE($3, 'draft'), $4, $5,
               COALESCE($6::jsonb, '{}'::jsonb), $7)
       RETURNING id, cycle_id, tenant_id, plan_status,
                 effective_date, review_date, accommodations,
                 created_by, created_at, updated_at`,
      [
        cycle_id,
        tenantId,
        plan_status ?? null,
        effective_date ?? null,
        review_date ?? null,
        accommodationsParam,
        userId,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err && err.code === PG_FK_VIOLATION) {
      return res.status(400).json({ error: 'Invalid cycle reference' });
    }
    if (err && err.code === PG_CHECK_VIOLATION) {
      return res.status(400).json({ error: 'Invalid value for a constrained field' });
    }
    console.error('[student504 POST /plans] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /plans/:id — plan row + team members for the plan's cycle.
//
// Single round-trip with a correlated json_agg subquery for team
// members, mirroring the GET /cycles/:cycleId bundle pattern.
// Explicit projection on the plan row AND on the team_members
// aggregation (Q1a) — the same staff-projection comment as
// /cycles/:cycleId applies: a parent route reading
// student_504_team_members would require a narrower projection.
//
// Tenant scoping: outer plan row scoped on req.user.tenant_id; inner
// team_members subquery additionally scoped on c.tenant_id via the
// cycle JOIN as defense in depth (composite FKs already enforce the
// match). 404 covers both "not found" and "wrong tenant" — non-leaky.
router.get('/plans/:id', requireAuth, requireElevated504Role, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await pool.query(
      `SELECT
         p.id,
         p.cycle_id,
         p.tenant_id,
         p.plan_status,
         p.effective_date,
         p.review_date,
         p.accommodations,
         p.created_by,
         p.created_at,
         p.updated_at,
         COALESCE((
           -- Staff projection. Parent reads of student_504_team_members
           -- require a narrower projection per PR 2 contract Q1(a) —
           -- do not copy this shape into a parent route.
           SELECT json_agg(json_build_object(
             'id', tm.id,
             'cycle_id', tm.cycle_id,
             'user_id', tm.user_id,
             'member_name', tm.member_name,
             'member_role', tm.member_role,
             'created_at', tm.created_at
           ) ORDER BY tm.created_at)
           FROM student_504_team_members tm
           WHERE tm.cycle_id = p.cycle_id AND tm.tenant_id = p.tenant_id
         ), '[]'::json) AS team_members
       FROM student_504_plans p
       WHERE p.id = $1 AND p.tenant_id = ANY($2::int[])`,
      [id, accessible]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[student504 GET /plans/:id] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /plans/student/:studentId — finalized accommodation plans for a student.
//
// R4-B: teacher-readable finalized-plan view. The process workflow (cycles,
// consents, eligibility-determinations, draft plans) remains special-ed-team-
// only via the requireElevated504Role handlers in this file (R4-A
// closure of the process tier — replaced refuseParentRole, which let
// teachers reach the process surface via curl). This endpoint is the
// additive teacher-side
// surface: a teacher who has caseload access to the student (via
// canStaffAccessStudent's caseload predicate) can read the student's
// active (finalized) 504 accommodations to inform classroom support.
//
// Tenant binding (§5): :studentId is gated by the canonical
// requireStudentReadAccess middleware — walks students.tenant_id, delegates
// to applyStudentAccessGate for staff branches (with resolveAccessibleTenantIds
// for §5 dual-path), and to parent_student_links membership for parents.
// Sets req.student = { id, tenant_id, tier }. Not-found and wrong-tenant
// collapse to byte-identical 403 inside the middleware.
//
// Access matrix (set by the gate, not by this handler):
//   - ELEVATED_ROLES (district_admin, district_tech_admin, school_admin,
//     counselor, interventionist): allowed via legacy tenant-membership /
//     applyStudentAccessGate's allow branch.
//   - teacher: allowed iff student is on caseload (tier=1 OR active
//     intervention_assignments(user_id, student_id) with status='active') —
//     enforced by canStaffAccessStudent's caseload predicate when strict
//     mode is engaged; legacy tenant-membership in dark mode.
//   - linked parent: allowed via parent_student_links membership.
//   - unlinked parent / cross-tenant staff / non-caseload teacher (strict):
//     byte-identical 403 inside the middleware.
//
// Plan-status filter: `WHERE p.plan_status = 'active'` — only finalized
// (active) plans are emitted. Draft/expired/discontinued plans are NEVER
// returned by this endpoint. Mirrors the parent504.js GET
// /accommodations/student/:studentId precedent at parent504.js:120.
//
// Projection (minimized — operator-mandated for the teacher tier):
//   id, plan_status, effective_date, review_date, accommodations
// Drops created_by (staff-directory leak) and team_members.user_id
// (staff-directory leak). The staff-side bundle (GET /plans/:id at
// line 771) retains the full projection — additive design, no collision.
//
// Tenant SQL defense-in-depth: c.tenant_id = $2 (req.student.tenant_id
// from the gate). Tighter than the existing accessible-array pattern
// because the gate has already confirmed which single tenant the caller
// is operating in for this :studentId.
router.get('/plans/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    const studentId = req.student.id;
    const tenantId = req.student.tenant_id;

    const result = await pool.query(
      `SELECT
         p.id,
         p.plan_status,
         p.effective_date,
         p.review_date,
         p.accommodations
       FROM student_504_plans p
       JOIN student_504_cycles c ON c.id = p.cycle_id
       WHERE c.student_id = $1
         AND c.tenant_id = $2
         AND p.plan_status = 'active'
       ORDER BY p.effective_date DESC NULLS LAST, p.id DESC`,
      [studentId, tenantId]
    );
    return res.json(result.rows);
  } catch (err) {
    // §4B: integer user_id + err.code only. No body echo, no PII.
    console.error('[student504:getStudentFinalizedPlans]', 'user_id=', req.user && req.user.id, 'err_code=', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
