-- Migration 036: Discipline referrals foundation
--
-- First PR of the discipline-referral feature. Schema-only: adds the
-- referral table, a join table for multiple consequences per referral,
-- and 7 tenant-customizable controlled-vocabulary tables seeded with
-- defaults per existing school-tenant. No route or UI changes.
-- Follow-up PRs add the routes, the customization UI, and wire new
-- tenants to inherit the seed lists at tenant-creation time.
--
-- §4B (PII): discipline referrals are PII under CLAUDE.md §4B
-- ("intervention history, tier placements, meeting notes, referral
-- data"). IEP / 504 / BIP status MUST NOT be stored on the referral
-- row. The D9 product note is explicit: link to the student record
-- only. A referral surface that needs to display those facts looks
-- them up at read time from students.* / student_504_* / etc., scoped
-- by the same tenant and student keys as the referral.
--
-- §5 (multi-tenancy): every table is school-tenant-scoped. The
-- composite-FK cross-tenant rejection pattern from Migration 021
-- (UNIQUE(id, tenant_id) on the parent + composite child FK
-- (child_id, tenant_id) REFERENCES parent(id, tenant_id)) is used
-- for every FK from discipline_referrals to a vocabulary row and
-- from the join table back to the referral and consequence. Cross-
-- tenant rows are rejected at the schema layer regardless of any
-- future application bug in route handlers. Staff FKs (referring
-- and reviewing) are scalar REFERENCES users(id), matching the
-- M021 precedent — user-tenant boundary is enforced at the
-- application layer via user_school_access, not at the schema layer.
--
-- Vocabulary seeding strategy: per-tenant default rows are seeded by
-- this migration for every existing tenant with type = 'school'.
-- Idempotent via ON CONFLICT against the per-tenant partial-unique
-- label index. New tenants created AFTER this migration runs do NOT
-- automatically inherit these defaults — wiring new-tenant seeding
-- into the tenant-creation route is a separate follow-up PR (will
-- surface as an OPEN ITEM at session close). Until that lands, new
-- tenants will see empty discipline vocabularies and must populate
-- via the customization UI (also a future PR).
--
-- Excluded behaviors: handbook §5.1 lists "Excessive tardiness" and
-- "Truancy" as Level 1 infractions but explicitly defers consequences
-- to the attendance policy. They are NOT seeded into
-- discipline_behaviors — they belong in the attendance system, not
-- in the discipline referral picklist. A school whose local policy
-- diverges can add either via the per-tenant vocab UI.
--
-- Conditional subtypes: harassment_subtype_id is only meaningful when
-- the chosen behavior is harassment; weapon_subtype_id only when the
-- chosen behavior is weapon-related. Both columns are NULLable on
-- the referral. The conditional-population rule is enforced at the
-- route/application layer, not in a CHECK constraint — encoding it
-- in SQL would require coupling the vocab table to the schema layer
-- in a way that breaks tenant customization (a tenant can rename or
-- deactivate the "Harassment" row).
--
-- Idempotency: CREATE TABLE / INDEX IF NOT EXISTS; INSERT … ON
-- CONFLICT DO NOTHING against the per-tenant partial-unique label
-- index. Safe to re-run.
--
-- Atomicity: entire migration wrapped in a single BEGIN / COMMIT.
--
-- Rollback (manual, run inside a transaction):
--   BEGIN;
--   DROP TABLE IF EXISTS discipline_referral_consequences;
--   DROP TABLE IF EXISTS discipline_referrals;
--   DROP TABLE IF EXISTS discipline_behaviors;
--   DROP TABLE IF EXISTS discipline_consequences;
--   DROP TABLE IF EXISTS discipline_locations;
--   DROP TABLE IF EXISTS discipline_motivations;
--   DROP TABLE IF EXISTS discipline_others_involved;
--   DROP TABLE IF EXISTS discipline_harassment_subtypes;
--   DROP TABLE IF EXISTS discipline_weapon_subtypes;
--   COMMIT;

BEGIN;

-- ============================================================
-- Vocabulary tables (7)
-- ============================================================
-- Each table is school-tenant-scoped, tenant-customizable. Shape:
--   id SERIAL PRIMARY KEY
--   tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
--   label TEXT NOT NULL
--   is_active BOOLEAN NOT NULL DEFAULT TRUE
--   sort_order INTEGER NOT NULL DEFAULT 0
--   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--   UNIQUE (id, tenant_id) -- enables composite FK from discipline_referrals
--
-- discipline_behaviors adds two extra columns:
--   severity_level INTEGER NOT NULL CHECK IN (1, 2, 3)
--   managed_by VARCHAR(10) NOT NULL CHECK IN ('staff', 'admin')
--
-- discipline_consequences adds one extra column:
--   is_restorative BOOLEAN NOT NULL DEFAULT FALSE
--
-- Per-tenant partial-unique on (tenant_id, lower(label)) WHERE is_active
-- prevents duplicate active labels per tenant while allowing a
-- deactivated label to be re-added later under the same name.
-- (M035 precedent for partial-unique-per-tenant.)

-- 1) discipline_locations
CREATE TABLE IF NOT EXISTS discipline_locations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_discipline_locations_tenant
  ON discipline_locations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discipline_locations_label_per_tenant
  ON discipline_locations(tenant_id, lower(label))
  WHERE is_active = TRUE;

