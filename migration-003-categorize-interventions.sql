-- Migration 003: Categorize interventions by area and add more area-specific interventions

-- First, update existing interventions with their proper areas
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Check-in/Check-out';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Behavior Contract';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Self-Monitoring Checklist';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Sensory Breaks';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Visual Schedule';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Token Economy System';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Modified Schedule';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Functional Behavior Assessment';
UPDATE intervention_templates SET area = 'Behavior' WHERE name = 'Parent Communication Plan';

UPDATE intervention_templates SET area = 'Academic' WHERE name = 'Small Group Instruction';
UPDATE intervention_templates SET area = 'Academic' WHERE name = 'Phonics Intervention';
UPDATE intervention_templates SET area = 'Academic' WHERE name = 'Preferential Seating';

UPDATE intervention_templates SET area = 'Social-Emotional' WHERE name = 'Individual Counseling';
UPDATE intervention_templates SET area = 'Social-Emotional' WHERE name = 'Social Skills Group';
UPDATE intervention_templates SET area = 'Social-Emotional' WHERE name = 'Mentor Program';

-- Add new ACADEMIC interventions
INSERT INTO intervention_templates (tenant_id, name, description, area, tier, is_system_default) VALUES
(NULL, 'Shortened Assignments', 'Reduce number of problems/questions while maintaining key concepts', 'Academic', 1, TRUE),
(NULL, 'Extended Time', 'Additional time for completing assignments and tests', 'Academic', 1, TRUE),
(NULL, 'Chunked Assignments', 'Break larger assignments into smaller, manageable parts', 'Academic', 1, TRUE),
(NULL, 'Graphic Organizers', 'Visual tools to help organize thoughts and information', 'Academic', 1, TRUE),
(NULL, 'Read Aloud', 'Text read aloud by teacher, aide, or technology', 'Academic', 1, TRUE),
(NULL, 'Calculator Use', 'Allow calculator for math computations', 'Academic', 1, TRUE),
(NULL, 'Word Bank', 'Provide word choices for fill-in-the-blank or written responses', 'Academic', 1, TRUE),
(NULL, 'Reduced Distractions', 'Separate testing location or quiet workspace', 'Academic', 1, TRUE),
(NULL, 'Math Intervention', 'Targeted math instruction in small group', 'Academic', 2, TRUE),
(NULL, 'Reading Fluency Practice', 'Repeated reading and timed fluency drills', 'Academic', 2, TRUE),
(NULL, 'Writing Support', 'Sentence starters, writing frames, or dictation', 'Academic', 2, TRUE),
(NULL, 'One-on-One Tutoring', 'Individualized academic instruction', 'Academic', 3, TRUE);

-- Add new BEHAVIOR interventions
INSERT INTO intervention_templates (tenant_id, name, description, area, tier, is_system_default) VALUES
(NULL, 'Proximity Control', 'Teacher positions themselves near student during instruction', 'Behavior', 1, TRUE),
(NULL, 'Nonverbal Cues', 'Agreed-upon signals between teacher and student', 'Behavior', 1, TRUE),
(NULL, 'Structured Choices', 'Provide limited choices to increase engagement', 'Behavior', 1, TRUE),
(NULL, 'Movement Breaks', 'Scheduled opportunities for physical movement', 'Behavior', 1, TRUE),
(NULL, 'First/Then Board', 'Visual showing required task before preferred activity', 'Behavior', 2, TRUE),
(NULL, 'Cool-Down Pass', 'Student can request break when feeling overwhelmed', 'Behavior', 2, TRUE),
(NULL, 'Daily Behavior Report Card', 'Tracking specific behaviors throughout the day', 'Behavior', 2, TRUE),
(NULL, 'Planned Ignoring', 'Strategically ignoring minor behaviors while reinforcing positive', 'Behavior', 1, TRUE),
(NULL, 'Restorative Conversation', 'Guided conversation to repair relationships after conflict', 'Behavior', 2, TRUE),
(NULL, 'Behavior Intervention Plan', 'Formal plan based on FBA with specific strategies', 'Behavior', 3, TRUE);

-- Add new SOCIAL-EMOTIONAL interventions
INSERT INTO intervention_templates (tenant_id, name, description, area, tier, is_system_default) VALUES
(NULL, 'Morning Greeting', 'Personal greeting and brief check-in each morning', 'Social-Emotional', 1, TRUE),
(NULL, 'Feelings Check-In', 'Regular opportunities to identify and express emotions', 'Social-Emotional', 1, TRUE),
(NULL, 'Calm Corner', 'Designated space with tools for self-regulation', 'Social-Emotional', 1, TRUE),
(NULL, 'Peer Buddy', 'Paired with supportive peer for activities and transitions', 'Social-Emotional', 2, TRUE),
(NULL, 'Lunch Bunch', 'Small group lunch with counselor or trusted adult', 'Social-Emotional', 2, TRUE),
(NULL, 'Coping Skills Practice', 'Direct instruction and practice of regulation strategies', 'Social-Emotional', 2, TRUE),
(NULL, 'Anxiety Management Plan', 'Individualized strategies for managing anxiety', 'Social-Emotional', 3, TRUE),
(NULL, 'Crisis Safety Plan', 'Plan for responding to emotional crises', 'Social-Emotional', 3, TRUE),
(NULL, 'Play Therapy', 'Therapeutic play sessions with trained professional', 'Social-Emotional', 3, TRUE),
(NULL, 'Family Counseling Referral', 'Referral for family-based therapeutic support', 'Social-Emotional', 3, TRUE);