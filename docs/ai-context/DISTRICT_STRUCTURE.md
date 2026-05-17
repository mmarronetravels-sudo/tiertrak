# DISTRICT STRUCTURE — Resolved Product Decisions

District structure in TierTrak refers to the layered tenant model: schools as tenants (`tenants.type = 'school'`), districts as parents of one or more school-tenants (via `tenants.district_id`), and per-user school access governed by the `user_school_access` membership table. See `CLAUDE.md §5` for the authoritative dual-path tenancy rules.

This doc is the canonical home for **resolved product decisions** about how district structure interacts with feature semantics. Scope of this revision is limited to two resolved decisions (§1.1 #122; §1.2 #123). Future X-list PRs will grow the doc with consolidated per-school binding doctrine (#125) and other district-scoped product decisions as they resolve.

---

## §1 Resolved Product Decisions

### §1.1 Followup #122 — Cross-school parent-student links (accepted by design)

**Question.** Should a `parent_student_links` row assert same-tenant between the parent user and the linked student, or should cross-school links be permitted?

**Resolution.** Cross-school parent-student links are **permitted by design** (Path A). A parent user may be linked to students across multiple schools within the same district.

**Rationale.** District admins with multi-school `user_school_access` membership routinely manage parent relationships spanning multiple schools in the same district (e.g., a family with one child in an elementary school and a sibling in a middle school within the same district). A structural `parent.tenant_id === student.tenant_id` assertion would prevent the legitimate multi-school-family pattern and force operator workarounds (duplicate parent accounts per school).

**Privacy posture.** Privacy is preserved by access control, not by structural same-tenant assertion. Visibility into a parent-student link is gated by the caller's `user_school_access` membership for the student's school. A parent who shouldn't see student X simply lacks the access path; the link existence is not the gate.

**Code state.** `routes/parentLinks.js` already permits cross-school links — tenant scoping uses `resolveAccessibleTenantIds` membership (see `loadLinkAndAssertTenant` helper). **No behavioral code change is required by this resolution.** The doctrine codification here closes the open question banked from PR #109 (privacy-reviewer W-1).

**Origin.** PR #109 W-1 (privacy-reviewer mandate) flagged the cross-school link question as MUST-resolve before any district admin with multi-school `user_school_access` could onboard. Resolution as "permitted by design" closes that gate.

---

### §1.2 Followup #123 — One in-progress tier1 assessment per tenant (per-school binding)

**Question.** `tier1_assessments` has a "one in_progress per tenant" rule (enforced by a unique partial index in Migration 019 — defined in `server.js` `createTables()`, see `server.js:450-500` — plus an app-layer 409 guard). Does that rule apply district-scope-wide or per-school?

**Resolution.** The rule applies **per-school**, matching the #125 per-school binding semantics shipped across PR-S3-D-1 through PR-S3-D-4 (the Pattern E sweep across `student504.js`, `screener.js`, `mtssMeetings.js`, `prereferralForms.js`, `csvImport.js`, and `students.js`).

**Rationale.** District admins with multi-school `user_school_access` should be able to have multiple concurrent in-progress assessments — one per school they manage — without a global lock at the district level. The "one in-progress" constraint is meaningful at the school level (one assessment per school at a time, to prevent confused authoring across overlapping drafts) but would be operationally unworkable at the district level (a district admin with three schools could only draft one assessment at a time across all three).

**Code state — FORWARD-LOOKING.** `routes/tier1-assessments.js` POST `/` currently binds **single-tenant** via `req.user.tenant_id` in both the in-progress existence-check SELECT and the INSERT. This handler has not yet been swept by D-class Pattern E binding. PR-S3-E (the forthcoming tier1-writes work) will wire per-school binding via `resolveAndBindTargetTenant` to match the established Pattern E shape. **This resolution codifies intent; behavioral code follows in PR-S3-E.**

**Migration 019 partial-index implication.** The existing unique partial index on `tier1_assessments(tenant_id) WHERE status = 'in_progress' AND archived = FALSE` already enforces per-school uniqueness IF `tenant_id` is bound per-school. No schema change is required — the index's semantics match the resolved doctrine; only the app-layer binding needs to be wired in PR-S3-E.

**Origin.** Resolved at S79 P3 product decision.

---

## Future growth

This doc will grow as further district-structure product decisions resolve. Consolidated #125 per-school binding doctrine (currently spread across six file-local copies of `resolveAndBindTargetTenant` per Followup #132 deferral) is the most likely next addition, landing in an X-list chore PR alongside the helper-consolidation work.
