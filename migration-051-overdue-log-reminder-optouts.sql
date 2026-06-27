-- Migration 051: overdue_log_reminder_optouts table (per-tenant opt-out config).
--
-- Gate item (a) for the scheduled weekly "overdue progress logs" staff email
-- (services/overdueLogsDigest.js). Before OVERDUE_LOGS_REMINDERS_ENABLED can be
-- turned on in production, a school or district MUST be able to decline these
-- emails. This table records that decline. It is read by the digest at run time
-- (the per-user district skip and the per-tenant school skip) and written by the
-- district-admin and operator opt-out endpoints in the SAME PR.
--
-- This is mutable CONFIG, not an append-only ledger/audit. It nonetheless keeps
-- the M031/M046/M047/M048/M049/M050 house style: BIGSERIAL PK, denormalized
-- integer references, NO foreign keys, single BEGIN/COMMIT, IF-NOT-EXISTS,
-- COMMENT ON TABLE, and integers/dates only (no PII). Its defining feature
-- versus the M050 dedup ledger is reminders_enabled -- a mutable state column,
-- not a one-shot send record -- so re-opting-in is a reversible UPDATE rather
-- than a delete.
--
-- Scope grain: EXACTLY ONE of (school_tenant_id, district_id) is set per row,
-- enforced by chk_optout_exactly_one_scope. Two scopes coexist deliberately:
--   - A school-scoped row (school_tenant_id set, district_id NULL) declines for
--     one school-tenant. This is the §5-authoritative grain and the only grain
--     usable for single-school / legacy customers (users.district_id IS NULL,
--     which is every prod tenant today per M029).
--   - A district-scoped row (district_id set, school_tenant_id NULL) declines
--     wholesale for an entire district. The digest applies this as a per-user
--     skip: every staff user whose users.district_id matches is skipped before
--     scope resolution, so EVERY school under that district is suppressed, not
--     just one. This rests on the §5 resolver contract that a user's resolved
--     accessible school-tenants all lie within users.district_id.
--
-- Default-on / opt-OUT semantics: absence of a row means "eligible" (the email
-- will send once the global flag is on). Only declines are stored. A stored row
-- with reminders_enabled = FALSE suppresses; reminders_enabled = TRUE is a row
-- that has been re-enabled after a prior opt-out (kept for the actor/timestamp
-- audit trail) and does NOT suppress. The digest reads only the FALSE rows.
--
-- Columns (IDs + state + dates only -- §4B-compliant by construction):
--   id                BIGSERIAL PK     -- house style (M050 precedent)
--   school_tenant_id  INTEGER          -- §5 school identifier of the declining
--                                         school; NULL on a district-wide row.
--                                         Indexed.
--   district_id       INTEGER          -- declining district; NULL on a school
--                                         row. Indexed.
--   reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE -- FALSE = opted out
--   created_by        INTEGER          -- actor user id that first set the row
--                                         (integer ref, no PII; no FK per house
--                                         style)
--   updated_by        INTEGER          -- actor user id of the last UPDATE
--   created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--   updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--
-- §4B compliance: no student/staff names, no emails, no external/SIS ids, no
-- free text. Only integer references, a boolean, and timestamps. The PII (which
-- students are overdue) never touches this table -- it lives only in the
-- transient email body, exactly as for the M050 ledger.
--
-- §5 compliance: school_tenant_id is the §5 school-tenant identifier and is
-- indexed (idx ..._school). district_id is indexed (idx ..._district) for the
-- district-scoped read. Storing only district_id would not be sufficient under
-- the layered tenant model, which is precisely why the school grain exists as
-- its own column + index.
--
-- Composite-FK note (§5 Migration-021 pattern): intentionally NOT applied. That
-- pattern guards a CHILD row that must live within a single parent scope by
-- composing the child FK against the parent's (id, scope_id). Here each row
-- scopes to EITHER a school OR a district independently -- it is a standalone
-- config row keyed by one scope, not a child contained within a parent. The
-- "this school belongs to this district" check that matters for the
-- district-admin writer is enforced at the route layer (the endpoint validates
-- the target school's tenants.district_id before writing), consistent with the
-- M050 decision to enforce the (user, school) relation at write time rather than
-- by a DB constraint. No foreign keys at all, per the M031..M050 house style.
--
-- Idempotency:
--   Step 1 CREATE TABLE IF NOT EXISTS -- same final shape every run.
--   Step 2 COMMENT ON TABLE -- set/overwrite; idempotent.
--   Step 3a, 3b CREATE UNIQUE INDEX IF NOT EXISTS (partial) -- one live row per
--          scope; same shape every run.
--   Step 4a, 4b CREATE INDEX IF NOT EXISTS -- §5 scope-read indexes; same shape.
--
-- Atomicity: all steps inside one BEGIN/COMMIT. Either every step lands or none
-- does. Apply as a single \i unit; do not run statements individually
-- (cf. Followup #111).

BEGIN;

-- Step 1: per-tenant opt-out config. Denormalized integer references + a boolean
-- state + dates; no FKs by design (M031..M050 house style). The CHECK enforces
-- the "exactly one scope" invariant so a row can never name both or neither.
CREATE TABLE IF NOT EXISTS overdue_log_reminder_optouts (
  id                BIGSERIAL PRIMARY KEY,
  school_tenant_id  INTEGER,
  district_id       INTEGER,
  reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        INTEGER,
  updated_by        INTEGER,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_optout_exactly_one_scope
    CHECK ((school_tenant_id IS NOT NULL) <> (district_id IS NOT NULL))
);

-- Step 2: table comment captures the opt-out purpose, the default-on semantics,
-- and the no-FK / no-PII doctrine inline so future reviewers see it at \d+ time.
COMMENT ON TABLE overdue_log_reminder_optouts IS
  'Per-tenant opt-out config for the scheduled weekly overdue-progress-log staff email (services/overdueLogsDigest.js). Exactly one of (school_tenant_id, district_id) is set per row (chk_optout_exactly_one_scope). reminders_enabled = FALSE means opted out (suppressed); absence of a row means eligible (default-on / opt-out semantics). A district-scoped FALSE row suppresses every school under that district via the digest per-user skip; a school-scoped FALSE row suppresses one school. Denormalized integer references with NO foreign keys; stores no student/staff names, emails, or intervention data. See migration-051 header.';

-- Step 3a: one live opt-out row per school. Partial UNIQUE so a school cannot
-- accumulate conflicting rows; the writer UPSERTs on this target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_overdue_log_reminder_optouts_school
  ON overdue_log_reminder_optouts (school_tenant_id)
  WHERE school_tenant_id IS NOT NULL;

-- Step 3b: one live opt-out row per district. Partial UNIQUE, same rationale.
CREATE UNIQUE INDEX IF NOT EXISTS uq_overdue_log_reminder_optouts_district
  ON overdue_log_reminder_optouts (district_id)
  WHERE district_id IS NOT NULL;

-- Step 4a: §5 school-scope read index ("is this school opted out?"). The partial
-- UNIQUE above already covers school_tenant_id, but an explicit named index is
-- added to satisfy the §5 "index on the school identifier" requirement
-- independently of the uniqueness constraint's implementation.
CREATE INDEX IF NOT EXISTS idx_overdue_log_reminder_optouts_school
  ON overdue_log_reminder_optouts (school_tenant_id);

-- Step 4b: §5 district-scope read index ("is this district opted out?").
CREATE INDEX IF NOT EXISTS idx_overdue_log_reminder_optouts_district
  ON overdue_log_reminder_optouts (district_id);

COMMIT;
