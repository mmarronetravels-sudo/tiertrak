-- Migration 031: user_school_access_audit table + cascade-event trigger.
--
-- Forensic-grade append-only audit table for the new district access
-- layer. Three event sources land rows:
--   - 'grant'                — app-layer INSERT from POST grant route (PR B2)
--   - 'revoke'               — app-layer INSERT from DELETE revoke route (PR B2)
--   - 'cascade_user_delete'  — schema-level trigger AFTER DELETE ON
--                              user_school_access (this migration)
--
-- Design (i) trigger-based audit, per S69 privacy-reviewer verdict
-- (agentIds ad5577dc9a9aba16b for the (i)-decision verdict +
-- aa64397dba70ad892 for the FK/timestamp shape clarification, both
-- 2026-05-13). FERPA §99.32 record-of-disclosure retention requires
-- the audit trail to survive user deletion; M028's ON DELETE CASCADE
-- on user_school_access wipes access rows silently without a trigger.
--
-- #115 sequencing note: the cascade hazard activates only when
-- user_school_access has rows. Today the parent table is empty; PR
-- B2 (grant/revoke surface) is the first writer. Deploy sequence per
-- privacy-reviewer recommendation:
--   B1 merge  → M031 trigger configured, user_school_access empty,
--               cascade structurally in place but nothing to capture.
--   #115 merge → unauthed DELETE-FROM-users sites gated. External
--               cascade attack path closed.
--   B2 merge  → grant/revoke live, user_school_access starts taking
--               rows. Cascade now has rows to wipe; #115 has already
--               closed the external path.
-- M031's trigger is dormant in production until B2 ships.
--
-- Composite-FK trust + audit independence: the audit table carries
-- denormalized (user_id, district_id, school_tenant_id) columns
-- matching user_school_access's shape, but NO foreign-key constraints
-- back to user_school_access, users, or tenants. Audit rows must
-- outlive their referents per FERPA §99.32 record-of-disclosure
-- retention. See inline comment at table-creation.
--
-- BIGSERIAL on audit_id (not SERIAL): audit table is append-only-
-- unbounded; SERIAL's 2.1B INTEGER ceiling is reachable on a multi-
-- year district fleet timeline. Same class as Followup #76's
-- augmented INTEGER bound, applied to the audit-table PK.
--
-- CHECK constraint on action: enforced at schema time alongside the
-- column declaration. Defense-in-depth — Followup #112-class
-- (app-layer type validation) applied at DB layer.
--
-- Trigger function security: NO SECURITY DEFINER. The trigger fires
-- in the same transaction as the parent DELETE under the caller's
-- privileges. Future reviewers should not add SECURITY DEFINER
-- reflexively — see privacy-reviewer rationale (S69 agentId
-- ad5577dc9a9aba16b).
--
-- Idempotency (explicit, S68 lesson on M029's WHERE-NOT-EXISTS
-- comment that didn't match its mechanism):
--   Step 1 CREATE TABLE IF NOT EXISTS produces the same final
--     table shape on every run; re-running is a no-op.
--   Step 2 CREATE INDEX IF NOT EXISTS produces the same index
--     shape on every run.
--   Step 3 CREATE OR REPLACE FUNCTION updates the function body
--     if changed; identical body on re-run is a no-op behavior.
--   Step 4 DROP TRIGGER IF EXISTS + CREATE TRIGGER re-establishes
--     the trigger fresh on every run; same shape every time.
--
-- Atomicity: all four steps inside one BEGIN/COMMIT. Either every
-- step lands or none does. Apply as a single \i unit; do not run
-- statements individually (cf. Followup #111).

BEGIN;

-- Step 1: audit table. Denormalized integer columns, no FKs by design.
CREATE TABLE IF NOT EXISTS user_school_access_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  district_id      INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  action           VARCHAR(32) NOT NULL
                   CHECK (action IN ('grant', 'revoke', 'cascade_user_delete')),
  actor_user_id    INTEGER,
  occurred_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NO FK to user_school_access by design — audit row must outlive its
-- referent per FERPA §99.32 record-of-disclosure retention. See M031
-- commit message and S69 privacy-reviewer agentIds ad5577dc9a9aba16b +
-- aa64397dba70ad892.
COMMENT ON TABLE user_school_access_audit IS
  'Append-only audit trail for user_school_access. Denormalized integer columns (user_id, district_id, school_tenant_id) with NO foreign keys — rows must outlive their referents per FERPA §99.32 record-of-disclosure retention. See migration-031 header.';

-- Step 2: district-scoped index for operator queries (most-recent first).
CREATE INDEX IF NOT EXISTS idx_user_school_access_audit_district
  ON user_school_access_audit (district_id, occurred_at DESC);

-- Step 3: trigger function for cascade-event capture.
-- AFTER DELETE on user_school_access fires inside the same transaction
-- under the caller's privileges. NO SECURITY DEFINER — the trigger
-- writes under whatever role performed the DELETE. Future reviewers
-- should not add SECURITY DEFINER reflexively; see migration header.
CREATE OR REPLACE FUNCTION user_school_access_audit_cascade()
  RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_school_access_audit
    (user_id, district_id, school_tenant_id, action)
  VALUES
    (OLD.user_id, OLD.district_id, OLD.school_tenant_id, 'cascade_user_delete');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 4: bind trigger. DROP IF EXISTS + CREATE makes re-runs
-- idempotent (same shape every time).
DROP TRIGGER IF EXISTS user_school_access_audit_after_delete
  ON user_school_access;

CREATE TRIGGER user_school_access_audit_after_delete
  AFTER DELETE ON user_school_access
  FOR EACH ROW EXECUTE FUNCTION user_school_access_audit_cascade();

COMMIT;
