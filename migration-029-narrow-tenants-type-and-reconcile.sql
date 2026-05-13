-- Migration 029: Narrow tenants.type CHECK to 'school' only.
--
-- Closes Followup #103 (doctrine/schema divergence introduced when
-- PR #96 rewrote §5 to put districts in the districts table — but
-- the tenants CHECK still permitted type='district'). Reconciles ALL
-- legacy type='district' rows by creating matching districts entries
-- and flipping type to 'school'. As of S68 P1 audit, two such rows
-- exist: tenant #9 (Humble ISD Demo) and tenant #11 (Vandercook Demo).
--
-- Pre-flight (operator's responsibility, not this migration):
--   Run scripts/ops/audit-legacy-district-tenants.sql first.
--   Review every row returned and confirm each is genuinely a legacy
--   district-typed tenant that should be reconciled to school-tenant
--   shape under a new districts row carrying its current name.
--
-- Idempotent. Safe to re-run.
--
-- Atomicity: all of (a) create matching district, (b) convert tenant
-- #9 to type='school', (c) DROP+ADD CHECK happen inside a single
-- transaction. Either every step lands or none does.

BEGIN;

-- 1) Insert a districts row for each legacy type='district' tenant.
--    Idempotent: on re-run, step 2 has already flipped these rows to
--    type='school', so the SELECT returns zero rows and the INSERT
--    inserts nothing. District labels are sourced from existing
--    tenant names so no operator-side string entry is required.
INSERT INTO districts (name)
SELECT name FROM tenants WHERE type = 'district';

-- 2) Convert each legacy type='district' tenant to type='school' and
--    link to its matching district. Conditional UPDATE: only fires on
--    rows still typed 'district'. Correlated sub-SELECT matches each
--    tenant to its districts row by name (step 1 just inserted one
--    districts row per such tenant).
UPDATE tenants
   SET type = 'school',
       district_id = (
         SELECT d.id FROM districts d
         WHERE d.name = tenants.name
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE type = 'district';

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
