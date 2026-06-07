-- Migration 043: Reconcile prod's ea_caseload_students with M041's intended
-- shape; reassert users_role_check at M041's 8-role VALID universe.
--
-- WHY THIS MIGRATION EXISTS (not a re-statement of M041):
--   M041 declared three composite FKs inline inside CREATE TABLE
--   ea_caseload_students. Prod was found to have the table + columns +
--   indexes + the simple created_by FK present, but the three composite
--   FKs absent — consistent with a pre-existing table shell having been
--   created on prod before M041's \i ran, causing M041 Step 2's
--   CREATE TABLE IF NOT EXISTS to silently skip the whole CREATE
--   (composite FKs included). Re-running M041 will NOT recover the
--   composite FKs for the same reason — IF NOT EXISTS skips on
--   name match, not shape match.
--
--   Step 1 below adds the three composite FKs via ALTER TABLE ADD
--   CONSTRAINT with explicit names, each guarded by a pg_constraint
--   existence check that matches on REFERENCING-COLUMN-SET, not name.
--   The column-set guard makes this migration a true no-op on fresh
--   tenant DBs where M041's inline FKs did land — those FKs are
--   anonymous (PG auto-named), so a name-only guard would not see
--   them and we'd end up with duplicate FKs enforcing the same
--   relationship. The column-set guard sees the relationship itself.
--
--   Step 2 reasserts users_role_check at the 8-role VALID shape
--   defined by M041 Step 1. This is required because server.js's
--   boot DDL block (mislabeled "Migration 017", actually a 7-role
--   NOT VALID assertion) has been continuously reverting the
--   constraint back to the 7-role NOT VALID universe on every server
--   restart. The companion server.js diff in this PR deletes that
--   boot DDL, eliminating the revert path permanently.
--
-- APPLY ORDER on the day of: deploy the server.js boot-DDL deletion
-- FIRST, then \i this migration. The DROP+ADD on users_role_check is
-- inside BEGIN/COMMIT so neither order produces a window with no role
-- CHECK on a stable server. The reason deploy-first matters is that
-- any Render restart between this migration's apply and the server.js
-- deploy would re-execute the boot DDL and revert the widened
-- constraint, defeating Step 2.
--
-- IDEMPOTENCY:
--   - Step 1 DO blocks: each FK ADD is guarded by an exists-check that
--     matches on (conrelid, contype='f', confrelid, conkey, confkey).
--     Re-running this migration on a fully-reconciled prod DB OR on
--     a fresh tenant DB where M041's anonymous FKs already landed is
--     a no-op for Step 1.
--   - Step 2 DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT:
--     unconditional rebuild, but the final shape is deterministic.
--     The 0-row state in prod (S115 guardrail) means VALIDATION
--     scan is trivial.
--
-- PREREQUISITES (verified in prod via pg_constraint pre-check on
-- 2026-06-07; all three UNIQUE constraints below were confirmed
-- present with correct definitions):
--   - tenants_id_district_unique on tenants(id, district_id)         [M028]
--   - users_id_district_unique  on users(id, district_id)            [M028]
--   - students_id_tenant_unique on students(id, tenant_id)           [M021]
--
-- PRE-FLIGHT (operator responsibility):
--   SELECT COUNT(*) FROM ea_caseload_students;
--   -- Expected: 0 (S115 prod-seeding guardrail held).
--   -- Non-zero rows CAN abort the migration: composite FK C
--   -- (student_id, school_tenant_id) -> students(id, tenant_id) has
--   -- BOTH local columns declared NOT NULL on ea_caseload_students,
--   -- so MATCH SIMPLE never skips — every row is validated against
--   -- students(id, tenant_id). If any row references a
--   -- (student_id, school_tenant_id) pair absent from students, the
--   -- ADD CONSTRAINT will abort and roll back the whole transaction.
--   -- Composite FKs A and B (district_id NULLABLE) skip via MATCH
--   -- SIMPLE when district_id IS NULL, so they would not abort
--   -- legacy-EA rows. Moot at 0 rows; the abort risk only matters if
--   -- seeding happened ahead of this migration.
--
-- ATOMICITY: all steps inside one BEGIN/COMMIT. Either every step
-- lands or none does.

