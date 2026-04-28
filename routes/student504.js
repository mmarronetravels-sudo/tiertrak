const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');

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
//   - tenant_id is ALWAYS derived from req.user.tenant_id (JWT claim)
//     server-side. Routes NEVER read req.body.tenant_id (master-index
//     Followup 67 lesson — applied from day one for the 504 surface
//     so this route family does not inherit the legacy gap).
//   - INSERT statements in PR 2 will set created_by from req.user.id
//     for the 4 form-bearing tables that carry it (cycles + the 3
//     form types).
//   - Composite-FK schema (Migration 021) rejects cross-tenant child
//     references at the SQL layer regardless of any application bug
//     in these handlers.
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
function refuseParentRole(req, res, next) {
  if (req.user && req.user.role === 'parent') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
}

const NOT_IMPLEMENTED = { error: 'Not implemented in PR 1 (foundation scaffold)' };

// pg SQLSTATE codes used in handler error branches
// (https://www.postgresql.org/docs/current/errcodes-appendix.html).
const PG_FK_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

const ALLOWED_CONSENT_STATUS = new Set(['pending', 'granted', 'denied', 'revoked']);
const ALLOWED_ELIGIBILITY_STATUS = new Set(['pending', 'eligible', 'not_eligible']);

function isValidIsoTimestamp(v) {
  return typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
      .test(v);
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
router.post('/cycles', requireAuth, refuseParentRole, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
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
router.get('/cycles/student/:studentId', requireAuth, refuseParentRole, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const studentId = Number(req.params.studentId);
    if (!isPositiveInt(studentId)) {
      return res.status(400).json({ error: 'Invalid studentId' });
    }

    const result = await pool.query(
      `SELECT id, tenant_id, student_id, form_set_id, form_set_version,
              status, created_by, created_at, updated_at
       FROM student_504_cycles
       WHERE student_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [studentId, tenantId]
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
router.get('/cycles/:cycleId', requireAuth, refuseParentRole, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
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
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [cycleId, tenantId]
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
router.post('/consents', requireAuth, refuseParentRole, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
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
router.get('/consents/:id', requireAuth, refuseParentRole, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
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
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
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
router.post('/eligibility-determinations', requireAuth, refuseParentRole, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
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
router.get('/eligibility-determinations/:id', requireAuth, refuseParentRole, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await pool.query(
      `SELECT id, cycle_id, tenant_id, eligibility_status,
              determination_notes, determined_at,
              created_by, created_at, updated_at
       FROM student_504_eligibility_determinations
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
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

// POST /plans — create the 504 Accommodation Plan record.
// Accommodations are stored as a JSONB value on the plan row itself
// (Migration 022 reshape — domain-keyed dict matching
// frontend/src/data/504-form-sets/oregon-ode-2025.js
// formJ.accommodations.domains), not as separate child rows.
// Phase 2 implementation:
//   INSERT INTO student_504_plans (cycle_id, tenant_id, plan_status,
//     effective_date, review_date, accommodations, created_by)
//     VALUES (...)
// tenant_id is sourced from req.user.tenant_id (JWT-derived) — never
// from request body.
router.post('/plans', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// GET /plans/:id — plan + team members.
// Phase 2 implementation (explicit-projection only — never SELECT *):
//   SELECT p.id,
//          p.cycle_id,
//          p.accommodations,
//          p.plan_status,
//          p.effective_date,
//          p.review_date,
//          p.created_by,
//          p.created_at,
//          p.updated_at
//   FROM student_504_plans p
//   WHERE p.id = $1 AND p.tenant_id = $2     -- req.user.tenant_id (JWT)
//
// Then a separate SELECT against student_504_team_members for the
// matching cycle_id (also tenant-scoped). Migration 022 reshaped
// accommodations from a child table (student_504_accommodations,
// dropped) to a JSONB column on student_504_plans; the projection
// above includes p.accommodations directly, no separate aggregation
// needed. tenant_id is sourced from req.user.tenant_id (JWT-derived)
// — never from request body.
router.get('/plans/:id', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

module.exports = router;
