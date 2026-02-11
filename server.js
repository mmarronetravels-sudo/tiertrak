const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());
app.use(cors({
  origin: [
    'https://tiertrak.scholarpathsystems.org',
    'https://www.scholarpathsystems.org',
    'https://scholarpathsystems.org'
  ],
  credentials: true
}));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Import routes
const tenantsRoutes = require('./routes/tenants');
const studentsRoutes = require('./routes/students');
const interventionsRoutes = require('./routes/interventions');
const progressNotesRoutes = require('./routes/progressNotes');
const usersRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const interventionLogsRoutes = require('./routes/interventionLogs');
const prereferralFormsRoutes = require('./routes/prereferralForms');
const csvImportRoutes = require('./routes/csvImport');
const weeklyProgressRoutes = require('./routes/weeklyProgress');
const mtssMeetingsRoutes = require('./routes/mtssMeetings');
const interventionAssignmentsRoutes = require('./routes/interventionAssignments');
const parentLinksRoutes = require('./routes/parentLinks');
const adminTemplatesRoutes = require('./routes/adminTemplates');
const interventionPlansRoutes = require('./routes/interventionPlans');
const studentDocumentsRoutes = require('./routes/studentDocuments');
const staffManagementRoutes = require('./routes/staffManagement');
const interventionBankRoutes = require('./routes/interventionBank');

// Initialize pools for routes that need them
prereferralFormsRoutes.initializePool(pool);
mtssMeetingsRoutes.initializePool(pool);
interventionAssignmentsRoutes.initializePool(pool);
parentLinksRoutes.initializePool(pool);
adminTemplatesRoutes.initializePool(pool);
interventionPlansRoutes.initializePool(pool);
studentDocumentsRoutes.initializePool(pool);
staffManagementRoutes.initializePool(pool);
interventionBankRoutes.initializePool(pool);

