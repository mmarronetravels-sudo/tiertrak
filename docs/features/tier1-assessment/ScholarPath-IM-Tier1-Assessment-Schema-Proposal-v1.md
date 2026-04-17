# Tier 1 Self-Assessment — Schema Proposal

**Status:** Proposal for review — no code to be run yet
**Date:** April 16, 2026
**Prepared for:** ScholarPath Systems / Intervention Monitoring
**Depends on:** Item Bank v5 (approved April 16, 2026)

---

## What this document is (and isn't)

This document proposes the database schema and migration approach for the Tier 1 Self-Assessment feature. **It is a review artifact, not executable work.** When you approve it, I will then:

1. Write the actual Migration 019 block to add to `server.js`
2. Write the item bank module (`data/tier1-assessment-items.js`)
3. Write the new `routes/tier1-assessments.js` file

Each of those is a separate small change you'll review before anything gets committed.

---

## Summary of decisions already made

From earlier conversations:

- **Four tables**, all tenant-scoped
- **Item bank stored in code** (JavaScript module), not in the database
- **Completed assessments are immutable**, archivable by admin (mirroring the `students` archive pattern)
- **Single user captured** as `completed_by_user_id`; no team participant tracking in v1
- **0/1/2 scoring**, 26 items, 8 domains, 52 points max
- **Optional Evidence URL + optional Notes field** per item response
- **Permissions:** role-based, six roles can complete (see Decision D1 below for final list)
- **Forward-compatible** for district scope and future data-aware validation
- **Migration style:** Migration 019 block added to `createTables()` in `server.js` — same idempotent `IF NOT EXISTS` pattern used for migrations 007–018

---

## The four tables at a glance

| Table | Purpose | Rows per tenant (typical) |
|---|---|---|
| `tier1_assessments` | One row per assessment attempt. The top-level record. | 2–10 per year |
| `tier1_assessment_responses` | One row per item per assessment. Holds the score, Evidence URL, and Notes. | 26 × (assessments per year) |
| `tier1_assessment_recommendations` | Snapshot of which items scored below 2 and the recommendation text shown. Optional. | varies |
| `tier1_assessment_events` | Audit log of key events (created, completed, archived). Optional for v1 but recommended. | 3–5 per assessment |

**The middle two tables are what I want your feedback on most.** I'll explain the tradeoffs in each section.

---

## Table 1 — `tier1_assessments` (required, the core table)

This is the top-level record. When a team starts an assessment, a row is inserted here. When they complete it, the row's `status` and `completed_at` get updated and scores are calculated and stored.

### Proposed DDL

```sql
CREATE TABLE IF NOT EXISTS tier1_assessments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Authorship
  created_by INTEGER NOT NULL REFERENCES users(id),
  completed_by INTEGER REFERENCES users(id),

  -- Status lifecycle
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'archived')),

  -- Scoring (populated at completion)
  total_score INTEGER,
  max_score INTEGER,
  overall_percentage NUMERIC(5,2),
  score_band VARCHAR(20)
    CHECK (score_band IS NULL OR score_band IN ('implementing', 'partial', 'installing')),

  -- Item bank version at time of completion (so trend lines are trustworthy across item edits)
  item_bank_version VARCHAR(20) NOT NULL DEFAULT 'v1.0',

  -- Forward-compatibility fields (v1 values fixed; unused until later releases)
  scope VARCHAR(20) NOT NULL DEFAULT 'building'
    CHECK (scope IN ('building', 'district')),
  subject_tenant_id INTEGER REFERENCES tenants(id),

  -- Archive pattern (matches students table)
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMP,
  archived_by INTEGER REFERENCES users(id),
  archived_reason VARCHAR(100),

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tier1_assessments_tenant
  ON tier1_assessments(tenant_id, archived);

CREATE INDEX IF NOT EXISTS idx_tier1_assessments_tenant_status
  ON tier1_assessments(tenant_id, status)
  WHERE archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_tier1_assessments_completed_at
  ON tier1_assessments(tenant_id, completed_at DESC)
  WHERE status = 'completed' AND archived = FALSE;

-- Only one in-progress assessment per tenant at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_tier1_assessments_one_in_progress_per_tenant
  ON tier1_assessments(tenant_id)
  WHERE status = 'in_progress' AND archived = FALSE;
```

### Column-by-column rationale

