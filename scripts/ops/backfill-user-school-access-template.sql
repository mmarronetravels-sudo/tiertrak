-- Operator template: backfill user_school_access grants for a district.
--
-- Idempotent. Re-runnable. Uses CTE pattern so the audit row is ONLY
-- written when the underlying user_school_access INSERT actually
-- happens — duplicate runs do not pile up spurious 'grant' audit rows.
--
-- USAGE
--   1. Copy this file to a per-district + dated name, e.g.,
--        scripts/ops/backfill-humble-isd-2026-05-14.sql
--   2. Fill in the placeholder values below for each (user, school)
--      grant to create. Each grant is one CTE block.
--   3. Optional: set the app.actor_user_id GUC at the top of the
--      script for self-attribution in the audit table. Without this,
--      audit rows will land with actor_user_id=NULL (the correct
--      value for system-initiated / operator-template backfills not
--      tied to a specific user session).
--   4. Apply via Render External PSQL: \i <your-renamed-file>.sql
--   5. Verify:
--        SELECT COUNT(*) FROM user_school_access;
--      should reflect the new rows.
--        SELECT user_id, school_tenant_id, action, actor_user_id,
--               occurred_at
--        FROM user_school_access_audit
--        WHERE action = 'grant'
--        ORDER BY occurred_at DESC LIMIT 20;
--      should show the grant rows just landed.
--
-- ACTOR ATTRIBUTION (optional)
--   To attribute these grants to the running operator's users.id in
--   the audit table, uncomment and fill the SELECT set_config line
--   below the BEGIN. The 3rd arg `true` makes the GUC transaction-
--   local; the whole script runs as one transaction via \i, so the
--   GUC stays set across every CTE block.
--   If left commented out, audit rows land with actor_user_id=NULL.
--   That is the correct value for operator-template backfills where
--   no user-session actor exists; FERPA §99.32 record-of-disclosure
--   semantics are preserved (the WHEN + WHICH + ACTION are recorded;
--   the actor is documented as "system-initiated" via the NULL).
--   user_school_access.created_by follows the same attribution as
--   the audit row's actor_user_id (both read from the same GUC):
--   operator-set → both populated with the operator's users.id;
--   operator-unset → both NULL.
--
-- IDEMPOTENCY GUARANTEE
--   ON CONFLICT (user_id, school_tenant_id) DO NOTHING on the
--   user_school_access INSERT short-circuits the row creation if a
--   grant already exists. The CTE then emits zero rows; the audit-
--   row INSERT (SELECT ... FROM inserted) writes zero rows. Re-
--   running this script after partial completion is therefore safe
--   and does NOT double-count grants in the audit table.
--
-- CROSS-DISTRICT REJECTION
--   M028's composite FKs reject (user_id, district_id) and
--   (school_tenant_id, district_id) mismatches at the schema layer.
--   If your fill-in values cross districts, the INSERT raises
--   SQLSTATE 23503 and the transaction ROLLBACKs. Verify your
--   triples before running.

BEGIN;

-- Optional operator self-attribution (uncomment + fill):
-- SELECT set_config('app.actor_user_id', '<OPERATOR_USER_ID>', true);

-- ----------------------------------------------------------------
-- Grant block — duplicate this block per (user, school) grant.
-- Replace the four placeholder identifiers per row.
-- ----------------------------------------------------------------
WITH inserted AS (
  INSERT INTO user_school_access
    (user_id, district_id, school_tenant_id, created_by)
  VALUES
    (REPLACE_USER_ID, REPLACE_DISTRICT_ID, REPLACE_SCHOOL_TENANT_ID,
     NULLIF(current_setting('app.actor_user_id', true), '')::int)
  ON CONFLICT (user_id, school_tenant_id) DO NOTHING
  RETURNING user_id, district_id, school_tenant_id
)
INSERT INTO user_school_access_audit
  (user_id, district_id, school_tenant_id, action, actor_user_id)
SELECT
  user_id, district_id, school_tenant_id, 'grant',
  NULLIF(current_setting('app.actor_user_id', true), '')::int
FROM inserted;

-- Add additional WITH inserted AS ( ... ) INSERT INTO audit ... blocks
-- below for each additional grant. Keep each pair together so they
-- roll back together on FK violation.

COMMIT;
