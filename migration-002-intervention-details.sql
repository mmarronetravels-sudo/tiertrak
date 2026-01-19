-- Migration 002: Add intervention log entries
-- Tracks each occurrence of an intervention with date, time of day, and location

-- Create intervention_logs table
CREATE TABLE intervention_logs (
    id SERIAL PRIMARY KEY,
    student_intervention_id INTEGER REFERENCES student_interventions(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    logged_by INTEGER REFERENCES users(id),
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    time_of_day VARCHAR(50) NOT NULL CHECK (time_of_day IN ('Before School', 'Morning', 'Mid-Morning', 'Lunch', 'Afternoon', 'After School')),
    location VARCHAR(100) NOT NULL CHECK (location IN ('Classroom', 'Hallway', 'Cafeteria', 'Playground', 'Gym', 'Library', 'Office', 'Counselor Office', 'Special Education Room', 'Other')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);