-- Migration 001: Update user roles
-- Adds counselor and behavior_specialist roles

-- Drop the old constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Add the new constraint with updated roles
ALTER TABLE users ADD CONSTRAINT users_role_check 
CHECK (role IN ('district_admin', 'school_admin', 'teacher', 'counselor', 'behavior_specialist'));