-- Migration 013: Add password reset and Google auth fields
-- Run this on your database

-- Add password reset columns
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP,
ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users(password_reset_token);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);