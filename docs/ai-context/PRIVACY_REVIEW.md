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

### Uploaded content
- Any document uploaded by a staff member that concerns an identified student
- Any CSV row containing any of the above

### What is NOT PII (but still be careful)
- Aggregate counts across a school ("234 students on Tier 2 interventions this month")
- Anonymous survey data with no identifier
- Curriculum/intervention definitions not tied to a person
- Reference data like the tier-1 assessment item bank

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
