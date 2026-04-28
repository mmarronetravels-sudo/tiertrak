const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth, requireStudentReadAccess } = require('../middleware/authorizeInterventionAccess');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Pre-loaded registry of known form sets, mapping form_set_id (the value
// stored in tenant_form_sets.form_set_id) to the imported form-set module
// object. Pre-loading at module init avoids per-request import cost AND
// removes any chance of using an attacker-controlled form_set_id as a
// path component (defense in depth — form_set_id comes from the DB, but
// the registry-based lookup makes path-traversal structurally impossible).
//
// require() of a leaf ESM module synchronously needs Node ≥22.12. The
// frontend/ tree has "type": "module" but the form-set files have no
// top-level await and no relative imports, so they meet the constraint.
// If require() fails here it fails at server start (immediate detection)
// rather than at request time — a desirable property.
//
// IMPORTANT: this server's Node version is NOT pinned in the repo —
// there is no render.yaml, no .nvmrc, and no engines field in
// package.json. Production runs on Render under whatever Node default
// the service is configured with (Render dashboard, not visible in
// repo). Pinning Node version explicitly is a separate followup
// (see master-index draft followup added for this PR).
//
// TODO(form-set-arch): the backend require()-of-frontend-module
// pattern is a known-debt decision for this PR. Long-term this should
// be either (a) form-set content moved to a shared/ directory imported
// by both backend and frontend, or (b) form-set content stored in the
// database keyed by form_set_id. Captured for the master-index draft
// as the "Form-set architecture" followup. Don't refactor in PR 2 —
// this is a breadcrumb for a future architectural pass.
const FORM_SET_REGISTRY = {
  'oregon-ode-2025': require('../frontend/src/data/504-form-sets/oregon-ode-2025.js').oregonOde2025,
};

// ============================================================
// 504 parent routes
//
// Strict architectural constraint, enforced at the route boundary:
// these handlers MUST NOT be capable of returning staff-only fields
// regardless of any future bug. The defense in depth is structural,
// not relying on caller-side filtering:
//
//   - Each SELECT projects columns BY EXPLICIT NAME. No SELECT *.
//     No json_agg of (mi.*) or (a.*) shapes that would widen the
//     response if a future column lands on the underlying table.
//   - Endpoints exist ONLY for parent-visible resources. There are no
//     handlers here for evaluation_consents, eligibility_determinations,
//     or staff-only fields like determination_notes — those resources
//     are addressable only via routes/student504.js.
//   - requireStudentReadAccess (imported from
//     middleware/authorizeInterventionAccess.js, originally Session 25
//     PR #8 + Session 28 PR #14) gates every studentId-scoped route on
//     parent_student_links membership.
//
// Form set lookup: GET /procedural-safeguards reads the tenant's
// active form set from tenant_form_sets (Migration 021) and returns
// the matching form set's proceduralSafeguardsText. The form set
// registry is pre-loaded at module init (FORM_SET_REGISTRY above).
// ============================================================

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
// Tenant scoping (PR 2 contract): tenant_id is sourced from
// req.student.tenant_id (set by requireStudentReadAccess from the
// students row server-side) — NOT from req.user.tenant_id and NEVER
// from request body. studentId is also taken from req.student.id
// (middleware-validated) rather than re-reading req.params, so the
// handler relies entirely on middleware-derived state.
//
// Explicit projection (PR 2 contract Q1a): the SELECT enumerates 5
// plan columns by name. tenant_id, cycle_id, created_by, created_at,
// updated_at are deliberately NOT projected — they're staff metadata
// the parent surface does not need. determination_notes (staff-only)
// lives on student_504_eligibility_determinations and is not reached
// by this JOIN. team_members are NOT included — the parent route
// family does not expose student_504_team_members at all in PR 2;
// any future parent endpoint reading that table would require an
// even narrower projection per Q1a.
//
// Migration 022 reshape: accommodations is a JSONB column on
// student_504_plans, keyed by Form J domain (educational /
// extracurricular / assessments). Returned as-is.
router.get('/accommodations/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    const tenantId = req.student.tenant_id;
    const studentId = req.student.id;

    const result = await pool.query(
      `SELECT p.id,
              p.accommodations,
              p.plan_status,
              p.effective_date,
              p.review_date
       FROM student_504_plans p
       JOIN student_504_cycles c
         ON c.id = p.cycle_id AND c.tenant_id = p.tenant_id
       WHERE c.student_id = $1
         AND p.tenant_id  = $2
         AND p.plan_status = 'active'
       ORDER BY p.effective_date DESC NULLS LAST, p.id DESC`,
      [studentId, tenantId]
    );
    return res.json(result.rows);
  } catch (err) {
    // err.code only — PG error bodies can carry student_id / tenant_id
    // values that count as PII per CLAUDE.md §4B.
    console.error('[parent504 GET /accommodations/student/:studentId] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// Procedural safeguards (static text from the tenant's form set)
// ============================================================

// GET /procedural-safeguards
//
// Followup #2 (Session 32 master index, carry-forward): why
// requireAuth alone — no per-student or role guard — is intentional
// on this route, which is the only requireAuth-only handler in the
// new 504 surface and could read as a missing guard during cold
// review.
//
//   - No per-student guard: the procedural-safeguards text is static
//     policy content from the tenant's form set. It is identical for
//     every student under the same tenant's form set, so attaching a
//     studentId to the path or gating on parent_student_links would
//     add no privacy benefit.
//   - No role guard: the same text is shown to parents AND to staff
//     (it's the procedural-safeguards notice that accompanies every
//     Form C / I / J packet). refuseParentRole-style gating would be
//     wrong here.
//   - No PII: the response body is published policy text from a
//     versioned form set. No student data, no staff data, no
//     intervention data is read or returned by this handler. The
//     only DB read is tenant_form_sets, which carries no PII.
//   - Cross-tenant: tenant_form_sets is scoped by req.user.tenant_id;
//     a request from one tenant cannot read another tenant's form
//     set selection. The form-set CONTENT is shared (multiple
//     tenants can use 'oregon-ode-2025'), which is correct because
//     the content is published policy.
//
// Contract (PR 2): returns ONLY { text: formSet.proceduralSafeguardsText }.
// No fallback, no error envelope wrapping a placeholder. Until the
// content lands in the form-set module, formSet.proceduralSafeguardsText
// is null, and this endpoint returns { text: null } with status 200 —
// the release-blocker is content-side, tracked separately, not a code
// fault that should be surfaced as a 5xx.
//
// Tiebreaker for tenants with multiple is_active=TRUE rows in
// tenant_form_sets (allowed by the schema per Q5): pick the most
// recently created. In practice tenants have one active form set;
// the ORDER BY is for the edge case.
router.get('/procedural-safeguards', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await pool.query(
      `SELECT form_set_id
       FROM tenant_form_sets
       WHERE tenant_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active form set for tenant' });
    }
    const { form_set_id: formSetId } = result.rows[0];
    const formSet = FORM_SET_REGISTRY[formSetId];
    if (!formSet) {
      // Tenant points at a form_set_id this server doesn't know about.
      // Should not happen in normal operation (the registry covers
      // every form_set_id a tenant admin can choose). Generic 500 —
      // surfacing form_set_id in the response would leak a tenant
      // configuration detail.
      console.error('[parent504 GET /procedural-safeguards] unknown form_set_id');
      return res.status(500).json({ error: 'Server error' });
    }
    return res.json({ text: formSet.proceduralSafeguardsText });
  } catch (err) {
    console.error('[parent504 GET /procedural-safeguards] error code:', err && err.code);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
