const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const router = express.Router();

// Database connection (matches your other route files)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================
// GET OPTIONS (dropdowns)
// ============================================
router.get('/options', async (req, res) => {
  try {
    const options = {
      initiated_by: ['staff', 'parent', 'other'],
      concern_areas: ['Academic', 'Behavior', 'Social-Emotional'],
      specific_concerns: {
        academic: [
          'Reading comprehension',
          'Reading fluency',
          'Math computation',
          'Math reasoning/problem solving',
          'Written expression',
          'Difficulty focusing/attention',
          'Work completion',
          'Organization/time management',
          'Other'
        ],
        behavior: [
          'Verbal disrespect/defiance',
          'Physical aggression',
          'Elopement/leaving area',
          'Property destruction',
          'Non-compliance',
          'Disruptive behavior',
          'Other'
        ],
        socialEmotional: [
          'Social isolation/withdrawal',
          'Anxiety symptoms',
          'Depression symptoms',
          'Emotional dysregulation',
          'Difficulty with peer relationships',
          'Low self-esteem',
          'Other'
        ]
      },
      concern_first_noticed: [
        'Less than 1 month',
        '1-3 months',
        '3-6 months',
        '6-12 months',
        'More than 1 year'
      ],
      concern_frequency: [
        'Daily',
        'Several times per week',
        'Weekly',
        'Occasionally'
      ],
      concern_settings: [
        'Classroom',
        'Hallway',
        'Cafeteria',
        'Playground',
        'Gym',
        'Library',
        'Office',
        'Counselor Office',
        'Special Education Room',
        'Other'
      ],
      yes_no_unknown: ['yes', 'no', 'unknown'],
      current_plans: ['504', 'IEP', 'Safety Plan', 'Behavior Plan', 'None'],
      parent_relationship: ['Parent', 'Guardian', 'Grandparent', 'Foster Parent', 'Other'],
      contact_method: ['Phone call', 'Email', 'In-person', 'Text', 'Video call'],
      preferred_contact: ['Phone', 'Email', 'Text'],
      parent_supports: ['yes', 'no', 'partial'],
      recommended_tier: [2, 3],
      statuses: ['draft', 'submitted', 'changes_requested', 'approved', 'archived']
    };
    
    res.json(options);
  } catch (error) {
    console.error('Error getting options:', error);
    res.status(500).json({ error: 'Failed to get options' });
  }
});

// ============================================
// GET ALL FORMS FOR A TENANT (for admin/counselor view)
// ============================================
router.get('/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { status } = req.query;
    
    let query = `
      SELECT 
        pf.*,
        s.first_name as student_first_name,
        s.last_name as student_last_name,
        s.grade as student_grade,
        s.tier as student_current_tier,
        u.full_name as referred_by_name
      FROM prereferral_forms pf
      JOIN students s ON pf.student_id = s.id
      LEFT JOIN users u ON pf.referred_by = u.id
      WHERE pf.tenant_id = $1
    `;
    
    const params = [tenantId];
    
    if (status) {
      query += ` AND pf.status = $2`;
      params.push(status);
    }
    
    query += ` ORDER BY pf.created_at DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting forms for tenant:', error);
    res.status(500).json({ error: 'Failed to get pre-referral forms' });
  }
});

// ============================================
// GET PENDING FORMS COUNT (for dashboard alert)
// ============================================
router.get('/pending/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'submitted') as pending_approval,
        COUNT(*) FILTER (WHERE status = 'changes_requested') as needs_revision
      FROM prereferral_forms
      WHERE tenant_id = $1
    `, [tenantId]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting pending count:', error);
    res.status(500).json({ error: 'Failed to get pending count' });
  }
});

