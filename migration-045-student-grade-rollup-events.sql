-- migration-045-student-grade-rollup-events.sql
--
-- Adds the audit substrate for the EOY grade roll-up (feat/student-
-- grade-rollup-eoy, PR 2). Header + children split:
--
--   student_grade_rollup_runs        -- one row per roll-up run
--   student_grade_rollup_event_rows  -- one row per affected student
--
-- Deviation from M041/M042 (flat per-event audit): the roll-up is a
-- batch operation. A run-identity is required so (a) undo can
-- reverse a single run atomically, (b) the preview_snapshot_hash that
-- binds preview->commit (HMAC contract in PR 2) has a place to live,
-- (c) operator-facing "last run for school X" lookups remain a
-- single-row read. The split is justified by these run-level facts;
-- the M039-M042 no-FK doctrine is preserved across both tables.
--
-- §4B PII posture: no PII columns. student_id is an internal integer
-- identifier already scoped by tenant_id/school_tenant_id. No names,
-- emails, DOBs, or free-text notes. exit_reason is route-layer
-- allowlist-validated VARCHAR(50) before INSERT (mirrors archived_
-- reason precedent at routes/students.js:943-953). No DB CHECK on
-- exit_reason -- route is authoritative.
--
-- §5: both tables are school-scoped. Every row carries
-- school_tenant_id (the school the roll-up targeted) AND district_id
-- (denormalized for district-scoped queries). Indexes on both.
-- M041 audit-table shape (ea_caseload_students_audit) is the
-- structural precedent: integer-typed scope columns, no FKs, audit
-- rows survive deletion of users/students for FERPA §99.32
-- record-of-disclosure retention.
--
-- Naming choice: school_tenant_id matches M040 (mtss_coordinators_
-- audit) and M041 (ea_caseload_students_audit). M042 (students_
-- demographics_audit) calls the same scope tenant_id because that
-- table audits a single student per row with no join ambiguity. The
-- roll-up's event rows are likewise single-student per row but are
-- conceptually "for a school within a district" (the run targets one
-- school), so school_tenant_id is used for explicitness consistent
-- with M040/M041 phrasing. This is a documented divergence from M042.
--
-- No-FK doctrine (M039-M042): student_grade_rollup_event_rows.run_id
-- references student_grade_rollup_runs.id BY CONVENTION ONLY. Not a
-- DB foreign key. Children must outlive their header if the header
-- is ever purged by retention policy. The application creates header
-- first inside one transaction, then inserts children with the
-- returned id -- referential consistency is enforced at write time,
-- not at the catalog.
--
-- M034-style failure guard: all new columns are either NOT NULL with
-- a sensible DEFAULT or nullable. No backfill of existing rows is
-- required (both tables are new and start empty).
--
-- Apply as a unit. One BEGIN/COMMIT. Partial replay not supported.
-- Idempotent guards (IF NOT EXISTS, conditional DO blocks) on every
-- object so a partial prior apply does not block re-run.

BEGIN;

-- 1) Header table: one row per roll-up run.
CREATE TABLE IF NOT EXISTS student_grade_rollup_runs (
    id                      BIGSERIAL PRIMARY KEY,
    district_id             INTEGER       NOT NULL,
    target_school_tenant_id INTEGER       NOT NULL,
    terminal_grade          VARCHAR(20)   NOT NULL,
    actor_user_id           INTEGER       NOT NULL,
    preview_snapshot_hash   VARCHAR(64)   NOT NULL,
    total_promoted          INTEGER       NOT NULL DEFAULT 0,
    total_graduated         INTEGER       NOT NULL DEFAULT 0,
    total_exited            INTEGER       NOT NULL DEFAULT 0,
    started_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ   NULL,
    undone_at               TIMESTAMPTZ   NULL,
    undone_by_user_id       INTEGER       NULL
);

