-- Migration 023: Note-only intervention flag
--
-- Adds no_progress_monitoring_required to BOTH student_interventions and
-- mtss_meeting_interventions. The flag marks an intervention as "documented
-- without weekly progress logs" (e.g., preferential seating). When true:
--   - The missing-logs notification query in routes/weeklyProgress.js skips
--     the intervention so staff are not pinged to log progress that isn't
--     required.
--   - The MTSS meeting view replaces the amber "no logs recorded" warning
--     with a calm slate info note, and renders "Logs: not required" instead
--     of "Logs: 0".
--   - A "Note only" badge is rendered on intervention surfaces.
-- The progress-notes UI itself stays available — flag-flips are reversible
-- and existing notes are preserved through flips.
--
-- Why the same column on both tables (Option α — snapshot to meeting at
-- save time):
--   - student_interventions.no_progress_monitoring_required is the LIVE
--     value; UI flag-flips PATCH this row.
--   - mtss_meeting_interventions.no_progress_monitoring_required is the
--     IMMUTABLE SNAPSHOT captured at meeting save (POST) or for newly-added
--     interventions on edit (PUT). Existing interventions on a meeting edit
--     preserve their prior snapshot — mirrors the weekly_progress_snapshot
--     "frozen at first save" contract from Migration 020.
-- This means a saved meeting's record of "this was a note-only intervention"
-- stays accurate even if the live flag is flipped later.
--
-- NOT NULL DEFAULT false: existing rows backfill to false (the prior
-- behavior — every intervention required progress monitoring). PG11+ avoids
-- a table rewrite when the default is constant, so the migration is fast
-- on large tables.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes this safe to re-run, and
-- safe whether or not the column was already added out-of-band (e.g., via
-- the Render GUI per master-index Followup 76's drift pattern).

ALTER TABLE student_interventions
  ADD COLUMN IF NOT EXISTS no_progress_monitoring_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE mtss_meeting_interventions
  ADD COLUMN IF NOT EXISTS no_progress_monitoring_required BOOLEAN NOT NULL DEFAULT false;

-- Verify the columns landed with the expected default on both tables
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE column_name = 'no_progress_monitoring_required'
  AND table_name IN ('student_interventions', 'mtss_meeting_interventions')
ORDER BY table_name;
