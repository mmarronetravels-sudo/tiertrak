-- Migration 024: Multi-screener support foundation
--
-- Adds assessment_type to screener_results and reshapes uniqueness so the
-- same student can have rows for multiple assessment vendors (STAR + MAP +
-- DIBELS, etc.) in the same school year/period/subject. Reconciles the
-- table into schema.sql via CREATE TABLE IF NOT EXISTS — the table was
-- previously applied out-of-band on prod and never committed to the repo.
-- Migration 024 makes the schema self-documenting for the first time.
--
-- Backfill mapping (Owner direction, Session 45):
--   tenant_id=4  (Summit Learning Charter) → 'STAR'
--   tenant_id=10 (Mazapan School)          → 'MAP'
--   tenant_id=9  (Humble ISD Demo)         → 'STAAR' (deferred but tagged
--                                            so existing rows are correctly
--                                            labeled when STAAR support
--                                            lights up later)
--   tenant_id=8  (Molalla River Academy)   → no data expected
--   any other tenant                       → 'STAR' (defensive fallback —
--                                            STAR is the only vendor any
--                                            existing UI ever produced)
--
-- Idempotent: every step uses IF EXISTS / IF NOT EXISTS or guards by
-- inspecting current state. Safe to re-run.

-- Step 1: Reconcile table existence. CREATE TABLE IF NOT EXISTS is a
-- no-op on prod where the table already exists, but lets fresh dev DBs
-- and any future prod restore declare the table without a separate
-- bootstrap step. Mirror of the schema.sql block added in this migration.
CREATE TABLE IF NOT EXISTS screener_results (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    student_first_name TEXT NOT NULL,
    student_last_name TEXT NOT NULL,
    external_student_id TEXT,
    grade TEXT,
    screener_name TEXT,
    subject TEXT NOT NULL,
    screening_period TEXT NOT NULL,
    school_year TEXT NOT NULL,
    test_date DATE,
    scaled_score INTEGER,
    percentile_rank INTEGER,
    benchmark_category TEXT,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Add assessment_type column (nullable initially so backfill can
-- run without violating NOT NULL). Idempotent.
ALTER TABLE screener_results
  ADD COLUMN IF NOT EXISTS assessment_type TEXT;

-- Step 3: Backfill assessment_type per tenant. Skip rows that already
-- have a value (defensive — re-run safety, and avoids overwriting any
-- value that landed via an out-of-band write between this migration's
-- column-add and backfill).
UPDATE screener_results SET assessment_type = 'STAR'  WHERE assessment_type IS NULL AND tenant_id = 4;
UPDATE screener_results SET assessment_type = 'STAAR' WHERE assessment_type IS NULL AND tenant_id = 9;
UPDATE screener_results SET assessment_type = 'MAP'   WHERE assessment_type IS NULL AND tenant_id = 10;
-- Defensive catch-all for any other tenant_id that turns out to have
-- existing data (test fixtures, future expansion, unknown). STAR is the
-- only vendor any existing upload UI ever produced, so it's the
-- closest-to-truth default.
UPDATE screener_results SET assessment_type = 'STAR'  WHERE assessment_type IS NULL;

-- Step 4: Enforce NOT NULL. Will fail loudly if Step 3 left any NULLs
-- (which it shouldn't given Step 3's catch-all). The failure is the
-- correct behavior — surfaces unexpected NULLs immediately rather than
-- letting them propagate.
ALTER TABLE screener_results
  ALTER COLUMN assessment_type SET NOT NULL;

-- Step 5: Drop the old uniqueness constraint. Its exact name depends on
-- how the table was created out-of-band on prod (anonymous inline UNIQUE
-- constraints get auto-named with a length-truncated pattern that's not
-- safe to predict). Discover dynamically by inspecting pg_constraint
-- for a UNIQUE constraint that exactly covers the old column tuple.
DO $$
DECLARE
    old_constraint_name TEXT;
BEGIN
    SELECT conname INTO old_constraint_name
    FROM pg_constraint c
    WHERE c.conrelid = 'screener_results'::regclass
      AND c.contype  = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM unnest(c.conkey) col(num)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = col.num
      ) = ARRAY['school_year','screening_period','student_id','subject','tenant_id']
    LIMIT 1;

    IF old_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE screener_results DROP CONSTRAINT %I', old_constraint_name);
        RAISE NOTICE 'Dropped old uniqueness constraint: %', old_constraint_name;
    ELSE
        RAISE NOTICE 'No old uniqueness constraint found on (tenant_id, student_id, subject, screening_period, school_year) — assuming fresh DB or already migrated.';
    END IF;
END $$;

-- Step 6: Add the new uniqueness constraint with explicit name and
-- assessment_type included. Use NULLS NOT DISTINCT if PG 15+ so
-- unmatched-name uploads (student_id IS NULL) UPSERT correctly instead
-- of duplicating on every re-upload — closes a pre-existing
-- data-integrity bug surfaced during the PR1 audit (Followup TBD if
-- PG < 15). Idempotent: skip if the new constraint already exists.
DO $$
DECLARE
    pg_major INT;
    new_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'screener_results'::regclass
        AND conname = 'screener_results_unique_per_period_assessment'
    ) INTO new_exists;

    IF new_exists THEN
        RAISE NOTICE 'New uniqueness constraint already exists — skipping.';
        RETURN;
    END IF;

    SELECT current_setting('server_version_num')::INT / 10000 INTO pg_major;

    IF pg_major >= 15 THEN
        EXECUTE 'ALTER TABLE screener_results
                 ADD CONSTRAINT screener_results_unique_per_period_assessment
                 UNIQUE NULLS NOT DISTINCT
                 (tenant_id, student_id, assessment_type, subject, screening_period, school_year)';
        RAISE NOTICE 'Added UNIQUE NULLS NOT DISTINCT constraint (PG %).', pg_major;
    ELSE
        EXECUTE 'ALTER TABLE screener_results
                 ADD CONSTRAINT screener_results_unique_per_period_assessment
                 UNIQUE
                 (tenant_id, student_id, assessment_type, subject, screening_period, school_year)';
        RAISE WARNING 'Postgres % detected — UNIQUE constraint uses default NULLS DISTINCT semantics. Unmatched-name UPSERTs will continue to duplicate on re-upload. File followup for post-upgrade cleanup.', pg_major;
    END IF;
END $$;

-- Step 7: Index covering the new dashboard query shape (tenant filter +
-- year/period/subject/assessment_type combinations from the upcoming
-- multi-assessment dashboard tabs).
CREATE INDEX IF NOT EXISTS idx_screener_results_dashboard_filters
  ON screener_results (tenant_id, school_year, screening_period, subject, assessment_type);

-- Verify-SELECTs: column landed, NOT NULL set, new uniqueness constraint
-- exists, index exists, and the post-backfill distribution by tenant
-- looks right (Owner spot-checks tenant 4 = STAR, tenant 9 = STAAR,
-- tenant 10 = MAP).

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'screener_results'
  AND column_name = 'assessment_type';

SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.conrelid = 'screener_results'::regclass
  AND con.contype = 'u'
ORDER BY con.conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'screener_results'
  AND indexname = 'idx_screener_results_dashboard_filters';

SELECT tenant_id, assessment_type, COUNT(*) AS row_count
FROM screener_results
GROUP BY tenant_id, assessment_type
ORDER BY tenant_id, assessment_type;
