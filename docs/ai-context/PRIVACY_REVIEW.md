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

### Student demographics — race/ethnicity (FERPA + sensitive category)

The `students.race_ethnicity`-projected array and the underlying `student_race_ethnicity` table (Migration 042) hold the OMB SPD-15 (2024 revised) race/ethnicity category set for each student. The seven-code allowlist is `AIAN` (American Indian or Alaska Native), `ASIAN`, `BLACK` (Black or African American), `HISP` (Hispanic or Latino), `MENA` (Middle Eastern or North African), `NHPI` (Native Hawaiian or Pacific Islander), and `WHITE`. Sensitivity tier: elevated PII when linked to a student — the codes alone are categorical and not directly identifying, but the linkage to `student_id` makes any per-student projection a FERPA education record. Sibling concern to the PR-D-banked `chore/privacy-review-m042-fields` follow-up covering the four scalar M042 flags (`iep_flag`, `sec_504_flag`, `ell_flag`, `gender`).

**`student_race_ethnicity`** — child table with composite FK `(student_id, tenant_id) REFERENCES students(id, tenant_id)` and a UNIQUE constraint on `(student_id, category)`. Up to seven rows per student; zero rows when nothing is recorded. School-tenant-scoped via the composite FK; cross-tenant child rows are structurally impossible at the schema layer. CHECK constraint `student_race_ethnicity_category_check` enforces the seven-code allowlist at the database layer regardless of any application-layer bug.

**Wire-shape projection on read**: `routes/students.js` GET handlers project the codes as an alphabetized `varchar[]` via a correlated `ARRAY_AGG(... ORDER BY category)` subquery on `student_race_ethnicity`, with `COALESCE(..., ARRAY[]::varchar[])` so the field is always an array and never null. The subquery's WHERE clause carries belt-and-suspenders `sre.tenant_id = s.tenant_id` even though the composite FK already makes cross-tenant child rows structurally impossible. Five projection sites: the four `GET /api/students/tenant/:tenantId` role branches (elevated, parent, education_assistant, staff/teacher) and `GET /api/students/:studentId`.

**Writers (persist race/ethnicity)**:
- `POST /api/students/` — manual add by `ADMIN_ROLES`. Body field `race_ethnicity` accepts an array of code strings; `sanitizeRaceEthnicityArray` in `constants/studentDemographics.js` is the authoritative trust boundary (allowlist-not-blocklist; rejects non-array, deduplicates, returns a canonical error envelope on any unknown code). Per-code INSERT into `student_race_ethnicity` inside the same transaction as the `students` row; ROLLBACK on any sanitizer failure or per-row INSERT failure.
- `PUT /api/students/:id` — manual edit by `ADMIN_ROLES`. **Preserve-on-omit semantics**: `Object.prototype.hasOwnProperty.call(req.body, 'race_ethnicity')` gates the entire reconciliation block — an absent key leaves the existing `student_race_ethnicity` rows untouched. When present, the current rows are `SELECT ... FOR UPDATE`-ed, the symmetric difference vs the sanitized new array is computed, and missing codes are `DELETE`d while new codes are `INSERT`ed inside the transaction. Same belt-and-suspenders `tenant_id` bind on every SELECT / INSERT / DELETE inside the block.
- `POST /api/csv/students/:tenantId` (CSV bulk-import) — `race_ethnicity` CSV column accepts a `;`-delimited list of codes (e.g., `ASIAN;WHITE`). The `RACE_ETHNICITY_CSV_SEPARATOR` constant lives in the BE `constants/studentDemographics.js` module; the FE CSV-import description text currently hardcodes the literal `;` separately (banked under F-236b). Trim, blank → none recorded; per-code sanitization mirrors the JSON-write path; per-code INSERT into `student_race_ethnicity` after the `students` INSERT, inside the same transaction.

