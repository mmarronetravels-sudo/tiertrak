-- Migration 046: user_role_change_audit table.
--
-- Forensic-grade append-only audit table for staff role changes,
-- written by the upcoming delegated-role-assignment feature
-- (feat/delegated-role-assignment). Schema-only here; the writer (an
-- INSERT inside the existing UPDATE-users-role transaction in
-- routes/staffManagement.js + routes/users.js) lands in a separate PR.
-- Migration is dormant in production until that PR ships.
--
-- Columns (IDs + role strings only — §4B-compliant by construction):
--   audit_id          BIGSERIAL PK    — append-only-unbounded, M031 precedent
--   user_id           INTEGER NOT NULL — target of the role change
--   old_role          VARCHAR(50) NOT NULL — role string at start of change
--   new_role          VARCHAR(50) NOT NULL — role string at end of change
--                                       (VARCHAR(50) matches users.role
--                                       exactly per schema.sql:21. Closes
--                                       PR #260 security-reviewer LOW-2:
--                                       a narrower audit-column width
--                                       would hard-fail INSERTs after a
--                                       future role-widening migration
--                                       admitted a longer role name,
--                                       creating an asymmetric-failure
--                                       partial-commit hazard if the
--                                       writer's transaction handling
--                                       regresses.)
--   actor_user_id     INTEGER          — nullable (M031 precedent: cascade
--                                       /admin-script writes have no actor)
--   school_tenant_id  INTEGER NOT NULL — target's tenant_id at time of change
--   district_id       INTEGER          — nullable per §5 dual-path
--                                       (legacy single-tenant users have
--                                        users.district_id IS NULL)
--   occurred_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--
-- §4B compliance: no names, emails, slugs, or any free-text identifier.
-- Role strings ARE staff data per §4B but are the audit table's entire
-- purpose — the transition (e.g. teacher → counselor) is unrecoverable
-- without them. All other columns are integer FK-like references.
--
-- §5 compliance: school_tenant_id NOT NULL + indexed; district_id NOT NULL-
-- guaranteed-by-writer is NOT asserted at schema level (legacy single-
-- tenant users carry users.district_id IS NULL, and the audit row mirrors
-- that), but every district-scoped row IS indexed for forensic queries.
-- M031 idx_user_school_access_audit_district is the shape precedent.
--
-- Composite-FK trust + audit independence: denormalized (user_id,
-- school_tenant_id, district_id, actor_user_id) columns with NO foreign-
-- key constraints back to users, tenants, or districts. Audit rows must
-- outlive their referents per FERPA §99.32 record-of-disclosure
-- retention. Same shape as M031 user_school_access_audit; same reasoning.
--
-- BIGSERIAL on audit_id (not SERIAL): audit table is append-only-
-- unbounded; SERIAL's 2.1B INTEGER ceiling is reachable on a multi-year
-- district fleet timeline. Matches M031 precedent.
--
-- NO CHECK constraint on old_role / new_role: the audit table records
-- what happened, not what would be valid today. If a future migration
-- widens users.role's CHECK (cf. M041, M043), the audit table must not
-- silently reject historical events. The role-string validity gate
-- lives on users.role; the audit table is permissive by design.
--
-- Idempotency (explicit, S68 lesson on M029's WHERE-NOT-EXISTS comment
-- that didn't match its mechanism):
--   Step 1 CREATE TABLE IF NOT EXISTS — same final shape every run.
--   Step 2 COMMENT ON TABLE — set/overwrite; idempotent.
--   Step 3a, 3b, 3c CREATE INDEX IF NOT EXISTS — same shape every run.
--
-- Atomicity: all steps inside one BEGIN/COMMIT. Either every step lands
-- or none does. Apply as a single \i unit; do not run statements
-- individually (cf. Followup #111).

BEGIN;

-- Step 1: audit table. Denormalized integer columns + two role strings;
-- no FKs by design (FERPA §99.32 outlive-referent rule, M031 precedent).
CREATE TABLE IF NOT EXISTS user_role_change_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  old_role         VARCHAR(50) NOT NULL,
  new_role         VARCHAR(50) NOT NULL,
  actor_user_id    INTEGER,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  occurred_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: table comment captures the no-FK doctrine inline so future
-- reviewers/agents see the FERPA reasoning at \d+ time, not just in
-- the migration file.
COMMENT ON TABLE user_role_change_audit IS
  'Append-only audit trail for staff role changes. Denormalized integer columns (user_id, school_tenant_id, district_id, actor_user_id) with NO foreign keys -- rows must outlive their referents per FERPA section 99.32 record-of-disclosure retention. See migration-046 header.';

-- Step 3a: per-user lookup ("show me every role change applied to user N,
-- most recent first"). DESC on occurred_at matches M031 precedent for
-- forensic queries that scan recent-first.
CREATE INDEX IF NOT EXISTS idx_user_role_change_audit_user
  ON user_role_change_audit (user_id, occurred_at DESC);

-- Step 3b: §5 school-scope index ("show me every role change in this
-- school"). school_tenant_id is the §5 school-tenant identifier per
-- the layered tenant model.
CREATE INDEX IF NOT EXISTS idx_user_role_change_audit_school
  ON user_role_change_audit (school_tenant_id, occurred_at DESC);

-- Step 3c: §5 district-scope index ("show me every role change my
-- district_admin made this week"). Required by §5 strict reading for
-- district-scoped audit data; precedent is M031
-- idx_user_school_access_audit_district. NULL district_id values
-- (legacy single-tenant users) are still indexed by btree and do not
-- participate in district-scoped queries.
CREATE INDEX IF NOT EXISTS idx_user_role_change_audit_district
  ON user_role_change_audit (district_id, occurred_at DESC);

COMMIT;