// Auto-create tables if they don't exist
const createTables = async () => {
  try {
    // Migration 007: Pre-Referral Forms
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prereferral_forms (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        tenant_id INTEGER REFERENCES tenants(id),
        referral_date DATE DEFAULT CURRENT_DATE,
        referred_by INTEGER REFERENCES users(id),
        initiated_by VARCHAR(50) DEFAULT 'staff',
        initiated_by_other TEXT,
        concern_areas JSONB,
        specific_concerns JSONB,
        concern_description TEXT,
        concern_first_noticed VARCHAR(100),
        concern_frequency VARCHAR(100),
        concern_settings JSONB,
        hearing_tested VARCHAR(20),
        hearing_test_date DATE,
        hearing_test_result TEXT,
        vision_tested VARCHAR(20),
        vision_test_date DATE,
        vision_test_result TEXT,
        medical_diagnoses TEXT,
        mental_health_diagnoses TEXT,
        medications TEXT,
        health_concerns TEXT,
        current_grades TEXT,
        assessment_scores TEXT,
        support_classes TEXT,
        credits_status TEXT,
        current_plans JSONB,
        plan_details TEXT,
        external_supports TEXT,
        prior_interventions JSONB,
        other_interventions TEXT,
        academic_strengths TEXT,
        social_strengths TEXT,
        interests TEXT,
        motivators TEXT,
        parent_name VARCHAR(255),
        parent_relationship VARCHAR(100),
        parent_phone VARCHAR(50),
        parent_email VARCHAR(255),
        preferred_contact VARCHAR(50),
        contact_date DATE,
        contact_method VARCHAR(100),
        parent_informed BOOLEAN DEFAULT FALSE,
        parent_input TEXT,
        home_supports TEXT,
        parent_supports_referral VARCHAR(20),
        why_tier1_insufficient TEXT,
        supporting_data TEXT,
        triggering_events TEXT,
        recommended_tier INTEGER CHECK (recommended_tier IN (2, 3)),
        recommended_interventions JSONB,
        recommended_assessments TEXT,
        recommended_supports TEXT,
        additional_recommendations TEXT,
        meeting_date DATE,
        meeting_attendees TEXT,
        meeting_summary TEXT,
        decisions_made TEXT,
        follow_up_actions TEXT,
        next_meeting_date DATE,
        referring_staff_name VARCHAR(255),
        referring_staff_signed_at TIMESTAMP,
        counselor_name VARCHAR(255),
        counselor_signed_at TIMESTAMP,
        counselor_id INTEGER REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'draft',
        change_request_comments TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_prereferral_forms_student ON prereferral_forms(student_id);
      CREATE INDEX IF NOT EXISTS idx_prereferral_forms_tenant ON prereferral_forms(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_prereferral_forms_status ON prereferral_forms(status);
    `);
    console.log('prereferral_forms table ready');

    // Migration 008: MTSS Meetings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mtss_meetings (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        tenant_id INTEGER REFERENCES tenants(id),
        meeting_date DATE NOT NULL,
        meeting_number INTEGER DEFAULT 1 CHECK (meeting_number IN (1, 2, 3)),
        meeting_type VARCHAR(50) CHECK (meeting_type IN ('4-week', '6-week', 'final-review', 'other')),
        attendees JSONB DEFAULT '{}',
        parent_attended BOOLEAN DEFAULT FALSE,
        progress_summary TEXT,
        tier_decision VARCHAR(50) CHECK (tier_decision IN (
          'stay_tier2_continue', 'stay_tier2_modify', 'move_tier1', 'move_tier3', 'refer_sped', 'refer_504'
        )),
        next_steps TEXT,
        next_meeting_date DATE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS mtss_meeting_interventions (
        id SERIAL PRIMARY KEY,
        mtss_meeting_id INTEGER REFERENCES mtss_meetings(id) ON DELETE CASCADE,
        student_intervention_id INTEGER REFERENCES student_interventions(id) ON DELETE CASCADE,
        implementation_fidelity VARCHAR(20) CHECK (implementation_fidelity IN ('yes', 'partial', 'no')),
        progress_toward_goal VARCHAR(20) CHECK (progress_toward_goal IN ('met', 'progressing', 'minimal', 'no_progress', 'regression')),
        recommendation VARCHAR(30) CHECK (recommendation IN ('continue', 'modify', 'discontinue_met', 'discontinue_ineffective', 'add_support')),
        notes TEXT,
        avg_rating DECIMAL(3,2),
        total_logs INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_mtss_meetings_student ON mtss_meetings(student_id);
      CREATE INDEX IF NOT EXISTS idx_mtss_meetings_tenant ON mtss_meetings(tenant_id);
    `);
    console.log('MTSS meetings tables ready');

    // Migration 009: Intervention Plan Templates
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'intervention_templates' AND column_name = 'plan_template'
        ) THEN
          ALTER TABLE intervention_templates ADD COLUMN plan_template JSONB DEFAULT NULL;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'intervention_templates' AND column_name = 'has_plan_template'
        ) THEN
          ALTER TABLE intervention_templates ADD COLUMN has_plan_template BOOLEAN DEFAULT FALSE;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'student_interventions' AND column_name = 'plan_data'
        ) THEN
          ALTER TABLE student_interventions ADD COLUMN plan_data JSONB DEFAULT NULL;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'student_interventions' AND column_name = 'plan_status'
        ) THEN
          ALTER TABLE student_interventions ADD COLUMN plan_status VARCHAR(20) DEFAULT 'not_applicable';
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'student_interventions' AND column_name = 'plan_completed_at'
        ) THEN
          ALTER TABLE student_interventions ADD COLUMN plan_completed_at TIMESTAMP;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'student_interventions' AND column_name = 'plan_completed_by'
        ) THEN
          ALTER TABLE student_interventions ADD COLUMN plan_completed_by INTEGER REFERENCES users(id);
        END IF;
      END $$;
    `);
    console.log('Intervention plan columns ready');

    // Migration 010: Role-Based Student Access
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS school_wide_access BOOLEAN DEFAULT FALSE
    `);
    
    await pool.query(`
      UPDATE users SET school_wide_access = TRUE 
      WHERE role IN ('counselor', 'school_admin') AND (school_wide_access IS NULL OR school_wide_access = FALSE)
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_student_links (
        id SERIAL PRIMARY KEY,
        parent_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        relationship VARCHAR(50) DEFAULT 'parent',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parent_user_id, student_id)
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS intervention_assignments (
        id SERIAL PRIMARY KEY,
        student_intervention_id INTEGER REFERENCES student_interventions(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        assignment_type VARCHAR(20) CHECK (assignment_type IN ('staff', 'parent')),
        can_log_progress BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_intervention_id, user_id)
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent ON parent_student_links(parent_user_id);
      CREATE INDEX IF NOT EXISTS idx_parent_student_links_student ON parent_student_links(student_id);
      CREATE INDEX IF NOT EXISTS idx_intervention_assignments_intervention ON intervention_assignments(student_intervention_id);
      CREATE INDEX IF NOT EXISTS idx_intervention_assignments_user ON intervention_assignments(user_id)
    `);
    console.log('Role-based access tables ready');

    // Migration 011: Update weekly_progress response options
    try {
      await pool.query(`ALTER TABLE weekly_progress DROP CONSTRAINT IF EXISTS weekly_progress_response_check`);
      await pool.query(`ALTER TABLE weekly_progress DROP CONSTRAINT IF EXISTS check_response`);
      await pool.query(`
        ALTER TABLE weekly_progress ADD CONSTRAINT weekly_progress_response_check 
          CHECK (response IS NULL OR response IN ('Engaged', 'Cooperative', 'Resistant', 'Frustrated', 'Distracted', 'Positive', 'Neutral'))
      `);
      console.log('weekly_progress response constraint updated');
    } catch (err) {
      console.log('Response constraint update skipped or failed:', err.message);
    }

    // Migration 012: Student Documents
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_documents (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        
        -- File info
        file_name VARCHAR(255) NOT NULL,
        file_url TEXT NOT NULL,
        file_type VARCHAR(50),
        file_size INTEGER,
        s3_key VARCHAR(500),
        
        -- Document metadata
        document_category VARCHAR(50) CHECK (document_category IN (
          '504 Plan', 'IEP', 'Evaluation Report', 'Progress Report', 
          'Parent Communication', 'Medical Record', 'Other'
        )),
        description TEXT,
        
        -- Expiration tracking
        expiration_date DATE,
        expiration_alert_sent BOOLEAN DEFAULT FALSE,
        
        -- Audit trail
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_student_documents_student ON student_documents(student_id);
      CREATE INDEX IF NOT EXISTS idx_student_documents_tenant ON student_documents(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_student_documents_expiration ON student_documents(expiration_date) 
        WHERE expiration_date IS NOT NULL;
    `);
    console.log('student_documents table ready');

    // Migration 013: Archive/Delete Interventions Support
    await pool.query(`
      ALTER TABLE student_interventions 
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
      
      ALTER TABLE student_interventions 
      ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id);
      
      ALTER TABLE student_interventions 
      ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(100);
      
      ALTER TABLE student_interventions
      ADD COLUMN IF NOT EXISTS end_date DATE;
    `);
    console.log('Migration 013: Archive/Delete interventions columns ready');

    // Migration 013b: Update status constraint to include 'archived'
    await pool.query(`
      ALTER TABLE student_interventions DROP CONSTRAINT IF EXISTS student_interventions_status_check;
      ALTER TABLE student_interventions ADD CONSTRAINT student_interventions_status_check 
        CHECK (status IN ('active', 'completed', 'discontinued', 'archived'));
    `);
    console.log('Migration 013b: Status constraint updated');

    // Migration 014: Referral Monitoring
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_monitoring (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        tenant_id INTEGER REFERENCES tenants(id),
        monitored_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_referral_monitoring_student ON referral_monitoring(student_id);
      CREATE INDEX IF NOT EXISTS idx_referral_monitoring_tenant ON referral_monitoring(tenant_id);
    `);
    console.log('Migration 014: referral_monitoring table ready');

    // Update role constraint to include all roles
    await pool.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('district_admin', 'school_admin', 'teacher', 'counselor', 'behavior_specialist', 'student_support_specialist', 'parent'));
    `);
    console.log('Role constraint updated');

    // Seed test users (only if they don't exist)
    const testUsers = await pool.query(`SELECT id FROM users WHERE email = 'teacher1@lincoln.edu'`);
    if (testUsers.rows.length === 0) {
      await pool.query(`
        INSERT INTO users (tenant_id, email, password_hash, full_name, role, school_wide_access) VALUES
        (3, 'teacher1@lincoln.edu', '$2b$10$xPPPGQ5IAVP4VnKBKhGHXu3UH/J8EJfGJHQG7V6.6O7E0lLrVz8Zm', 'Maria Santos', 'teacher', FALSE),
        (3, 'teacher2@lincoln.edu', '$2b$10$xPPPGQ5IAVP4VnKBKhGHXu3UH/J8EJfGJHQG7V6.6O7E0lLrVz8Zm', 'James Wilson', 'teacher', FALSE),
        (3, 'specialist@lincoln.edu', '$2b$10$xPPPGQ5IAVP4VnKBKhGHXu3UH/J8EJfGJHQG7V6.6O7E0lLrVz8Zm', 'Dr. Angela Thompson', 'student_support_specialist', TRUE),
        (3, 'parent1@gmail.com', '$2b$10$xPPPGQ5IAVP4VnKBKhGHXu3UH/J8EJfGJHQG7V6.6O7E0lLrVz8Zm', 'Sarah Johnson', 'parent', FALSE),
        (3, 'parent2@gmail.com', '$2b$10$xPPPGQ5IAVP4VnKBKhGHXu3UH/J8EJfGJHQG7V6.6O7E0lLrVz8Zm', 'Michael Davis', 'parent', FALSE)
      `);
      console.log('Test users seeded');
    }

    // Migration 016: Intervention Bank
    await pool.query(`
      ALTER TABLE intervention_templates 
      ADD COLUMN IF NOT EXISTS is_starter BOOLEAN DEFAULT FALSE;
      
      ALTER TABLE intervention_templates 
      ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN DEFAULT FALSE;
      
      CREATE TABLE IF NOT EXISTS tenant_intervention_bank (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        template_id INTEGER NOT NULL REFERENCES intervention_templates(id) ON DELETE CASCADE,
        activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        activated_by INTEGER REFERENCES users(id),
        UNIQUE(tenant_id, template_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_tenant_bank_tenant ON tenant_intervention_bank(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_bank_template ON tenant_intervention_bank(template_id);
    `);
    console.log('Migration 016: Intervention bank tables ready');

 // Migration 017: Add mtss_support role
    await pool.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('district_admin', 'school_admin', 'teacher', 'counselor', 'behavior_specialist', 'student_support_specialist', 'mtss_support', 'parent'));
    `);
    console.log('Migration 017: mtss_support role added');

  } catch (error) {
    console.error('Error creating tables:', error);
  }
};