BEGIN;

-- =========================================================
-- Step 1a: composite FK (ea_user_id, district_id) -> users(id, district_id)
-- Mirrors M028 line 82-83 + M038 line 92-93. MATCH SIMPLE (PG default)
-- skips enforcement when district_id IS NULL (legacy single-tenant EA).
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid  = 'ea_caseload_students'::regclass
       AND c.contype   = 'f'
       AND c.confrelid = 'users'::regclass
       AND c.conkey  = ARRAY[
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'ea_caseload_students'::regclass
                  AND attname  = 'ea_user_id'),
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'ea_caseload_students'::regclass
                  AND attname  = 'district_id')
            ]::int2[]
       AND c.confkey = ARRAY[
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'users'::regclass
                  AND attname  = 'id'),
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'users'::regclass
                  AND attname  = 'district_id')
            ]::int2[]
  ) THEN
    ALTER TABLE ea_caseload_students
      ADD CONSTRAINT ea_caseload_students_ea_user_district_fkey
      FOREIGN KEY (ea_user_id, district_id)
      REFERENCES users(id, district_id) ON DELETE CASCADE;
  END IF;
END $$;

-- =========================================================
-- Step 1b: composite FK (school_tenant_id, district_id) -> tenants(id, district_id)
-- Mirrors M028 line 84-85 + M038 line 94-95.
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid  = 'ea_caseload_students'::regclass
       AND c.contype   = 'f'
       AND c.confrelid = 'tenants'::regclass
       AND c.conkey  = ARRAY[
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'ea_caseload_students'::regclass
                  AND attname  = 'school_tenant_id'),
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'ea_caseload_students'::regclass
                  AND attname  = 'district_id')
            ]::int2[]
       AND c.confkey = ARRAY[
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'tenants'::regclass
                  AND attname  = 'id'),
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'tenants'::regclass
                  AND attname  = 'district_id')
            ]::int2[]
  ) THEN
    ALTER TABLE ea_caseload_students
      ADD CONSTRAINT ea_caseload_students_school_district_fkey
      FOREIGN KEY (school_tenant_id, district_id)
      REFERENCES tenants(id, district_id) ON DELETE CASCADE;
  END IF;
END $$;

-- =========================================================
-- Step 1c: composite FK (student_id, school_tenant_id) -> students(id, tenant_id)
-- The §5 M021-doctrine cross-school rejection layer. Fires regardless
-- of district_id NULL/NOT NULL because it does not involve district_id;
-- both local columns are NOT NULL so MATCH SIMPLE never skips.
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid  = 'ea_caseload_students'::regclass
       AND c.contype   = 'f'
       AND c.confrelid = 'students'::regclass
       AND c.conkey  = ARRAY[
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'ea_caseload_students'::regclass
                  AND attname  = 'student_id'),
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'ea_caseload_students'::regclass
                  AND attname  = 'school_tenant_id')
            ]::int2[]
       AND c.confkey = ARRAY[
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'students'::regclass
                  AND attname  = 'id'),
              (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'students'::regclass
                  AND attname  = 'tenant_id')
            ]::int2[]
  ) THEN
    ALTER TABLE ea_caseload_students
      ADD CONSTRAINT ea_caseload_students_student_school_fkey
      FOREIGN KEY (student_id, school_tenant_id)
      REFERENCES students(id, tenant_id) ON DELETE CASCADE;
  END IF;
END $$;

-- =========================================================
-- Step 2: reassert users_role_check at M041's 8-role VALID shape.
-- Identical literal list to M041 lines 214-221. No NOT VALID clause —
-- the constraint must validate existing rows. S115 guardrail means
-- there are no education_assistant rows yet; even if there were,
-- the wide universe admits them so validation succeeds.
-- =========================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('district_admin',
                  'school_admin',
                  'district_tech_admin',
                  'teacher',
                  'counselor',
                  'interventionist',
                  'parent',
                  'education_assistant'));

COMMIT;