- **`id`, `tenant_id`** — matches the pattern on every other table. `ON DELETE CASCADE` means if a tenant is deleted, their assessments are too (consistent with `students`, `screener_results`).
- **`created_by` NOT NULL, `completed_by` nullable** — created_by is always known. completed_by is NULL while in progress, set when the team clicks Complete.
- **`status`** — three states. `in_progress` is the editable state. `completed` is immutable. `archived` is soft-deleted (only admin can archive; they can't be resurrected without being re-created).
- **Score fields populated only at completion** — while in progress, these are NULL. Computing them on the fly from `tier1_assessment_responses` is cheap, but storing them at completion locks in the historical data point and means trend-view queries don't need joins.
- **`item_bank_version`** — this is important and subtle. Because the item bank lives in code, you might edit an item's text or anchors in a future release. If a school's assessment from October uses v1.0 items and the team scores it as "Partial," and you later rewrite that item's anchors in v1.1, their historical "Partial" score might no longer align with the new anchors. Storing the version at completion lets us (a) render old assessments with the items they were actually scored against and (b) trigger UI warnings if comparing scores across item bank versions.
- **`scope` and `subject_tenant_id`** — v1 only writes `scope = 'building'` and `subject_tenant_id = NULL`. These exist so district-mode (A) can be added later: a district coordinator completing the building instrument about School X would have `scope = 'district'` and `subject_tenant_id = <school's tenant_id>`. Without these fields now, we'd need another migration later.
- **Archive fields** — exact pattern from `students` table. Archive doesn't delete — it hides from default views and score trends. Useful if a team ran an assessment in error or for testing.
- **Partial index `WHERE archived = FALSE`** — most queries filter out archived rows. The partial index is smaller and faster than indexing all rows.
- **Unique partial index for one in-progress assessment per tenant** — enforces the "Only one in_progress at a time" rule at the database level, not just in application code. This is defense-in-depth; if a bug in the UI somehow tries to create a second in-progress assessment, Postgres will reject it.

### Decision points on this table

**D1 — Permission role list.** Finalize which roles can create/edit an assessment. My recommendation: `district_admin`, `school_admin`, `counselor`, `student_support_specialist`, `behavior_specialist`, `mtss_support`. Teachers and parents can view but not create. Everyone can view.

**D2 — `item_bank_version` format.** I've proposed a string like `'v1.0'`. Alternative: a numeric version (`1`, `2`). String is more flexible (allows `'v1.0-hotfix'`). Numeric is cleaner to sort. Preference?

**D3 — Archive vs. delete.** I'm proposing archive-only, no hard-delete. The `routes/students.js` file has a DELETE endpoint but the students app uses archive in practice. Should admins be able to hard-delete an assessment? I'd say no — it's better to archive for audit trail.

---

## Table 2 — `tier1_assessment_responses` (required, holds the answers)

One row per item per assessment. 26 rows created when an assessment begins (all with score = NULL), filled in as the team answers.

### Proposed DDL

```sql
CREATE TABLE IF NOT EXISTS tier1_assessment_responses (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES tier1_assessments(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which item this response is for (matches item IDs in the code-stored item bank)
  item_id VARCHAR(10) NOT NULL,   -- e.g., "1.1", "3.3", "7.3"
  domain_number INTEGER NOT NULL CHECK (domain_number BETWEEN 1 AND 8),

  -- The response
  score INTEGER CHECK (score IS NULL OR score IN (0, 1, 2)),
  evidence_url TEXT,
  notes VARCHAR(300),

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- One response per item per assessment
  UNIQUE (assessment_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_tier1_responses_assessment
  ON tier1_assessment_responses(assessment_id);

CREATE INDEX IF NOT EXISTS idx_tier1_responses_tenant
  ON tier1_assessment_responses(tenant_id);
```

### Column-by-column rationale

- **`assessment_id` + `tenant_id`** — both are present even though `tenant_id` could be derived by joining. Having it directly on the responses table means tenant-scoped queries don't need joins, which matches how your other tables work (e.g., `screener_results.tenant_id` exists even though it could be derived via `student_id`).
- **`item_id VARCHAR(10)`** — matches the string format I'll use in the code-stored item bank (e.g., `"1.1"`, `"3.3"`, `"7.3"`). Using the human-readable format rather than an integer makes debugging and SQL inspection much easier.
- **`domain_number`** — could be derived from `item_id` (the part before the dot), but storing it denormalized makes "score by domain" queries trivial. Matches your denormalization pattern on `screener_results.student_first_name`.
- **`score` nullable** — while the assessment is in progress, not all items have been answered yet. NULL means "not yet answered." At completion, we can enforce all scores are non-null in application code (and optionally reject the Complete action until all 26 are filled).
- **`evidence_url TEXT`** — URL lengths can be long (especially Google Drive links with query parameters). TEXT is the right type; a fixed VARCHAR would risk truncation.
- **`notes VARCHAR(300)`** — the 300-char limit we agreed on. Enforced at the DB level too, not just the UI.
- **UNIQUE `(assessment_id, item_id)`** — can't have two responses for the same item on the same assessment. Guards against bugs.

### Why I'm not creating all 26 rows up front

My first instinct was "insert 26 rows when an assessment is created, fill them in as the team answers." That's clean but has downsides:

- If you edit the item bank (adding item 9.1 in a future release), existing in-progress assessments would have 26 empty rows and no way to capture a 27th.
- Inserts happen one time; updates happen on every autosave. Preferring INSERT-on-first-answer is actually *fewer* total queries.

So the design is: the assessment starts with **zero responses**. On first autosave of each item, we UPSERT a row. `ON CONFLICT (assessment_id, item_id) DO UPDATE` handles subsequent edits to that same item. This matches the `screener_results` upload pattern (which uses `ON CONFLICT DO UPDATE`).

### Decision points on this table

**D4 — `item_id` as string or FK.** I'm proposing `VARCHAR(10)` because the item bank is code-stored, not a database table — so there's nothing to FK to. Schools can't change items. If someone edits an item ID in code without migrating historical responses, old assessments break in subtle ways. Mitigation: item IDs should be treated as **immutable identifiers in code** — we can rewrite item *text* but never change an item *ID* after v1.0 ships. I'll document this in the code comments.

**D5 — Notes field size.** 300 chars. This matches what we discussed. If you want bigger, the argument is "teams want to record more context." If you want smaller (say, 200), the argument is "tighter limit → less PII risk." I'd stay at 300.

**D6 — Should Evidence URL be validated at the DB?** I could add a CHECK constraint like `evidence_url ~ '^https?://'`. My preference: validate on the client and in the route handler, not in a CHECK constraint. CHECK constraints with regex are hard to debug when they fail and a malformed URL is not a data-integrity issue.

---

## Table 3 — `tier1_assessment_recommendations` (optional, I want to discuss)

This is where I want your input most. The question is whether to store the **recommendation text that was shown to a team** at the time they completed their assessment.

### Two approaches

**Approach A — Don't store recommendations at all. Derive on display.**

When a team views results, the frontend pulls the scores from `tier1_assessment_responses`, looks up each below-2 item in the code-stored item bank, and displays the recommendation from there.

- **Pros:** No extra table. Simpler schema. If you improve the recommendation text in a future release, old assessments automatically show the new text.
- **Cons:** If you later rewrite an item's recommendation significantly, a team looking at their October assessment in April will see different recommendations than they originally saw. Continuity of "what we committed to" is lost.

**Approach B — Store recommendation text as a snapshot when the assessment is completed.**

At completion, for each item scored below 2, we insert a row with the recommendation text exactly as it was shown at the time.

- **Pros:** Historical fidelity. A team's "improvement plan" from October is exactly what they saw, regardless of future item bank edits. Makes the formal PDF report (v1.1) simpler — it just reads from this table.
- **Cons:** Extra table. Data duplication (same text repeated across many assessments). More writes at completion.

### Proposed DDL if we go with Approach B

```sql
CREATE TABLE IF NOT EXISTS tier1_assessment_recommendations (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES tier1_assessments(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  item_id VARCHAR(10) NOT NULL,
  domain_number INTEGER NOT NULL CHECK (domain_number BETWEEN 1 AND 8),
  score_at_completion INTEGER NOT NULL CHECK (score_at_completion IN (0, 1)),
  recommendation_text TEXT NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (assessment_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_tier1_recommendations_assessment
  ON tier1_assessment_recommendations(assessment_id);
```

### My recommendation

**Go with Approach A for v1 — don't create this table.** Reasoning:

- You already have `item_bank_version` on the main table, so teams viewing an old assessment can see what version they scored against.
- The realistic scenario of recommendation text changing dramatically between versions is rare for an internally-authored instrument you control.
- We can always add this table later if the need becomes clear. It's additive, not a breaking change.
- Simpler schema = fewer things that can go wrong.

If you disagree and want the historical fidelity, we add the table. Your call.

**D7 — Do we create `tier1_assessment_recommendations`?**

---

## Table 4 — `tier1_assessment_events` (optional, I recommend yes)

An audit log of key lifecycle events on an assessment.

### Proposed DDL

```sql
CREATE TABLE IF NOT EXISTS tier1_assessment_events (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES tier1_assessments(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  event_type VARCHAR(30) NOT NULL
    CHECK (event_type IN ('created', 'completed', 'archived', 'unarchived')),
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_note VARCHAR(200),

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tier1_events_assessment
  ON tier1_assessment_events(assessment_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tier1_events_tenant
  ON tier1_assessment_events(tenant_id, created_at);
```

### Why I recommend including this

Your existing codebase has limited audit logging beyond `archived_by`/`archived_at` on `students`. For a tool that:

- Produces scores that may influence grant applications and accreditation reports
- Is completed by specific users on behalf of a team
- Could become a point of dispute in "who said what when" discussions

...a simple event log is cheap insurance. It's one table with five columns and writes a row four or five times per assessment in its lifetime.

The one thing it deliberately doesn't log is **content edits** (changes to scores or notes during the `in_progress` phase). That'd be much higher write volume and more complex. Content history isn't needed for v1.

### Decision point

**D8 — Include `tier1_assessment_events`?** My recommendation: yes. Small cost, real value.

---

## Item bank — code-stored module

Per earlier decision, the 26 items live in a JavaScript module, not a database table. This is the structure I'm proposing. No DB work needed for this — it's here so you can see how it connects to `item_id` in the responses table.

```js
// data/tier1-assessment-items.js

const ITEM_BANK_VERSION = 'v1.0';

const DOMAINS = [
  { number: 1, title: 'Team & Infrastructure', maxItems: 4 },
  { number: 2, title: 'Universal Academic Instruction', maxItems: 4 },
  { number: 3, title: 'Universal Behavior Supports', maxItems: 4 },
  { number: 4, title: 'Universal SEL Supports', maxItems: 4 },
  { number: 5, title: 'Universal Screening & Interim Assessment', maxItems: 4 },
  { number: 6, title: 'Data-Based Decision Making', maxItems: 4 },
  { number: 7, title: 'Family Engagement', maxItems: 3 },
  { number: 8, title: 'Professional Development & Coaching', maxItems: 3 }
];

const ITEMS = [
  {
    id: '1.1',   // Immutable. Never change this after v1.0 ships.
    domain: 1,
    title: 'MTSS Design & Implementation Team exists and meets regularly',
    question: 'Is there a designated building-level MTSS Design & Implementation Team...',
    anchors: {
      0: 'No designated system-level MTSS team exists, or...',
      1: 'A team exists and meets, but less than monthly...',
      2: 'A designated MTSS Design & Implementation Team meets at least monthly...'
    },
    recommendation: 'Establish a standing monthly meeting on the school calendar...'
  },
  // ...25 more items
];

module.exports = { ITEM_BANK_VERSION, DOMAINS, ITEMS };
```

Route handlers require the module and use it to:
- Validate incoming `item_id`s
- Look up anchors for UI tooltips
- Look up recommendation text for the results view
- Compute the max possible score

The **critical rule** in the file header comment: **item IDs are immutable after v1.0 ships**. If an item is retired, its ID retires with it; a replacement gets a new ID (e.g., `1.1-b` or `9.1`). This is the only way historical responses stay meaningful.

---

## Route plan (preview, will be fleshed out in step 3)

New file: `routes/tier1-assessments.js`. Mounted at `/api/tier1-assessments` in `server.js`.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/` | Create a new in_progress assessment | Role-restricted |
| GET | `/tenant/:tenantId` | List assessments for a tenant (paginated) | Any logged-in user at tenant |
| GET | `/:id` | Get a single assessment with all responses | Any logged-in user at tenant |
| PATCH | `/:id/responses/:itemId` | Upsert a response (autosave) | Role-restricted, only while in_progress |
| POST | `/:id/complete` | Finalize scoring, set status to completed | Role-restricted, only while in_progress |
| PATCH | `/:id/archive` | Archive a completed assessment | Role-restricted, completed only |
| PATCH | `/:id/unarchive` | Restore an archived assessment | Role-restricted |

**Auth approach:** new routes will use `req.user.id` from the httpOnly cookie (as `server.js` does for screener upload), not the `x-user-*` headers pattern that `routes/students.js` uses. This is the more secure pattern, and since these are new routes I'd rather start them correctly than inherit the inconsistency.

**Error responses:** generic messages only. Never return `error.message` to the client. Returns like `{ error: 'Server error' }` or `{ error: 'Not authorized' }`. This avoids leaking Postgres constraint-violation text that could contain PII.

---

## Migration 019 — structural sketch

The actual migration code will go inside `createTables()` in `server.js`, formatted exactly like Migrations 007–017.

```js
// Migration 019: Tier 1 Self-Assessment
await pool.query(`
  CREATE TABLE IF NOT EXISTS tier1_assessments (
    -- columns as specified above
  );
  CREATE INDEX IF NOT EXISTS idx_tier1_assessments_tenant ON ...;
  -- etc.
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS tier1_assessment_responses (
    -- columns as specified above
  );
  CREATE INDEX IF NOT EXISTS idx_tier1_responses_assessment ON ...;
`);

// If D8 = yes:
await pool.query(`
  CREATE TABLE IF NOT EXISTS tier1_assessment_events (
    -- columns as specified above
  );
`);

// If D7 = yes (Approach B on recommendations):
// await pool.query(`CREATE TABLE IF NOT EXISTS tier1_assessment_recommendations ...`);

console.log('Migration 019: Tier 1 Self-Assessment tables ready');
```

It runs the next time the server restarts after deployment. Idempotent — running it twice does nothing.

---

## Rollback plan

If something goes wrong and we need to remove these tables (unlikely but worth documenting), the rollback is:

```sql
-- Run in Render Shell psql in reverse dependency order
DROP TABLE IF EXISTS tier1_assessment_events;
DROP TABLE IF EXISTS tier1_assessment_recommendations;  -- if created
DROP TABLE IF EXISTS tier1_assessment_responses;
DROP TABLE IF EXISTS tier1_assessments;
```

Then revert the `server.js` commit that added Migration 019 so it doesn't re-create them on next startup.

No existing tables are modified by this migration. No existing data is touched. Rollback is clean.

---

## Verification after migration runs

After deploying and the server restarts, verify in Render Shell psql:

```sql
\d tier1_assessments
\d tier1_assessment_responses
\d tier1_assessment_events       -- if D8 = yes
\d tier1_assessment_recommendations  -- if D7 = yes
```

Expected result: each `\d` command shows the table structure with all columns, indexes, and constraints. If any command returns "Did not find any relation named..." the migration didn't run — check the Render server logs for errors.

Also check the server log during startup — it should print `Migration 019: Tier 1 Self-Assessment tables ready`.

---

## Open decisions summary (what I need from you)

| # | Decision | My recommendation |
|---|---|---|
| D1 | Permission role list for create/edit | `district_admin`, `school_admin`, `counselor`, `student_support_specialist`, `behavior_specialist`, `mtss_support` (six roles) |
| D2 | `item_bank_version` format | String (`'v1.0'`) |
| D3 | Archive-only or allow hard-delete | Archive-only |
| D4 | `item_id` type | `VARCHAR(10)` with immutability rule |
| D5 | Notes field size | 300 chars |
| D6 | URL validation at DB level | No; client + route validation only |
| D7 | Create `tier1_assessment_recommendations` table | No (Approach A) |
| D8 | Create `tier1_assessment_events` audit table | Yes |

Answer each one (or tell me "all your recommendations are fine") and I'll proceed to writing the actual Migration 019 code + item bank module as the next step.

---

## One thing I want to flag clearly

This migration creates **2 to 4 new tables** depending on D7 and D8, adds no columns to existing tables, and modifies no existing data. It's additive only. The worst-case failure mode is "the new tables exist but the feature doesn't work," which is fixable without a rollback.

This is still an ask-first change per your CLAUDE.md Section 8, and I'm waiting for your approval before writing the code. But the risk profile is about as low as a 4-table migration gets.
