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
- Meeting notes (MTSS, pre-referral, parent conferences)
- Referral data
- Assessment results
- Attendance linked to a person
- Behavior records linked to a person
- Progress notes

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
