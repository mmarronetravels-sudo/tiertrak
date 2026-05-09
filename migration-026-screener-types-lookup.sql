-- Migration 026: screener_types lookup table
--
-- Precursor to feat/multi-screener-upload (PR2 of multi-screener). Adds a
-- canonical lookup table for the universal screeners TierTrak supports.
-- Adding a new screener type is a SQL change (insert a row here); v1 does
-- not expose tenant-configurable screener registration.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, ADD-by-INSERT-ON-CONFLICT, and a
-- transactional wrapper. Safe to re-run against any environment.
--
-- Design note — no FK from screener_results.assessment_type to
-- screener_types.name in v1. Membership is enforced in the route handler
-- (routes/screener.js) at upload time, not at the SQL layer. Reasons:
--   * The seed list is intentionally narrow in v1 (STAR only) and will
--     grow as real CSV samples land for the deferred vendors. An FK now
--     would force a 2-step coordination on every type addition (insert
--     lookup row, then existing rows can use it) and would require all
--     existing screener_results rows to validate against the lookup at
--     constraint-add time.
--   * Migration 024 backfill maps tenants to assessment_type values
--     including 'STAAR' (UI-deferred) — values the lookup table will not
--     seed in v1. An FK would reject those rows.
-- A future migration may add the FK once the seed list stabilizes and any
-- existing-row reconciliation is planned. Not an oversight.
--
-- Seed scope — STAR only in v1. The four other vendors named in repo
-- comments (MAP, DIBELS, DIBELS Spelling, iReady) are deferred to a
-- follow-up migration pending real CSV exports for column-spec accuracy.
-- The repo's existing client-side parser (frontend ScreenerUploadModal.jsx
-- lines 56-77) is STAR-only; deriving column specs for the other vendors
-- without sample CSVs would mean guessing, and per-row validation in PR2
-- depends on these specs being correct.
--
-- expected_columns shape (JSONB per row): { "required": [...],
-- "optional": [...] }. `required` columns block the upload if missing
-- from the CSV header (matches existing client-side behavior). `optional`
-- documents columns the parser knows how to map; absence does not fail
-- the row.

BEGIN;

-- Step 1: Create the lookup table. Idempotent via IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS screener_types (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    expected_columns JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Seed STAR. Idempotent via ON CONFLICT (name) DO NOTHING — a
-- re-run leaves the existing row alone. Column spec derived from the
-- existing client-side parser in frontend/src/components/Modals/
-- ScreenerUploadModal.jsx lines 56-77 (required: 'Student',
-- 'Benchmark Category Level'; optional/recognized: 'Grade', 'Test Date',
-- 'SS (Star Unified)', 'PR').
INSERT INTO screener_types (name, display_name, expected_columns)
VALUES (
    'STAR',
    'STAR (Renaissance)',
    '{"required": ["Student", "Benchmark Category Level"], "optional": ["Grade", "Test Date", "SS (Star Unified)", "PR"]}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Verify-SELECTs: table exists with the expected shape and STAR seed
-- landed. Mirrors migration-024's verify-block pattern.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'screener_types'
ORDER BY ordinal_position;

SELECT id, name, display_name, expected_columns
FROM screener_types
ORDER BY id;
