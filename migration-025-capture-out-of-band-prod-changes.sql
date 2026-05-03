-- Migration 025: Capture out-of-band prod schema changes (#57, #59)
-- with the corrected referral_monitoring UNIQUE shape.
--
-- This migration replaces the closed PR #53 attempt. PR #53 captured
-- the same three out-of-band prod schema changes but used
-- UNIQUE (student_id) on referral_monitoring; tenant-isolation-auditor
-- BLOCKED that PR because — combined with the pre-existing
-- routes/students.js handlers that trusted req.body.tenant_id —
-- UNIQUE (student_id) lets a Tenant A user overwrite a Tenant B row
-- via INSERT … ON CONFLICT (student_id) DO UPDATE.
--
-- The corrected shape is UNIQUE (tenant_id, student_id), matching
-- the schema's pattern at users (schema.sql:24, UNIQUE(tenant_id,
-- email)) and screener_results (schema.sql:97, UNIQUE on
-- (tenant_id, student_id, ...)). Under this shape, the cross-tenant
-- ON CONFLICT pathway fails at the SQL layer, providing
-- defense-in-depth alongside the route-handler tenant checks landed
-- in the same PR (sec/students-referral-monitoring).
--
-- All sections idempotent — safe to apply against prod (which
-- currently has UNIQUE(student_id) added out-of-band) and against
-- local (which has the same shape from Session 48's PR #53 apply).
-- Wrapped in a single transaction so the constraint reshape window
-- never exists in committed state.

BEGIN;

-- ---------------------------------------------------------------
-- Section 1: users.password_hash — drop NOT NULL.
-- Prod allows NULL to support token-only parent accounts pre-
-- password-setup. See PR #53 description for the full rationale.
-- Idempotent native: DROP NOT NULL on a nullable column is a no-op.
-- ---------------------------------------------------------------
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- ---------------------------------------------------------------
-- Section 2: referral_monitoring.notes column.
-- Prod has had this column. routes/students.js requires it
-- (SELECT rm.notes, INSERT ... notes, ON CONFLICT ... SET notes).
-- Idempotent via ADD COLUMN IF NOT EXISTS.
-- ---------------------------------------------------------------
ALTER TABLE referral_monitoring ADD COLUMN IF NOT EXISTS notes TEXT;

-- ---------------------------------------------------------------
-- Section 3a: Drop any existing single-column UNIQUE on student_id.
--
-- Defensive — handles both (i) prod's existing constraint added
-- out-of-band with whatever name and (ii) local DBs that applied
-- the closed PR #53's referral_monitoring_student_id_key.
-- Discovers by column (pg_index), not by name.
-- ---------------------------------------------------------------
DO $$
DECLARE
  idx_name TEXT;
BEGIN
  SELECT i.relname INTO idx_name
    FROM pg_index ix
    JOIN pg_class i  ON i.oid = ix.indexrelid
    JOIN pg_class t  ON t.oid = ix.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
   WHERE t.relname = 'referral_monitoring'
     AND a.attname = 'student_id'
     AND ix.indisunique = true
     AND array_length(ix.indkey, 1) = 1;

  IF idx_name IS NOT NULL THEN
    -- If the index is backed by a constraint, drop the constraint
    -- (PG cascades to the index). Otherwise drop the bare index.
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'referral_monitoring'::regclass
         AND conname  = idx_name
    ) THEN
      EXECUTE format('ALTER TABLE referral_monitoring DROP CONSTRAINT %I', idx_name);
    ELSE
      EXECUTE format('DROP INDEX %I', idx_name);
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------
-- Section 3b: Add UNIQUE (tenant_id, student_id).
-- Name-based existence check (we are authoring the new name, so
-- name-based is sufficient and clear).
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'referral_monitoring'::regclass
       AND conname  = 'referral_monitoring_tenant_student_key'
  ) THEN
    ALTER TABLE referral_monitoring
      ADD CONSTRAINT referral_monitoring_tenant_student_key
      UNIQUE (tenant_id, student_id);
  END IF;
END
$$;

-- ---------------------------------------------------------------
-- Section 4: student_interventions.log_frequency.
-- Prod has this column; local does not (until this migration).
-- routes/interventions.js:97,116 and routes/weeklyProgress.js:155
-- reference it. Default 'weekly' matches the application default.
-- Idempotent via ADD COLUMN IF NOT EXISTS.
-- ---------------------------------------------------------------
ALTER TABLE student_interventions
  ADD COLUMN IF NOT EXISTS log_frequency VARCHAR(20) DEFAULT 'weekly';

COMMIT;
