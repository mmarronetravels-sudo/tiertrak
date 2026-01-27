const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
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
const csvImportRoutes = require('./routes/csvImport');
const weeklyProgressRoutes = require('./routes/weeklyProgress');
const prereferralFormsRoutes = require('./routes/prereferralForms');
const mtssMeetingsRoutes = require('./routes/mtssMeetings');
prereferralFormsRoutes.initializePool(pool);
mtssMeetingsRoutes.initializePool(pool);
// Auto-create prereferral_forms table if it doesn't exist
const createPreReferralTable = async () => {
  try {
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
createPreReferralTable();

// Use routes
app.use('/api/tenants', tenantsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/interventions', interventionsRoutes);
app.use('/api/progress-notes', progressNotesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/intervention-logs', interventionLogsRoutes);
app.use('/api/csv', csvImportRoutes);
app.use('/api/weekly-progress', weeklyProgressRoutes);
app.use('/api/prereferral-forms', prereferralFormsRoutes);
app.use('/api/mtss-meetings', mtssMeetingsRoutes);// Test route
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

// Start server
app.listen(PORT, () => {
  console.log(`TierTrak server running at http://localhost:${PORT}`);
});
