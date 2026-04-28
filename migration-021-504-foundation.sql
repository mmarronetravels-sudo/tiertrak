-- Migration 021: 504 v1 foundation
--
-- Creates the 504 plan workflow schema. A cycle bundles all forms for a
-- single 504 evaluation/plan iteration on a student; child records
-- (consents, eligibility determinations, plans, accommodations, team
-- members) attach via cycle_id with composite (cycle_id, tenant_id) FK
-- references so cross-tenant child references are rejected at the schema
-- layer (master-index Followup 81 lesson — composite tenant-bound FKs
-- prevent the cross-tenant-drift class of bug regardless of application
-- bugs in route handlers).
--
-- Form letter mapping (per Oregon ODE handbook):
--   Form C = student_504_evaluation_consents       (Prior Notice and Consent to Evaluate)
--   Form I = student_504_eligibility_determinations (Section 504 Eligibility Determination)
--   Form J = student_504_plans                     (Section 504 Student Accommodation Plan)
--
-- form_set_id + form_set_version live ONLY on student_504_cycles. Child
-- records inherit the version via cycle_id; do NOT denormalize the
-- version onto each child to avoid drift when interpreting historical
-- records.
--
-- Permission tiers (enforced at the route boundary in routes/student504.js
-- and routes/parent504.js):
--   parent-visible: accommodations, team_members (names + roles),
--     procedural_safeguards (static text from form set)
--   gated (Phase 2+): health docs (no schema in PR 1)
--   staff-only: eligibility_determinations.determination_notes,
--     evaluation_consents (audit trail of consent transitions)
--
-- Snapshot pattern from PR #16 (mtss_meeting_interventions.weekly_progress_snapshot)
-- is noted as the precedent for 504 review meetings in Phase 2+ but is
-- NOT implemented in this foundation PR.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS for new tables; DO $$ BEGIN
-- IF NOT EXISTS ... END $$ for the students ALTER. Safe to re-run.

-- ============================================================
-- Prerequisite: students(id, tenant_id) must be UNIQUE so
-- student_504_cycles can reference it via composite FK. Adding a
-- UNIQUE constraint to an existing tenant-scoped table; purely
-- additive (creates a supporting index) but flagged in the commit
-- message because it touches existing schema.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_id_tenant_unique'
      AND conrelid = 'students'::regclass
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_id_tenant_unique UNIQUE (id, tenant_id);
  END IF;
END $$;

-- ============================================================
-- 1. student_504_cycles — parent of all 504 records for one cycle
-- ============================================================
CREATE TABLE IF NOT EXISTS student_504_cycles (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  student_id INTEGER NOT NULL,
  form_set_id VARCHAR(100) NOT NULL,
  form_set_version VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'completed', 'expired', 'discontinued'
  )),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Composite FK enforces cycle and student belong to the same tenant
  -- at the schema layer.
  FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id) ON DELETE CASCADE,
  -- Required so child tables can reference (id, tenant_id) compositely.
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_student_504_cycles_student ON student_504_cycles(student_id);
CREATE INDEX IF NOT EXISTS idx_student_504_cycles_tenant ON student_504_cycles(tenant_id);

-- ============================================================
-- 2. student_504_evaluation_consents — Form C
-- ============================================================
CREATE TABLE IF NOT EXISTS student_504_evaluation_consents (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  consent_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (consent_status IN (
    'pending', 'granted', 'denied', 'revoked'
  )),
  parent_signature_text TEXT,
  parent_signature_at TIMESTAMP,
  staff_signature_text TEXT,
  staff_signature_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cycle_id, tenant_id) REFERENCES student_504_cycles(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_504_evaluation_consents_cycle ON student_504_evaluation_consents(cycle_id);
CREATE INDEX IF NOT EXISTS idx_504_evaluation_consents_tenant ON student_504_evaluation_consents(tenant_id);

-- ============================================================
-- 3. student_504_eligibility_determinations — Form I
-- ============================================================
CREATE TABLE IF NOT EXISTS student_504_eligibility_determinations (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  eligibility_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (eligibility_status IN (
    'pending', 'eligible', 'not_eligible'
  )),
  -- determination_notes is staff-only sensitive content per the permission
  -- tier matrix above. Parent route MUST NOT project this column.
  determination_notes TEXT,
  determined_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cycle_id, tenant_id) REFERENCES student_504_cycles(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_504_eligibility_determinations_cycle ON student_504_eligibility_determinations(cycle_id);
CREATE INDEX IF NOT EXISTS idx_504_eligibility_determinations_tenant ON student_504_eligibility_determinations(tenant_id);

-- ============================================================
-- 4. student_504_plans — Form J
-- ============================================================
CREATE TABLE IF NOT EXISTS student_504_plans (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  plan_status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (plan_status IN (
    'draft', 'active', 'expired', 'discontinued'
  )),
  effective_date DATE,
  review_date DATE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cycle_id, tenant_id) REFERENCES student_504_cycles(id, tenant_id) ON DELETE CASCADE,
  -- Required so student_504_accommodations can reference (id, tenant_id)
  -- compositely.
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_504_plans_cycle ON student_504_plans(cycle_id);
CREATE INDEX IF NOT EXISTS idx_504_plans_tenant ON student_504_plans(tenant_id);

-- ============================================================
-- 5. student_504_accommodations — child of plans
-- ============================================================
CREATE TABLE IF NOT EXISTS student_504_accommodations (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  accommodation_text TEXT NOT NULL,
  category VARCHAR(50) CHECK (category IN (
    'academic', 'behavioral', 'environmental', 'assessment', 'other'
  )),
  order_position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id, tenant_id) REFERENCES student_504_plans(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_504_accommodations_plan ON student_504_accommodations(plan_id);
CREATE INDEX IF NOT EXISTS idx_504_accommodations_tenant ON student_504_accommodations(tenant_id);

-- ============================================================
-- 6. student_504_team_members
-- ============================================================
CREATE TABLE IF NOT EXISTS student_504_team_members (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  -- user_id nullable for team members who are not platform users (e.g.,
  -- parents recorded by name, outside specialists). member_name is the
  -- display fallback in either case (denormalized so historical records
  -- stay meaningful if a user's full_name later changes or is deleted).
  user_id INTEGER REFERENCES users(id),
  member_name VARCHAR(255) NOT NULL,
  member_role VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cycle_id, tenant_id) REFERENCES student_504_cycles(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_504_team_members_cycle ON student_504_team_members(cycle_id);
CREATE INDEX IF NOT EXISTS idx_504_team_members_tenant ON student_504_team_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_504_team_members_user ON student_504_team_members(user_id);

-- ============================================================
-- 7. tenant_form_sets — which form set + version each tenant uses
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_form_sets (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  form_set_id VARCHAR(100) NOT NULL,
  form_set_version VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, form_set_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_form_sets_tenant ON tenant_form_sets(tenant_id);

-- ============================================================
-- Verification
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE 'student_504_%' OR table_name = 'tenant_form_sets')
ORDER BY table_name;

SELECT conname
FROM pg_constraint
WHERE conrelid = 'students'::regclass
  AND conname = 'students_id_tenant_unique';
