const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth, requireStudentReadAccess } = require('../middleware/authorizeInterventionAccess');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================
// 504 parent routes — PR 1 scaffold (handlers stubbed)
//
// Strict architectural constraint, enforced at the route boundary:
// these handlers MUST NOT be capable of returning staff-only fields
// regardless of any future bug. The defense in depth is structural,
// not relying on caller-side filtering:
//
//   - Each Phase 2 SELECT will project columns BY EXPLICIT NAME.
//     No SELECT *. No json_agg of (mi.*) or (a.*) shapes that would
//     widen the response if a future column lands on the underlying
//     table.
//   - Endpoints exist ONLY for parent-visible resources. There are no
//     handlers here for evaluation_consents, eligibility_determinations,
//     or staff-only fields like determination_notes — those resources
//     are addressable only via routes/student504.js.
//   - requireStudentReadAccess (imported from
//     middleware/authorizeInterventionAccess.js, originally Session 25
//     PR #8 + Session 28 PR #14) gates every studentId-scoped route on
//     parent_student_links membership.
//
// PR 1 stubs return 501; full handlers + the explicit projection lists
// land in PR 2.
//
// Form set lookup: Phase 2's GET /procedural-safeguards reads the
// tenant's active form set from tenant_form_sets (Migration 021),
// imports the matching frontend form set module, and returns its
// proceduralSafeguardsText constant. PR 1 does not implement the
// lookup — the form set data file in commit 3 declares the constant;
// commits 2 + 3 are scaffold + data, not yet wired.
// ============================================================

void pool;

const NOT_IMPLEMENTED = { error: 'Not implemented in PR 1 (foundation scaffold)' };

// ============================================================
// Parent-visible accommodations for a linked student
// ============================================================

// GET /accommodations/student/:studentId
//
// Auth chain: requireAuth → requireStudentReadAccess
//   - requireAuth verifies the JWT and re-queries the user row.
//   - requireStudentReadAccess gates parents on parent_student_links
//     for the named studentId (Session 28 PR #14 pattern). Staff
//     callers who happen to hit this route are also accepted by the
//     existing helper via the staff-tenant-match branch — but they
//     should be using routes/student504.js instead; nothing is leaked
//     either way.
//
// Phase 2 implementation (explicit-projection only — never SELECT *):
//   SELECT a.id,
//          a.accommodation_text,
//          a.category,
//          a.order_position
//   FROM student_504_accommodations a
//   JOIN student_504_plans p ON a.plan_id = p.id AND p.tenant_id = a.tenant_id
//   JOIN student_504_cycles c ON p.cycle_id = c.id AND c.tenant_id = p.tenant_id
//   WHERE c.student_id = $1
//     AND c.tenant_id  = $2     -- req.targetStudent.tenant_id from middleware
//     AND p.plan_status = 'active'
//   ORDER BY a.order_position ASC
//
// determination_notes (staff-only) lives on a different table
// (student_504_eligibility_determinations) and is not reached by this
// JOIN; the projection list explicitly enumerates 4 accommodation
// columns so a future schema addition cannot widen the response.
router.get('/accommodations/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

// ============================================================
// Procedural safeguards (static text from the tenant's form set)
// ============================================================

// GET /procedural-safeguards
//
// Phase 2 implementation:
//   1. Look up the tenant's active form_set_id from tenant_form_sets
//      WHERE tenant_id = req.user.tenant_id AND is_active = TRUE.
//   2. Import the corresponding frontend form set module
//      (e.g., frontend/src/data/504-form-sets/oregon-ode-2025.js).
//   3. Return { text: formSet.proceduralSafeguardsText }.
//
// No DB read of student data. No tenant scoping concerns beyond
// "which form set does this tenant use." Parent role confirmed via
// requireAuth; no studentId in the path because the safeguards text
// is identical for every student under the same tenant's form set.
router.get('/procedural-safeguards', requireAuth, async (req, res) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

module.exports = router;
