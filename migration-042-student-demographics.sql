-- migration-042-student-demographics.sql
--
-- Adds five demographic fields to the student data surface — the
-- foundation for downstream discipline reporting. Per CLAUDE.md §4B
-- these are sensitive FERPA fields (race/IEP/504/ELL are in the
-- extra-sensitive class); every mutation is audited via an append-
-- only audit table with the M039/M040/M041 GUC actor doctrine.
--
-- Field set (operator-locked):
--   - iep_flag       BOOLEAN, 3-state (TRUE/FALSE/NULL = unknown)
--   - sec_504_flag   BOOLEAN, 3-state
--   - ell_flag       BOOLEAN, 3-state
--   - gender         VARCHAR(20) CHECK allowlist 'M'/'F'/'X'/'prefer_not_to_say'
--   - race/ethnicity multi-select via student_race_ethnicity child
--                    table; stable codes (2024 OMB SPD 15 seven
--                    minima); display labels live in the app, not
--                    the DB.
--
-- Audit doctrine: mirrors M039/M040/M041 — denormalized integer
-- columns, no foreign keys (FERPA §99.32 record-of-disclosure
-- retention), actor captured from app.actor_user_id GUC.
-- New for M042: AFTER INSERT triggers capture initial-set values
-- so CSV import (which does not set the GUC) emits audit rows with
-- actor_user_id = NULL meaning "set at import."
--
-- Apply as a unit. One BEGIN/COMMIT. Partial replay not supported.

BEGIN;

-- ----------------------------------------------------------------------
-- 0) Precondition: §5 composite uniqueness on students(id, tenant_id)
-- ----------------------------------------------------------------------
-- The child-table composite FK depends on students_id_tenant_unique.
-- Fail fast with a clear message if it's missing rather than failing
-- inside CREATE TABLE with a generic constraint-not-found error.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_id_tenant_unique'
      AND conrelid = 'students'::regclass
  ) THEN
    RAISE EXCEPTION 'M042 precondition failed: students_id_tenant_unique constraint not present. Composite FK on student_race_ethnicity cannot be created. Apply the migration that established the composite unique first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------
-- 1) ALTER TABLE students — four scalar demographic columns
-- ----------------------------------------------------------------------

ALTER TABLE students ADD COLUMN iep_flag     BOOLEAN     NULL;
ALTER TABLE students ADD COLUMN sec_504_flag BOOLEAN     NULL;
ALTER TABLE students ADD COLUMN ell_flag     BOOLEAN     NULL;
ALTER TABLE students ADD COLUMN gender       VARCHAR(20) NULL;

ALTER TABLE students
  ADD CONSTRAINT students_gender_check
  CHECK (gender IS NULL OR gender IN ('M', 'F', 'X', 'prefer_not_to_say'));

-- ----------------------------------------------------------------------
-- 2) student_race_ethnicity — multi-select child table
-- ----------------------------------------------------------------------
--
-- §5: composite FK (student_id, tenant_id) → students(id, tenant_id)
-- guarantees the child row cannot point to a student in a different
-- tenant by construction. ON DELETE CASCADE off the student means
-- per-student race rows die with the student; the AFTER DELETE
-- trigger below emits an audit row per category removed.
--
-- category stores stable codes (NOT English labels). Display labels
-- live in constants/studentDemographics.js (banked alongside this
-- migration); the DB is the source of truth for the code set via
-- the CHECK allowlist.

CREATE TABLE student_race_ethnicity (
  id          BIGSERIAL   PRIMARY KEY,
  student_id  INTEGER     NOT NULL,
  tenant_id   INTEGER     NOT NULL,
  category    VARCHAR(60) NOT NULL,
  added_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT student_race_ethnicity_category_check
    CHECK (category IN ('AIAN', 'ASIAN', 'BLACK', 'HISP', 'MENA', 'NHPI', 'WHITE')),

  CONSTRAINT student_race_ethnicity_student_fk
    FOREIGN KEY (student_id, tenant_id)
    REFERENCES students(id, tenant_id)
    ON DELETE CASCADE,

  CONSTRAINT student_race_ethnicity_unique
    UNIQUE (student_id, category)
);

