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

// Reference the pool so lint doesn't flag it as unused while handlers
// are still stubs. PR 2 fills in real pool.query() calls.
void pool;

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

// ============================================================
// Cycles — POST, GET by student, GET by id
// ============================================================

// POST /cycles — create a new 504 cycle for a student.
// Phase 2 implementation:
//   const tenantId = req.user.tenant_id;
//   const { student_id, form_set_id, form_set_version } = req.body;
//   INSERT INTO student_504_cycles (tenant_id, student_id, form_set_id,
//     form_set_version, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *
//   Composite FK rejects if (student_id, tenant_id) is not in students.
router.post('/cycles', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// GET /cycles/student/:studentId — list cycles for a student.
// Phase 2 implementation:
//   SELECT * FROM student_504_cycles
//   WHERE student_id = $1 AND tenant_id = $2
//   ORDER BY created_at DESC
router.get('/cycles/student/:studentId', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// GET /cycles/:cycleId — get one cycle with all its child forms.
// Phase 2 implementation:
//   Cycle row + json_agg of consents + eligibility + plans + team_members
//   WHERE cycle_id = $1 AND tenant_id = $2
router.get('/cycles/:cycleId', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// ============================================================
// Form C — Evaluation Consents
// ============================================================

// POST /consents — record a Notice and Consent to Evaluate.
// Phase 2 implementation:
//   INSERT INTO student_504_evaluation_consents (cycle_id, tenant_id,
//     consent_status, parent_signature_text, parent_signature_at,
//     staff_signature_text, staff_signature_at, created_by) VALUES (...)
router.post('/consents', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// GET /consents/:id
// Phase 2 implementation:
//   SELECT * FROM student_504_evaluation_consents
//   WHERE id = $1 AND tenant_id = $2
router.get('/consents/:id', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// ============================================================
// Form I — Eligibility Determinations
// ============================================================

// POST /eligibility-determinations
// Phase 2 implementation:
//   INSERT INTO student_504_eligibility_determinations (cycle_id,
//     tenant_id, eligibility_status, determination_notes (staff-only!),
//     determined_at, created_by) VALUES (...)
router.post('/eligibility-determinations', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// GET /eligibility-determinations/:id
// Phase 2 implementation: full SELECT * is acceptable on the staff
// route — determination_notes IS reachable here. The parent route
// (routes/parent504.js) does NOT expose this resource at all.
router.get('/eligibility-determinations/:id', requireAuth, refuseParentRole, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
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
