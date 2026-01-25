-- Migration 005: Progress Tracking & Reporting
-- Adds weekly progress logs, intervention goals, and expected frequency

-- Add expected frequency to student_interventions
ALTER TABLE student_interventions
ADD COLUMN IF NOT EXISTS expected_frequency VARCHAR(50) DEFAULT 'weekly' CHECK (expected_frequency IN ('daily', 'twice_weekly', 'weekly', 'biweekly', 'monthly')),
ADD COLUMN IF NOT EXISTS goal_description TEXT,
ADD COLUMN IF NOT EXISTS goal_target_date DATE,
ADD COLUMN IF NOT EXISTS goal_target_rating INTEGER CHECK (goal_target_rating >= 1 AND goal_target_rating <= 5);

-- Create weekly progress table
CREATE TABLE IF NOT EXISTS weekly_progress (
  id SERIAL PRIMARY KEY,
  student_intervention_id INTEGER REFERENCES student_interventions(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('Implemented as Planned', 'Partially Implemented', 'Not Implemented', 'Student Absent')),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  response VARCHAR(50) CHECK (response IN ('Positive', 'Neutral', 'Resistant')),
  notes TEXT,
  logged_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_intervention_id, week_of)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_weekly_progress_student ON weekly_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_weekly_progress_intervention ON weekly_progress(student_intervention_id);
CREATE INDEX IF NOT EXISTS idx_weekly_progress_week ON weekly_progress(week_of);

-- Verify the migration
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'student_interventions' 
AND column_name IN ('expected_frequency', 'goal_description', 'goal_target_date', 'goal_target_rating');