// ============================================
// GET FORMS FOR A STUDENT
// ============================================
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        pf.*,
        u.full_name as referred_by_name,
        c.full_name as counselor_full_name
      FROM prereferral_forms pf
      LEFT JOIN users u ON pf.referred_by = u.id
      LEFT JOIN users c ON pf.counselor_id = c.id
      WHERE pf.student_id = $1
      ORDER BY pf.created_at DESC
    `, [studentId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting forms for student:', error);
    res.status(500).json({ error: 'Failed to get pre-referral forms' });
  }
});

// ============================================
// GET SINGLE FORM BY ID
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        pf.*,
        s.first_name as student_first_name,
        s.last_name as student_last_name,
        s.grade as student_grade,
        s.tier as student_current_tier,
        s.area as student_area,
        s.teacher_id,
        u.full_name as referred_by_name,
        c.full_name as counselor_full_name,
        t.full_name as teacher_name
      FROM prereferral_forms pf
      JOIN students s ON pf.student_id = s.id
      LEFT JOIN users u ON pf.referred_by = u.id
      LEFT JOIN users c ON pf.counselor_id = c.id
      LEFT JOIN users t ON s.teacher_id = t.id
      WHERE pf.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pre-referral form not found' });
    }
    
    // Also get the student's existing interventions
    const interventionsResult = await pool.query(`
      SELECT 
        si.id,
        si.intervention_name,
        si.notes,
        si.status,
        si.start_date,
        si.end_date
      FROM student_interventions si
      WHERE si.student_id = $1
      ORDER BY si.start_date DESC
    `, [result.rows[0].student_id]);
    
    const form = result.rows[0];
    form.existing_interventions = interventionsResult.rows;
    
    res.json(form);
  } catch (error) {
    console.error('Error getting form:', error);
    res.status(500).json({ error: 'Failed to get pre-referral form' });
  }
});

// ============================================
// CHECK IF STUDENT HAS APPROVED FORM (for tier change)
// ============================================
router.get('/check-approved/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT id, status, counselor_signed_at, recommended_tier
      FROM prereferral_forms
      WHERE student_id = $1 AND status = 'approved'
      ORDER BY counselor_signed_at DESC
      LIMIT 1
    `, [studentId]);
    
    if (result.rows.length === 0) {
      return res.json({ 
        has_approved_form: false,
        message: 'No approved pre-referral form found. Form required to move student from Tier 1.'
      });
    }
    
    res.json({
      has_approved_form: true,
      form_id: result.rows[0].id,
      recommended_tier: result.rows[0].recommended_tier,
      approved_at: result.rows[0].counselor_signed_at
    });
  } catch (error) {
    console.error('Error checking approved form:', error);
    res.status(500).json({ error: 'Failed to check for approved form' });
  }
});

// ============================================
// CREATE NEW FORM
// ============================================
router.post('/', async (req, res) => {
  try {
    const {
      student_id,
      tenant_id,
      referred_by,
      initiated_by,
      initiated_by_other
    } = req.body;
    
    // Check if student already has a non-archived form
    const existingForm = await pool.query(`
      SELECT id, status FROM prereferral_forms
      WHERE student_id = $1 AND status NOT IN ('archived')
    `, [student_id]);
    
    if (existingForm.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Student already has an active pre-referral form',
        existing_form_id: existingForm.rows[0].id,
        existing_status: existingForm.rows[0].status
      });
    }
    
    // Get student's existing interventions to auto-populate
    const interventions = await pool.query(`
      SELECT 
        si.id as intervention_id,
        si.intervention_name as name,
        si.start_date,
        si.end_date,
        si.status,
        si.notes
      FROM student_interventions si
      WHERE si.student_id = $1
    `, [student_id]);
    
    const priorInterventions = interventions.rows.map(i => ({
      intervention_id: i.intervention_id,
      name: i.name,
      start_date: i.start_date,
      end_date: i.end_date,
      status: i.status,
      duration: '',
      frequency: '',
      outcome: ''
    }));
    
    const result = await pool.query(`
      INSERT INTO prereferral_forms (
        student_id, tenant_id, referred_by, initiated_by, initiated_by_other,
        prior_interventions, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'draft')
      RETURNING *
    `, [
      student_id,
      tenant_id,
      referred_by,
      initiated_by || 'staff',
      initiated_by_other,
      JSON.stringify(priorInterventions)
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating form:', error);
    res.status(500).json({ error: 'Failed to create pre-referral form' });
  }
});