createTables();

// Use routes
app.use('/api/tenants', tenantsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/interventions', interventionsRoutes);
app.use('/api/progress-notes', progressNotesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/intervention-logs', interventionLogsRoutes);
app.use('/api/prereferral-forms', prereferralFormsRoutes);
app.use('/api/csv', csvImportRoutes);
app.use('/api/weekly-progress', weeklyProgressRoutes);
app.use('/api/mtss-meetings', mtssMeetingsRoutes);
app.use('/api/intervention-assignments', interventionAssignmentsRoutes);
app.use('/api/parent-links', parentLinksRoutes);
app.use('/api/admin', adminTemplatesRoutes);
app.use('/api/intervention-plans', interventionPlansRoutes);
app.use('/api/student-documents', studentDocumentsRoutes);
app.use('/api/staff', staffManagementRoutes);
app.use('/api/intervention-bank', interventionBankRoutes);

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to TierTrak API!' });
});

// Test database connection
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'healthy',
      database: 'connected',
      time: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Contact form endpoint (ScholarPath website demo requests)
app.post('/api/contact', async (req, res) => {
  try {
    const { firstName, lastName, email, school, website, students, role, products, needs } = req.body;
    
    if (!firstName || !lastName || !email || !school) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await resend.emails.send({
      from: 'ScholarPath Systems <noreply@scholarpathsystems.org>',
      to: ['sps@scholarpathsystems.org'],
      reply_to: email,
      subject: 'New Demo Request: ' + school + ' - ' + firstName + ' ' + lastName,
      html: '<div style="font-family: Arial, sans-serif; max-width: 600px;">' +
        '<h2 style="color: #4f46e5;">New Demo Request</h2>' +
        '<table style="width: 100%; border-collapse: collapse;">' +
        '<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Name</td><td style="padding: 8px; border-bottom: 1px solid #eee;">' + firstName + ' ' + lastName + '</td></tr>' +
        '<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Email</td><td style="padding: 8px; border-bottom: 1px solid #eee;">' + email + '</td></tr>' +
        '<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">School</td><td style="padding: 8px; border-bottom: 1px solid #eee;">' + school + '</td></tr>' +
        '<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Website</td><td style="padding: 8px; border-bottom: 1px solid #eee;">' + (website || 'Not provided') + '</td></tr>' +
        '<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Students</td><td style="padding: 8px; border-bottom: 1px solid #eee;">' + students + '</td></tr>' +
        '<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Role</td><td style="padding: 8px; border-bottom: 1px solid #eee;">' + role + '</td></tr>' +
        '<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Products</td><td style="padding: 8px; border-bottom: 1px solid #eee;">' + (Array.isArray(products) ? products.join(', ') : products) + '</td></tr>' +
        '<tr><td style="padding: 8px; font-weight: bold;">Needs</td><td style="padding: 8px;">' + (needs || 'Not provided') + '</td></tr>' +
        '</table>' +
        '<p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">Submitted via scholarpathsystems.org contact form</p>' +
        '</div>'
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: 'Email failed to send' });
    }

    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`TierTrak server running at http://localhost:${PORT}`);
});
