-- Migration 006: Add meeting_date to progress_notes
-- Run: psql tiertrak -f migration-006-meeting-date.sql

-- Add meeting_date column (defaults to created_at date for existing records)
ALTER TABLE progress_notes 
ADD COLUMN meeting_date DATE;

-- Update existing records to use their created_at date
UPDATE progress_notes 
SET meeting_date = DATE(created_at);

-- Make it NOT NULL with a default for future records
ALTER TABLE progress_notes 
ALTER COLUMN meeting_date SET DEFAULT CURRENT_DATE;

-- Verify
SELECT id, meeting_date, created_at FROM progress_notes LIMIT 5;
