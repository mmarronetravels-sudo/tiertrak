-- Migration 039: mtss_coordinators_audit table + cascade-event
-- trigger.
--
-- Forensic-grade append-only audit trail for the MTSS
-- Coordinator entitlement layer added in M038. Three event
-- sources land rows here:
--   - 'grant'                — app-layer INSERT from the future
--                              POST grant route (next PR).
--   - 'revoke'               — app-layer INSERT from the future
--                              DELETE revoke route (next PR).
--   - 'cascade_user_delete'  — schema-level AFTER DELETE trigger
--                              on mtss_coordinators (this
--                              migration).
--
-- Identical doctrine to migration-031 (user_school_access_audit):
--   - Trigger-based audit. FERPA §99.32 record-of-disclosure
--     retention requires the audit trail to survive deletion of
--     its referent. M038's ON DELETE CASCADE on mtss_coordinators
--     would otherwise wipe access rows silently when a user or
--     tenant row is deleted.
--   - No foreign keys on the audit table. Audit rows must
--     outlive their referents — a FK to mtss_coordinators or
--     users would force ON DELETE CASCADE / SET NULL / RESTRICT,
--     each of which compromises the §99.32 contract. Denormalized
--     integer columns (user_id, school_tenant_id, district_id)
--     are the correct shape.
--   - BIGSERIAL on audit_id (not SERIAL). Audit table is
--     append-only-unbounded; SERIAL's 2.1B INTEGER ceiling is
--     reachable on a multi-year district fleet timeline. Same
--     reasoning as M031's audit_id.
--   - CHECK constraint on action enforced at schema time. The
--     three blessed values match M031 exactly: 'grant', 'revoke',
--     'cascade_user_delete'.
--   - NO SECURITY DEFINER on the trigger function. The trigger
--     fires in the same transaction as the parent DELETE under
--     the caller's privileges. Future reviewers should NOT add
--     SECURITY DEFINER reflexively — see M031 header (S69 agentId
--     ad5577dc9a9aba16b) for the rationale; the same logic
--     applies here.
--
-- district_id nullability matches M038:
--   The parent table mtss_coordinators.district_id is NULLABLE
--   to admit legacy single-tenant users. The audit table mirrors
--   that nullability so the trigger can write a row regardless
--   of the deleted row's district_id. A legacy-user cascade
--   never fires the M038 composite FK (MATCH SIMPLE skip on
--   NULL), so the only path that writes a legacy audit row is
--   a direct DELETE FROM mtss_coordinators — which still fires
--   the trigger here.
--
-- Sequencing note: the cascade-event hazard activates only when
-- mtss_coordinators has rows. Today the parent table will be
-- empty immediately after this migration applies; the next PR
-- (grant/revoke routes) is the first writer. M039 ships dormant
-- until that PR lands, which is the correct order — the audit
-- table is in place before the first row is written.
--
-- Composite-FK trust + audit independence: the audit table
-- carries denormalized (user_id, school_tenant_id, district_id)
-- columns matching mtss_coordinators's shape, but NO foreign-key
-- constraints back to mtss_coordinators, users, or tenants.
-- Audit rows must outlive their referents per FERPA §99.32
-- record-of-disclosure retention. See inline comment at
-- table-creation.
--
-- Trigger label is the minimal M031 shape:
--   The trigger body writes a hardcoded 'cascade_user_delete'
--   string. This is the M031 doctrine — single-label trigger,
--   future grant/revoke writers emit their own labels from the
--   app layer via INSERT. M032/M033 later evolved
--   user_school_access_audit's trigger to read action and
--   actor_user_id from transaction-local GUCs
--   (app.audit_action, app.actor_user_id) so the same trigger
--   could serve cascade + explicit-revoke paths. That evolution
--   may be adopted here in a future migration once the
--   grant/revoke routes ship and the operational picture is
--   clear; doing so up front is premature for a schema-only PR.
--   actor_user_id is declared (nullable) on the audit table so
--   that future GUC enhancement is a CREATE OR REPLACE FUNCTION
--   change, not an ALTER TABLE.
--
-- Idempotency (explicit, S68 lesson on M029's comment vs
-- mechanism mismatch):
--   Step 1 CREATE TABLE IF NOT EXISTS produces the same final
--     table shape on every run; re-running is a no-op.
--   Step 2 CREATE INDEX IF NOT EXISTS produces the same index
--     shape on every run.
--   Step 3 CREATE OR REPLACE FUNCTION updates the function body
--     if changed; identical body on re-run is a no-op behavior.
--   Step 4 DROP TRIGGER IF EXISTS + CREATE TRIGGER re-establishes
--     the trigger fresh on every run; same shape every time.
--
-- Atomicity: all four steps inside one BEGIN/COMMIT. Either
-- every step lands or none does. Apply as a single \i unit; do
-- not run statements individually (cf. Followup #111).
--
-- Pre-flight check before applying:
--   SELECT COUNT(*) FROM mtss_coordinators;
-- Expected: 0 (the grant/revoke routes have not yet shipped).
-- If non-zero, pause and report — M039 should land before any
-- row exists in mtss_coordinators so the audit table is in
-- place before the first row is written and the trigger never
-- misses an event.

BEGIN;

-- Step 1: audit table. Denormalized integer columns, no FKs by
-- design. district_id is NULLABLE to match the M038 parent
-- table's legacy single-tenant support.
CREATE TABLE IF NOT EXISTS mtss_coordinators_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  action           VARCHAR(32) NOT NULL
                   CHECK (action IN ('grant', 'revoke', 'cascade_user_delete')),
  actor_user_id    INTEGER,
  occurred_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NO FK to mtss_coordinators by design — audit row must outlive
-- its referent per FERPA §99.32 record-of-disclosure retention.
-- See M039 commit message and M031 precedent (S69 privacy-
-- reviewer agentIds ad5577dc9a9aba16b + aa64397dba70ad892).
COMMENT ON TABLE mtss_coordinators_audit IS
  'Append-only audit trail for mtss_coordinators. Denormalized integer columns (user_id, school_tenant_id, district_id) with NO foreign keys — rows must outlive their referents per FERPA §99.32 record-of-disclosure retention. See migration-039 header.';

-- Step 2: district-scoped index for operator queries (most-
-- recent first). Mirrors idx_user_school_access_audit_district
-- from M031. Rows with district_id NULL (legacy single-tenant
-- audit rows) still index correctly via btree NULL handling.
CREATE INDEX IF NOT EXISTS idx_mtss_coordinators_audit_district
  ON mtss_coordinators_audit (district_id, occurred_at DESC);

-- Step 3: trigger function for cascade-event capture.
-- AFTER DELETE on mtss_coordinators fires inside the same
-- transaction under the caller's privileges. NO SECURITY DEFINER
-- — the trigger writes under whatever role performed the DELETE.
-- Future reviewers should not add SECURITY DEFINER reflexively;
-- see migration header.
--
-- Action label is the hardcoded M031-doctrine string. The
-- actor_user_id column is declared on the audit table but the
-- trigger writes NULL for it — populating it from a transaction-
-- local GUC (per M032's pattern on user_school_access_audit) is
-- a future enhancement once app-layer writers ship and the
-- need is concrete.
CREATE OR REPLACE FUNCTION mtss_coordinators_audit_cascade()
  RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO mtss_coordinators_audit
    (user_id, school_tenant_id, district_id, action)
  VALUES
    (OLD.user_id, OLD.school_tenant_id, OLD.district_id, 'cascade_user_delete');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 4: bind trigger. DROP IF EXISTS + CREATE makes re-runs
-- idempotent (same shape every time). AFTER DELETE FOR EACH ROW
-- mirrors M031's binding on user_school_access.
DROP TRIGGER IF EXISTS mtss_coordinators_audit_after_delete
  ON mtss_coordinators;

CREATE TRIGGER mtss_coordinators_audit_after_delete
  AFTER DELETE ON mtss_coordinators
  FOR EACH ROW EXECUTE FUNCTION mtss_coordinators_audit_cascade();

COMMIT;
