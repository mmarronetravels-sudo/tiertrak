-- Migration 038: MTSS Coordinator designation table.
--
-- Per-(user, school_tenant_id) entitlement granting a non-admin
-- staff member building-wide reach to see and do intervention
-- work on any student in that specific building. Composes with
-- the §5 dual-path access contract: a coordinator row is
-- meaningful only for a user who is already a tenant-member of
-- the named school, via either user_school_access (district
-- users) or users.tenant_id (legacy single-tenant users).
--
-- Mirrors the user_school_access doctrine from M028: composite-
-- FK pair on (user_id, district_id) and (school_tenant_id,
-- district_id) so cross-district rows are structurally
-- impossible at the schema layer for district users. Legacy
-- single-tenant users have district_id = NULL on this table,
-- matching their NULL district_id in users — MATCH SIMPLE FK
-- semantics skip enforcement when any composite-FK column is
-- NULL, which is correct because cross-district is impossible
-- for a user who has no district at all.
--
-- Schema-only PR. No route, middleware, or app code reads this
-- table yet. The next PR will land the admin-only grant/revoke
-- routes; a follow-up PR after that will widen the elevated-
-- read predicate at routes/students.js, routes/weeklyProgress.js,
-- and routes/studentDocuments.js to also accept an
-- mtss_coordinators membership row for the specific tenant.
--
-- Idempotent. Safe to re-run.
--
-- Backwards compatibility:
--   - Net-new table. No existing data is rewritten; no existing
--     query semantics change.
--
-- Cascade behavior:
--   - District user (district_id NOT NULL):
--       FK (user_id, district_id) → users(id, district_id) and
--       FK (school_tenant_id, district_id) → tenants(id, district_id)
--       both fire ON DELETE CASCADE. A user delete or a tenant
--       delete will wipe matching coordinator rows, and the
--       M039 AFTER DELETE trigger captures each one into
--       mtss_coordinators_audit as a 'cascade_user_delete' row.
--   - Legacy single-tenant user (district_id NULL):
--       Composite-FK enforcement is skipped (MATCH SIMPLE), so
--       ON DELETE CASCADE does NOT fire automatically from a
--       user or tenant delete. The grant/revoke route (next PR)
--       and any DELETE-FROM-users site (Followup #115 work) must
--       clean up legacy coordinator rows explicitly. The M039
--       audit trigger fires on direct DELETE FROM
--       mtss_coordinators regardless of district_id, so explicit
--       app-layer cleanup is captured.
--
-- Composite-FK trust property: for district users, the FK pair
-- guarantees that a coordinator row's school_tenant_id lives in
-- the same district as the user. A district_admin granting
-- coordinator status to a cross-district user fails at the
-- schema layer with 23503, not at the app layer. Section 5
-- isolation is enforced by the database, not the route handler.
--
-- No soft-delete column. Matches user_school_access /
-- intervention_assignments / parent_student_links — entitlement/
-- grant tables in this repo use hard delete + cascade trigger to
-- a separate append-only audit table (M039) per FERPA §99.32
-- record-of-disclosure retention. Soft-delete via is_active is
-- reserved for customizable vocab tables (M036), which is a
-- different pattern with different retention needs.
--
-- Idempotency:
--   Step 1 CREATE TABLE IF NOT EXISTS produces the same final
--     table shape on every run; re-running is a no-op.
--   Step 2 CREATE INDEX IF NOT EXISTS produces the same index
--     shape on every run.
--
-- Atomicity: both steps inside one BEGIN/COMMIT. Either every
-- step lands or none does. Apply as a single \i unit; do not
-- run statements individually (cf. Followup #111).

BEGIN;

-- Step 1: per-(user, school) coordinator designation table.
-- Composite-FK pair mirrors user_school_access (M028 lines 75-86).
-- district_id is NULLABLE here (vs NOT NULL on user_school_access)
-- because legacy single-tenant users — who have no
-- user_school_access row at all — must still be able to receive
-- a coordinator designation in single-school deployments.
CREATE TABLE IF NOT EXISTS mtss_coordinators (
  user_id          INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, school_tenant_id),
  FOREIGN KEY (user_id, district_id)
    REFERENCES users(id, district_id) ON DELETE CASCADE,
  FOREIGN KEY (school_tenant_id, district_id)
    REFERENCES tenants(id, district_id) ON DELETE CASCADE
);

-- Step 2: indexes. Mirrors the three indexes on user_school_access
-- (M028 lines 88-93). user index supports "list buildings I'm a
-- coordinator for"; school index supports "list coordinators for
-- this building"; district index supports operator/audit queries
-- scoped to a district.
CREATE INDEX IF NOT EXISTS idx_mtss_coordinators_user
  ON mtss_coordinators(user_id);
CREATE INDEX IF NOT EXISTS idx_mtss_coordinators_school
  ON mtss_coordinators(school_tenant_id);
CREATE INDEX IF NOT EXISTS idx_mtss_coordinators_district
  ON mtss_coordinators(district_id);

COMMIT;