**FE surface footprint** (as of PR #240):
- Add Student form — full-width seven-checkbox fieldset below the existing demographic-flags grid; render iteration is the FE-declared `RACE_ETHNICITY_CODES` in OMB SPD-15 (2024 revised) order; the toggle handler runs the value through `canonicalRace` (sort + dedupe + allowlist-filter) before `setState`.
- Edit Student form — same fieldset, same iteration order, bound to `studentForm` + `setStudentForm`. Submit-time set-diff at `handleUpdateStudent` emits the `race_ethnicity` key ONLY when the canonical-form array differs from the snapshot captured at `startEditStudent`. End-to-end preserve-on-omit: untouched edit → no key on the wire → BE `hasOwnProperty` gate preserves the rows.
- CSV-import description panel — 9th `<li>` in the Optional Columns list documenting the seven codes and the `;` separator; italic note extended to cover "blank means none recorded".

**Three-writer drift hazard (F-236b — banked CI follow-up)**: the seven-code allowlist is repeated in three places that must stay byte-equal:

1. The Migration 042 `student_race_ethnicity_category_check` CHECK constraint — the database authority.
2. The BE `constants/studentDemographics.js` module — `RACE_ETHNICITY_CODES` consumed by `sanitizeRaceEthnicityArray` and the CSV sanitizer.
3. The FE `frontend/src/constants/studentDemographics.js` ESM mirror — `RACE_ETHNICITY_CODES` consumed by the checkbox-group render iteration and by `canonicalRace`'s allowlist filter.

Drift between any two of the three has different failure modes. **FE shorter than BE**: the FE silently drops BE-only codes on edit. Preserve-on-omit protects untouched students, but a user who interacts with the demographics group at all will erase any BE-only code from that student's row, and the dropped code never appears in the rendered form so the loss is not visible at the surface. **BE shorter than CHECK**: the sanitizer rejects valid stored codes that the CHECK still permits — older rows become unwritable through the JSON write path. **CHECK shorter than BE**: per-code INSERTs from a valid sanitizer call fail at the DB layer with a generic CHECK violation. F-236b's CI scope is a single check that asserts all three lists are byte-equal AND that the FE-declared order matches the OMB SPD-15 canonical manifest.

Cross-cutting notes:

- **Tenant scoping invariant**: composite FK on `student_race_ethnicity (student_id, tenant_id) REFERENCES students (id, tenant_id)` enforces same-tenant for every child row at the schema layer regardless of any application-layer route bug. Verified at four layers on every read/write path: route gate (`requireStudentReadAccess` / `requireTenantStaffAccess`), outer query scope (`students.tenant_id = $1`), inner subquery / per-code scope (`sre.tenant_id = $1`), and the schema FK itself.
- **No PII in logs / error responses**: write-path `console.error` handlers log `tenant_id` (integer) + `student_id` (integer) + `err.message` only; no body echo of the codes array. Error responses translate sanitizer failures into generic strings citing the column + valid set (`"Invalid race_ethnicity code. Must be one or more of: AIAN, ASIAN, BLACK, HISP, MENA, NHPI, WHITE (separated by ';')."`); no PG constraint name, no internal index name. The pre-existing `error.message` leak at `routes/students.js:237 / 261 / 281 / 559` is a separate sec-PR follow-up (banked as `project_followup_students_error_message_leak`); PR-E increased its blast radius by adding M042 fields to two of the four leaking paths.
- **CSV / S3 / external egress**: CSV import path matches the existing students CSV discipline — file deleted from the server immediately after processing per CLAUDE.md §4B. No S3 path; no third-party services touch race/ethnicity data.
- **Parent-visibility decision (v1)**: race/ethnicity is **NOT** projected on `routes/parentLinks.js` parent-of-own-child views as of PR-E. The current parent surface projects via `SELECT s.*` for the four PR-D scalar flags but does NOT JOIN `student_race_ethnicity` — race/ethnicity codes do not surface to parents in v1. A future product decision to widen parent visibility would need an explicit second privacy review and a separate JOIN site; until then, the absence of the JOIN is the gate.
- **Staff-visibility decision (v1)**: every staff role with `requireStudentReadAccess` access to a student row receives the alphabetized `varchar[]` on GET. No further role-based projection narrowing. Visibility scope matches PR-D's four scalar flags exactly. EA-caseload and per-student access predicates (Migration 041 / PR-3 / PR-4 lineage) are the existing gates; race/ethnicity does not introduce a new narrowing dimension.
- **Data-minimization stance**: the FE control is the only end-user surface that writes race/ethnicity; the create + edit forms render the seven SPD-15 codes labeled with the OMB-recommended display strings only. No alternate code mapping, no district-specific re-labels, no "Other" code (per OMB SPD-15 2024 revised — "Other" is not a permitted category at this layer; intersectional combinations are represented as multiple codes on the same student row).
- **FE on-device caching**: none. The Edit modal fetches the student row fresh on open; the Add modal posts to the server immediately on Save with no `localStorage` write of the codes array. No on-disk cache surface to evict.

Migration provenance:

- Migration 042 — `student_race_ethnicity` table + composite FK + UNIQUE constraint + CHECK allowlist (PR #229).
- Wire-shape widening on GET — `routes/students.js` ARRAY_AGG subquery (PR #238 / PR-E Piece 1).
- FE consumer + control — `frontend/src/App.jsx` + `frontend/src/constants/studentDemographics.js` (PR #240 / PR-E Piece 2).
- Doc section — this entry (chore/privacy-review-race-ethnicity-fields, sibling of Followup #120 and of the PR-D-banked `chore/privacy-review-m042-fields` follow-up which covers the four scalar M042 flags).

Phase 2+ deferred surfaces (NOT yet landed; will need privacy review when added):

- Parent-visibility widening (any JOIN of `student_race_ethnicity` on the `routes/parentLinks.js` surfaces) — explicit second privacy review required.
- Aggregate / equity reporting cuts — small-cell aggregation rules (suppress counts below a threshold) must be designed before this surface ships; intersectional code combinations make naïve cross-tabs trivially re-identifying for small subgroups.
- District-level cross-school aggregations — district-scoped surfaces that aggregate race/ethnicity counts across multiple school-tenants would surface a new privacy dimension (district as analyst, school as source); not in v1.
- F-236b drift-CI assertion — CI check that asserts the three allowlists are byte-equal + the FE-declared order matches the SPD-15 canonical manifest. Banked separately.

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

### Discipline referral records (FERPA — behavioral)

The `discipline_referrals` table (Migration 036) stores office discipline referrals (ODRs) — student behavior incidents reported by staff. School-tenant-scoped via `tenant_id INTEGER NOT NULL REFERENCES tenants(id)`. Every referral row identifies a single student and is treated as PII at all times per CLAUDE.md §4B. Two free-text columns are the highest-sensitivity surfaces on this table.

**`discipline_referrals.staff_notes`** — Staff-authored free-text narrative captured at submit time. On the staff-managed (Level 1) path it is OPTIONAL response detail (what the staff member did or said); on the admin-managed (Level 2+) path it is REQUIRED — the "what happened" description that lets the reviewing administrator reconstruct an event they did not witness. May contain student names other than the subject ("Alex pushed Jamie"), staff names, witness identifiers, and incident detail. Treat as parent-visible AT WRITE TIME for any future render path the student's parent can reach: per design D6 (the discipline-referral spec §8) the v1 visibility contract is admins + the referring author only. Other staff assigned to the student see the structured fields + level + consequence, but NOT the notes. The structured "others involved" field stays category-only (None / Peers / Staff / Teacher / Substitute / Other / Unknown) so it carries no names and is visible to all referral viewers.

**`discipline_referrals.admin_notes`** — Admin-authored free-text added at the review / resolve step. Same sensitivity tier as `staff_notes` and same D6 visibility contract. Persisted by `PATCH /api/discipline-referrals/:id/admin-notes` (mid-review save) and `PATCH /api/discipline-referrals/:id/resolve` (terminal step, optional). Length cap: 5000 characters after trim, enforced at the route layer in `parseAdminNotes` — the underlying column is unbounded TEXT in M036; the cap is route-side data hygiene, not a schema constraint. Trimmed-to-empty collapses to NULL so a deliberate clear is supported.

**v1 visibility policy for draft `admin_notes` on a released-back referral** — `PATCH /api/discipline-referrals/:id/release` returns the row from `under_review` to `submitted` and intentionally PRESERVES any `admin_notes` saved during the previous claim (release is reversible state; silently destroying draft notes was rejected as a footgun). The student-record D6 path (`GET /api/discipline-referrals/student/:studentId`) gates `admin_notes` by ROLE — counselor / school_admin / district_admin / interventionist see; teacher / everyone else returns NULL. The gate does NOT consider referral STATUS. Consequence: between a release-back and the next claim, a counselor or interventionist opening the student record sees in-progress draft admin_notes. This is accepted for v1: counselor and interventionist are members of the D6 admin_notes audience by design (Readers contract below). Gating draft notes by status (so non-claimers see notes only on `resolved` rows) is a future follow-up if product policy tightens. Teachers and parents remain correctly NULL on the student-record path regardless of status.

**Conditional-subtype app-layer rule (M036 + M037)** — `harassment_subtype_id` is populated only when the chosen behavior's `requires_subtype = 'harassment'`; `weapon_subtype_id` only when `requires_subtype = 'weapon'`. The route layer is the enforcement point — `routes/disciplineReferrals.js` POST uses explicit equality on `requires_subtype` (never truthy, never label-match) to gate both subtype fields and reject either when not required. The FE never decides this from label text; it reads the column off the vocab row payload. Subtype rows themselves (`discipline_harassment_subtypes` 8 rows, `discipline_weapon_subtypes` 4 rows) are vocab-only, not PII.

**Writers (persist staff_notes)**:
- `POST /api/discipline-referrals/` (this PR — the staff create flow). `staff_notes` body field permitted; trimmed at parse; empty-after-trim → NULL. `admin_notes` body field NOT accepted (admin-only writer at the review step, future PR). `target_tenant_id` via the F#125 binding pattern (routes/prereferralForms.js precedent); `referring_staff_id` derived from `req.user.id`; `grade` looked up from `students` rather than read from body. Composite FKs from M036 reject cross-tenant FK references at the schema layer; route-layer pre-checks turn unknown ids into clean 400s instead of 23503 violations.

**Readers (project staff_notes / admin_notes)**:
- `GET /api/discipline-referrals/student/:studentId` (student-record referral-history view, prior PR). D6 enforced via SQL `CASE` on `staff_notes` (counselor / school_admin / district_admin / interventionist see all; teacher sees ONLY referrals they authored; else NULL) and `admin_notes` (counselor / school_admin / district_admin / interventionist see; else NULL). Notes columns are never plucked into JS and post-filtered — the gate lives in the SELECT.
- `GET /api/discipline-referrals/queue/:tenantId` (admin review workflow PR). Summary payload only. NO `staff_notes` / `admin_notes` shipped to the queue. Positive route-layer role gate restricts to VIEW_ROLES (school_admin, district_admin, counselor, interventionist).
- `GET /api/discipline-referrals/:id` (admin review workflow PR). Byte-identical D6 `CASE` projection to the student-record path, kept defensively even though every current VIEW_ROLE resolves to "see notes" — if VIEW_ROLES ever widens (e.g., assigned-teacher visibility), the SQL gate keeps notes off the wire for the added roles unless the CASE is also updated.

Future Phase 2+ reader surfaces (SWIS reports, equity / disproportionality cuts) MUST continue to enforce D6.

Cross-cutting notes:

- **Tenant scoping invariant**: every `discipline_referrals` row carries `tenant_id NOT NULL` with `idx_discipline_referrals_tenant`. The composite-FK pattern from M021 enforces same-tenant for student, location, behavior, motivation, others_involved, and both subtype FKs at the schema layer regardless of any future application-layer route bug. Joined vocab/student SELECTs in future read surfaces MUST include a defense-in-depth `WHERE tenant_id = $...` bind sourced from `resolveAccessibleTenantIds(req.user)` per CLAUDE.md §5 dual-path doctrine.
- **No PII in logs / error responses**: `routes/disciplineReferrals.js` catch handlers log `tenant_id` (integer) + `user_id` (integer) + `err.message` only. No `student_id`, no behavior label, no notes content, no body echo. `res.json` error bodies are generic strings ("Failed to create referral", "Invalid behavior", etc.). FE modal failures route through `logError()` rather than raw `console.log` per the PreReferralFormModal precedent.
- **D9 / IEP / 504 / BIP not stored**: per the spec's D9 decision, student-support flags are NOT copied onto the referral row. Surfaces that need to display them look up at read time from `students.*` / `student_504_*` scoped by the same tenant + student keys as the referral. The schema enforces this by simply not having the columns (M036).
- **CSV / S3 / external egress**: none. No file uploads on the create path. No third-party services touch referral data.
- **Rate limiting**: matches `routes/prereferralForms.js` posture — no per-route rate limit added on PR #2; CSRF is enforced at the `/api` mount. If a future PR adds bulk-create or import, rate limiting must be revisited.
- **FE on-device caching**: none. The mobile-first modal (`DisciplineReferralModal.jsx`) deliberately does not use localStorage or IndexedDB per design D10. Vocab and student-search are live fetches per session; no referral draft state survives a page reload.

Migration provenance:

- Migration 036 — `discipline_referrals` + 7 vocab tables + many-per-referral consequences join. School-tenant-scoped; composite-FK cross-tenant rejection on every FK from the referral row.
- Migration 037 — `discipline_behaviors.requires_subtype` column. Structural alternative to FE label-matching for the conditional harassment/weapon subtype gate. Conservative backfill: only the two canonical seeded rows tagged.

Phase 2+ deferred surfaces (NOT yet landed; will need privacy review when added):
- Parent / guardian notifications, appeals, restraint/seclusion handling, bulk historical import — out of v1 entirely per spec §2.
- Equity / disproportionality reports — deferred to a separate phase per spec D4. Re-evaluate small-cell aggregation rules at design time before these surfaces ship.

(SWIS-style report cuts from spec §7 — five total — are now LANDED. See "Discipline reports — GET surfaces" subsection below.)

### Discipline reports — GET surfaces (FERPA)

The `/api/discipline-reports/*` router (`routes/disciplineReports.js`) exposes five GET cuts over `discipline_referrals` for in-school review. All five are gated by `requireAuth + requireTenantStaffAccess` (per §5 dual-path doctrine, helper-consumed); tenant scope is bound at `WHERE dr.tenant_id = $1` on every query. Two distinct role-gate tiers split the catalog by privacy posture: an aggregate tier and a per-person tier.

**Tier 1 — Aggregate cuts (no PII).** Three GET surfaces: `/by-location/:tenantId`, `/by-incident-type/:tenantId`, `/by-time-of-day/:tenantId`. Gated by `VIEW_ROLES = ['school_admin','district_admin','counselor','interventionist']`; teacher + parent return 403. Projections are tenant-customizable vocab labels + integer counts only — `location_label`, `behavior_label + severity_level`, and `hour` respectively. No student or staff identifier of any kind reaches any of these responses. Notes columns (`staff_notes`, `admin_notes`) are never projected on the reports surface; the D6 visibility contract on the read-from-student-record path is the canonical place for notes. FE consumer (`frontend/src/components/DisciplineReports.jsx`) renders these as three cards in the "Aggregate cuts" section; `cache: 'no-store'` on every GET so granular counts don't sit in the browser disk cache.

**Tier 2 — Per-person cuts (display-name projections).** Two GET surfaces, each documented as a worked application of the granter-name precedent in the "Display-name projections under the granter-name precedent" subsection below: `/repeat-offenders/:tenantId` (student display names; same `VIEW_ROLES` gate as Tier 1) and `/by-staff/:tenantId` (staff display names; NARROWER `STAFF_VIEW_ROLES = ['school_admin','district_admin']` per product decision R5). Both projections are display-name-only; both pass the four-point granter-name precedent. The FE renders these as two cards in a separate "Per-person cuts" section so the privacy posture difference is visible at the layout level; the by-staff card is conditionally rendered for admins only via `canViewStaffReport` (UI gate is UX-only — server is the boundary). Each card's empty-state caption is a static literal with no interpolation of identity ("No students with N+ referrals in this range." / "No referrals submitted by staff in this range.").

Cross-cutting notes (apply to all five cuts):

- **No PII in logs / error bodies**: every handler's `console.error` carries `tenant_id` (integer, from path), `user_id` (integer, from `req.user.id`), and `err.message` only. No student/staff identifier, no body echo. Generic-string error responses ("Invalid tenant id", "Invalid min_count", "Invalid status filter", "Failed to load report").
- **Input validation**: `parseDateParam` shape-regex on `start_date`/`end_date`; allowlist on `status`; `parseInt + isPositiveInt + REPEAT_OFFENDERS_MAX_MIN_COUNT=1000` cap on `min_count`. Junk input returns 400 with a generic message; raw input is never echoed in the response.
- **Tenant scoping**: `requireTenantStaffAccess` enforces accessible-set membership BEFORE the role check fires, and the role check fires BEFORE any DB read — out-of-scope callers consume zero PII via this surface.
- **URL convention**: every endpoint terminates in the `:tenantId` path segment with no trailing slash, mirroring the disciplineReferrals/queue convention and avoiding the PR #183 Vercel-rewrite / 405 edge.

Migration provenance:
- Wave-1 aggregate cuts landed in PR #190 (`feat/discipline-referral-reports`).
- Wave-2 per-person cuts landed in PR #197 (`feat/discipline-reports-wave2`).
- Closes F-DOC-1 / catalog-gap follow-up flagged by privacy-reviewer on PR #197.

Phase 2+ deferred surfaces (NOT yet landed; will need privacy review when added):
- Teacher caseload-scoped repeat-offenders — tied to enabling the access-flip strict mode (PR #195's `STRICT_STUDENT_ACCESS_PREDICATE=true`). Deferred until that flag is on in prod.
- Equity / disproportionality cuts (spec D4) — deferred entirely per the discipline-referral section above.

### MTSS Coordinator entitlement records

The `mtss_coordinators` + `mtss_coordinators_audit` pair (Migrations 038 / 039 / 040) implements the per-(user, school_tenant_id) coordinator designation introduced in PR #191. The data shape mirrors the access-control audit pair almost exactly: integer-key entitlement table + append-only audit table with NO foreign keys (FERPA §99.32 retention), AFTER DELETE trigger writing `'cascade_user_delete'` by default, two transaction-local GUCs (`app.actor_user_id`, `app.audit_action`) for explicit-revoke attribution. The trigger function `mtss_coordinators_audit_cascade` runs as plain `LANGUAGE plpgsql` with NO `SECURITY DEFINER`; M040 evolved it from the M031-minimal hardcoded shape to the M033-mature GUC-driven shape in a single CREATE OR REPLACE FUNCTION step (greenfield audit table; combined evolution rather than the historical M032+M033 split that user_school_access_audit went through).

Per-row columns are integer identifiers only; this table itself is NOT a name-projecting surface. The grant/revoke API at `/api/mtss-coordinators` (`POST /` + `DELETE /users/:userId/schools/:schoolTenantId`, PR #192) accepts only integer ids in body/path and returns only integer ids + status messages. Writers (PR #192) and destroyers (PR #192 + the M038 ON DELETE CASCADE triggered from DELETE-FROM-users) both comply with the two-GUC writers contract documented for `user_school_access_audit` above; M040's header re-states the contract verbatim so audit-table evolution and writer-site evolution stay in sync.

The single name-projecting surface is `GET /api/mtss-coordinators/by-school/:tenantId` (PR #193), which surfaces the granter's `users.full_name` via LEFT JOIN to support the admin-UI display caption "Designated by [granter] on [date]". This surface is a worked application of the granter-name precedent below.

Migration provenance:
- Migration 038 — `mtss_coordinators` table foundation (PR #191; mirrors M028 composite-FK doctrine).
- Migration 039 — `mtss_coordinators_audit` + AFTER DELETE trigger (PR #191; mirrors M031 forensic-grade append-only doctrine).
- Migration 040 — trigger function evolution to GUC-driven action + actor capture (PR #192 prerequisite; M032+M033 doctrines combined in one CREATE OR REPLACE FUNCTION step).
- PR #193 — admin UI for grant/revoke; established the granter-name display-projection precedent.
- Closes F-INFO-1 / doc-only follow-up flagged by privacy-reviewer on PR #193.

### Education Assistant caseload records

The `ea_caseload_students` + `ea_caseload_students_audit` pair (Migration 041) implements the per-(EA user, student) caseload designation introduced for the `education_assistant` role landing in PR-2 (`feat/education-assistant-enforcement`). The data shape mirrors the MTSS Coordinator pair above almost exactly — integer-key entitlement table + append-only audit table with NO foreign keys (FERPA §99.32 retention), AFTER DELETE trigger writing `'cascade_user_delete'` by default, two transaction-local GUCs (`app.actor_user_id`, `app.audit_action`) for explicit-revoke attribution — with one structural addition unique to this table: a third composite foreign key `(student_id, school_tenant_id) REFERENCES students(id, tenant_id) ON DELETE CASCADE`, applying the M021 doctrine (CLAUDE.md §5 composite-FK cross-scope rejection) at the student-side. M038 (the immediate analog) did not need this third FK because it tracked a per-(user, school) entitlement without a student column; M041 binds a student, so cross-school caseload rows are rejected at the schema layer with FK 23503 — even within the same district. The trigger function `ea_caseload_students_audit_cascade` runs as plain `LANGUAGE plpgsql` with NO `SECURITY DEFINER`; M041 lands the GUC-driven shape in a single CREATE OR REPLACE FUNCTION step (greenfield audit table; same combined-evolution reasoning as M040).

Per-row columns are integer identifiers only; this table itself is NOT a name-projecting surface. The grant/revoke API for caseload assignment is deferred to PR-3 along with the assignment UI; per-row writers and destroyers will comply with the two-GUC writers contract documented for `user_school_access_audit` and `mtss_coordinators_audit` above. PR-2 ships the enforcement surfaces (`canStaffAccessStudent` EA branch + a new narrow building-wide picker endpoint at `GET /api/discipline-referrals/picker/:tenantId`) but adds no writer for the caseload table; caseload rows are seeded via SQL in dev/staging during the PR-2 → PR-3 window. No real `education_assistant` accounts are provisioned to prod until PR-3 ships the assignment UI and the list-endpoint EA branch — without those, the EA's roster page renders empty.

The single name-projecting surface added in PR-2 is the picker endpoint, which surfaces `first_name`, `last_name`, `grade` for students in the caller's tenant. The picker is open to all non-parent roles (gated by `requireTenantStaffAccess`) and is the minimum payload needed to render a typeahead student selector in the discipline-referral create modal. NO tier, NO risk_level, NO history, NO documents, NO external_id, NO dob, NO parent_email. The data-minimization win applies tenant-wide, not just for EA — replaces the FE's prior use of `GET /students/tenant/:tenantId` (which over-discloses `s.*` for the referral-picker use case). Picker satisfies the four-point test below: (a) audit-subject is the student being referral'd; (b) precedent is the existing referral create flow; (c) strict minimum — name + grade are the only identity fields; (d) gated to non-parent staff whose accessible-tenant set includes the path tenant.

The deferred PR-3 list-endpoint EA branch in `routes/students.js GET /tenant/:tenantId` MUST reuse the exact column-triple predicate (`ea_user_id`, `student_id`, `school_tenant_id`) and table from `middleware/canAccessStudent.js` to avoid the per-record-vs-list divergence bug-shape that produced S113 teacher over-exposure. PR-3's tenant-isolation reviewer should flag any column-triple drift between the per-record and list predicates.

Migration provenance:
- Migration 041 — `ea_caseload_students` + `ea_caseload_students_audit` + AFTER DELETE trigger function combined into one atomic apply (merged via PR #221; mirrors M028 composite-FK doctrine + adds student-side FK per M021 doctrine; mirrors M031/M039 forensic-grade append-only doctrine; mirrors M040 GUC-driven greenfield trigger evolution). Reviewer agentIds: `a9ac57f670ac09e50` (privacy), `ace43c65a9db68bd8` (tenant-isolation).
- PR-2 (`feat/education-assistant-enforcement`) — role allowlist wiring + `canStaffAccessStudent` EA branch + narrow picker endpoint + FE wiring + this PRIVACY_REVIEW.md entry.
- PR-3 (deferred) — caseload assignment UI + CRUD routes (grant/revoke) + the `routes/students.js` list-endpoint EA branch. Will need fresh privacy + tenant-isolation + security review.

### Scheduled overdue-progress-log staff email (egress)

The `feat/overdue-logs-staff-email` feature adds a scheduled weekly email reminding each staff member of the active interventions on their caseload that are missing this week's progress log — the same data the Dashboard "Weekly Reminder: Log Progress" card already shows in-app (`routes/weeklyProgress.js` `GET /missing/:tenantId`). It is built from three parts: the reusable predicate `getMissingLogsForStaff(user, tenantId)` (extracted from that route, unchanged behavior), the digest service `services/overdueLogsDigest.js`, and an in-process `node-cron` registration in `server.js`. The whole feature is gated OFF by default behind `OVERDUE_LOGS_REMINDERS_ENABLED` (must equal `'true'`); production is unaffected until it is explicitly enabled, and a **deliberate per-tenant opt-out follow-up must land before it is ever enabled in prod**.

**External egress — Resend, reusing the existing sub-processor.** The digest sends via the same inline Resend client + `RESEND_API_KEY` already used by `routes/auth.js` and `routes/csvImport.js` — not a new vendor. This egress is materially **more sensitive than the discipline-referral admin notification**, and the distinction is deliberate and load-bearing:

- The referral notification body is **PII-free** (no student data; recipient was simply told "a referral was submitted").
- **This email body CONTAINS student PII**: for each overdue item it lists the student's name (`last_name, first_name`), the `intervention_name`, the `tier`, and the `log_frequency`. Resend, as the transactional sub-processor, therefore receives student PII in the message body.

**Why that is acceptable under §4B (no new disclosure scope).** The PII in the body is delivered ONLY to the one staff member who is already authorized to see exactly that data in-app. The email is generated by the SAME `getMissingLogsForStaff` predicate that backs the in-app card, driven by that staffer's own server-resolved identity — so an elevated viewer receives their tenant-wide overdue list and a non-elevated staffer receives only their `intervention_assignments` caseload, identical to what each already sees on the dashboard. The email is a push channel for data the recipient can already pull; it does not widen who can see what. No student's data reaches a staff member who could not already open it in-app.

**§5 tenant scoping — no request input anywhere.** The recipient set is `SELECT ... FROM users WHERE role <> 'parent'` (mirroring the in-app `requireTenantStaffAccess` gate, which rejects only `parent`; deliberately NOT `INTERVENTION_MANAGER_ROLES`, which would silently drop `education_assistant`). For each recipient the accessible school-tenant set is resolved server-side via `resolveAccessibleTenantIds(user)` from that user's own DB row (legacy → `[tenant_id]`; district → `user_school_access` grants for their district), and `getMissingLogsForStaff` binds `s.tenant_id` as defense-in-depth. The digest iterates only tenants the user can access; there is no path param, no JWT, no caller-supplied scope. One email is sent per `(staffer, school)` pair, so **two schools' student names are never commingled in a single message body** — a district user with overdue items in three schools receives three single-school emails rather than one mixed one.

**No PII in logs, subject, or URLs.** All DB-sourced strings interpolated into the HTML body are HTML-escaped (`escapeHtml`) to prevent a stored name like `O'<script>` from injecting markup. The subject line is the static literal `Weekly Reminder: Log Progress` (no names, no identifying count). The only link points at `FRONTEND_URL` root, never a student- or intervention-specific URL. Every log line carries integer ids (`user_id`, `tenant_id`) + counts only — never the recipient's email address, never a student name, never intervention text. The recipient address is read from `users.email` at send time and is never persisted by this feature.

**Send-dedup ledger (Migration 050).** `overdue_log_reminder_sends` records one row per `(user_id, school_tenant_id, week_of)` confirming a send, so a process restart, an overlapping cron tick, or a multi-instance deploy cannot double-send. It is a claim-then-send design: the row is inserted with `ON CONFLICT DO NOTHING` BEFORE the email, only the slot winner sends, and a send failure rolls the claim back so a later run retries. The table stores integer references + dates only (`user_id`, `school_tenant_id`, `district_id`, `week_of`, `sent_at`) — **no student/staff names, no email addresses, no intervention data**; the overdue PII lives only in the transient email body. `school_tenant_id NOT NULL` + index satisfies §5; no foreign keys, consistent with the M031–M049 ledger/audit house style.

**v1 exclusions / follow-ups.** Per-tenant (or per-staff) opt-out is NOT built in v1 (single global weekly cadence) and is a gating follow-up before any prod enable. No school-name label is rendered in the per-school email body yet (acceptable while most users are single-school; revisit with the opt-out follow-up). Multi-instance correctness rests on the dedup ledger rather than leader election; if the Render deploy ever scales beyond one instance before the ledger is battle-tested, re-verify the claim-then-send path under concurrency.

### Display-name projections under the granter-name precedent

A doctrinal subsection: how this codebase reasons about response projections that surface a person's `full_name` (or equivalent display name). Established in PR #193's privacy-reviewer ruling on the MTSS Coordinator UI; applied verbatim on the discipline-reports wave-2 cuts in PR #197.

**The four-point test.** A display-name projection is acceptable under §4B if and only if it satisfies all four of:

(a) **Audit-subject purpose.** The named person IS the audit subject the surface exists to surface — granter, reviewer, author, designee. Concealing the name would defeat the feature's stated purpose. (Counter-test: if the surface could function equally well with only an integer id, the name projection is unjustified.)

(b) **Repo precedent.** The same projection shape already exists on an analogous surface with the same gating posture, so the new projection is incremental rather than novel. Cite the precedent file:line.

(c) **Strict minimum projection.** The name field is the ONLY identity field in the response. No email, no role, no district_id, no DOB, no external_id, no employment data, no grade, no enrollment status, no incident notes. The reader gets exactly what the audit-subject purpose requires and nothing else.

(d) **Gated recipient.** The endpoint enforces a role/scope gate in the server handler that restricts visibility to a small allowlist (admin, counselor, interventionist, etc., as appropriate). The FE role gate is UX-only; the server is the trust boundary. Document the allowlist and the in-handler check site.

**Application precedent and worked rulings.**

**Ruling 1 — `granter_full_name` on `GET /api/mtss-coordinators/by-school/:tenantId` (PR #193).**

- (a) Audit-subject purpose: the granter IS the audit subject the toggle surface exists to display ("Designated by [granter] on [date]" caption). Concealing the granter defeats the feature.
- (b) Repo precedent: `routes/disciplineReferrals.js` line 597 already projects `ra.full_name AS reviewing_admin_name` (the reviewing admin of a referral) under the same gating posture.
- (c) Strict minimum projection: `granter.full_name` is the ONLY identity field in the response. The projection at `routes/mtssCoordinators.js` GET `/by-school/:tenantId` returns `user_id, school_tenant_id, district_id, granted_by, granted_at, granter_full_name` — integer keys + timestamp + the one name field. No email, no role, no district_id of the granter, no other identity field.
- (d) Gated recipient: the GET surface enforces `VIEW_ROLES = ['school_admin','district_admin']` in-handler before any DB read (`routes/mtssCoordinators.js` GET handler). Counselor / interventionist / teacher / parent return 403 server-side.
- Reader contract: visible only to school-admin / district-admin of the building. A district-admin from a different district granting a coordinator designation in this building may legitimately appear in the response — that's the audit-subject purpose; the granter's identity is the whole point of displaying the row at all.

**Ruling 2 — `student_first_name + student_last_name` on `GET /api/discipline-reports/repeat-offenders/:tenantId` (PR #197).**

- (a) Audit-subject purpose: this cut exists to surface the specific students requiring intervention review (the repeat-referral cohort). Without names the surface devolves into "you have 4 students with 3+ referrals" — no actionable signal for the intervention team.
- (b) Repo precedent: `routes/disciplineReferrals.js` lines 594-598 already project `student_first_name + student_last_name` (the referred student) on the admin review queue under the same gating posture. The wave-2 projection is a strict subset of the existing queue projection.
- (c) Strict minimum projection: `student_first_name + student_last_name` are the ONLY identity fields. Response shape is `student_id, student_first_name, student_last_name, referral_count` — integer keys + the two name fields + the count. No DOB, no `external_id` (the H10 SIS-identifier surface remains deferred), no email, no grade, no enrollment status, no notes content.
- (d) Gated recipient: the GET surface enforces `VIEW_ROLES = ['school_admin','district_admin','counselor','interventionist']` in-handler before any DB read. Teacher / parent return 403 server-side. (Same gate as the wave-1 aggregate cuts.)

**Ruling 3 — `staff_full_name` on `GET /api/discipline-reports/by-staff/:tenantId` (PR #197).**

- (a) Audit-subject purpose: this cut exists to surface per-staff referral activity for school-leadership review. The named staff IS the activity subject; an anonymous "5 staff submitted 17 referrals" surface gives leadership nothing actionable.
- (b) Repo precedent: `routes/disciplineReferrals.js` line 277 already projects `ru.full_name AS referring_staff_name` (the referring staff member) on the per-student referral-history view under a similar gating posture. The wave-2 projection mirrors the same field with tighter recipient gating.
- (c) Strict minimum projection: `staff_full_name` is the ONLY identity field. Response shape is `staff_id, staff_full_name, referral_count` — integer key + the name + the count. No email, no role, no district_id, no employment data, no home tenant_id (a staff member whose home tenant changed since authoring still appears under the audit-identity semantics; the projection deliberately doesn't expose where they "are now").
- (d) Gated recipient: the GET surface enforces NARROWER `STAFF_VIEW_ROLES = ['school_admin','district_admin']` in-handler before any DB read — explicitly distinct from `VIEW_ROLES` and from the wave-1 cuts. Counselor / interventionist (who DO see the four other cuts) are 403'd here per product decision R5: staff-performance data restricts to administrators. The FE component conditionally renders the by-staff card only when `canViewStaffReport` evaluates true; non-admin callers never fire the request.

**Drift-watch invariant**: any future endpoint surfacing a display name MUST be examined against the four-point test by a privacy-reviewer pass; precedent reuse is not automatic. The audit-subject purpose criterion (a) is the gating one — if a maintainer cannot articulate why the name belongs in the audit picture, the projection should default to integer id only.

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

### Operator-provisioned district admin accounts (staff PII)

`POST /api/operator/districts/:districtId/admins` (`routes/operatorDistricts.js`, under the router-level `requireAuth + platformAdminOnly` operator gate) mints a single `users` row for the first — or an additional — `district_admin` of an existing district. It is a §4B data-collection point: it persists exactly two PII fields, `email` and `full_name` (both trimmed; `email` lowercased to match the case-insensitive login lookup), and nothing else from the request body. `role` is hard-coded server-side to `'district_admin'`, `district_id` is taken exclusively from the URL path (a body-supplied `role` / `district_id` / `tenant_id` is structurally ignored — only `{ email, full_name }` are destructured), and three columns are fixed server-side: `tenant_id = NULL` (a district-level user owns no school data — the one legitimate null-tenant write), `school_wide_access = FALSE` (district scope is `user_school_access` membership, not the school-wide flag — deliberately FALSE even though `staffManagement.js` would default it TRUE for this role), and `password_hash` omitted → NULL (Google SSO only; nullable per Migration 025).

**No school access at creation (Option 2)**: the row is minted with NO `user_school_access` grant, so the new district_admin reads zero student/staff rows until a separate later flow grants school access (the empty accessible-tenant set from `resolveAccessibleTenantIds` resolves to deny on every scope gate). The account is usable at login immediately because the auth queries LEFT JOIN `tenants` (PR #270), so a `tenant_id = NULL` user is no longer dropped by the join — `tenant_name` returns NULL and the session-header labels fall back to the caller's own `district_name`.

**Duplicate-email pre-flight is GLOBAL, not tenant-scoped**: the pre-INSERT check is `SELECT 1 FROM users WHERE email = $1` across all tenants (returning a boolean existence signal only — no row, no PII), because login resolves users by `email` across all tenants and takes `rows[0]`, and `UNIQUE(tenant_id, email)` never fires for a `tenant_id = NULL` row (NULL is distinct under a UNIQUE constraint), so a colliding email would otherwise make login non-deterministic. The check is best-effort (a TOCTOU race window the null-tenant case cannot close at the DB layer; partial-unique-index hardening banked as a separate `migration/` follow-up). The 409 ("A user with this email already exists"), 404 ("District not found"), and 400 bodies are static literals; the catch logs tag-only (`[operatorDistricts:createAdmin]`, `err.message`) — no `email` / `full_name` in logs or error bodies. The 201 echoes back only the operator's own just-submitted values (`id, email, full_name, role, district_id, created_at`), not another person's PII. No new column or table (no migration); provenance `feat/operator-first-district-admin` (PR #273), triad-reviewed (privacy / security / tenant-isolation).

### Operator-driven user_school_access grant (no PII collected)

`POST /api/operator/districts/:districtId/admins/:userId/access` and `GET /api/operator/districts/:districtId/admins/:userId/access` (`routes/operatorDistricts.js`, under the same router-level `requireAuth + platformAdminOnly` operator gate) give a freshly-minted null-tenant `district_admin` (from the N2 admins endpoint above) its school scope — moving it from zero accessible rows to its granted school(s). These are the operator analog of the district_admin-driven grant/list at `routes/districtAccess.js` (PR #104). **This is NOT a §4B data-collection point: it persists and returns integer identifiers only — `user_id`, `district_id`, `school_tenant_id`, `created_by`, `created_at` — and never reads, writes, logs, or echoes any student/staff PII field** (`email` / `full_name` are never touched). The grant body accepts only `{ school_tenant_id }`; `district_id` and `user_id` come exclusively from the URL path.

**Scope is structural, not membership-based**: operators hold zero `user_school_access` rows, so `resolveAccessibleTenantIds` is deliberately NOT in the chain (it would resolve to an empty set and 404 every grant — same reasoning as the N2 endpoint's `router.use` comment). Cross-district leakage is blocked by two §5 in-handler pre-flights — target `user.district_id === pathDistrictId` and school `tenant.district_id === pathDistrictId` (the school pre-flight additionally filters `type = 'school'`, so a grant can never bind to a `type = 'district'` tenant even within the same district — matching the same-file `createSchool` precedent), both required before any write — backstopped by M028's composite FKs at the schema layer (a mismatched triple raises 23503, mapped to 404). The grant runs in an explicit transaction that sets `app.actor_user_id` to the operator's own `users.id` and app-writes the `'grant'` audit row (M031's trigger fires only on DELETE), exactly mirroring `districtAccess.js`. Error bodies are static literals — 400 (invalid id), 404 ("Not found" for missing/cross-district user or school), 409 ("Already granted", SQLSTATE 23505), 500 — and the catch logs tag-only (`[operatorDistricts:grantAccess]` / `[operatorDistricts:listAccess]`, `err.message`); no PII in logs, bodies, or URLs. The 201 echoes back only the operator's own just-submitted integer scalars. Grant-only: `school_wide_access` and every other `users` column are untouched. Revoke ships as its own follow-up. No new column or table (no migration); provenance `feat/operator-grant-district-admin-access`, triad-reviewed (privacy / security / tenant-isolation).

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
