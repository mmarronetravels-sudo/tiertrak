-- Migration 030: Role consolidation — 8 roles -> 7.
--
-- (a) Flips every row with role in ('behavior_specialist',
--     'student_support_specialist', 'mtss_support') to
--     'interventionist'. Per-shape, NOT per-id (S68 §1 doctrine).
--
-- (b) Rewrites users_role_check to permit the 7-role universe:
--     district_admin, school_admin, district_tech_admin, teacher,
--     counselor, interventionist, parent.
--
-- The 'district_tech_admin' role is admitted by the new CHECK but
-- starts with zero users — operators grant it later. Adding the
-- role literal here so PR B2's grant/revoke surface and Session 3's
-- read-side sweep can reference it without a separate CHECK
-- migration.
--
-- Pre-flight (operator's responsibility, not this migration):
--   Run scripts/ops/audit-role-consolidation-targets.sql first.
--   Query 1 counts are informational per the per-shape doctrine —
--   M030 flips whatever rows exist at apply time. Query 3 must
--   return 0; STOP if not.
--
-- Idempotency (explicit, S68 lesson on M029's WHERE-NOT-EXISTS
-- comment that didn't match its mechanism):
--   Step 1 UPDATE is per-shape — its WHERE clause IS the guard.
--     On re-run no rows match (the three legacy roles no longer
--     exist post-first-run), so the UPDATE flips zero rows.
--   Step 2 DO-block guard passes on re-run (no rows hold any
--     role outside the target 7-role universe by construction).
--   Step 3 DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT produces
--     the same final CHECK shape on every run.
--
-- Atomicity: all three steps inside one BEGIN/COMMIT. Either every
-- step lands or none does. Apply as a single \i unit; do not run
-- statements individually (cf. Followup #111).

BEGIN;

-- Step 1: per-shape role collapse. Drift-tolerant (S68 §1 doctrine).
UPDATE users
   SET role = 'interventionist',
       updated_at = CURRENT_TIMESTAMP
 WHERE role IN ('behavior_specialist',
                'student_support_specialist',
                'mtss_support');

-- Step 2: verify zero rows hold roles outside the target 7-role
-- universe before narrowing the CHECK. RAISE EXCEPTION rolls back
-- the whole transaction if reconciliation is incomplete — better
-- than a constraint-violation error during step 3.
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
    FROM users
   WHERE role NOT IN ('district_admin',
                      'school_admin',
                      'district_tech_admin',
                      'teacher',
                      'counselor',
                      'interventionist',
                      'parent');
  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Migration 030: % user row(s) hold roles outside the target 7-role universe — investigate before retrying',
      invalid_count;
  END IF;
END $$;

-- Step 3: DROP + ADD CHECK in one statement-equivalent block.
-- Idempotent on re-run via IF EXISTS guard.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('district_admin',
                  'school_admin',
                  'district_tech_admin',
                  'teacher',
                  'counselor',
                  'interventionist',
                  'parent'));

COMMIT;
