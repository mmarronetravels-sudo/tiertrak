-- TierTrak Database Schema

-- Tenants table (schools or districts)
CREATE TABLE tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('school', 'district')),
    subdomain VARCHAR(100) UNIQUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table (teachers, specialists, admins)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('district_admin', 'school_admin', 'teacher', 'specialist')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, email)
);

-- Students table
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    grade VARCHAR(20) NOT NULL,
    teacher_id INTEGER REFERENCES users(id),
    tier INTEGER DEFAULT 1 CHECK (tier IN (1, 2, 3)),
    area VARCHAR(50) CHECK (area IN ('Behavior', 'Academic', 'Social-Emotional')),
    risk_level VARCHAR(20) DEFAULT 'low' CHECK (risk_level IN ('low', 'moderate', 'high')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Intervention templates (customizable per tenant)
CREATE TABLE intervention_templates (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    area VARCHAR(50) CHECK (area IN ('Behavior', 'Academic', 'Social-Emotional')),
    tier INTEGER CHECK (tier IN (1, 2, 3)),
    is_system_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Student interventions (active interventions assigned to students)
CREATE TABLE student_interventions (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    intervention_template_id INTEGER REFERENCES intervention_templates(id),
    assigned_by INTEGER REFERENCES users(id),
    intervention_name VARCHAR(255) NOT NULL,
    notes TEXT,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'in-progress', 'completed', 'discontinued')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Progress notes
CREATE TABLE progress_notes (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id),
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default intervention templates (available to all tenants)
INSERT INTO intervention_templates (tenant_id, name, description, area, tier, is_system_default) VALUES
(NULL, 'Check-in/Check-out', 'Daily check-ins with designated adult to review behavior goals', 'Behavior', 2, TRUE),
(NULL, 'Behavior Contract', 'Written agreement outlining expected behaviors and rewards', 'Behavior', 2, TRUE),
(NULL, 'Small Group Instruction', 'Targeted instruction in small group setting', 'Academic', 2, TRUE),
(NULL, 'Individual Counseling', 'One-on-one sessions with school counselor or psychologist', 'Social-Emotional', 3, TRUE),
(NULL, 'Social Skills Group', 'Group sessions focused on developing social skills', 'Social-Emotional', 2, TRUE),
(NULL, 'Self-Monitoring Checklist', 'Student tracks own behavior using checklist', 'Behavior', 2, TRUE),
(NULL, 'Mentor Program', 'Student paired with adult mentor for regular meetings', 'Social-Emotional', 2, TRUE),
(NULL, 'Phonics Intervention', 'Targeted phonics instruction for reading support', 'Academic', 2, TRUE),
(NULL, 'Modified Schedule', 'Adjusted daily schedule to support student needs', 'Behavior', 3, TRUE),
(NULL, 'Functional Behavior Assessment', 'Comprehensive assessment to understand behavior function', 'Behavior', 3, TRUE),
(NULL, 'Parent Communication Plan', 'Regular structured communication with parents', 'Behavior', 1, TRUE),
(NULL, 'Sensory Breaks', 'Scheduled breaks for sensory regulation', 'Behavior', 2, TRUE),
(NULL, 'Preferential Seating', 'Strategic seating placement in classroom', 'Academic', 1, TRUE),
(NULL, 'Visual Schedule', 'Picture-based schedule to support transitions', 'Behavior', 1, TRUE),
(NULL, 'Token Economy System', 'Points or tokens earned for positive behaviors', 'Behavior', 2, TRUE);