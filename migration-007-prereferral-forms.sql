-- Migration 007: Pre-Referral Forms
-- Created: January 26, 2026
-- Purpose: Add pre-referral form support for Tier 1 → Tier 2/3 transitions

-- Create the prereferral_forms table
CREATE TABLE prereferral_forms (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants(id),
  
  -- Section 1: Referral Info
  referral_date DATE NOT NULL DEFAULT CURRENT_DATE,
  referred_by INTEGER REFERENCES users(id),
  initiated_by VARCHAR(50) NOT NULL DEFAULT 'staff' CHECK (initiated_by IN ('staff', 'parent', 'other')),
  initiated_by_other TEXT, -- If 'other', explain
  
  -- Section 2: Referral Type
  concern_areas JSONB DEFAULT '[]', -- ['Academic', 'Behavior', 'Social-Emotional']
  specific_concerns JSONB DEFAULT '{}', -- {academic: [...], behavior: [...], socialEmotional: [...]}
  
  -- Section 3: Detailed Concerns
  concern_description TEXT,
  concern_first_noticed VARCHAR(50), -- '<1 month', '1-3 months', '3-6 months', '6-12 months', '>1 year'
  concern_frequency VARCHAR(50), -- 'Daily', 'Several times/week', 'Weekly', 'Occasionally'
  concern_settings JSONB DEFAULT '[]', -- ['Classroom', 'Hallway', etc.]
  
  -- Section 4: Medical/Background
  hearing_tested VARCHAR(20), -- 'yes', 'no', 'unknown'
  hearing_test_date DATE,
  hearing_test_result TEXT,
  vision_tested VARCHAR(20), -- 'yes', 'no', 'unknown'
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
  credits_status TEXT, -- For high school only
  
  -- Section 6: Existing Plans
  current_plans JSONB DEFAULT '[]', -- ['504', 'IEP', 'Safety Plan', 'Behavior Plan', 'None']
  plan_details TEXT, -- Disability category, plan specifics
  external_supports TEXT, -- Counseling, tutoring, community services
  
  -- Section 7: Prior Interventions
  prior_interventions JSONB DEFAULT '[]', -- [{intervention_id, name, duration, frequency, outcome}, ...]
  other_interventions TEXT,
  
  -- Section 8: Student Strengths
  academic_strengths TEXT,
  social_strengths TEXT,
  interests TEXT,
  motivators TEXT,
  
  -- Section 9: Parent/Guardian Contact & Input
  parent_name VARCHAR(255),
  parent_relationship VARCHAR(50), -- 'Parent', 'Guardian', 'Grandparent', 'Other'
  parent_phone VARCHAR(50),
  parent_email VARCHAR(255),
  preferred_contact VARCHAR(50), -- 'Phone', 'Email', 'Text'
  contact_date DATE,
  contact_method VARCHAR(50), -- 'Phone call', 'Email', 'In-person', 'Text'
  parent_informed BOOLEAN DEFAULT FALSE,
  parent_input TEXT, -- What did the parent say?
  home_supports TEXT, -- What's working at home?
  parent_supports_referral VARCHAR(20), -- 'yes', 'no', 'partial'
  
  -- Section 10: Reason for Referral
  why_tier1_insufficient TEXT,
  supporting_data TEXT,
  triggering_events TEXT,
  
  -- Section 11: Recommendations
  recommended_tier INTEGER CHECK (recommended_tier IN (2, 3)),
  recommended_interventions JSONB DEFAULT '[]', -- Array of intervention template IDs or names
  recommended_assessments TEXT,
  recommended_supports TEXT,
  additional_recommendations TEXT,
  
  -- Section 12: Meeting Notes (optional, can be filled after team meeting)
  meeting_date DATE,
  meeting_attendees TEXT,
  meeting_summary TEXT,
  decisions_made TEXT,
  follow_up_actions TEXT,
  next_meeting_date DATE,
  
  -- Signatures (name + timestamp)
  referring_staff_name VARCHAR(255),
  referring_staff_signed_at TIMESTAMP,
  counselor_name VARCHAR(255),
  counselor_signed_at TIMESTAMP,
  counselor_id INTEGER REFERENCES users(id),
  
  -- Status & Workflow
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'changes_requested', 'approved', 'archived')),
  change_request_comments TEXT, -- If counselor requests changes
  
  -- Meta
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX idx_prereferral_student ON prereferral_forms(student_id);
CREATE INDEX idx_prereferral_tenant ON prereferral_forms(tenant_id);
CREATE INDEX idx_prereferral_status ON prereferral_forms(status);
CREATE INDEX idx_prereferral_referred_by ON prereferral_forms(referred_by);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_prereferral_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prereferral_updated_at
  BEFORE UPDATE ON prereferral_forms
  FOR EACH ROW
  EXECUTE FUNCTION update_prereferral_timestamp();

-- Comment on table
COMMENT ON TABLE prereferral_forms IS 'Pre-referral forms for moving students from Tier 1 to Tier 2/3 in MTSS';
