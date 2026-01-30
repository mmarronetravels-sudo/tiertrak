-- Migration 007: Pre-Referral Forms
-- Created: January 26, 2026
-- Purpose: Add table for pre-referral forms used when moving Tier 1 students into MTSS

CREATE TABLE prereferral_forms (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants(id),
  referral_date DATE DEFAULT CURRENT_DATE,
  referred_by INTEGER REFERENCES users(id),
  initiated_by VARCHAR(50) DEFAULT 'staff',
  initiated_by_other TEXT,
  
  -- Section 2: Area of Concern
  concern_areas JSONB,
  specific_concerns JSONB,
  
  -- Section 3: Detailed Description
  concern_description TEXT,
  concern_first_noticed VARCHAR(100),
  concern_frequency VARCHAR(100),
  concern_settings JSONB,
  
  -- Section 4: Medical/Background
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
  
  -- Section 5: Academic Performance
  current_grades TEXT,
  assessment_scores TEXT,
  support_classes TEXT,
  credits_status TEXT,
  
  -- Section 6: Existing Plans
  current_plans JSONB,
  plan_details TEXT,
  external_supports TEXT,
  
  -- Section 7: Prior Interventions
  prior_interventions JSONB,
  other_interventions TEXT,
  
  -- Section 8: Student Strengths
  academic_strengths TEXT,
  social_strengths TEXT,
  interests TEXT,
  motivators TEXT,
  
  -- Section 9: Parent Contact
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
  
  -- Section 10: Reason for Referral
  why_tier1_insufficient TEXT,
  supporting_data TEXT,
  triggering_events TEXT,
  
  -- Section 11: Recommendations
  recommended_tier INTEGER CHECK (recommended_tier IN (2, 3)),
  recommended_interventions JSONB,
  recommended_assessments TEXT,
  recommended_supports TEXT,
  additional_recommendations TEXT,
  
  -- Meeting & Signatures
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
  
  -- Status & Workflow
  status VARCHAR(50) DEFAULT 'draft',
  change_request_comments TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX idx_prereferral_forms_student ON prereferral_forms(student_id);
CREATE INDEX idx_prereferral_forms_tenant ON prereferral_forms(tenant_id);
CREATE INDEX idx_prereferral_forms_status ON prereferral_forms(status);
