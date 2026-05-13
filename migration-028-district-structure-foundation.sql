-- Migration 028: District structure foundation
--
-- Adds the layered tenant model: districts as a parent layer over tenants
-- (schools), users belonging to one district, and a per-user list of
-- accessible school-tenants within that district.
--
-- Schema-only. No route or middleware code reads these tables yet —
-- Session 2 of the district structure project will wire up the
-- access-resolution layer and the JWT-shape change.
--
-- Idempotent. Safe to re-run.
--
-- Pattern follows Migration 021 (composite-FK cross-tenant rejection at
-- the schema layer): tenants.UNIQUE(id, district_id) and
-- users.UNIQUE(id, district_id) let user_school_access enforce
-- "this user can only be linked to schools within their own district."
--
-- Backwards compatibility:
--   - tenants.district_id and users.district_id are NULL-by-default,
--     so existing single-school customers and legacy users are unchanged.
--   - The composite FKs on user_school_access only fire when both sides
--     have a non-NULL district_id — i.e., the district case.
--   - No existing data is rewritten; no existing query semantics change.

BEGIN;

-- 1) districts table
CREATE TABLE IF NOT EXISTS districts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) tenants.district_id (nullable — single-school customers have no district)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES districts(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_id_district_unique'
      AND conrelid = 'tenants'::regclass
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_id_district_unique UNIQUE (id, district_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_district ON tenants(district_id);

-- 3) users.district_id (nullable — legacy single-tenant users have no district)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES districts(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_id_district_unique'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_id_district_unique UNIQUE (id, district_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_district ON users(district_id);

-- 4) user_school_access table
--    Composite-FK pattern: the school_tenant_id must live in the same
--    district as the user. Cross-district rows are rejected at the
--    schema layer — Migration 021 lesson applied to the layered model.
CREATE TABLE IF NOT EXISTS user_school_access (
  user_id INTEGER NOT NULL,
  district_id INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, school_tenant_id),
  FOREIGN KEY (user_id, district_id)
    REFERENCES users(id, district_id) ON DELETE CASCADE,
  FOREIGN KEY (school_tenant_id, district_id)
    REFERENCES tenants(id, district_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_school_access_user
  ON user_school_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_school_access_school
  ON user_school_access(school_tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_school_access_district
  ON user_school_access(district_id);

COMMIT;
