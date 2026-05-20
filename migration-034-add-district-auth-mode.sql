-- Migration 034: Add districts.auth_mode column.
--
-- Per-district auth policy field. Two values:
--   'sso'      — staff log in via Google OAuth; users are pre-created
--                with password_hash=NULL; first login binds google_id.
--   'password' — staff get a set-password URL on creation, same
--                pattern as the parent set-password flow in
--                routes/auth.js (password_reset_token + 7-day expiry).
--
-- Default for new districts: 'sso'.
--
-- Design context:
--   The auth_mode field is added with DEFAULT 'sso' and ships
--   without any retroactive backfill UPDATE because:
--   (a) Current district rows are either SSO-confirmed or inert
--       demo data — the DEFAULT 'sso' fills every existing row
--       to the intended state with no correction needed.
--   (b) Known password-mode customers are single-school tenants
--       with district_id=NULL, living in the tenants table rather
--       than districts — no district row exists for them to flip,
--       and the auth_mode column does not apply at the tenant
--       level.
--   Future district-level password-mode customers will receive
--   their auth_mode at promotion time via a per-district UPDATE
--   ops query, not a retroactive backfill migration.
--
-- Idempotency:
--   Step 1: ADD COLUMN IF NOT EXISTS is idempotent. On re-run no
--           change.
--   Step 2: DROP CONSTRAINT IF EXISTS + ADD produces the same shape
--           every run.
--
-- Atomicity: both steps inside one BEGIN/COMMIT.

BEGIN;

-- Step 1: ADD COLUMN with default. NOT NULL is safe because the
-- DEFAULT fills every existing row at ADD time.
ALTER TABLE districts
  ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(20) NOT NULL DEFAULT 'sso';

-- Step 2: CHECK constraint via the DROP+ADD idempotent pattern.
ALTER TABLE districts DROP CONSTRAINT IF EXISTS districts_auth_mode_check;
ALTER TABLE districts
  ADD CONSTRAINT districts_auth_mode_check
  CHECK (auth_mode IN ('sso', 'password'));

COMMIT;