CREATE INDEX idx_student_race_ethnicity_tenant_category
  ON student_race_ethnicity (tenant_id, category);

-- ----------------------------------------------------------------------
-- 3) students_demographics_audit — append-only audit table
-- ----------------------------------------------------------------------
--
-- NO foreign keys by design (M039 lines 121-126, M041 lines 301-305):
-- audit row must outlive its referent per FERPA §99.32 record-of-
-- disclosure retention. Denormalized integer columns for student_id,
-- tenant_id, district_id, actor_user_id.
--
-- Both tenant_id AND district_id present:
--   - tenant_id  — primary read-scope anchor, always populated.
--   - district_id — denormalized from tenants.district_id at trigger
--                   fire time so district-wide compliance reporting
--                   does not have to join. NULL is valid (single-
--                   tenant orgs, or v_district lookup-failure safety
--                   net per design outline).
--
-- field_name allowlist names the LOGICAL field being audited. Both
-- adds and removes of a race/ethnicity category share field_name =
-- 'race_ethnicity'; direction is encoded in which of old/new is
-- NULL. Matches the scalar one-field-name-both-directions pattern.
--
-- old_value / new_value are TEXT so booleans (cast to 'true'/'false'),
-- gender codes, and race/ethnicity codes all fit one schema.
--
-- actor_user_id is nullable; from app.actor_user_id GUC at trigger
-- fire time. NULL means "set at import" or "unattributed system
-- path" — a real semantic, not a missing value.

CREATE TABLE students_demographics_audit (
  audit_id      BIGSERIAL   PRIMARY KEY,
  student_id    INTEGER     NOT NULL,
  tenant_id     INTEGER     NOT NULL,
  district_id   INTEGER     NULL,
  field_name    VARCHAR(32) NOT NULL,
  old_value     TEXT        NULL,
  new_value     TEXT        NULL,
  actor_user_id INTEGER     NULL,
  occurred_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT students_demographics_audit_field_check
    CHECK (field_name IN ('iep_flag', 'sec_504_flag', 'ell_flag', 'gender', 'race_ethnicity'))
);

CREATE INDEX idx_students_demographics_audit_tenant_student_time
  ON students_demographics_audit (tenant_id, student_id, occurred_at DESC);

CREATE INDEX idx_students_demographics_audit_district_time
  ON students_demographics_audit (district_id, occurred_at DESC)
  WHERE district_id IS NOT NULL;

-- ----------------------------------------------------------------------
-- 4) Trigger function: AFTER INSERT on students
-- ----------------------------------------------------------------------
--
-- Initial-set audit for the four scalar demographic columns. One audit
-- row per non-NULL scalar field at insert time; NULL fields emit
-- nothing.
--
-- Race/ethnicity NOT touched here — the child-table AFTER INSERT
-- trigger emits one row per category.
--
-- Actor capture: app.actor_user_id GUC; NULL when unset (CSV import).
-- v_district lookup is exception-safe: a deleted tenant row at fire
-- time collapses to district_id = NULL on the emit rather than
-- aborting the parent INSERT.

CREATE OR REPLACE FUNCTION trg_students_demographic_insert_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_actor    INTEGER;
  v_district INTEGER;
BEGIN
  v_actor := NULLIF(current_setting('app.actor_user_id', true), '')::INTEGER;

  BEGIN
    SELECT district_id INTO v_district FROM tenants WHERE id = NEW.tenant_id;
  EXCEPTION WHEN OTHERS THEN
    v_district := NULL;
  END;

  IF NEW.iep_flag IS NOT NULL THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'iep_flag', NULL, NEW.iep_flag::TEXT, v_actor);
  END IF;

  IF NEW.sec_504_flag IS NOT NULL THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'sec_504_flag', NULL, NEW.sec_504_flag::TEXT, v_actor);
  END IF;

  IF NEW.ell_flag IS NOT NULL THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'ell_flag', NULL, NEW.ell_flag::TEXT, v_actor);
  END IF;

  IF NEW.gender IS NOT NULL THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'gender', NULL, NEW.gender, v_actor);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_students_demographic_insert
  AFTER INSERT ON students
  FOR EACH ROW
  EXECUTE FUNCTION trg_students_demographic_insert_fn();

