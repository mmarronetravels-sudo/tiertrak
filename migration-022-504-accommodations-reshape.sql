-- Migration 022: 504 accommodations JSONB reshape
--
-- Reshapes the foundation PR's accommodations persistence to match Form J's
-- per-domain accommodations layout. Form J (Section 504 Student Accommodation
-- Plan) groups accommodations into three free-text domains rather than a list
-- of per-accommodation rows with a category enum:
--   1. In the educational setting
--   2. For school district extracurricular activities, field trips, and
--      other school related functions
--   3. For district, state, or standardized assessments (i.e. documentation
--      for AP, ACT, SAT, and/or PSAT)
--
-- The Migration 021 student_504_accommodations table modeled accommodations
-- as discrete rows with a 5-value category enum (academic / behavioral /
-- environmental / assessment / other), which doesn't match Form J's actual
-- shape. Migration 022 replaces that table with a JSONB column on
-- student_504_plans, keyed by the three domain keys defined in the form set
-- module (frontend/src/data/504-form-sets/oregon-ode-2025.js
-- formJ.accommodations.domains[].key):
--   { educational: '...', extracurricular: '...', assessments: '...' }
--
-- Persistence shape mirrors the PR #16 weekly_progress_snapshot precedent
-- (immutable JSONB on a parent table). Domain keys are stable across form
-- set versions; if a future ODE handbook update renames a domain, the form
-- set module bumps its formSetVersion and a future migration handles any
-- rename mapping.
--
-- Pre-condition: zero rows exist in student_504_accommodations at migration
-- time. The 504 routes are stubs in this PR (PR 1 is foundation only) — no
-- application code writes to the table. The DROP is therefore data-loss-free.
--
-- Post-condition: 6 tables remain in the 504 schema --
--   student_504_cycles
--   student_504_evaluation_consents
--   student_504_eligibility_determinations
--   student_504_plans                          (with new accommodations JSONB column)
--   student_504_team_members
--   tenant_form_sets
--
-- Idempotent: re-running this migration is a no-op once applied.

ALTER TABLE student_504_plans
  ADD COLUMN IF NOT EXISTS accommodations JSONB DEFAULT '{}'::jsonb;

DROP TABLE IF EXISTS student_504_accommodations;
