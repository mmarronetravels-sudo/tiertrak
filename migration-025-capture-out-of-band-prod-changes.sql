-- Migration 025: Capture out-of-band prod schema changes
--
-- This migration does NOT introduce new schema. It captures three
-- changes that already exist in prod (applied directly via psql,
-- never written as migration files) and brings the repo + local
-- environments into alignment with prod.
--
-- Closes Followups #57 (users.password_hash NOT NULL drift) and
-- #59 (rm.notes / si.log_frequency missing locally).
--
-- Every section is idempotent so this migration is safe to apply
-- against prod as well — each change is a no-op where the column
-- or constraint already exists.

-- ---------------------------------------------------------------
-- Section 1: users.password_hash — drop NOT NULL constraint.
--
-- Prod allows NULL on this column to support token-only parent
-- accounts that exist before the parent has set a password (the
-- parent-link flow creates the user row at invite time and
-- finalizes the password later). Local was patched ad-hoc during
-- Session 47 to unblock smoke testing; this migration captures
-- that change properly.
--
-- Idempotent: ALTER COLUMN ... DROP NOT NULL is a no-op if the
-- column is already nullable.
-- ---------------------------------------------------------------
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- ---------------------------------------------------------------
-- Section 2: referral_monitoring.notes column + UNIQUE constraint
-- on student_id.
--
-- Prod has both. routes/students.js relies on them:
--   - SELECT rm.notes AS monitoring_notes  (line 239)
--   - GROUP BY rm.notes                    (line 256)
--   - INSERT ... ON CONFLICT (student_id) DO UPDATE SET notes = $4
--                                          (lines 290-296)
-- The ON CONFLICT clause requires UNIQUE(student_id); the SELECT/
-- INSERT require a notes column. Neither was captured in any prior
-- migration file or in the server.js bootstrap.
--
-- Idempotency:
--   - ADD COLUMN IF NOT EXISTS — built-in.
--   - UNIQUE constraint — wrapped in a DO block with a column-based
--     pg_index existence check (see comment above the block).
-- ---------------------------------------------------------------
ALTER TABLE referral_monitoring ADD COLUMN IF NOT EXISTS notes TEXT;

-- Idempotent UNIQUE-on-student_id add. Column-based existence
-- check (not name-based) because prod's constraint, if any, may
-- have been added manually with a non-default name, and we want
-- this migration to no-op cleanly in either case. pg_index also
-- catches bare unique indexes (CREATE UNIQUE INDEX with no backing
-- constraint), which a pg_constraint-only check would miss.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = c.oid
      AND a.attnum = ANY(i.indkey)
    WHERE c.relname = 'referral_monitoring'
      AND a.attname = 'student_id'
      AND i.indisunique = true
      AND array_length(i.indkey, 1) = 1
  ) THEN
    ALTER TABLE referral_monitoring
      ADD CONSTRAINT referral_monitoring_student_id_key
      UNIQUE (student_id);
  END IF;
END $$;

-- ---------------------------------------------------------------
-- Section 3: student_interventions.log_frequency column.
--
-- Prod has this column; local does not. Application code that
-- references it:
--   - routes/interventions.js:97   destructures log_frequency from
--                                   the request body, default 'weekly'
--   - routes/interventions.js:116  INSERT (..., log_frequency, ...)
--   - routes/weeklyProgress.js:155 SELECT si.log_frequency
--
-- Default 'weekly' matches the application's default in
-- routes/interventions.js:97. Idempotent via IF NOT EXISTS.
--
-- NOTE: Followup #65 will investigate whether expected_frequency
-- (added in migration-005) is now dead and should be dropped.
-- That cleanup is OUT OF SCOPE for this migration — this file
-- captures prod state as-is, no removals.
-- ---------------------------------------------------------------
ALTER TABLE student_interventions
  ADD COLUMN IF NOT EXISTS log_frequency VARCHAR(20) DEFAULT 'weekly';