-- 2) discipline_motivations
CREATE TABLE IF NOT EXISTS discipline_motivations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_discipline_motivations_tenant
  ON discipline_motivations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discipline_motivations_label_per_tenant
  ON discipline_motivations(tenant_id, lower(label))
  WHERE is_active = TRUE;

-- 3) discipline_others_involved
CREATE TABLE IF NOT EXISTS discipline_others_involved (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_discipline_others_involved_tenant
  ON discipline_others_involved(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discipline_others_involved_label_per_tenant
  ON discipline_others_involved(tenant_id, lower(label))
  WHERE is_active = TRUE;

-- 4) discipline_consequences (with is_restorative flag)
CREATE TABLE IF NOT EXISTS discipline_consequences (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_restorative BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_discipline_consequences_tenant
  ON discipline_consequences(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discipline_consequences_label_per_tenant
  ON discipline_consequences(tenant_id, lower(label))
  WHERE is_active = TRUE;

-- 5) discipline_harassment_subtypes
CREATE TABLE IF NOT EXISTS discipline_harassment_subtypes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_discipline_harassment_subtypes_tenant
  ON discipline_harassment_subtypes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discipline_harassment_subtypes_label_per_tenant
  ON discipline_harassment_subtypes(tenant_id, lower(label))
  WHERE is_active = TRUE;

-- 6) discipline_weapon_subtypes
CREATE TABLE IF NOT EXISTS discipline_weapon_subtypes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_discipline_weapon_subtypes_tenant
  ON discipline_weapon_subtypes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discipline_weapon_subtypes_label_per_tenant
  ON discipline_weapon_subtypes(tenant_id, lower(label))
  WHERE is_active = TRUE;

-- 7) discipline_behaviors (with severity_level + managed_by)
CREATE TABLE IF NOT EXISTS discipline_behaviors (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  severity_level INTEGER NOT NULL CHECK (severity_level IN (1, 2, 3)),
  managed_by VARCHAR(10) NOT NULL CHECK (managed_by IN ('staff', 'admin')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_discipline_behaviors_tenant
  ON discipline_behaviors(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discipline_behaviors_label_per_tenant
  ON discipline_behaviors(tenant_id, lower(label))
  WHERE is_active = TRUE;

-- ============================================================
-- discipline_referrals — the main record
-- ============================================================
-- Status lifecycle: 'submitted' -> 'under_review' -> 'resolved'.
-- reviewing_admin_id and reviewed_at are NULL until an admin opens
-- the referral; populated when status transitions to 'under_review'
-- or 'resolved'.
--
-- Composite FKs enforce same-tenant for student + every vocab row.
-- Staff FKs are scalar REFERENCES users(id) — matches M021 precedent.
-- The user-tenant boundary is enforced at the route layer via
-- user_school_access; cross-tenant staff assignment is an
-- application-layer concern.
--
-- time_out_of_instruction is a bucket label, not a numeric value.
-- CHECK enum is enforced at the schema layer; bucket list provided
-- by the handbook owner.

CREATE TABLE IF NOT EXISTS discipline_referrals (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  student_id INTEGER NOT NULL,
  referring_staff_id INTEGER NOT NULL REFERENCES users(id),
  grade VARCHAR(20) NOT NULL,
  incident_date DATE NOT NULL,
  incident_time TIME,
  location_id INTEGER NOT NULL,
  behavior_id INTEGER NOT NULL,
  motivation_id INTEGER,
  others_involved_id INTEGER,
  harassment_subtype_id INTEGER,
  weapon_subtype_id INTEGER,
  time_out_of_instruction VARCHAR(20) CHECK (
    time_out_of_instruction IN ('<5 min', '6-15 min', '16-30 min', '31-60 min', '>1 hr')
    OR time_out_of_instruction IS NULL
  ),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('submitted', 'under_review', 'resolved')
  ),
  reviewing_admin_id INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  staff_notes TEXT,
  admin_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Composite FKs (M021 pattern). Cross-tenant references rejected at
  -- the schema layer. NULLable vocab FKs are MATCH SIMPLE: PG skips
  -- the FK check when the referencing column is NULL even if
  -- tenant_id is NOT NULL.
  FOREIGN KEY (student_id, tenant_id)
    REFERENCES students(id, tenant_id),
  FOREIGN KEY (location_id, tenant_id)
    REFERENCES discipline_locations(id, tenant_id),
  FOREIGN KEY (behavior_id, tenant_id)
    REFERENCES discipline_behaviors(id, tenant_id),
  FOREIGN KEY (motivation_id, tenant_id)
    REFERENCES discipline_motivations(id, tenant_id),
  FOREIGN KEY (others_involved_id, tenant_id)
    REFERENCES discipline_others_involved(id, tenant_id),
  FOREIGN KEY (harassment_subtype_id, tenant_id)
    REFERENCES discipline_harassment_subtypes(id, tenant_id),
  FOREIGN KEY (weapon_subtype_id, tenant_id)
    REFERENCES discipline_weapon_subtypes(id, tenant_id),
  -- Enables composite FK from discipline_referral_consequences.
  UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_discipline_referrals_tenant
  ON discipline_referrals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_discipline_referrals_tenant_student
  ON discipline_referrals(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_discipline_referrals_tenant_status
  ON discipline_referrals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_discipline_referrals_tenant_incident_date
  ON discipline_referrals(tenant_id, incident_date);

-- ============================================================
-- discipline_referral_consequences — many-per-referral join
-- ============================================================
-- A single referral may be resolved with multiple consequences
-- (handbook §5.1: "a single situation may involve several levels of
-- discipline at once"). Composite FKs to both sides enforce same-
-- tenant; ON DELETE CASCADE from the referral keeps the join clean
-- when a referral is deleted. tenant_id column is required by §5
-- (every school-scoped table carries a school-tenant identifier
-- column with an index).

CREATE TABLE IF NOT EXISTS discipline_referral_consequences (
  referral_id INTEGER NOT NULL,
  consequence_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (referral_id, consequence_id),
  FOREIGN KEY (referral_id, tenant_id)
    REFERENCES discipline_referrals(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (consequence_id, tenant_id)
    REFERENCES discipline_consequences(id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_discipline_referral_consequences_tenant
  ON discipline_referral_consequences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_discipline_referral_consequences_consequence
  ON discipline_referral_consequences(consequence_id, tenant_id);

-- ============================================================
-- Per-tenant seeding of default vocabularies
-- ============================================================
-- Seeds defaults for every existing tenant of type='school'. Each
-- INSERT cross-joins the school-tenant set against the vocab VALUES
-- list. ON CONFLICT targets the per-tenant partial-unique label
-- index, so re-runs are no-ops and operator additions/renames in the
-- meantime are preserved.
--
-- New tenants created after this migration runs will NOT inherit
-- these defaults automatically. Follow-up PR will wire seeding into
-- the tenant-creation route.

-- locations (16)
INSERT INTO discipline_locations (tenant_id, label, sort_order)
SELECT t.id, v.label, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Classroom', 1),
  ('Hallway / Breezeway', 2),
  ('Cafeteria', 3),
  ('Playground / Recess', 4),
  ('Bus', 5),
  ('Bus Loading Zone', 6),
  ('Bathroom / Restroom', 7),
  ('Office', 8),
  ('Gym', 9),
  ('Library', 10),
  ('Locker Room', 11),
  ('Parking Lot', 12),
  ('On Field Trip', 13),
  ('Special Event / Assembly', 14),
  ('Other', 15),
  ('Unknown', 16)
) AS v(label, sort_order)
WHERE t.type = 'school'
ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;

-- motivations (7 — SWIS canonical)
INSERT INTO discipline_motivations (tenant_id, label, sort_order)
SELECT t.id, v.label, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Avoid Adult(s)', 1),
  ('Avoid Peer(s)', 2),
  ('Avoid Tasks/Activities', 3),
  ('Obtain Adult Attention', 4),
  ('Obtain Peer Attention', 5),
  ('Obtain Items/Activities', 6),
  ('Don''t Know', 7)
) AS v(label, sort_order)
WHERE t.type = 'school'
ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;

-- others_involved (7 — SWIS canonical)
INSERT INTO discipline_others_involved (tenant_id, label, sort_order)
SELECT t.id, v.label, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('None', 1),
  ('Peers', 2),
  ('Staff', 3),
  ('Teacher', 4),
  ('Substitute', 5),
  ('Other', 6),
  ('Unknown', 7)
) AS v(label, sort_order)
WHERE t.type = 'school'
ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;

-- consequences (22 — 16 not-restorative + 6 restorative).
-- is_restorative reflects the nature of the action, NOT the source
-- list it came from. Exclusionary actions (bus suspension, classroom
-- exclusion / time-out), privilege removal (loss of privilege), and
-- the status placeholder "Action pending" are FALSE despite appearing
-- in the SWIS standard menu alongside genuinely restorative items.
INSERT INTO discipline_consequences (tenant_id, label, sort_order, is_restorative)
SELECT t.id, v.label, v.sort_order, v.is_restorative
FROM tenants t
CROSS JOIN (VALUES
  -- From handbook §5.1 per-level menus
  ('Parent notification', 1, FALSE),
  ('Parental conference', 2, FALSE),
  ('Warning', 3, FALSE),
  ('Work assignment', 4, FALSE),
  ('Detention', 5, FALSE),
  ('Double detention', 6, FALSE),
  ('Temporary leave', 7, FALSE),
  ('In-school suspension', 8, FALSE),
  ('Out-of-school suspension', 9, FALSE),
  ('Recommended expulsion', 10, FALSE),
  ('Referral to authorities', 11, FALSE),
  ('Financial restitution', 12, FALSE),
  -- From SWIS standard menu (is_restorative flag distinguishes —
  -- bus suspension, classroom exclusion / time-out, loss of privilege,
  -- and action pending are not restorative)
  ('Conference with student', 13, TRUE),
  ('Individualized instruction', 14, TRUE),
  ('Restorative practice (chat / impromptu circle)', 15, TRUE),
  ('Community service', 16, TRUE),
  ('Restitution', 17, TRUE),
  ('Loss of privilege', 18, FALSE),
  ('Request for additional support', 19, TRUE),
  ('Classroom exclusion / time-out', 20, FALSE),
  ('Bus suspension', 21, FALSE),
  ('Action pending', 22, FALSE)
) AS v(label, sort_order, is_restorative)
WHERE t.type = 'school'
ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;

-- harassment_subtypes (8 — SWIS / handbook reportable categories)
INSERT INTO discipline_harassment_subtypes (tenant_id, label, sort_order)
SELECT t.id, v.label, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Gender', 1),
  ('Physical Characteristics', 2),
  ('Race', 3),
  ('Religion', 4),
  ('Sexual', 5),
  ('Disability/Exceptionality', 6),
  ('Ethnicity', 7),
  ('Other', 8)
) AS v(label, sort_order)
WHERE t.type = 'school'
ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;

-- weapon_subtypes (4 — handbook categories)
INSERT INTO discipline_weapon_subtypes (tenant_id, label, sort_order)
SELECT t.id, v.label, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Gun', 1),
  ('Knife > 6"', 2),
  ('Knife < 6"', 3),
  ('Other', 4)
) AS v(label, sort_order)
WHERE t.type = 'school'
ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;

-- behaviors (20 — handbook §5.1 L1/L2/L3, attendance rows excluded).
-- managed_by mapping: L1 = staff-managed (teacher writes the referral,
-- admin sees it at review). L2/L3 = admin-managed (immediate office
-- routing). Schools whose policy diverges can override per row via
-- the customization UI.
INSERT INTO discipline_behaviors (tenant_id, label, sort_order, severity_level, managed_by)
SELECT t.id, v.label, v.sort_order, v.severity_level, v.managed_by
FROM tenants t
CROSS JOIN (VALUES
  -- Level 1 (staff-managed)
  ('Profanity', 1, 1, 'staff'),
  ('Dress code violation', 2, 1, 'staff'),
  ('Defiance / disrespect / insubordination', 3, 1, 'staff'),
  ('Forgery of school passes or excuses', 4, 1, 'staff'),
  ('Disorderly conduct', 5, 1, 'staff'),
  -- Level 2 (admin-managed)
  ('Fighting', 6, 2, 'admin'),
  ('Harassment', 7, 2, 'admin'),
  ('Smoking on school grounds', 8, 2, 'admin'),
  ('Larceny', 9, 2, 'admin'),
  ('Refusal to abide by school rules', 10, 2, 'admin'),
  ('Matters of public safety', 11, 2, 'admin'),
  ('Disorderly conduct — threats of violence', 12, 2, 'admin'),
  -- Level 3 (admin-managed)
  ('Assault', 13, 3, 'admin'),
  ('Arson', 14, 3, 'admin'),
  ('Socially unaccepted / immoral behavior', 15, 3, 'admin'),
  ('Destruction or defacement of property', 16, 3, 'admin'),
  ('Use or possession of alcohol or drugs', 17, 3, 'admin'),
  ('Carrying a knife or weapon', 18, 3, 'admin'),
  ('Bomb threat', 19, 3, 'admin'),
  ('Fireworks or explosive material', 20, 3, 'admin')
) AS v(label, sort_order, severity_level, managed_by)
WHERE t.type = 'school'
ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;

COMMIT;

-- ============================================================
-- Verification
-- ============================================================

-- All 9 tables present.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'discipline_%'
ORDER BY table_name;

-- Composite UNIQUE constraints landed (one per vocab + referral).
SELECT conname, conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'u'
  AND conrelid::regclass::text LIKE 'discipline_%'
ORDER BY table_name, conname;

-- Per-tenant partial-unique label indexes landed (one per vocab).
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'discipline_%'
  AND indexname LIKE '%_label_per_tenant'
ORDER BY tablename;

-- Seed counts. Expected per school-tenant:
--   locations 16, motivations 7, others_involved 7,
--   consequences 22, harassment_subtypes 8, weapon_subtypes 4,
--   behaviors 20.
-- Totals = (school_tenant_count) * (per-tenant count).
SELECT 'discipline_locations'           AS vocab_table, COUNT(*) AS total_rows FROM discipline_locations
UNION ALL
SELECT 'discipline_motivations',                COUNT(*) FROM discipline_motivations
UNION ALL
SELECT 'discipline_others_involved',            COUNT(*) FROM discipline_others_involved
UNION ALL
SELECT 'discipline_consequences',               COUNT(*) FROM discipline_consequences
UNION ALL
SELECT 'discipline_harassment_subtypes',        COUNT(*) FROM discipline_harassment_subtypes
UNION ALL
SELECT 'discipline_weapon_subtypes',            COUNT(*) FROM discipline_weapon_subtypes
UNION ALL
SELECT 'discipline_behaviors',                  COUNT(*) FROM discipline_behaviors
ORDER BY vocab_table;

-- Sanity: every school tenant has exactly the expected per-tenant
-- counts. A tenant missing rows means either: (a) the migration was
-- re-run after the operator edited rows (legitimate, ON CONFLICT
-- preserves the operator's state), or (b) the tenant was created
-- after the migration ran and is awaiting the follow-up new-tenant
-- seeding wire-up.
SELECT t.id AS tenant_id, t.name,
  (SELECT COUNT(*) FROM discipline_locations           WHERE tenant_id = t.id) AS locations,
  (SELECT COUNT(*) FROM discipline_motivations         WHERE tenant_id = t.id) AS motivations,
  (SELECT COUNT(*) FROM discipline_others_involved     WHERE tenant_id = t.id) AS others_involved,
  (SELECT COUNT(*) FROM discipline_consequences        WHERE tenant_id = t.id) AS consequences,
  (SELECT COUNT(*) FROM discipline_harassment_subtypes WHERE tenant_id = t.id) AS harassment_subtypes,
  (SELECT COUNT(*) FROM discipline_weapon_subtypes     WHERE tenant_id = t.id) AS weapon_subtypes,
  (SELECT COUNT(*) FROM discipline_behaviors           WHERE tenant_id = t.id) AS behaviors
FROM tenants t
WHERE t.type = 'school'
ORDER BY t.id;
