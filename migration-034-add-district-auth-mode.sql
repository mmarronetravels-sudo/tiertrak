-- Migration 034: Add districts.auth_mode column.
--
-- Per-district auth policy field. Three values:
--   'sso'      — staff log in via Google OAuth; users are pre-created
--                with password_hash=NULL; first login binds google_id.
--   'password' — staff get a set-password URL on creation, same
--                pattern as the parent set-password flow in
--                routes/auth.js (password_reset_token + 7-day expiry).
--   'disabled' — all authentication attempts rejected for this
--                district. Operator kill-switch for offboarding or
--                incident response.
--
-- No DEFAULT clause. Fail-safe design: every district INSERT must
-- specify auth_mode explicitly, and the NOT NULL constraint will
-- reject any attempt to create a district row without an auth
-- policy decision. This avoids the failure mode where a forgotten
-- ops step leaves a district in the permissive 'sso' mode by
-- default — see CLAUDE.md §9 (privacy-preserving approaches
-- preferred over convenient ones).
--
-- Design context:
--   Existing district rows are backfilled to 'sso' explicitly via
--   the UPDATE in Step 2. Current rows are all SSO-confirmed or
--   inert demo data, so 'sso' matches the intended state with no
--   per-row correction needed. Future district-level password-mode
--   customers receive their auth_mode at promotion time via a
--   per-district UPDATE ops query.
--
--   Known password-mode customers are single-school tenants with
--   district_id=NULL — they live in the tenants table rather than
--   districts, so the auth_mode column does not apply to them.
--   The auth_mode column is a per-district policy field only.
--
-- Idempotency:
--   Step 1: ADD COLUMN IF NOT EXISTS — no-op on re-run.
--   Step 2: UPDATE … WHERE auth_mode IS NULL — no-op once filled.
--   Step 3: ALTER COLUMN … SET NOT NULL — no-op once applied.
--   Step 4: DROP CONSTRAINT IF EXISTS + ADD — produces the same
--           constraint shape every run.
--
-- Atomicity: all four steps inside one BEGIN/COMMIT.
--
-- Rollback (manual, run inside a transaction):
--   BEGIN;
--   ALTER TABLE districts DROP CONSTRAINT IF EXISTS districts_auth_mode_check;
--   ALTER TABLE districts DROP COLUMN IF EXISTS auth_mode;
--   COMMIT;

BEGIN;

-- Step 1: ADD COLUMN as nullable. No DEFAULT, no NOT NULL yet.
ALTER TABLE districts
  ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(20);

-- Step 2: Explicit backfill of existing rows.
UPDATE districts SET auth_mode = 'sso' WHERE auth_mode IS NULL;

-- Step 3: Apply NOT NULL once existing rows are populated.
ALTER TABLE districts
  ALTER COLUMN auth_mode SET NOT NULL;

-- Step 4: CHECK constraint via the DROP+ADD idempotent pattern.
ALTER TABLE districts DROP CONSTRAINT IF EXISTS districts_auth_mode_check;
ALTER TABLE districts
  ADD CONSTRAINT districts_auth_mode_check
  CHECK (auth_mode IN ('sso', 'password', 'disabled'));

COMMIT;
