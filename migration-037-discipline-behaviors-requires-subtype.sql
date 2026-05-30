-- Migration 037: discipline_behaviors.requires_subtype
--
-- Second PR in the discipline-referral feature. Adds a single
-- NULLable column to discipline_behaviors so the route + UI layer
-- can decide, at submit time, whether the conditional harassment or
-- weapon subtype picker is required. Pulls the "conditional
-- subtype" rule out of the application-layer label-matching the
-- M036 comment hand-waved at (lines 56-63 of M036) and onto a
-- structured column the route + UI can both read.
--
-- §4B (PII): no PII touched. requires_subtype is a tag on a vocab
-- row, not a person.
--
-- §5 (multi-tenancy): discipline_behaviors is already school-tenant-
-- scoped (M036). This migration adds no new joins, no new FKs, no
-- new indexes that cross tenant boundaries. The per-tenant
-- customization model is preserved — a tenant who renames or
-- deactivates "Harassment" / "Carrying a knife or weapon" still has
-- their own row's requires_subtype intact, and a tenant who adds a
-- new behavior gets NULL (the safe default) until an operator sets
-- it via the customization UI.
--
-- Why a column instead of FE label-matching:
-- The vocab is tenant-customizable (M036 D3). A tenant who renames
-- "Harassment" to "Bullying / harassment" would silently break a FE
-- substring rule; a tenant who deactivates and recreates the row
-- would break a hardcoded-ID rule. The column travels with the row
-- across renames and survives customization.
--
-- Backfill scope (conservative): only the two rows that have a
-- ready subtype vocab table behind them.
--   - "Harassment" → requires_subtype = 'harassment' (8-row
--     discipline_harassment_subtypes table).
--   - "Carrying a knife or weapon" → requires_subtype = 'weapon'
--     (4-row discipline_weapon_subtypes table).
-- Other arguably weapon-adjacent rows ("Bomb threat", "Fireworks or
-- explosive material") are intentionally NOT tagged: the seeded
-- weapon_subtypes list (Gun, Knife > 6", Knife < 6", Other) doesn't
-- describe them. A tenant whose policy demands a sub-classification
-- for those can add subtype rows and tag the behavior via the
-- per-tenant customization UI.
--
-- Drift-risk: data/discipline-vocab-seeds.js BEHAVIORS list MUST
-- carry the requires_subtype field on the two canonical rows so
-- new-tenant seeding (PR #175) propagates the tag. Updated in the
-- same PR as this migration. Editing this migration after the fact
-- is not permitted (M036 doctrine).
--
-- Idempotency: ALTER TABLE … ADD COLUMN IF NOT EXISTS; UPDATE
-- statements are no-ops if the row was already tagged (or doesn't
-- exist for a tenant that deleted it). Safe to re-run.
--
-- Atomicity: entire migration wrapped in a single BEGIN / COMMIT.
--
-- Rollback (manual, run inside a transaction):
--   BEGIN;
--   ALTER TABLE discipline_behaviors DROP COLUMN IF EXISTS requires_subtype;
--   COMMIT;

BEGIN;

ALTER TABLE discipline_behaviors
  ADD COLUMN IF NOT EXISTS requires_subtype VARCHAR(20)
  CHECK (requires_subtype IN ('harassment', 'weapon') OR requires_subtype IS NULL)
  DEFAULT NULL;

-- Backfill existing tenants. Per-tenant partial-unique label index
-- guarantees at most one active row per (tenant, lower(label)), so the
-- UPDATE is bounded to at most one row per tenant per label. A tenant
-- that renamed or deactivated either row is silently skipped — its
-- operator can tag the renamed row via the per-tenant UI.
UPDATE discipline_behaviors
SET requires_subtype = 'harassment'
WHERE lower(label) = 'harassment'
  AND is_active = TRUE
  AND requires_subtype IS DISTINCT FROM 'harassment';

UPDATE discipline_behaviors
SET requires_subtype = 'weapon'
WHERE lower(label) = 'carrying a knife or weapon'
  AND is_active = TRUE
  AND requires_subtype IS DISTINCT FROM 'weapon';

COMMIT;

-- ============================================================
-- Verification
-- ============================================================

-- Column present with the expected CHECK constraint.
SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'discipline_behaviors'
  AND column_name = 'requires_subtype';

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'discipline_behaviors'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%requires_subtype%';

-- Per-tenant tag counts. Expected per school-tenant (assuming the
-- seeded rows are still active and unmodified):
--   requires_subtype = 'harassment' : 1 row  ("Harassment")
--   requires_subtype = 'weapon'     : 1 row  ("Carrying a knife or weapon")
--   requires_subtype IS NULL        : 18 rows
SELECT t.id AS tenant_id, t.name,
  (SELECT COUNT(*) FROM discipline_behaviors WHERE tenant_id = t.id AND requires_subtype = 'harassment') AS tagged_harassment,
  (SELECT COUNT(*) FROM discipline_behaviors WHERE tenant_id = t.id AND requires_subtype = 'weapon')     AS tagged_weapon,
  (SELECT COUNT(*) FROM discipline_behaviors WHERE tenant_id = t.id AND requires_subtype IS NULL)        AS untagged
FROM tenants t
WHERE t.type = 'school'
ORDER BY t.id;

-- Sanity: the two canonical rows actually carry the tag in every
-- school-tenant that still has them by their seeded label. A tenant
-- whose operator renamed either row appears with count 0 here — that
-- is legitimate per the per-tenant customization model and can be
-- resolved by tagging the renamed row via the customization UI.
SELECT
  'Harassment'                    AS expected_label,
  COUNT(*) FILTER (WHERE lower(label) = 'harassment' AND requires_subtype = 'harassment')                AS tagged_count,
  COUNT(*) FILTER (WHERE lower(label) = 'harassment')                                                    AS active_label_count
FROM discipline_behaviors
WHERE is_active = TRUE
UNION ALL
SELECT
  'Carrying a knife or weapon',
  COUNT(*) FILTER (WHERE lower(label) = 'carrying a knife or weapon' AND requires_subtype = 'weapon'),
  COUNT(*) FILTER (WHERE lower(label) = 'carrying a knife or weapon')
FROM discipline_behaviors
WHERE is_active = TRUE;
