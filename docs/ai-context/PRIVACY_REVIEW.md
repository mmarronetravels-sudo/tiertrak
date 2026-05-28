# PRIVACY REVIEW PROTOCOL

Student/staff data handling checklist for TierTrak. Loaded on demand via `@` import.

This doc complements the `privacy-reviewer` subagent (`.claude/agents/privacy-reviewer.md`). The subagent runs the checks; this doc explains the rules, the worked examples, and the scope boundaries.

## Regulatory context (plain language)

TierTrak handles K-12 student data, which places it under:

- **FERPA (Family Educational Rights and Privacy Act)** — federal US law. Schools own the "education records"; TierTrak is a "school official" service provider. FERPA restricts who can see student records, requires a direct educational interest to access them, and requires the school to maintain control.
- **COPPA (Children's Online Privacy Protection Act)** — federal US law. Applies to any data collected from children **under 13**. TierTrak's model is that the school grants consent on behalf of the parent; this only works if we collect only what's necessary and use it only for the educational service.
- **State laws** — many states (California, Illinois, New York, Colorado, etc.) have additional K-12-specific privacy laws. Behaviors that are safe under FERPA alone may not be safe under the strictest state law a customer operates in. When in doubt, treat the strictest interpretation as the rule.

We do not require Claude Code to be a lawyer. We require Claude Code to follow the hard rules that implement these laws, as encoded in `CLAUDE.md` Section 4B.

## What counts as PII in TierTrak (authoritative list)

Treat any of these as PII and apply Section 4B rules:

### Directly identifying
- First name, last name, full name
- Student ID (district-issued)
- Staff ID / employee number
- Email address (student, staff, or parent)
- Phone number
- Date of birth
- Home address

### Indirectly identifying (quasi-identifiers)
- Grade level + school + small classroom → often re-identifies
- Photograph of a person
- A signature
- A unique combination of intervention history that only applies to one student

### Education-record-specific (FERPA)
- Tier assignment history
- Intervention records (what was tried, when, outcomes)
- Meeting notes (MTSS, pre-referral, parent conferences) — `mtss_meetings` fields: `meeting_type`, `progress_summary`, `next_steps`, `created_by_name`. **MTSS meetings additionally persist an immutable snapshot of underlying log data:**
  - `mtss_meeting_interventions.weekly_progress_snapshot` (JSONB array, one element per `weekly_progress` row reviewed). Per-element fields: `week_of`, `status`, `rating`, `response`, `notes`, `created_at`, plus denormalized `logged_by_name` and `logged_by_role` (staff full name + role frozen at meeting save time so the snapshot stays meaningful even if a staff record is later renamed or deactivated).
  - Captured at meeting save (POST `/mtss-meetings`); preserved per-intervention on edit (PUT `/mtss-meetings/:id`) — "frozen at first save" contract. Edits to or deletions of underlying `weekly_progress` rows do not propagate into a saved meeting's snapshot.
  - Returned inline on both `GET /mtss-meetings/:id` and `GET /mtss-meetings/student/:studentId`. Render surfaces: in-modal display in `MTSSMeetingFormModal.jsx` (sparkline + expandable disclosure, fed live from the auth-gated `/weekly-progress/intervention/:id` endpoint, NOT from the snapshot); view-past-meeting block in `App.jsx` (sparkline + expandable disclosure + zero-data warning + legacy label per a three-state discriminator: full snapshot / zero-data / legacy meeting).
  - **Print-mode caveat:** the printed MTSS meeting record now includes the snapshot disclosure list. Every intervention card's log list is forced open during print regardless of on-screen expansion state — a deliberate audit-trail choice for parent conferences, OCR responses, and IEP transitions. `weekly_progress.notes` free-text therefore appears on paper artifacts (truncated to 100 chars + ellipsis). Loggers should be reminded not to enter additional identifying detail in `notes` beyond what the field is designed for; printed records will carry whatever was written.
  - **Pending sec/ branch (master-index Followup 67):** the four `GET /mtss-meetings/*` handlers are currently unauthenticated, so the snapshot is reachable by any caller who knows or guesses a meeting/student id. The snapshot SELECT does carry a defense-in-depth `s.tenant_id` JOIN bind (sourced from `req.body.tenant_id`), which closes sloppy cross-tenant forgery but not targeted forgery. Followup 67 will add `requireAuth` and switch the tenant bind to a JWT-derived value.
- Referral data
- Assessment results
- Attendance linked to a person
- Behavior records linked to a person
- Progress notes

### Section 504 records (FERPA + ADA)

The 6 tables introduced by Migration 021 (and reshaped by Migration 022) hold the Section 504 evaluation, eligibility-determination, and accommodation-plan workflow. All tenant-scoped via composite `(id, tenant_id)` FK references — defense in depth at the schema layer per master-index Followup 81 (cross-tenant child references rejected by Postgres regardless of route-handler bugs). Form letters map to tables: Form C → `student_504_evaluation_consents`, Form I → `student_504_eligibility_determinations`, Form J → `student_504_plans` (and its `accommodations` JSONB column). Permission tiers split three ways: parent-visible (accommodations, team-member names + roles, own consent), staff-only (eligibility-determination notes, evaluation-consent audit trail), and admin config (`tenant_form_sets`). Enforced at the route boundary in `routes/student504.js` (staff: `requireAuth` + `refuseParentRole`) and `routes/parent504.js` (parent: `requireStudentReadAccess` + role check).

**`student_504_cycles`** — Mixed permission tier. Cycle existence is visible to all parties on the student's 504 team (parents, staff). The `status` enum (`active` / `completed` / `expired` / `discontinued`) is low-sensitivity workflow state. `form_set_id` and `form_set_version` identify which jurisdiction's form set is in use (currently only `oregon-ode-2025`) and are tenant-scoped configuration, not PII.

**`student_504_evaluation_consents`** — Form C (Prior Notice and Consent to Evaluate). Parent-visible: parent's own consent status, signature text, and signature timestamp. Staff-only: the audit trail of consent transitions (`created_by`, `consent_status` changes over time) and staff signature fields tracking which staff member issued the notice. Print-mode caveat for `staff_signature_text`: Form C is a parent-facing notice; the staff signature is rendered on the printed Form C as part of the notice the parent receives. The column is free-text `TEXT` with no enforced shape, so any name or descriptor staff enter crosses the parent boundary at write time. Treat `staff_signature_text` as parent-visible at write time, not just at render time.

**`student_504_eligibility_determinations`** — Form I (Section 504 Eligibility Determination). STAFF-ONLY by default per the three-layer permission model. `determination_notes` is especially sensitive because it can capture clinical observations, evaluator interpretations, and diagnostic reasoning that the parent receives separately through the formal eligibility-determination notice (Form I as a whole) rather than as raw notes. The `eligibility_status` enum and `determined_at` are part of the parent-facing notice flow; `determination_notes` specifically does not appear in the parent portal.

**`student_504_plans`** — Form J (Section 504 Student Accommodation Plan). Mixed permission tier. Plan dates, `plan_status`, and `accommodations` are part of the legally binding plan parents receive; `created_by` and audit timestamps are staff-only. The `accommodations` JSONB column added in Migration 022 is parent-visible and follows the PR #16 `weekly_progress_snapshot` precedent (JSONB on a parent table) with one key difference: accommodations are MUTABLE across the plan's life rather than frozen at first save. `medicalServices` is declared in the form set rendering schema (`oregon-ode-2025.js` `formJ.medicalServices`) but persistence is deferred to a future migration when the workflow needs to store it.

- **Column shape:** `student_504_plans.accommodations` JSONB, default `'{}'::jsonb`. Domain-keyed dict where keys are defined by the form set module's `formJ.accommodations.domains[].key`. For `oregon-ode-2025`: `{ educational, extracurricular, assessments }`, each carrying a free-text string of accommodations for that domain.
- **Mutability:** writable through Phase 2+ POST/PUT handlers — accommodations evolve across the plan's life as the team adjusts supports. NOT immutable like `weekly_progress_snapshot`.
- **Render surfaces:** Form J PDF print output (full plan rendered for parent signature and district records), parent portal accommodation view (read-only display of current accommodations by domain), staff edit UI (textarea per domain, scoped to active plan).
- **Print-mode caveat:** Form J prints the full accommodations text verbatim. Free-text content entered by staff appears on parent-facing paper artifacts; staff should treat the accommodations field as parent-visible at write time, not just at render time.
- **Cross-references:** Migration 022 (`migration-022-504-accommodations-reshape.sql`), `frontend/src/data/504-form-sets/oregon-ode-2025.js` `formJ.accommodations.domains`, the FERPA inventory section above.

**`student_504_team_members`** — Parent-visible. Names, roles, and "knowledgeable of" categorization (the student / the evaluation data / the placement) are part of the notice the parent receives identifying who participated in the eligibility determination and plan. `user_id` links to the staff record, but the rendered surface for parents is `member_name` + `member_role` only.

**`tenant_form_sets`** — Admin config / staff-only. Not PII. Records which form set (e.g., `oregon-ode-2025`) is active for the tenant. No student or staff individual data; pure tenant-level configuration.

Cross-cutting notes:

- Composite tenant-scoped FKs (`FOREIGN KEY (cycle_id, tenant_id) REFERENCES student_504_cycles(id, tenant_id)`) are present on every 504 child table per Migration 021. This is defense in depth — application-layer scoping in `routes/student504.js` + `routes/parent504.js` is the primary control, but the schema rejects cross-tenant child inserts even if a route handler has a tenant-scoping bug (master-index Followup 81 lesson).
- The 504 routes apply master-index Followup 67's auth lesson prophylactically: `requireAuth` is on every route from day one, and `tenant_id` is sourced exclusively from `req.user.tenant_id` (JWT-derived), not from request bodies.
- Phase 2 implementation rule: parent-scoped reads of 504 tables (in `routes/parent504.js`) MUST explicitly project the parent-visible columns and never use `SELECT *`. `student_504_team_members` SELECTs MUST list `member_name, member_role` and never include `user_id` (staff audit metadata, not parent-visible). This mirrors the explicit-projection discipline already documented inline in the `routes/student504.js` and `routes/parent504.js` Phase-2 SQL example comments.
- Phase 2+ deferred surfaces (NOT in PR 1, will need privacy review when added):
  - `student_504_plans` medical-services persistence column (form set declares `formJ.medicalServices`; no DB column yet)
  - `proceduralSafeguardsText` content in `oregon-ode-2025.js` (currently `null` TODO placeholder pending source document)
  - Gated-tier health document handling (Forms D, E in the ODE handbook — schema not yet defined)
- No data-minimization exceptions are added by PR 1. Every persisted column in the 504 schema is feature-required; no fields are stored beyond what the workflow uses.

### Students roster — SIS-issued identifier (FERPA)

The `students` table holds the canonical roster of every student tracked in TierTrak. Tenant-scoped via `tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`. Every column on this table identifies a single student and is treated as PII at all times per CLAUDE.md §4B. This entry documents `students.external_id` specifically, added by Migration 035.

**`students.external_id`** — SIS-issued student identifier (PowerSchool, Skyward, Infinite Campus, Aeries, etc.). Free-form TEXT, nullable. Same sensitivity tier as `first_name` / `last_name` — a school-issued identifier sufficient to single out a student within their district's SIS. Not elevated PII (not medical, not §504, not behavioral) but absolutely identifying; treat as PII at all times.

**Writers (persist external_id)**:
- `POST /api/students/` — manual add by `ADMIN_ROLES`. Trim, empty-after-trim → null.
- `PUT /api/students/:id` — manual edit by `ADMIN_ROLES`. **Preserve-on-omit semantics**: omitted field preserves existing value; explicit `null` or empty-string clears; non-empty string trims and writes. Asymmetric with the other PUT fields by design — data-loss prevention for the first nullable PUT field on this route. CASE-WHEN inline; see commit `a9e791d` rationale.
- `POST /api/csv/students/:tenantId` (CSV bulk-import) — trim at parse, empty→null, pre-INSERT within-upload dedup map keyed by external_id value with first-occurrence row tracking.

**Readers (project external_id)**:
- Staff: `GET /tenant/:tenantId`, `GET /tenant/:tenantId/tier/:tier`, `GET /:studentId`, `GET /referral-candidates/:tenantId`, `GET /referral-monitoring/:tenantId`. First three project via `SELECT s.*`; latter two added explicit `s.external_id` projections + GROUP BY in commit `a9e791d`.
- Parent: `routes/parentLinks.js` parent-of-own-child view projects via `SELECT s.*` and therefore surfaces external_id to the parent of the linked student. **Pending product decision** on whether SIS IDs should be parent-visible; sibling concern to Followup #79. Privacy-reviewer flagged in WI8 review.

**Cross-cutting notes**:

- **Tenant scoping invariant**: per-tenant partial UNIQUE INDEX `idx_students_tenant_external_id (tenant_id, external_id) WHERE external_id IS NOT NULL` (Migration 035). Different districts can legitimately reuse the same SIS-issued ID; cross-tenant collisions are by design allowed at the data layer and blocked from cross-tenant writes at the SQL layer via the composite key. Mirrors Migration 025's `referral_monitoring (tenant_id, student_id)` shape.
- **Error-response policy** (§4B narrowing):
  - **Within-upload dedup errors** in the CSV importer surface only `{row, data: {external_id}, error}` — `first_name`/`last_name` are NOT included in the dedup error envelope. Reason: the operator already knows their own row content; including additional PII columns in the error would compound the §4B surface without operator value.
  - **DB-level UNIQUE-violation responses** (POST/PUT/CSV-import) translate the PG `23505` error from `idx_students_tenant_external_id` into HTTP 409 with a sanitized message: `"A student with this external_id already exists in this school."` No PG constraint name, no index name, no `tenant_id` integer in the response body. Scoped to this index only; broader pg-error-code translation is deferred to `fix/api-dberror-translation`.
- **Implementation rule for read surfaces**: GETs that use `SELECT s.*` automatically project external_id; GETs with explicit column lists (`referral-candidates`, `referral-monitoring`) must explicitly include `s.external_id` in both SELECT and GROUP BY. Future GETs that add new explicit projections of student identity columns should include external_id alongside `first_name`/`last_name`.
- **FE surface footprint** (as of `e4ac13d`): external_id is documented in the CSV-template help-text at `App.jsx:5812` only. Display in student card, edit modal, and list tables is deferred. Staff GET responses already include the field via `s.*` projection but it is not yet rendered. Future PRs adding visible display will need their own privacy review of the staff and parent surfaces.

### Universal screener records (FERPA)

The `screener_results` table stores universal screener (benchmark assessment) results — STAR, MAP Growth, DIBELS, DIBELS Spelling, iReady, with STAAR deferred. Reconciled into the repo by Migration 024. Tenant-scoped via `tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`. Per-tenant backfill and explicit-projection discipline added in PR #47.

**`screener_results`** — Mixed permission tier. Per-row classification:

- **Directly identifying (PII)**: `student_first_name`, `student_last_name`, `external_student_id`. Stored denormalized at upload time so unmatched-name rows (where `student_id IS NULL` because the CSV's name didn't match any TierTrak student) remain queryable in the dashboard. Treat as PII at all times. **Phase 1 implementation rule: `routes/screener.js` per-student GET handler MUST NOT project these columns** — the caller already knows the student (URL carries studentId), so denormalized name fields would be redundant exposure. Dashboard list handler (`GET /:tenantId`) DOES project them, since unmatched-name rows are surfaced specifically so staff can fix the mismatch.
- **FERPA education records (PII when linked to student)**: `scaled_score`, `percentile_rank`, `benchmark_category`. Each row is a single screener result that, when linked to `student_id`, constitutes a FERPA-protected education record. The screener-result tuple alone (without `student_id`) is not PII; once joined with `students` it is.
- **Quasi-identifiers (not PII alone, become PII when joined)**: `assessment_type`, `subject`, `screening_period`, `school_year`, `grade`, `screener_name`. Workflow tags and benchmark metadata. None of these alone identify a student. Joined to `student_id` they form part of the FERPA-protected education record above.
- **System metadata (not PII)**: `id`, `tenant_id`, `student_id` (FK only), `uploaded_by`, `uploaded_at`. Tenant identifier is a system-level scoping value; `uploaded_by` references a staff user_id (FK only — staff name is fetched on display via JOIN, not stored on the screener row).

Cross-cutting notes:

- **Tenant scoping invariant**: every row carries `tenant_id NOT NULL`. Cross-tenant reads are blocked by `requireStudentReadAccess` (per-student route) + `requireTenantStaffAccess` (dashboard list route) + defense-in-depth `JOIN students s ON s.id = sr.student_id AND s.tenant_id = $...` on every query (added in PR #47).
- **Per-tenant data segregation**: Migration 024 backfilled `assessment_type` per tenant (`tenant_id=4 → STAR`, `tenant_id=9 → STAAR`, `tenant_id=10 → MAP`); each tenant's screener data is logically separate.
- **CSV upload destruction**: per CLAUDE.md §4B, CSV imports must be deleted from the server immediately after processing. The screener upload is browser-side parsed (Papa Parse) and posted as JSON — the file never reaches the server filesystem, so the destruction rule is satisfied by construction.
- **Phase 1 implementation rule (PR #47 onward)**: per-student SELECTs MUST use explicit column projection (no `SELECT sr.*`). Dropped from per-student GET projections: `student_first_name`, `student_last_name`, `external_student_id`. Mirrors the §504 routes' explicit-projection discipline above.
- **Phase 2+ deferred surfaces** (NOT in PR1, will need privacy review when added):
  - Multi-vendor CSV parser registry (PR2 — per-vendor parser receives raw CSV rows; server-side per-row validation lands as Followup #47)
  - Replace-mode upload endpoint (PR2 — `DELETE WHERE (...) THEN INSERT` semantics inside a transaction; transaction wrapper lands as Followup #46)
  - Multi-assessment dashboard tabs (PR3 — per-vendor tabbed view)
  - Student-profile screener section (PR3 — subject-grouped layout displaying screener history; first frontend caller of the per-student GET handler)

### Access control audit records (FERPA §99.32)

The `user_school_access` + `user_school_access_audit` pair implements the FERPA §99.32 record-of-disclosure trail for the district-structure layered-tenant model. Per-row columns are integer identifiers only (not name/email PII per the Directly-identifying list above), but the aggregate audit table is the FERPA-governed disclosure record for who-granted-or-revoked-whose-school-access-when at the district layer. Treat the audit table as §99.32-grade machinery: retention semantics, append-only contract, and actor-identity capture are all load-bearing.

**`user_school_access`** — Internal access-mapping table introduced by Migration 028. Per-row columns: `(user_id, district_id, school_tenant_id, created_at, created_by)`. Composite PK on `(user_id, school_tenant_id)`; two composite FKs `(user_id, district_id) → users(id, district_id)` and `(school_tenant_id, district_id) → tenants(id, district_id)` reject cross-district inserts at the schema layer (Migration 021 composite-FK doctrine applied to the layered model). Writers: PR #104's POST grant handler at `routes/districtAccess.js` and the operator-template backfill at `scripts/ops/backfill-user-school-access-template.sql`. Destroyers: PR #104's DELETE revoke handler and the M028 `ON DELETE CASCADE` triggered from `DELETE FROM users` (PR #101's authenticated DELETE-FROM-users surface). Permission tier: internal scope-mapping; not surfaced to parents. Staff access gated by district_admin role + path-district equality + helper-resolved school scope per PR #104 DQ2 three-guard authz.

**`user_school_access_audit`** — Append-only audit table introduced by Migration 031. Per-row columns: `(audit_id BIGSERIAL, user_id, district_id, school_tenant_id, action VARCHAR(32), actor_user_id, occurred_at)`. CHECK constraint at M031 line 76 admits only `('grant', 'revoke', 'cascade_user_delete')`. The table has NO foreign keys to `user_school_access`, `users`, or `tenants` by design — FERPA §99.32 retention requires audit rows to outlive their referents (a deleted user's disclosure record is precisely what §99.32 is for). Trigger function `user_school_access_audit_cascade` runs as plain `LANGUAGE plpgsql` with NO `SECURITY DEFINER`; fires AFTER DELETE on `user_school_access` under the caller's privileges (M031 lines 46-50 doctrine, affirmed across PR #103 §9 and PR #104 §9 reviewer triads). Per-row columns are integer identifiers only — `actor_user_id` is an internal FK to `users.id`, not a name. The table is operator-only: no API surface today reads or writes it; operator queries via Render External PSQL directly.

**Two-GUC contract** — The trigger function reads two transaction-local GUCs to produce correctly-shaped audit rows for every writer profile. Future writers MUST comply with this contract; the canonical statement lives in the M033 migration header lines 32-65.

1. `app.actor_user_id` (introduced in Migration 032 to close Followup #118)
   - Set by: every app-layer writer of `user_school_access` (INSERT or DELETE), plus every app-layer DELETE-FROM-`users` site (PR #101 handlers at `routes/users.js` + `routes/staffManagement.js` after PR #103's plumbing).
   - Value: `String(req.user.id)` — positive integer `users.id` of the authenticated actor, validated belt-and-suspenders via `Number(req.user.id)` + `Number.isInteger` + `> 0` before the GUC is set.
   - Mechanism: `SELECT set_config('app.actor_user_id', $1, true)` inside the explicit transaction, before any user_school_access INSERT/DELETE or DELETE-FROM-users.
   - Scope: transaction-local (3rd arg `true`); dies at COMMIT/ROLLBACK; cannot leak to subsequent transactions on the same pooled client.

2. `app.audit_action` (introduced in Migration 033 to disambiguate explicit-revoke from cascade)
   - Set by: explicit-revoke writers only — currently PR #104's DELETE handler at `routes/districtAccess.js`.
   - Value: `'revoke'` literal (one of the three M031-CHECK-admitted strings).
   - Mechanism: `SELECT set_config('app.audit_action', 'revoke', true)` inside the explicit transaction, before the DELETE.
   - Default behavior: cascade writers leave it unset; the trigger's `COALESCE(NULLIF(current_setting('app.audit_action', true), ''), 'cascade_user_delete')` substitutes `'cascade_user_delete'`.

`NULLIF` + `COALESCE` guard mechanics: `current_setting(name, true)` returns the empty string when the GUC is unset (not NULL, not an error). `NULLIF('', '')` collapses to NULL; `COALESCE(NULL, 'cascade_user_delete')` then substitutes the cascade default. Without `NULLIF`, casting `''` to `int` for `actor_user_id` would raise SQLSTATE 22P02; the same idiom is used on both GUC reads.

**Three writer profiles**

| Writer profile | `app.actor_user_id` | `app.audit_action` | Resulting `action` | Resulting `actor_user_id` |
|---|---|---|---|---|
| PR #104 explicit-revoke (DELETE /api/districts/:id/users/:userId/access/:schoolTenantId) | set to actor's id | `'revoke'` | `'revoke'` | actor's id |
| Cascade-from-users (DELETE FROM users via authenticated handlers at `routes/users.js` + `routes/staffManagement.js`) | set to actor's id | unset | `'cascade_user_delete'` | actor's id |
| Direct DBA psql DELETE (no app-layer writer) | unset | unset | `'cascade_user_delete'` | NULL |

The `'grant'` action value is NOT written by the trigger. M031's trigger fires AFTER DELETE only; PR #104's POST grant handler writes its own `action='grant'` row to `user_school_access_audit` directly inside the same explicit transaction (single audit row per logical event; no duplicate via trigger). Future writers that need a fourth profile (e.g., a new role that grants or revokes at the district layer, or a self-service revoke path) MUST set both GUCs explicitly inside their transaction per the M033 Future-Writers Contract — see migration header lines 32-65.

Cross-cutting notes:

- **Tenant-scoping invariant**: trigger writes `OLD.user_id`, `OLD.district_id`, `OLD.school_tenant_id` (from the row being deleted) plus the two GUCs only. No SELECT, no JOIN inside the trigger body — zero pathway to read another tenant's data. Verified by tenant-isolation-auditor at PR #103 §9 and PR #104 §9.
- **No PII in trigger-log channels**: trigger body has zero `RAISE NOTICE` / `RAISE LOG` / `RAISE WARNING` / `RAISE EXCEPTION`. No PII can bleed to PG log channels via trigger-emitted notices. Privacy-reviewer convergent check across M031 + M032 + M033 — confirmed at PR #104 §9.
- **CHECK fail-loud**: out-of-allowlist `app.audit_action` values (e.g., a future writer mistakenly setting `'self_remove'`) raise SQLSTATE 23514 at the trigger's INSERT and abort the parent transaction. Fail-loud at the writer site, not silent corruption. M033 header lines 22-26.
- **Helper-consumed against pool, not txn client**: `resolveAccessibleTenantIds` (`middleware/resolveAccessibleTenantIds.js`) is consumed against its own `pg.Pool`, never against the route's checked-out client inside the transaction. GUCs set on the txn client are not visible to the helper's separate connection — and the helper does not read them, so the decoupling is correct. The membership-set staleness window is bounded by request lifetime per S69 doctrine; affirmed in PR #103 §9 INFO-1 and PR #104 §9.
- **Append-only contract**: no UPDATE/DELETE path on `user_school_access_audit` is exposed. Operator can re-run M031/M032/M033 idempotently (CREATE OR REPLACE FUNCTION + CREATE TABLE/INDEX IF NOT EXISTS), but the table data is never overwritten.
- **§99.32 retention beyond the user lifecycle**: when a user is deleted, M028's ON DELETE CASCADE wipes the user's `user_school_access` rows and fires the trigger, which writes a `'cascade_user_delete'` row per wiped grant. The audit row survives because there is no FK from audit → user. This is the load-bearing reason M031 carries denormalized columns and no FKs.

Migration provenance:

- Migration 028 — `user_school_access` table foundation (district-structure layered-tenant model; composite-FK cross-district rejection).
- Migration 031 — `user_school_access_audit` table + cascade trigger (S69 PR #100, district-structure PR B1). Forensic-grade append-only audit; NO foreign keys; CHECK constraint on `action`; NO SECURITY DEFINER.
- Migration 032 — `actor_user_id` capture via `app.actor_user_id` GUC (S70 PR #103, Followup #118).
- Migration 033 — action-label-from-GUC via `app.audit_action` with `'cascade_user_delete'` default (S70 PR #104, B2).

Doctrine-trail review record: full triad on M031 (S69 PR #100); design-consultation continuity on M032 (PR #103 §9); full triad on M033 + B2 surface (PR #104 §9). Followup #120 ships this PRIVACY_REVIEW.md update as the doc-only completion.

Phase 2+ deferred surfaces (NOT in B2; will need privacy review when added):

- Operator-facing audit query API endpoint — currently no API surface reads `user_school_access_audit`; operator queries via Render External PSQL directly.
- FE Session 4 — district-admin UI for grant/revoke/list will surface only the GET response shape from `routes/districtAccess.js` (`{ school_tenant_id, created_at }` per grant); will not surface audit-table content.
- Additional writer profiles at the district layer (e.g., a new role that grants/revokes, or a self-service revoke path) — MUST comply with the M033 Future-Writers Contract: set both GUCs inside an explicit transaction before the DELETE.

### Uploaded content
- Any document uploaded by a staff member that concerns an identified student
- Any CSV row containing any of the above

### What is NOT PII (but still be careful)
- Aggregate counts across a school ("234 students on Tier 2 interventions this month")
- Anonymous survey data with no identifier
- Curriculum/intervention definitions not tied to a person
- Reference data like the tier-1 assessment item bank
- `no_progress_monitoring_required` (BOOLEAN, on `student_interventions` and `mtss_meeting_interventions` per Migration 023) — workflow flag indicating an intervention is documented without requiring weekly progress logs (e.g., preferential seating). Exposed on staff surfaces (intervention list cards, MTSS meeting form, saved meeting report) and parent surfaces (parent portal active interventions); snapshotted onto `mtss_meeting_interventions` at meeting save time per Option α so historical meeting records stay accurate after live flag-flips. Not PII — per-row boolean carrying no student identifier or content.

## Hard rules (restated for convenience — authoritative copy in CLAUDE.md Section 4B)

- **No PII in logs.** `console.log('Updating student', student.first_name)` is a violation. Log `student.id` only, and only if the log line genuinely needs it for debugging.
- **No PII in error responses.** `res.status(400).json({ error: 'Invalid grade for student Alex Johnson' })` is a violation.
- **No cross-tenant PII exposure.** Ever. This is the most serious category.
- **No PII stored in unexpected fields.** Do not stuff a student's name into a "notes" column "for convenience."
- **No PII used for purposes beyond collection.** Intervention data collected for MTSS tracking is not training data for a separate feature without explicit approval.
- **CSV uploads deleted immediately after processing.** Non-negotiable.
- **S3 objects via presigned URLs only.** Never expose raw bucket paths.

## Review workflow for a PII-touching PR

1. **Identify whether the change is PII-touching.** If the diff modifies any of:
   - A column in a table listed in the "PII in TierTrak" section above
   - A query SELECTing or updating such a column
   - An API response that includes such a column
   - A log line or error path in a handler that touches such a column
   - A file upload, CSV import, or S3 interaction
   - Then yes, it is PII-touching.
2. **Run the `privacy-reviewer` subagent** against the diff.
3. **Fill the PR's "Privacy impact" section** with specifics (not "none" if the diff is PII-touching).
4. **Get a human reviewer** on any PII-touching PR. The subagent does not replace human judgment.

## Worked examples

### Example 1 — Safe log line

```js
// Safe: uses IDs only
console.error('[studentDocs:upload]', 'failed for student_id=', studentId, 'err=', err.message);
```

### Example 2 — Unsafe log line

```js
// Violation: name is PII
console.log(`Assigned ${student.first_name} ${student.last_name} to tier ${tier}`);
```

Fix:

```js
console.log(`[interventions:assign] student_id=${student.id} tier=${tier}`);
```

### Example 3 — Safe error response

```js
res.status(404).json({ error: 'Student not found' });
```

### Example 4 — Unsafe error response

```js
res.status(400).json({
  error: `Student ${student.first_name} (ID ${student.id}) is already in tier ${student.tier}`
});
```

Fix: generic user-facing message, details only in the server log.

### Example 5 — Unsafe query pattern (tenant bypass)

```js
// Receives a studentId from the frontend, returns anything with that id
router.get('/students/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM students WHERE id = $1',
    [req.params.id]
  );
  res.json(rows[0]);
});
```

This is a FERPA-grade leak. User A at School X can read School Y's student by guessing the id.

Fix:

```js
router.get('/students/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM students WHERE id = $1 AND school_id = $2',
    [req.params.id, req.user.school_id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});
```

### Example 6 — Unsafe CSV handling

```js
router.post('/import', requireAuth, upload.single('file'), async (req, res) => {
  await processCsv(req.file.path);
  res.json({ ok: true });
  // File is left in /tmp — this is a FERPA problem
});
```

Fix:

```js
router.post('/import', requireAuth, upload.single('file'), async (req, res) => {
  try {
    await processCsv(req.file.path);
    res.json({ ok: true });
  } catch (err) {
    console.error('[csvImport]', err.message);
    res.status(500).json({ error: 'Import failed' });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});
```

### Example 7 — Unsafe S3 path exposure

```js
res.json({ url: `https://s3.amazonaws.com/tiertrak-bucket/students/${student.id}/report.pdf` });
```

Fix: issue a presigned URL scoped to short expiry (15 min) and return that instead.

## Data minimization review

When adding a new field or a new API response, ask:
- Does the UI genuinely use this field? If not, don't return it.
- Does TierTrak actually need to store this field? If not, don't persist it.
- Could this field be derived or computed on the fly? If yes, prefer that to storing it.

When CSV import adds new fields:
- Only whitelist columns TierTrak uses.
- Silently ignore (not store) any extra columns the district's CSV happens to include.
- Document the whitelist in code (a constant) and mention it in the PR.

## Approved data-minimization exceptions

Default posture is data minimization per CLAUDE.md Section 4B. Entries below are intentional exposures approved during a specific PR, recorded here so future reviewers see the decision on record.

### Parent portal — full `student_interventions` row exposure

**Exposure:** `GET /api/interventions/student/:studentId` returns `si.*` (including `notes`, `goal_description`, and other narrative fields) to callers with `role = 'parent'` who have a matching row in `parent_student_links`.

**Rationale:** Matches existing meeting-report behavior — parents already see the same narrative in scheduled meeting summaries. Divergent portal vs. report detail would split the source of truth and confuse parents. Read-only access; write restrictions documented below.

**Safeguards:** Read-only. Write access gated separately by `intervention_assignments.assignment_type = 'parent' AND can_log_progress = TRUE` in `routes/weeklyProgress.js`. Cross-tenant reads blocked by the tenant match in `requireStudentReadAccess`.

**Provenance:** `fix/parent-portal-intervention-write-access` (PR #8), commit `29daf3b`.

### `current_user_can_log` response field

**Exposure:** `GET /api/interventions/student/:studentId` returns a boolean `current_user_can_log` per intervention.

**Rationale:** Not PII. Derived server-side: for `role = 'parent'`, TRUE iff a row exists in `intervention_assignments` with `user_id = req.user.id`, matching `student_intervention_id`, `assignment_type = 'parent'`, and `can_log_progress = TRUE`. For all other roles, TRUE unconditionally. Frontend uses strict `=== true` to gate the "Log Progress" button in ParentPortalView.

**Provenance:** `fix/parent-portal-intervention-write-access` (PR #8), commit `29daf3b`.

## The "new data collection" trigger

Any PR that adds a new field storing PII is a Section 8 ask-first trigger. The PR description must include:
- What the new field is
- Why it's needed
- Who will have read access
- How it will be deleted / redacted when no longer needed
- Whether this changes the TierTrak data dictionary we show to schools

Do not ship a new PII field and figure out these answers later.

## Things NOT to do

- Do not use student/staff data to train ML models (internal or external) without explicit written approval.
- Do not send PII to a third-party analytics tool (Amplitude, Mixpanel, Segment) without explicit approval.
- Do not ship a "contact your users" feature that emails students under 13 directly.
- Do not ship a "guess the student" or "search across all schools" feature. A platform-admin user still gets scoped results unless an explicit cross-tenant admin feature has been approved.
- Do not send error reports containing request bodies to Sentry / Rollbar / etc. without scrubbing PII first.

## If you find PII was leaked

If in the course of reviewing a change you discover that PII has already been exposed (e.g., logged, emailed, returned in an API response shipped previously, left in a git history):

1. Do not panic-edit. Stop.
2. Flag it to a human reviewer immediately with specifics: what data, where it leaked, approximate timeframe.
3. Do not attempt to "clean up" the leak unilaterally — incident response is a human-led process.
4. A PR that closes a privacy leak must note "closes previously-reported incident" in the description, with a link to the incident ticket, and must be reviewed by a human.