-- ----------------------------------------------------------------------
-- 5) Trigger function: AFTER UPDATE on students
-- ----------------------------------------------------------------------
--
-- Per-column diff audit. IS DISTINCT FROM handles NULL↔value,
-- value↔NULL, and value↔value' symmetrically. An UPDATE that does
-- not touch any audited column emits zero rows. tier/area/archive
-- changes emit zero rows by design — M042 scope is demographics only.

CREATE OR REPLACE FUNCTION trg_students_demographic_update_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_actor    INTEGER;
  v_district INTEGER;
BEGIN
  v_actor := NULLIF(current_setting('app.actor_user_id', true), '')::INTEGER;

  BEGIN
    SELECT district_id INTO v_district FROM tenants WHERE id = NEW.tenant_id;
  EXCEPTION WHEN OTHERS THEN
    v_district := NULL;
  END;

  IF OLD.iep_flag IS DISTINCT FROM NEW.iep_flag THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'iep_flag', OLD.iep_flag::TEXT, NEW.iep_flag::TEXT, v_actor);
  END IF;

  IF OLD.sec_504_flag IS DISTINCT FROM NEW.sec_504_flag THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'sec_504_flag', OLD.sec_504_flag::TEXT, NEW.sec_504_flag::TEXT, v_actor);
  END IF;

  IF OLD.ell_flag IS DISTINCT FROM NEW.ell_flag THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'ell_flag', OLD.ell_flag::TEXT, NEW.ell_flag::TEXT, v_actor);
  END IF;

  IF OLD.gender IS DISTINCT FROM NEW.gender THEN
    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.id, NEW.tenant_id, v_district, 'gender', OLD.gender, NEW.gender, v_actor);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_students_demographic_update
  AFTER UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION trg_students_demographic_update_fn();

-- ----------------------------------------------------------------------
-- 6) Trigger function: AFTER INSERT / AFTER DELETE on student_race_ethnicity
-- ----------------------------------------------------------------------
--
-- One function, two bindings. Discriminates on TG_OP.
--   INSERT  (add)    → (old_value NULL, new_value = code)
--   DELETE  (remove) → (old_value = code, new_value NULL)
-- field_name = 'race_ethnicity' for both directions (matches scalar
-- one-field-name-both-directions pattern).

CREATE OR REPLACE FUNCTION trg_student_race_ethnicity_change_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_actor    INTEGER;
  v_district INTEGER;
BEGIN
  v_actor := NULLIF(current_setting('app.actor_user_id', true), '')::INTEGER;

  IF TG_OP = 'INSERT' THEN
    BEGIN
      SELECT district_id INTO v_district FROM tenants WHERE id = NEW.tenant_id;
    EXCEPTION WHEN OTHERS THEN
      v_district := NULL;
    END;

    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (NEW.student_id, NEW.tenant_id, v_district, 'race_ethnicity', NULL, NEW.category, v_actor);

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    BEGIN
      SELECT district_id INTO v_district FROM tenants WHERE id = OLD.tenant_id;
    EXCEPTION WHEN OTHERS THEN
      v_district := NULL;
    END;

    INSERT INTO students_demographics_audit
      (student_id, tenant_id, district_id, field_name, old_value, new_value, actor_user_id)
    VALUES
      (OLD.student_id, OLD.tenant_id, v_district, 'race_ethnicity', OLD.category, NULL, v_actor);

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_student_race_ethnicity_insert
  AFTER INSERT ON student_race_ethnicity
  FOR EACH ROW
  EXECUTE FUNCTION trg_student_race_ethnicity_change_fn();

CREATE TRIGGER trg_student_race_ethnicity_delete
  AFTER DELETE ON student_race_ethnicity
  FOR EACH ROW
  EXECUTE FUNCTION trg_student_race_ethnicity_change_fn();

COMMIT;
