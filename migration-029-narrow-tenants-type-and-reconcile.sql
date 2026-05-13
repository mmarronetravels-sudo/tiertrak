-- Migration 029: Narrow tenants.type CHECK to 'school' only.
--
-- Closes Followup #103 (doctrine/schema divergence introduced when
-- PR #96 rewrote §5 to put districts in the districts table — but
-- the tenants CHECK still permitted type='district'). Reconciles the
-- one known legacy row (tenant #9, Humble ISD Demo) by converting
-- it to a school-tenant under a newly-created district row.
--
-- Pre-flight (operator's responsibility, not this migration):
--   Run scripts/ops/audit-legacy-district-tenants.sql first.
--   If any rows OTHER than #9 appear, STOP and reconcile manually.
--   This migration assumes exactly one legacy district row (#9).
--
-- Idempotent. Safe to re-run.
--
-- Atomicity: all of (a) create matching district, (b) convert tenant
-- #9 to type='school', (c) DROP+ADD CHECK happen inside a single
-- transaction. Either every step lands or none does.

BEGIN;

-- 1) Insert a districts row for Humble ISD Demo.
--    Idempotent: on re-run, step 2 has already flipped tenant #9 to
--    type='school', so the SELECT returns zero rows and the INSERT
--    inserts nothing. The district label is sourced from the existing
--    tenant name so no operator-side string entry is required.
INSERT INTO districts (name)
SELECT name FROM tenants WHERE id = 9 AND type = 'district';

-- 2) Convert tenant #9 to type='school' and link to its district.
--    Conditional UPDATE: only fires if #9 still has type='district'.
UPDATE tenants
   SET type = 'school',
       district_id = (
         SELECT d.id FROM districts d
         JOIN tenants t ON t.name = d.name
         WHERE t.id = 9
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE id = 9 AND type = 'district';

-- 3) Verify zero remaining type='district' rows before narrowing the
--    CHECK. RAISE EXCEPTION inside a DO block aborts the transaction
--    if reconciliation incomplete — better than a constraint-violation
--    error downstream.
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM tenants WHERE type = 'district';
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Migration 029: % tenant row(s) still have type=district — reconcile before re-running',
      remaining;
  END IF;
END $$;

-- 4) DROP + ADD CHECK in one statement-equivalent block. Uses the
--    pg_constraint guard for idempotency on re-run.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_type_check;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_type_check
  CHECK (type = 'school');

COMMIT;
