-- Migration 049: screener_reset_audit table.
--
-- Append-only audit table for the scoped screener-data RESET operation
-- (feat/screener-data-reset). A reset hard-deletes the screener_results rows
-- matching a (school_year, screening_period, subject [, assessment_type])
-- scope for one school-tenant, so the data can be re-uploaded cleanly. Because
-- the delete is destructive and touches student records, every reset must be
-- recorded. Schema-only here; the writer (an INSERT in the SAME transaction as
-- the DELETE, in routes/screener.js POST /reset) lands in the separate
-- feat/screener-data-reset PR. This migration is dormant in production until
-- that PR ships. Direct precedent: migration-047 staff_import_audit,
-- migration-048 student_import_audit.
--
-- Grain: ONE ROW PER RESET ACTION (not per deleted record). The auditable
-- event is the operator-initiated batch reset, and deleted_count captures how
-- many rows the action removed. Per-record grain would defeat the purpose --
-- the deleted screener rows no longer exist, so there is nothing to point at;
-- the action and its scope are what the trail must preserve. This differs from
-- M048 (per-created-record) because that path CREATES referents worth pointing
-- at; a reset DESTROYS them.
--
-- Columns:
--   audit_id          BIGSERIAL PK    -- append-only-unbounded, M031/M046/M047/
--                                       M048 precedent (SERIAL's 2.1B ceiling is
--                                       reachable on a multi-year fleet timeline)
--   school_tenant_id  INTEGER NOT NULL -- §5 school identifier; the tenant whose
--                                       screener_results were reset (holds
--                                       screener_results.tenant_id). Named
--                                       school_tenant_id to match the M031/M047/
--                                       M048 audit-table convention. Indexed.
--   district_id       INTEGER          -- district the reset targeted; indexed.
--                                       Nullable to mirror M046/M047/M048 and the
--                                       §5 dual-path posture (legacy single-tenant
--                                       users have no district)
--   school_year       TEXT NOT NULL    -- reset scope (see §4B note below)
--   screening_period  TEXT NOT NULL    -- reset scope
--   subject           TEXT NOT NULL    -- reset scope
--   assessment_type   TEXT             -- OPTIONAL narrowing filter; NULL means the
--                                       reset was not narrowed by assessment_type
--   deleted_count     INTEGER NOT NULL -- number of screener_results rows the reset
--                                       removed (the DELETE rowCount)
--   actor_user_id     INTEGER          -- the admin who ran the reset. Nullable per
--                                       M031/M046/M047/M048 precedent (out-of-band
--                                       writes have no actor)
--   occurred_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--
-- §4B compliance: the four scope columns (school_year, screening_period,
-- subject, assessment_type) ARE strings, which is intentionally LESS strict
-- than M048's "no string column of any kind." They are justified because they
-- are assessment-BATCH descriptors, NOT person identifiers: a school_year
-- ("2025-2026"), a screening period ("BOY"), a subject ("Math"), and an
-- assessment_type ("STAR") describe WHICH batch was reset, never WHO. They
-- carry no student or staff name, no external/SIS id, no grade, no score, no
-- demographic flag, no email, no free text. They are unrecoverable from any id
-- (screener_results stores them as free TEXT with no lookup table), so without
-- them the audit row cannot answer "what was deleted." Same reasoning shape as
-- M047 retaining the staff `role` string because it is unrecoverable otherwise.
-- deleted_count is an aggregate count, not a per-person datum.
--
-- §5 compliance: school_tenant_id NOT NULL + indexed (the §5 school-tenant
-- identifier under the layered tenant model -- storing only district_id would
-- not be sufficient); district_id indexed for district-scoped forensic queries.
-- M031/M047/M048 are the index-shape precedent.
--
-- Composite-FK trust + audit independence: denormalized (school_tenant_id,
-- district_id, actor_user_id) columns with NO foreign-key constraints back to
-- tenants, districts, or users. Audit rows must outlive their referents per
-- FERPA record-of-disclosure retention. Same shape and reasoning as M031, M046,
-- M047, and M048.
--
-- NO CHECK constraint: single-purpose table; the audit records what happened,
-- not what is valid today. Same posture as M046/M047/M048. No `action` column
-- (the table itself denotes the reset action; cf. M048 dropping it for a
-- single-purpose table).
--
-- Idempotency:
--   Step 1 CREATE TABLE IF NOT EXISTS -- same final shape every run.
--   Step 2 COMMENT ON TABLE -- set/overwrite; idempotent.
--   Step 3a, 3b CREATE INDEX IF NOT EXISTS -- same shape every run.
--
-- Atomicity: all steps inside one BEGIN/COMMIT. Either every step lands or none
-- does. Apply as a single \i unit; do not run statements individually
-- (cf. Followup #111).

BEGIN;

-- Step 1: audit table. Denormalized integer/text columns; the only strings are
-- assessment-batch scope descriptors (see §4B note in header); no FKs by design
-- (FERPA outlive-referent rule, M031/M046/M047/M048 precedent).
CREATE TABLE IF NOT EXISTS screener_reset_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  school_year      TEXT NOT NULL,
  screening_period TEXT NOT NULL,
  subject          TEXT NOT NULL,
  assessment_type  TEXT,
  deleted_count    INTEGER NOT NULL,
  actor_user_id    INTEGER,
  occurred_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: table comment captures the no-FK doctrine, the per-action grain, and
-- the §4B scope-descriptor posture inline so future reviewers/agents see the
-- reasoning at \d+ time, not just in the migration file.
COMMENT ON TABLE screener_reset_audit IS
  'Append-only audit trail for scoped screener-data resets (hard-delete of screener_results matching a year/period/subject[/assessment_type] scope for one school-tenant). One row per reset action; deleted_count is the rows removed. Denormalized integer columns (school_tenant_id, district_id, actor_user_id) with NO foreign keys -- rows must outlive their referents per FERPA record-of-disclosure retention. The four scope strings are assessment-batch descriptors (year/period/subject/assessment_type), never person identifiers: no names, external ids, grades, scores, demographics, emails, or free text. See migration-049 header.';

-- Step 3a: §5 school-scope index ("show me every reset run at this school").
-- school_tenant_id is the §5 school-tenant identifier. DESC on occurred_at
-- matches M031/M046/M047/M048 forensic recent-first scan precedent.
CREATE INDEX IF NOT EXISTS idx_screener_reset_audit_school
  ON screener_reset_audit (school_tenant_id, occurred_at DESC);

-- Step 3b: §5 district-scope index ("show me every reset my district ran this
-- week"). Required by §5 strict reading for district-scoped audit data;
-- precedent is M031/M047/M048 district indexes. NULL district_id values are
-- still indexed by btree and do not participate in district-scoped queries.
CREATE INDEX IF NOT EXISTS idx_screener_reset_audit_district
  ON screener_reset_audit (district_id, occurred_at DESC);

COMMIT;
