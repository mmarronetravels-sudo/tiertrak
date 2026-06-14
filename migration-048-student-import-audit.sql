-- Migration 048: student_import_audit table.
--
-- Forensic-grade append-only audit table for bulk student-record
-- provisioning via the operator-console student-import COMMIT path
-- (feat/student-import-commit, Slice 4). Schema-only here; the writer (an
-- INSERT inside the single per-import transaction in
-- routes/operatorStudentImport.js commitStudentImport) lands in a separate
-- PR. Migration is dormant in production until that PR ships. Direct
-- precedent: migration-047 staff_import_audit.
--
-- One row per created student record (per-student grain): creating a student
-- education record is the FERPA disclosure/record event the audit trail must
-- preserve, and per-student grain keeps per-record traceability that a
-- per-import summary row would lose. An import_batch_id (UUID, one per
-- import) groups the rows of a single upload for forensic queries.
--
-- Columns (IDs / UUID / timestamp ONLY -- §4B-compliant by construction):
--   audit_id          BIGSERIAL PK    -- append-only-unbounded, M031/M046/M047 precedent
--   import_batch_id   UUID NOT NULL   -- one crypto.randomUUID() per import;
--                                       groups every student record created by
--                                       a single upload
--   student_id        INTEGER NOT NULL -- the created student record. This is the
--                                       INTERNAL students.id surrogate PK
--                                       (schema.sql students.id SERIAL), the value
--                                       returned by INSERT INTO students ...
--                                       RETURNING id. It is NEVER external_id /
--                                       SIS id (TEXT, §4B PII) and NEVER a name.
--   school_tenant_id  INTEGER NOT NULL -- §5 school identifier; the tenant the
--                                       student record was created under
--                                       (students.tenant_id); indexed
--   district_id       INTEGER          -- district the import targeted; indexed.
--                                       NOT NULL in practice for this operator
--                                       surface (path-derived), but left nullable
--                                       to mirror M046/M047 and the §5 dual-path
--                                       posture
--   actor_user_id     INTEGER          -- the operator who ran the import.
--                                       Nullable per M031/M046/M047 precedent
--                                       (admin-script/out-of-band writes have
--                                       no actor)
--   occurred_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--
-- §4B compliance: NO string column of any kind. No names, no external_id / SIS
-- id, no grade, no tier/area/risk_level, no demographic flags (IEP/504/ELL/
-- gender/race-ethnicity), no emails, no slugs, no tokens, no free text. Every
-- column is an integer, UUID, or timestamp. This is STRICTER than M047, which
-- retained one staff-data string (role) because the provisioned role is
-- unrecoverable without it; the student equivalents (grade, external_id, tier/
-- area/risk) are all §4B-protected with no audit-purpose exception, so they are
-- excluded outright. Same no-FK / outlive-referent doctrine as M046/M047.
--
-- §5 compliance: school_tenant_id NOT NULL + indexed (the §5 school-tenant
-- identifier under the layered tenant model -- storing only district_id would
-- not be sufficient); district_id indexed for district-scoped forensic queries.
-- M031 idx_user_school_access_audit_district and M047
-- idx_staff_import_audit_district are the shape precedent.
--
-- Composite-FK trust + audit independence: denormalized (student_id,
-- school_tenant_id, district_id, actor_user_id) columns with NO foreign-key
-- constraints back to students, tenants, or districts. Audit rows must outlive
-- their referents per FERPA record-of-disclosure retention. Same shape and
-- reasoning as M031 user_school_access_audit, M046 user_role_change_audit, and
-- M047 staff_import_audit.
--
-- BIGSERIAL on audit_id (not SERIAL): audit table is append-only-unbounded;
-- SERIAL's 2.1B INTEGER ceiling is reachable on a multi-year district fleet
-- timeline. Matches M031/M046/M047 precedent.
--
-- NO CHECK constraint: the audit table records what happened, not what would be
-- valid today. The validity gates live on the students table and the import
-- validator; the audit table is permissive by design. Same as M046/M047.
--
-- Idempotency (explicit, S68 lesson on M029's WHERE-NOT-EXISTS comment that
-- didn't match its mechanism):
--   Step 1 CREATE TABLE IF NOT EXISTS -- same final shape every run.
--   Step 2 COMMENT ON TABLE -- set/overwrite; idempotent.
--   Step 3a, 3b, 3c CREATE INDEX IF NOT EXISTS -- same shape every run.
--
-- Atomicity: all steps inside one BEGIN/COMMIT. Either every step lands or
-- none does. Apply as a single \i unit; do not run statements individually
-- (cf. Followup #111).

BEGIN;

-- Step 1: audit table. Denormalized integer/UUID columns only; no string
-- column; no FKs by design (FERPA outlive-referent rule, M031/M046/M047
-- precedent).
CREATE TABLE IF NOT EXISTS student_import_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  import_batch_id  UUID NOT NULL,
  student_id       INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  actor_user_id    INTEGER,
  occurred_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: table comment captures the no-FK doctrine and the §4B no-PII posture
-- inline so future reviewers/agents see the reasoning at \d+ time, not just in
-- the migration file.
COMMENT ON TABLE student_import_audit IS
  'Append-only audit trail for bulk student-record provisioning via the operator student-import COMMIT path. One row per created student record. Denormalized integer/UUID columns (import_batch_id, student_id, school_tenant_id, district_id, actor_user_id) with NO foreign keys -- rows must outlive their referents per FERPA record-of-disclosure retention. student_id is the internal students.id PK, never external_id/SIS. No names, external ids, grades, demographics, emails, or tokens are stored. See migration-048 header.';

-- Step 3a: §5 school-scope index ("show me every student record provisioned at
-- this school"). school_tenant_id is the §5 school-tenant identifier per the
-- layered tenant model. DESC on occurred_at matches M031/M046/M047 forensic
-- recent-first scan precedent.
CREATE INDEX IF NOT EXISTS idx_student_import_audit_school
  ON student_import_audit (school_tenant_id, occurred_at DESC);

-- Step 3b: §5 district-scope index ("show me every student record my district
-- provisioned this week"). Required by §5 strict reading for district-scoped
-- audit data; precedent is M031 idx_user_school_access_audit_district and M047
-- idx_staff_import_audit_district. NULL district_id values are still indexed by
-- btree and do not participate in district-scoped queries.
CREATE INDEX IF NOT EXISTS idx_student_import_audit_district
  ON student_import_audit (district_id, occurred_at DESC);

-- Step 3c: batch lookup ("show me every student record created by this one
-- import"). Groups an upload's rows for forensic review of a single
-- provisioning event.
CREATE INDEX IF NOT EXISTS idx_student_import_audit_batch
  ON student_import_audit (import_batch_id);

COMMIT;
