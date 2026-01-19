-- Seed Test Data for TierTrak
-- Lincoln Elementary (tenant_id = 1)

-- Add some staff members (password is 'test123' for all)
INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES
(1, 'teacher1@lincoln.edu', '$2b$10$xPPKzrL5vYqXqHqK5zXqXOJGKrJnZpJKHqKJHqKJHqKJHqKJHqKJH', 'Emily Patterson', 'teacher'),
(1, 'teacher2@lincoln.edu', '$2b$10$xPPKzrL5vYqXqHqK5zXqXOJGKrJnZpJKHqKJHqKJHqKJHqKJHqKJH', 'Michael Rodriguez', 'teacher'),
(1, 'teacher3@lincoln.edu', '$2b$10$xPPKzrL5vYqXqHqK5zXqXOJGKrJnZpJKHqKJHqKJHqKJHqKJHqKJH', 'Jennifer Thompson', 'teacher'),
(1, 'counselor@lincoln.edu', '$2b$10$xPPKzrL5vYqXqHqK5zXqXOJGKrJnZpJKHqKJHqKJHqKJHqKJHqKJH', 'David Chen', 'counselor'),
(1, 'admin@lincoln.edu', '$2b$10$xPPKzrL5vYqXqHqK5zXqXOJGKrJnZpJKHqKJHqKJHqKJHqKJHqKJH', 'Rachel Adams', 'school_admin')
ON CONFLICT (tenant_id, email) DO NOTHING;

-- Add students
INSERT INTO students (tenant_id, first_name, last_name, grade, tier, area, risk_level) VALUES
-- Tier 1 students
(1, 'Emma', 'Wilson', '2nd', 1, 'Academic', 'low'),
(1, 'Liam', 'Brown', '3rd', 1, 'Behavior', 'low'),
(1, 'Olivia', 'Davis', '1st', 1, 'Social-Emotional', 'low'),
(1, 'Noah', 'Miller', '4th', 1, 'Academic', 'low'),

-- Tier 2 students  
(1, 'Sophia', 'Garcia', '2nd', 2, 'Behavior', 'moderate'),
(1, 'Jackson', 'Martinez', '3rd', 2, 'Academic', 'moderate'),
(1, 'Ava', 'Anderson', '5th', 2, 'Social-Emotional', 'moderate'),
(1, 'Lucas', 'Taylor', '1st', 2, 'Behavior', 'moderate'),
(1, 'Mia', 'Thomas', '4th', 2, 'Academic', 'moderate'),

-- Tier 3 students
(1, 'Ethan', 'Jackson', '3rd', 3, 'Behavior', 'high'),
(1, 'Isabella', 'White', '2nd', 3, 'Academic', 'high'),
(1, 'Aiden', 'Harris', '5th', 3, 'Behavior', 'high');

-- Get student IDs for adding interventions (we'll use a simple approach)
-- Add some interventions to Tier 2 and Tier 3 students

-- For Sophia Garcia (Tier 2 Behavior)
INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Check-in/Check-out', 'Daily morning check-ins with Ms. Patterson', 'active', 45, '2026-01-06'
FROM students WHERE first_name = 'Sophia' AND last_name = 'Garcia';

-- For Jackson Martinez (Tier 2 Academic)
INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Small Group Instruction', 'Reading intervention group - Tuesdays and Thursdays', 'active', 60, '2026-01-08'
FROM students WHERE first_name = 'Jackson' AND last_name = 'Martinez';

-- For Ethan Jackson (Tier 3 Behavior)
INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Individual Counseling', 'Weekly sessions with Mr. Chen', 'active', 30, '2026-01-06'
FROM students WHERE first_name = 'Ethan' AND last_name = 'Jackson';

INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Behavior Contract', 'Focus on classroom transitions and peer interactions', 'active', 25, '2026-01-08'
FROM students WHERE first_name = 'Ethan' AND last_name = 'Jackson';

INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Sensory Breaks', 'Scheduled breaks at 10am and 2pm', 'active', 50, '2026-01-10'
FROM students WHERE first_name = 'Ethan' AND last_name = 'Jackson';

-- For Isabella White (Tier 3 Academic)
INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Phonics Intervention', 'Intensive daily phonics support', 'active', 35, '2026-01-06'
FROM students WHERE first_name = 'Isabella' AND last_name = 'White';

INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Small Group Instruction', 'Additional math support', 'active', 40, '2026-01-10'
FROM students WHERE first_name = 'Isabella' AND last_name = 'White';

-- For Aiden Harris (Tier 3 Behavior)
INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Functional Behavior Assessment', 'In progress - collecting ABC data', 'in-progress', 20, '2026-01-13'
FROM students WHERE first_name = 'Aiden' AND last_name = 'Harris';

INSERT INTO student_interventions (student_id, intervention_name, notes, status, progress, start_date)
SELECT id, 'Modified Schedule', 'Reduced transitions, quiet workspace provided', 'active', 55, '2026-01-08'
FROM students WHERE first_name = 'Aiden' AND last_name = 'Harris';

-- Add some progress notes
INSERT INTO progress_notes (student_id, author_id, note, created_at)
SELECT s.id, 1, 'Sophia had a great week! Completed all check-ins and earned her reward.', '2026-01-17 14:30:00'
FROM students s WHERE s.first_name = 'Sophia' AND s.last_name = 'Garcia';

INSERT INTO progress_notes (student_id, author_id, note, created_at)
SELECT s.id, 1, 'Ethan had difficulty during morning transition. Used calm-down corner successfully.', '2026-01-17 15:00:00'
FROM students s WHERE s.first_name = 'Ethan' AND s.last_name = 'Jackson';

INSERT INTO progress_notes (student_id, author_id, note, created_at)
SELECT s.id, 1, 'Ethan showed improvement in peer interactions during structured activities.', '2026-01-16 14:00:00'
FROM students s WHERE s.first_name = 'Ethan' AND s.last_name = 'Jackson';

INSERT INTO progress_notes (student_id, author_id, note, created_at)
SELECT s.id, 1, 'Isabella is making progress with letter-sound correspondence. Still struggling with blends.', '2026-01-16 10:30:00'
FROM students s WHERE s.first_name = 'Isabella' AND s.last_name = 'White';

-- Add some intervention logs
INSERT INTO intervention_logs (student_id, logged_by, log_date, time_of_day, location, notes)
SELECT s.id, 1, '2026-01-17', 'Morning', 'Classroom', 'Check-in completed. Sophia set goal to raise hand before speaking.'
FROM students s WHERE s.first_name = 'Sophia' AND s.last_name = 'Garcia';

INSERT INTO intervention_logs (student_id, logged_by, log_date, time_of_day, location, notes)
SELECT s.id, 1, '2026-01-17', 'Afternoon', 'Classroom', 'Check-out completed. Met 4 of 5 goals today!'
FROM students s WHERE s.first_name = 'Sophia' AND s.last_name = 'Garcia';

INSERT INTO intervention_logs (student_id, logged_by, log_date, time_of_day, location, notes)
SELECT s.id, 1, '2026-01-17', 'Mid-Morning', 'Hallway', 'Difficult transition from gym. Required verbal prompts and escort.'
FROM students s WHERE s.first_name = 'Ethan' AND s.last_name = 'Jackson';

INSERT INTO intervention_logs (student_id, logged_by, log_date, time_of_day, location, notes)
SELECT s.id, 1, '2026-01-17', 'Lunch', 'Cafeteria', 'Positive lunch period. Sat with peers and used appropriate voice level.'
FROM students s WHERE s.first_name = 'Ethan' AND s.last_name = 'Jackson';