-- 1a) Header indexes: "last run for school X" + "recent runs in
-- district Y". Both are common operator-facing reads.
CREATE INDEX IF NOT EXISTS idx_student_grade_rollup_runs_school_started
  ON student_grade_rollup_runs (target_school_tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_grade_rollup_runs_district_started
  ON student_grade_rollup_runs (district_id, started_at DESC);

-- 2) Children table: one row per affected student per run.
-- run_id is denormalized -- NOT a FK -- per M039-M042 doctrine.
CREATE TABLE IF NOT EXISTS student_grade_rollup_event_rows (
    id                BIGSERIAL PRIMARY KEY,
    run_id            BIGINT       NOT NULL,
    student_id        INTEGER      NOT NULL,
    school_tenant_id  INTEGER      NOT NULL,
    district_id       INTEGER      NOT NULL,
    actor_user_id     INTEGER      NOT NULL,
    old_grade         VARCHAR(20)  NOT NULL,
    new_grade         VARCHAR(20)  NULL,
    action            VARCHAR(16)  NOT NULL,
    exit_reason       VARCHAR(50)  NULL,
    occurred_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 2a) action allowlist. 'unclassified' is intentionally excluded:
-- the commit endpoint blocks when unclassified rows are present, so
-- only successfully-classified actions are ever stored.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_grade_rollup_event_rows_action_check'
      AND conrelid = 'student_grade_rollup_event_rows'::regclass
  ) THEN
    ALTER TABLE student_grade_rollup_event_rows
      ADD CONSTRAINT student_grade_rollup_event_rows_action_check
      CHECK (action IN ('promoted', 'graduated', 'exited'));
  END IF;
END $$;

-- 2b) Child indexes.
--   - (run_id): "all children of run X" -- undo + per-run readback.
--   - (student_id, occurred_at DESC): "audit history for student X".
--   - (school_tenant_id, occurred_at DESC): "recent rollup activity
--     in school X" for district-admin dashboards.
CREATE INDEX IF NOT EXISTS idx_student_grade_rollup_event_rows_run
  ON student_grade_rollup_event_rows (run_id);

CREATE INDEX IF NOT EXISTS idx_student_grade_rollup_event_rows_student
  ON student_grade_rollup_event_rows (student_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_grade_rollup_event_rows_school
  ON student_grade_rollup_event_rows (school_tenant_id, occurred_at DESC);

-- 3) Verification SELECT -- matches the M042/M044 precedent of
-- emitting a column-shape confirmation at migration end so the
-- operator running \i can eyeball the result.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('student_grade_rollup_runs', 'student_grade_rollup_event_rows')
ORDER BY table_name, ordinal_position;

-- Index verification.
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE tablename IN ('student_grade_rollup_runs', 'student_grade_rollup_event_rows')
ORDER BY tablename, indexname;

COMMIT;

-- ----------------------------------------------------------------------
-- ROLLBACK (documented; not executed)
-- ----------------------------------------------------------------------
-- Reverses every object added above, in reverse dependency order.
-- Run by hand only if a forward apply must be undone before PR 2
-- ships. After PR 2 ships, rollback is unsafe -- application code
-- will read/write both tables and dropping them will start producing
-- runtime errors at /api/rollups/* endpoints. After any production
-- roll-up run, rollback also destroys the FERPA §99.32 audit record
-- of that run and must not be performed without compliance review.
--
-- BEGIN;
--
-- DROP INDEX IF EXISTS idx_student_grade_rollup_event_rows_school;
-- DROP INDEX IF EXISTS idx_student_grade_rollup_event_rows_student;
-- DROP INDEX IF EXISTS idx_student_grade_rollup_event_rows_run;
--
-- ALTER TABLE student_grade_rollup_event_rows
--   DROP CONSTRAINT IF EXISTS student_grade_rollup_event_rows_action_check;
--
-- DROP TABLE IF EXISTS student_grade_rollup_event_rows;
--
-- DROP INDEX IF EXISTS idx_student_grade_rollup_runs_district_started;
-- DROP INDEX IF EXISTS idx_student_grade_rollup_runs_school_started;
--
-- DROP TABLE IF EXISTS student_grade_rollup_runs;
--
-- COMMIT;
