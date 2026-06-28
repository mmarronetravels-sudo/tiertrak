-- Migration 052: school_academic_calendar table (per-school term + break ranges).
--
-- Foundation for making the scheduled weekly "overdue progress logs" staff email
-- (services/overdueLogsDigest.js) calendar-aware. Today the digest flags an
-- intervention as overdue every single week of the year, including summer and
-- breaks, because it has no notion of when a school is in session. This table
-- records, per school, the date ranges during which a school IS in session
-- ('term' rows) and the date ranges that interrupt a term ('break' rows). A
-- later PR reads it at digest run time to skip a week whose Monday falls outside
-- every term range or inside any break range. A school with NO rows here falls
-- back to an env-driven default break window (mid-June -> mid-Aug) rather than
-- the current flag-forever behavior -- that fallback lives in the digest, not in
-- this table.
--
-- This is mutable CONFIG, not an append-only ledger/audit. It keeps the
-- M031/M046/M047/M048/M049/M050/M051 house style: BIGSERIAL PK, denormalized
-- integer references, NO foreign keys, single BEGIN/COMMIT, IF-NOT-EXISTS,
-- COMMENT ON TABLE, and integers/dates (plus one optional non-PII label) only.
--
-- Period model (multi-term by design):
--   - A 'term' row is a date range during which the school is in session
--     (a semester, a quarter, a trimester). A school may have SEVERAL.
--   - A 'break' row is a date range that interrupts the session (winter break,
--     spring break, a single holiday). A school may have several of these too.
--   - "In session for week W" (computed in the digest, not here) means: W's
--     Monday falls inside some 'term' row AND inside no 'break' row.
--   There is intentionally NO uniqueness on (school_tenant_id, period_type):
--   ranges are additive, so multiple term rows and multiple break rows coexist.
--
-- §5 (multi-tenancy): school_tenant_id is the §5 school-tenant identifier and is
-- the scope that matters; it is NOT NULL and INDEXED (idx ..._school). district_id
-- is denormalized for the district-scoped read path and INDEXED (idx ..._district),
-- but is NOT sufficient on its own to scope a row -- the school identity is.
--   Composite-FK note (§5 Migration-021 pattern): intentionally NOT applied.
--   That pattern guards a CHILD row that must live within a single parent scope
--   by composing the child FK against the parent's (id, scope_id). Here each row
--   is a standalone config row keyed directly by one school_tenant_id; there is
--   no parent/child relationship to guard. As with M050/M051, "this school
--   belongs to the caller's access set" is enforced at the ROUTE layer (the
--   school_admin endpoint resolves the target from resolveAccessibleTenantIds;
--   the operator endpoint validates the tenant exists and is type='school'), not
--   by a DB constraint. This route-layer-binding decision is flagged in
--   docs/features/school-calendar-overdue-aware-spec.md for the
--   tenant-isolation-auditor to scrutinize when the endpoints land. No foreign
--   keys at all, per the M031..M051 house style.
--
-- §4B (PII): no student/staff names, emails, or intervention data. Columns are
-- integer references, dates, an optional descriptive label (e.g. 'Fall Semester',
-- 'Winter Break'), and timestamps. The label is convenience metadata for the
-- management UI ONLY; the digest never logs it and never emails it. It is not
-- PII, but it is held to the same no-leak posture as the rest of this surface.
--
-- Columns:
--   id                BIGSERIAL PK     -- house style (M050/M051 precedent)
--   school_tenant_id  INTEGER NOT NULL -- §5 school identifier. Indexed.
--   district_id       INTEGER          -- denormalized district ref; NULL for
--                                         single-school/legacy tenants (every
--                                         prod tenant today per M029). Indexed.
--   period_type       VARCHAR(10) NOT NULL -- 'term' | 'break' (chk_period_type)
--   start_date        DATE NOT NULL    -- inclusive range start
--   end_date          DATE NOT NULL    -- inclusive range end (chk_date_order)
--   label             VARCHAR(60)      -- optional, non-PII; never logged/emailed
--   created_by        INTEGER          -- actor user id at first insert (no FK)
--   updated_by        INTEGER          -- actor user id of the last UPDATE
--   created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--   updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--
-- Idempotency:
--   Step 1 CREATE TABLE IF NOT EXISTS    -- same final shape every run.
--   Step 2 COMMENT ON TABLE              -- set/overwrite; idempotent.
--   Step 3 CREATE INDEX IF NOT EXISTS    -- §5 school-scope read index.
--   Step 4 CREATE INDEX IF NOT EXISTS    -- §5 district-scope read index.
--
-- Atomicity: all steps inside one BEGIN/COMMIT. Either every step lands or none
-- does. Apply as a single \i unit; do not run statements individually
-- (cf. Followup #111).

BEGIN;

-- Step 1: per-school academic calendar (term + break date ranges). Denormalized
-- integer references + dates + an optional label; no FKs by design (M031..M051
-- house style). The CHECKs enforce a valid period_type and a non-inverted range.
CREATE TABLE IF NOT EXISTS school_academic_calendar (
  id                BIGSERIAL PRIMARY KEY,
  school_tenant_id  INTEGER NOT NULL,
  district_id       INTEGER,
  period_type       VARCHAR(10) NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  label             VARCHAR(60),
  created_by        INTEGER,
  updated_by        INTEGER,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_school_academic_calendar_period_type
    CHECK (period_type IN ('term', 'break')),
  CONSTRAINT chk_school_academic_calendar_date_order
    CHECK (end_date >= start_date)
);

-- Step 2: table comment captures the calendar purpose, the multi-term/break
-- model, the no-FK / no-PII doctrine, and the label-never-logged rule inline so
-- future reviewers see it at \d+ time.
COMMENT ON TABLE school_academic_calendar IS
  'Per-school academic calendar (term + break date ranges) for the calendar-aware weekly overdue-progress-log staff email (services/overdueLogsDigest.js). period_type is term (in session) or break (interrupts a term); rows are additive, so multiple terms and breaks per school coexist (no uniqueness on school_tenant_id, period_type). A week is in session when its Monday falls inside some term row and inside no break row (computed in the digest). Schools with no rows fall back to an env-driven default break window in the digest. school_tenant_id (NOT NULL, indexed) is the section-5 school identifier; district_id (indexed, nullable) is denormalized for district reads. Denormalized integer references with NO foreign keys; school-to-caller binding is enforced at the route layer (see migration-052 header and docs/features/school-calendar-overdue-aware-spec.md). Stores no student/staff names, emails, or intervention data; the optional label is non-PII UI metadata that the digest never logs or emails.';

-- Step 3: §5 school-scope read index ("what is this school's calendar?"). This
-- is the section-5-required index on the school identifier.
CREATE INDEX IF NOT EXISTS idx_school_academic_calendar_school
  ON school_academic_calendar (school_tenant_id);

-- Step 4: §5 district-scope read index, for a future district-scoped read of
-- calendars (district inheritance is deferred; the index is added now so the
-- denormalized district_id column is queryable without a later migration).
CREATE INDEX IF NOT EXISTS idx_school_academic_calendar_district
  ON school_academic_calendar (district_id);

COMMIT;
