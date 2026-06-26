-- Migration 050: overdue_log_reminder_sends table (send-dedup ledger).
--
-- Operational idempotency ledger for the scheduled weekly "overdue progress
-- logs" staff email (feat/overdue-logs-staff-email). The in-process node-cron
-- job (services/overdueLogsDigest.js) emails each staff member the active
-- interventions on their caseload that are missing this week's progress log --
-- the same data the Dashboard "Weekly Reminder: Log Progress" card already
-- shows in-app, reusing routes/weeklyProgress.js getMissingLogsForStaff. This
-- table records that the email was sent so a process restart, an overlapping
-- tick, or a multi-instance deploy cannot double-send. Schema-only here; the
-- writer (an INSERT in services/overdueLogsDigest.js, guarded by an existence
-- check before each send) lands in the SAME PR's later commits. The whole
-- feature is gated OFF in production behind OVERDUE_LOGS_REMINDERS_ENABLED
-- (default off), so this table is dormant until that flag is turned on.
--
-- This is NOT an audit table -- it is an operational dedup ledger. It still
-- follows the M031/M046/M047/M048/M049 denormalized-integer, no-FK, single
-- BEGIN/COMMIT, IF-NOT-EXISTS house style, but its defining feature is the
-- UNIQUE dedup key, which audit tables deliberately do not have.
--
-- Grain: ONE ROW PER (staff user, school-tenant, week). The digest sends one
-- email per school a staffer has overdue items in -- it never combines two
-- schools' student names into a single email body (a §4B data-commingling
-- avoidance), so the natural dedup unit is (user_id, school_tenant_id,
-- week_of). For the common legacy single-tenant staffer this is exactly one
-- row per week; a multi-school district user gets one row per school they were
-- emailed about. week_of is the Monday boundary produced by
-- weeklyProgress.getWeekStart, identical to the value the in-app NOT EXISTS
-- predicate keys on, so "this week" means the same thing in the email, the
-- dashboard, and the ledger.
--
-- Columns (IDs + dates only -- §4B-compliant by construction):
--   id                BIGSERIAL PK    -- append-only-unbounded (weekly x staff
--                                       fleet); BIGSERIAL not SERIAL per
--                                       M031/M046/M047/M048/M049 precedent
--   user_id           INTEGER NOT NULL -- the staff recipient of the reminder
--   school_tenant_id  INTEGER NOT NULL -- §5 school identifier: the tenant whose
--                                       overdue interventions the email listed
--                                       (the tenantId passed to
--                                       getMissingLogsForStaff). Indexed.
--   district_id       INTEGER          -- district the recipient belongs to;
--                                       indexed. Nullable to mirror the §5
--                                       dual-path posture (legacy single-tenant
--                                       staff have no district) and M047/M048/
--                                       M049. Supports the deliberate
--                                       per-tenant opt-out follow-up that must
--                                       land before this is enabled in prod.
--   week_of           DATE NOT NULL    -- Monday of the reminder week
--                                       (weeklyProgress.getWeekStart). Same
--                                       boundary the in-app predicate uses.
--   sent_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP -- when the
--                                       email send succeeded
--
-- §4B compliance: no student or staff names, no emails, no external/SIS ids,
-- no grade, no tier, no intervention name, no free text. Only integer
-- references and dates. The recipient's email address is resolved at send time
-- from users.email and is NEVER persisted here. The PII (which students are
-- overdue) lives only in the transient email body, never in this ledger.
--
-- §5 compliance: school_tenant_id NOT NULL + indexed -- the §5 school-tenant
-- identifier under the layered tenant model (storing only district_id would not
-- be sufficient). district_id indexed for district-scoped queries and the
-- future per-tenant opt-out. The dedup UNIQUE index leads with user_id, so the
-- school-scope index below (leading with school_tenant_id) is added separately
-- to satisfy the §5 "index on the school identifier" requirement.
--
-- Composite-FK note (§5 Migration-021 pattern): intentionally NOT applied here.
-- That pattern guards a child row that must live within a single school by
-- composing its FK against the parent's (id, scope_id). This ledger's natural
-- parent is users, and a staff user is NOT owned by a single school-tenant
-- under the district model (a district user spans multiple school-tenants via
-- user_school_access). The (user_id, school_tenant_id) pairing is therefore an
-- access RELATION, not a containment, and is enforced at write time by the
-- digest resolving the recipient's accessible-tenant set via
-- resolveAccessibleTenantIds before inserting -- not by a DB constraint. No
-- foreign keys at all, consistent with the M031/M046/M047/M048/M049 ledgers.
--
-- Idempotency:
--   Step 1 CREATE TABLE IF NOT EXISTS -- same final shape every run.
--   Step 2 COMMENT ON TABLE -- set/overwrite; idempotent.
--   Step 3 CREATE UNIQUE INDEX IF NOT EXISTS -- the dedup key; same shape every run.
--   Step 4a, 4b CREATE INDEX IF NOT EXISTS -- same shape every run.
--
-- Atomicity: all steps inside one BEGIN/COMMIT. Either every step lands or none
-- does. Apply as a single \i unit; do not run statements individually
-- (cf. Followup #111).

BEGIN;

-- Step 1: dedup ledger. Denormalized integer references + dates only; no FKs by
-- design (consistent with the M031..M049 ledger/audit house style).
CREATE TABLE IF NOT EXISTS overdue_log_reminder_sends (
  id               BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  week_of          DATE NOT NULL,
  sent_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: table comment captures the dedup purpose and the no-FK / no-PII
-- doctrine inline so future reviewers/agents see the reasoning at \d+ time.
COMMENT ON TABLE overdue_log_reminder_sends IS
  'Send-dedup ledger for the scheduled weekly overdue-progress-log staff email (feat/overdue-logs-staff-email). One row per (staff user, school-tenant, week) confirming the reminder was sent, so restarts/overlapping ticks/multi-instance deploys cannot double-send. Denormalized integer references (user_id, school_tenant_id, district_id) with NO foreign keys. Stores no student/staff names, emails, or intervention data -- the overdue PII lives only in the transient email body. week_of is the Monday boundary from weeklyProgress.getWeekStart. See migration-050 header.';

-- Step 3: the dedup key. UNIQUE so a concurrent or repeated tick cannot insert a
-- second send-record for the same staffer/school/week; the digest checks for an
-- existing row (or relies on ON CONFLICT DO NOTHING) before emailing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_overdue_log_reminder_sends_user_school_week
  ON overdue_log_reminder_sends (user_id, school_tenant_id, week_of);

-- Step 4a: §5 school-scope index ("show me every reminder sent for this school
-- this week"). school_tenant_id is the §5 school-tenant identifier; the UNIQUE
-- index above leads with user_id and does not satisfy this requirement on its
-- own.
CREATE INDEX IF NOT EXISTS idx_overdue_log_reminder_sends_school
  ON overdue_log_reminder_sends (school_tenant_id, week_of);

-- Step 4b: §5 district-scope index, supporting district-scoped queries and the
-- future per-tenant opt-out follow-up. NULL district_id values are still
-- indexed by btree and do not participate in district-scoped queries.
CREATE INDEX IF NOT EXISTS idx_overdue_log_reminder_sends_district
  ON overdue_log_reminder_sends (district_id, week_of);

COMMIT;
