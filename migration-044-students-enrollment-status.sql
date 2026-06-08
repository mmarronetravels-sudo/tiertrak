-- migration-044-students-enrollment-status.sql
--
-- Adds a structured enrollment-state triple to students:
--   - enrollment_status   VARCHAR(20) NOT NULL DEFAULT 'active'
--                         CHECK ('active' | 'graduated' | 'exited')
--   - exit_reason         VARCHAR(50) NULL
--   - exit_date           DATE        NULL
--
-- Purpose: foundation for the EOY grade roll-up (feat/student-grade-
-- rollup-eoy, PR 2). The roll-up needs a structured "graduated /
-- exited" surface that the existing free-text archived_reason column
-- cannot provide. enrollment_status is independent of archived (per
-- audit: 144 archived call sites; derived/computed mirror would be
-- a forbidden cross-cutting refactor under §7). Combinations are
-- meaningful:
--   active   + archived=FALSE  → current student
--   active   + archived=TRUE   → archived for non-terminal reason
--   graduated+ archived=TRUE   → finished terminal grade (set by PR 2)
--   exited   + archived=TRUE   → withdrew / transferred mid-year
--
-- §4B PII posture: enrollment_status / exit_reason / exit_date are
-- per-student state, not new identifying fields. No audit triggers in
-- this migration — the EOY roll-up in PR 2 introduces a dedicated
-- student_grade_rollup_events table (header + per-student child rows,
-- M039/M040/M041/M042 no-FK doctrine) which is the system of record
-- for EOY transitions. Manual /archive endpoint changes in PR 2 will
-- continue to use the existing archived_* columns; if we later want
-- per-mutation audit on enrollment_status, that lands as its own
-- migration with the GUC trigger pattern.
--
-- §5: students is already school-scoped via tenant_id; no new tenant-
-- scoping required. Partial index on (tenant_id, enrollment_status)
-- supports the roll-up's preview scan and future "list graduates for
-- school X" queries without bloating the full b-tree (most rows are
-- the default 'active').
--
-- M034-style failure guard: enrollment_status is NOT NULL with a
-- DEFAULT, so the ALTER backfills existing rows in the same
-- statement and never trips a NOT-NULL-without-default error on
-- non-empty tables. exit_reason and exit_date are nullable.
--
-- Apply as a unit. One BEGIN/COMMIT. Partial replay not supported.
-- Idempotent guards (IF NOT EXISTS) on every object so a partial
-- prior apply does not block re-run.

BEGIN;

-- 1) Three new columns on students.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS enrollment_status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(50) NULL;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS exit_date DATE NULL;

-- 2) CHECK allowlist on enrollment_status. Named so PR 2 + future
-- migrations can reference / extend it explicitly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_enrollment_status_check'
      AND conrelid = 'students'::regclass
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_enrollment_status_check
      CHECK (enrollment_status IN ('active', 'graduated', 'exited'));
  END IF;
END $$;

-- 3) Partial index for the roll-up preview scan + future graduate
-- lookups. WHERE enrollment_status <> 'active' keeps the index small
-- — the dominant row state is 'active' and does not need an index
-- entry here (the existing tenant-scoped indexes cover that path).
CREATE INDEX IF NOT EXISTS idx_students_tenant_enrollment_status
  ON students (tenant_id, enrollment_status)
  WHERE enrollment_status <> 'active';

-- 4) Verification SELECT — matches the M004 / M042 precedent of
-- emitting a row-shape confirmation at migration end so the operator
-- running \i can eyeball the result.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'students'
  AND column_name IN ('enrollment_status', 'exit_reason', 'exit_date')
ORDER BY column_name;

COMMIT;

-- ----------------------------------------------------------------------
-- ROLLBACK (documented; not executed)
-- ----------------------------------------------------------------------
-- Reverses every object added above, in reverse dependency order.
-- Run by hand only if a forward apply must be undone before PR 2
-- depends on these columns. After PR 2 ships, rollback is unsafe —
-- application code will read/write enrollment_status / exit_reason /
-- exit_date and dropping the columns will start producing runtime
-- errors at /api/students endpoints.
--
-- BEGIN;
--
-- DROP INDEX IF EXISTS idx_students_tenant_enrollment_status;
--
-- ALTER TABLE students
--   DROP CONSTRAINT IF EXISTS students_enrollment_status_check;
--
-- ALTER TABLE students DROP COLUMN IF EXISTS exit_date;
-- ALTER TABLE students DROP COLUMN IF EXISTS exit_reason;
-- ALTER TABLE students DROP COLUMN IF EXISTS enrollment_status;
--
-- COMMIT;
