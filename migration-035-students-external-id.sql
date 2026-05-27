-- Migration 035: Add students.external_id column.
--
-- Persists the SIS-issued student identifier (PowerSchool, Skyward,
-- Infinite Campus, Aeries, etc.) on the canonical student record. The
-- customer-facing roster upload template documents External Student ID
-- as an optional column; pre-035 the CSV importer discarded it. Post-035
-- it round-trips into students.external_id and can be referenced by
-- downstream features (e.g., screener-match by external_id rather than
-- by name).
--
-- Sibling field already exists at screener_results.external_student_id
-- (Migration 024 / schema.sql:102), where it is a denormalized upload-
-- time value that survives even when name-matching fails. This migration
-- gives external_id its canonical home on the student record itself.
--
-- Design choices:
--   - TEXT, not VARCHAR(N). Different SIS vendors use different shapes
--     (numeric, alphanumeric, varying lengths). VARCHAR(N) for any N
--     invites the "row rejected because SIS-X uses N+1 chars" failure
--     mode. Matches the sibling screener_results.external_student_id.
--   - Nullable, no DEFAULT. The customer-facing template marks the
--     column optional, manual student adds via POST /students/ do not
--     always carry a SIS ID, and existing rows must be NULL post-
--     migration. NULL means "this student has no SIS-issued ID
--     recorded" — semantically distinct from any sentinel string.
--   - Per-tenant uniqueness via a partial UNIQUE index, not a UNIQUE
--     constraint. Different districts can legitimately have colliding
--     SIS IDs cross-tenant; uniqueness must scope per tenant. The
--     WHERE external_id IS NOT NULL clause allows multiple NULLs (a
--     UNIQUE constraint would not under standard semantics). Same
--     shape pattern as Migration 025's referral_monitoring
--     UNIQUE (tenant_id, student_id) fix — partial-unique on a
--     per-tenant key rules out cross-tenant ON CONFLICT pathways at
--     the SQL layer, defense-in-depth alongside the route-handler
--     tenant scoping.
--   - The partial unique index also serves as the lookup index for
--     SIS-id-based queries. No additional B-tree index needed.
--
-- Idempotency:
--   Step 1: ADD COLUMN IF NOT EXISTS — no-op on re-run.
--   Step 2: CREATE UNIQUE INDEX IF NOT EXISTS — no-op on re-run.
--
-- Atomicity: both steps inside one BEGIN/COMMIT.
--
-- Rollback (manual, run inside a transaction):
--   BEGIN;
--   DROP INDEX IF EXISTS idx_students_tenant_external_id;
--   ALTER TABLE students DROP COLUMN IF EXISTS external_id;
--   COMMIT;

BEGIN;

-- Step 1: Add the column as nullable. No DEFAULT.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Step 2: Per-tenant partial UNIQUE index.
-- Allows multiple NULLs (one per tenant or many per tenant — the
-- WHERE clause excludes NULL rows from the uniqueness check entirely).
-- Enforces "within a tenant, an external_id value appears at most once."
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_tenant_external_id
  ON students (tenant_id, external_id)
  WHERE external_id IS NOT NULL;

COMMIT;
