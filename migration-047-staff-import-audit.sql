-- Migration 047: staff_import_audit table.
--
-- Forensic-grade append-only audit table for bulk staff-account
-- provisioning via the operator-console staff-import COMMIT path
-- (feat/staff-import-commit, Slice 2). Schema-only here; the writer (an
-- INSERT inside the single per-import transaction in
-- routes/operatorStaffImport.js commitStaffImport) lands in a separate
-- PR. Migration is dormant in production until that PR ships.
--
-- One row per created staff account (per-account grain): provisioning a
-- staff credential is the FERPA §99.32 disclosure event the audit trail
-- must preserve, and per-account grain keeps per-user traceability that a
-- per-import summary row would lose. An import_batch_id (UUID, one per
-- import) groups the rows of a single upload for forensic queries.
--
-- Columns (IDs + role string only — §4B-compliant by construction):
--   audit_id          BIGSERIAL PK    — append-only-unbounded, M031/M046 precedent
--   import_batch_id   UUID NOT NULL   — one crypto.randomUUID() per import;
--                                       groups every account created by a
--                                       single upload
--   user_id           INTEGER NOT NULL — the created staff account
--   role              VARCHAR(50) NOT NULL — role string at creation
--                                       (VARCHAR(50) matches users.role
--                                       exactly per schema.sql; a narrower
--                                       audit-column width would hard-fail
--                                       INSERTs after a future role-widening
--                                       migration, the M046 LOW-2 lesson)
--   school_tenant_id  INTEGER NOT NULL — §5 school identifier; the tenant the
--                                       account was created under; indexed
--   district_id       INTEGER          — district the import targeted;
--                                       indexed. NOT NULL in practice for
--                                       this operator surface (path-derived),
--                                       but left nullable to mirror M046 and
--                                       the §5 dual-path posture
--   actor_user_id     INTEGER          — the operator who ran the import.
--                                       Nullable per M031/M046 precedent
--                                       (admin-script/out-of-band writes have
--                                       no actor)
--   occurred_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--
-- §4B compliance: no names, emails, slugs, tokens, or any free-text
-- identifier. The setup credential token is NEVER written here. Role
-- strings ARE staff data per §4B but are the audit table's purpose — the
-- provisioned role is unrecoverable without it. All other columns are
-- integer/UUID FK-like references. Same doctrine as M046.
--
-- §5 compliance: school_tenant_id NOT NULL + indexed (the §5 school-tenant
-- identifier under the layered tenant model); district_id indexed for
-- district-scoped forensic queries. M031 idx_user_school_access_audit_district
-- is the shape precedent.
--
-- Composite-FK trust + audit independence: denormalized (user_id,
-- school_tenant_id, district_id, actor_user_id) columns with NO foreign-key
-- constraints back to users, tenants, or districts. Audit rows must outlive
-- their referents per FERPA §99.32 record-of-disclosure retention. Same
-- shape and reasoning as M031 user_school_access_audit and M046
-- user_role_change_audit.
--
-- BIGSERIAL on audit_id (not SERIAL): audit table is append-only-unbounded;
-- SERIAL's 2.1B INTEGER ceiling is reachable on a multi-year district fleet
-- timeline. Matches M031/M046 precedent.
--
-- NO CHECK constraint on role: the audit table records what happened, not
-- what would be valid today. If a future migration widens users.role's CHECK
-- (cf. M041, M043), the audit table must not silently reject historical
-- events. The role-string validity gate lives on users.role and the import
-- validator; the audit table is permissive by design. Same as M046.
--
-- Idempotency (explicit, S68 lesson on M029's WHERE-NOT-EXISTS comment that
-- didn't match its mechanism):
--   Step 1 CREATE TABLE IF NOT EXISTS — same final shape every run.
--   Step 2 COMMENT ON TABLE — set/overwrite; idempotent.
--   Step 3a, 3b, 3c CREATE INDEX IF NOT EXISTS — same shape every run.
--
-- Atomicity: all steps inside one BEGIN/COMMIT. Either every step lands or
-- none does. Apply as a single \i unit; do not run statements individually
-- (cf. Followup #111).

BEGIN;

-- Step 1: audit table. Denormalized integer/UUID columns + one role string;
-- no FKs by design (FERPA §99.32 outlive-referent rule, M031/M046 precedent).
CREATE TABLE IF NOT EXISTS staff_import_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  import_batch_id  UUID NOT NULL,
  user_id          INTEGER NOT NULL,
  role             VARCHAR(50) NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  actor_user_id    INTEGER,
  occurred_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: table comment captures the no-FK doctrine inline so future
-- reviewers/agents see the FERPA reasoning at \d+ time, not just in the
-- migration file.
COMMENT ON TABLE staff_import_audit IS
  'Append-only audit trail for bulk staff-account provisioning via the operator staff-import COMMIT path. One row per created account. Denormalized integer/UUID columns (import_batch_id, user_id, school_tenant_id, district_id, actor_user_id) with NO foreign keys -- rows must outlive their referents per FERPA section 99.32 record-of-disclosure retention. No emails, names, or setup tokens are stored. See migration-047 header.';

-- Step 3a: §5 school-scope index ("show me every account provisioned at this
-- school"). school_tenant_id is the §5 school-tenant identifier per the
-- layered tenant model. DESC on occurred_at matches M031/M046 forensic
-- recent-first scan precedent.
CREATE INDEX IF NOT EXISTS idx_staff_import_audit_school
  ON staff_import_audit (school_tenant_id, occurred_at DESC);

-- Step 3b: §5 district-scope index ("show me every account my district
-- provisioned this week"). Required by §5 strict reading for district-scoped
-- audit data; precedent is M031 idx_user_school_access_audit_district. NULL
-- district_id values are still indexed by btree and do not participate in
-- district-scoped queries.
CREATE INDEX IF NOT EXISTS idx_staff_import_audit_district
  ON staff_import_audit (district_id, occurred_at DESC);

-- Step 3c: batch lookup ("show me every account created by this one import").
-- Groups an upload's rows for forensic review of a single provisioning event.
CREATE INDEX IF NOT EXISTS idx_staff_import_audit_batch
  ON staff_import_audit (import_batch_id);

COMMIT;