// ============================================
// UPDATE FORM (save draft or full update)
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const formData = req.body;
    
    // Check if form exists and is editable
    const existingForm = await pool.query(
      'SELECT status FROM prereferral_forms WHERE id = $1',
      [id]
    );
    
    if (existingForm.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    const currentStatus = existingForm.rows[0].status;
    if (!['draft', 'changes_requested'].includes(currentStatus)) {
      return res.status(400).json({ 
        error: 'Form cannot be edited in current status',
        status: currentStatus 
      });
    }
    
    // Build dynamic update query
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    const allowedFields = [
      'initiated_by', 'initiated_by_other',
      'concern_areas', 'specific_concerns',
      'concern_description', 'concern_first_noticed', 'concern_frequency', 'concern_settings',
      'hearing_tested', 'hearing_test_date', 'hearing_test_result',
      'vision_tested', 'vision_test_date', 'vision_test_result',
      'medical_diagnoses', 'mental_health_diagnoses', 'medications', 'health_concerns',
      'current_grades', 'assessment_scores', 'support_classes', 'credits_status',
      'current_plans', 'plan_details', 'external_supports',
      'prior_interventions', 'other_interventions',
      'academic_strengths', 'social_strengths', 'interests', 'motivators',
      'parent_name', 'parent_relationship', 'parent_phone', 'parent_email',
      'preferred_contact', 'contact_date', 'contact_method',
      'parent_informed', 'parent_input', 'home_supports', 'parent_supports_referral',
      'why_tier1_insufficient', 'supporting_data', 'triggering_events',
      'recommended_tier', 'recommended_interventions', 'recommended_assessments',
      'recommended_supports', 'additional_recommendations',
      'meeting_date', 'meeting_attendees', 'meeting_summary',
      'decisions_made', 'follow_up_actions', 'next_meeting_date'
    ];
    
    for (const field of allowedFields) {
      if (formData[field] !== undefined) {
        updateFields.push(`${field} = $${paramCount}`);
        // Handle JSONB fields
        if (['concern_areas', 'specific_concerns', 'concern_settings', 'current_plans', 'prior_interventions', 'recommended_interventions'].includes(field)) {
          values.push(JSON.stringify(formData[field]));
        } else {
          values.push(formData[field]);
        }
        paramCount++;
      }
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    // If was changes_requested, reset to draft
    if (currentStatus === 'changes_requested') {
      updateFields.push(`status = $${paramCount}`);
      values.push('draft');
      paramCount++;
      updateFields.push(`change_request_comments = NULL`);
    }
    
    values.push(id);
    
    const query = `
      UPDATE prereferral_forms 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating form:', error);
    res.status(500).json({ error: 'Failed to update pre-referral form' });
  }
});

// ============================================
// SUBMIT FORM FOR APPROVAL (staff signs)
// ============================================
router.patch('/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const { referring_staff_name } = req.body;
    
    if (!referring_staff_name) {
      return res.status(400).json({ error: 'Staff name required to sign and submit' });
    }
    
    // Verify form is in draft status
    const existingForm = await pool.query(
      'SELECT status, parent_informed FROM prereferral_forms WHERE id = $1',
      [id]
    );
    
    if (existingForm.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    if (!['draft', 'changes_requested'].includes(existingForm.rows[0].status)) {
      return res.status(400).json({ error: 'Form cannot be submitted in current status' });
    }
    
    // Check parent was contacted
    if (!existingForm.rows[0].parent_informed) {
      return res.status(400).json({ error: 'Parent contact section must be completed before submitting' });
    }
    
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'submitted',
          referring_staff_name = $1,
          referring_staff_signed_at = CURRENT_TIMESTAMP,
          change_request_comments = NULL
      WHERE id = $2
      RETURNING *
    `, [referring_staff_name, id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting form:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// ============================================
// APPROVE FORM (counselor signs)
// ============================================
router.patch('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { counselor_name, counselor_id } = req.body;
    
    if (!counselor_name || !counselor_id) {
      return res.status(400).json({ error: 'Counselor name and ID required to approve' });
    }
    
    // Verify form is submitted
    const existingForm = await pool.query(
      'SELECT status FROM prereferral_forms WHERE id = $1',
      [id]
    );
    
    if (existingForm.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    if (existingForm.rows[0].status !== 'submitted') {
      return res.status(400).json({ error: 'Only submitted forms can be approved' });
    }
    
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'approved',
          counselor_name = $1,
          counselor_id = $2,
          counselor_signed_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [counselor_name, counselor_id, id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error approving form:', error);
    res.status(500).json({ error: 'Failed to approve form' });
  }
});

// ============================================
// REQUEST CHANGES (counselor returns to staff)
// ============================================
router.patch('/:id/request-changes', async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    
    if (!comments) {
      return res.status(400).json({ error: 'Comments required when requesting changes' });
    }
    
    // Verify form is submitted
    const existingForm = await pool.query(
      'SELECT status FROM prereferral_forms WHERE id = $1',
      [id]
    );
    
    if (existingForm.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    if (existingForm.rows[0].status !== 'submitted') {
      return res.status(400).json({ error: 'Only submitted forms can have changes requested' });
    }
    
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'changes_requested',
          change_request_comments = $1
      WHERE id = $2
      RETURNING *
    `, [comments, id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error requesting changes:', error);
    res.status(500).json({ error: 'Failed to request changes' });
  }
});

// ============================================
// ARCHIVE FORM (after tier change)
// ============================================
router.patch('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'archived'
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving form:', error);
    res.status(500).json({ error: 'Failed to archive form' });
  }
});

// ============================================
// DELETE FORM (only drafts)
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only allow deleting drafts
    const existingForm = await pool.query(
      'SELECT status FROM prereferral_forms WHERE id = $1',
      [id]
    );
    
    if (existingForm.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    if (existingForm.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Only draft forms can be deleted' });
    }
    
    await pool.query('DELETE FROM prereferral_forms WHERE id = $1', [id]);
    
    res.json({ message: 'Form deleted successfully' });
  } catch (error) {
    console.error('Error deleting form:', error);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

module.exports = router;
