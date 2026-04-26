-- Migration 020: MTSS meeting weekly_progress snapshot
--
-- Adds an immutable JSONB snapshot of weekly_progress logs to each
-- mtss_meeting_interventions row. The snapshot is captured at meeting save
-- time and is NEVER updated by subsequent edits to or deletions of the
-- underlying weekly_progress rows. This freezes "what data the team
-- reviewed" so future readers see the meeting as it stood when it was held.
--
-- Snapshot shape (per element of the JSONB array):
--   {
--     "week_of": "YYYY-MM-DD",
--     "status": "Implemented as Planned" | ...,
--     "rating": 1..5,
--     "response": "Positive" | "Neutral" | "Resistant",
--     "notes": text,
--     "logged_by_name": text (denormalized at snapshot time),
--     "logged_by_role": text (denormalized at snapshot time),
--     "created_at": ISO 8601 timestamp
--   }
--
-- Existing mtss_meeting_interventions rows backfill to '[]'::jsonb. The
-- view-past-meeting UI distinguishes three cases by (snapshot.length,
-- total_logs):
--   - snapshot.length === 0 && total_logs > 0   → LEGACY meeting
--   - snapshot.length === 0 && total_logs === 0 → ZERO-DATA review
--   - snapshot.length > 0                       → FULL render
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes this safe to re-run, and
-- safe whether or not the column was already added out-of-band (e.g.,
-- via the Render GUI per master-index Followup 76's drift pattern).

ALTER TABLE mtss_meeting_interventions
  ADD COLUMN IF NOT EXISTS weekly_progress_snapshot JSONB DEFAULT '[]'::jsonb;

-- Verify the column landed with the expected default
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'mtss_meeting_interventions'
  AND column_name = 'weekly_progress_snapshot';
