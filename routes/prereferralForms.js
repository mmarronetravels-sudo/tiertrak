const express = require('express');
const router = express.Router();

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// GET /options - Get dropdown options for form
router.get('/options', async (req, res) => {
  try {
    const options = {
      initiatedBy: [
        { value: 'staff', label: 'School Staff' },
        { value: 'parent', label: 'Parent/Guardian' },
        { value: 'student', label: 'Student Self-Referral' },
        { value: 'other', label: 'Other' }
      ],
      concernAreas: [
        { value: 'Academic', label: 'Academic' },
        { value: 'Behavior', label: 'Behavior' },
        { value: 'Social-Emotional', label: 'Social-Emotional' }
      ],
      academicConcerns: [
        'Reading comprehension',
        'Reading fluency',
        'Math computation',
        'Math reasoning/problem solving',
        'Written expression',
        'Difficulty focusing/attention',
        'Work completion',
        'Organization/time management'
      ],
      behaviorConcerns: [
        'Verbal disrespect/defiance',
        'Physical aggression',
        'Elopement/leaving area',
        'Property destruction',
        'Non-compliance',
        'Disruptive behavior'
      ],
      socialEmotionalConcerns: [
        'Social isolation/withdrawal',
        'Anxiety symptoms',
        'Depression symptoms',
        'Emotional dysregulation',
        'Difficulty with peer relationships',
        'Low self-esteem'
      ],
      concernFirstNoticed: [
        { value: 'less_than_1_month', label: 'Less than 1 month ago' },
        { value: '1_to_3_months', label: '1-3 months ago' },
        { value: '3_to_6_months', label: '3-6 months ago' },
        { value: '6_to_12_months', label: '6-12 months ago' },
        { value: 'more_than_1_year', label: 'More than 1 year ago' }
      ],
      concernFrequency: [
        { value: 'daily', label: 'Daily' },
        { value: 'several_times_week', label: 'Several times per week' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'occasionally', label: 'Occasionally' }
      ],
      concernSettings: [
        'Classroom',
        'Hallway',
        'Cafeteria',
        'Playground',
        'Gym',
        'Library',
        'Bathroom',
        'Bus',
        'Before/After School'
      ],
      yesNoUnknown: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
        { value: 'unknown', label: 'Unknown' }
      ],
      currentPlans: [
        { value: '504', label: '504 Plan' },
        { value: 'IEP', label: 'IEP' },
        { value: 'safety_plan', label: 'Safety Plan' },
        { value: 'behavior_plan', label: 'Behavior Plan' },
        { value: 'none', label: 'None' }
      ],
      parentRelationship: [
        { value: 'mother', label: 'Mother' },
        { value: 'father', label: 'Father' },
        { value: 'guardian', label: 'Guardian' },
        { value: 'grandparent', label: 'Grandparent' },
        { value: 'other', label: 'Other' }
      ],
      contactMethod: [
        { value: 'phone', label: 'Phone Call' },
        { value: 'email', label: 'Email' },
        { value: 'in_person', label: 'In Person' },
        { value: 'text', label: 'Text Message' }
      ],
      preferredContact: [
        { value: 'phone', label: 'Phone' },
        { value: 'email', label: 'Email' },
        { value: 'text', label: 'Text' }
      ],
      parentSupportsReferral: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
        { value: 'partial', label: 'Partially' }
      ],
      recommendedTier: [
        { value: 2, label: 'Tier 2 - Targeted Support' },
        { value: 3, label: 'Tier 3 - Intensive Support' }
      ]
    };
    res.json(options);
  } catch (error) {
    console.error('Error getting options:', error);
    res.status(500).json({ error: 'Failed to get options' });
  }
});

// GET /tenant/:tenantId - Get all forms for a tenant
router.get('/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { status } = req.query;
    
    let query = `
      SELECT pf.*, 
             s.first_name as student_first_name, 
             s.last_name as student_last_name,
             s.grade as student_grade,
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
    console.error('Error getting forms:', error);
    res.status(500).json({ error: 'Failed to get forms' });
  }
});

// GET /pending/:tenantId - Get counts of pending forms
router.get('/pending/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE status = 'submitted') as submitted_count,
        COUNT(*) FILTER (WHERE status = 'changes_requested') as changes_requested_count
      FROM prereferral_forms
      WHERE tenant_id = $1
    `, [tenantId]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting pending counts:', error);
    res.status(500).json({ error: 'Failed to get pending counts' });
  }
});

// GET /student/:studentId - Get forms for a student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT pf.*, u.full_name as referred_by_name
      FROM prereferral_forms pf
      LEFT JOIN users u ON pf.referred_by = u.id
      WHERE pf.student_id = $1
      ORDER BY pf.created_at DESC
    `, [studentId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting student forms:', error);
    res.status(500).json({ error: 'Failed to get student forms' });
  }
});

// GET /check-approved/:studentId - Check if student has approved form
router.get('/check-approved/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT id, status FROM prereferral_forms
      WHERE student_id = $1 AND status = 'approved'
      ORDER BY created_at DESC
      LIMIT 1
    `, [studentId]);
    
    res.json({
      hasApprovedForm: result.rows.length > 0,
      formId: result.rows[0]?.id || null
    });
  } catch (error) {
    console.error('Error checking approved form:', error);
    res.status(500).json({ error: 'Failed to check approved form' });
  }
});

// GET /:id - Get single form with full details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT pf.*, 
             s.first_name as student_first_name, 
             s.last_name as student_last_name,
             s.grade as student_grade,
             s.tier as student_tier,
             s.area as student_area,
             u.full_name as referred_by_name,
             c.full_name as counselor_name_full
      FROM prereferral_forms pf
      JOIN students s ON pf.student_id = s.id
      LEFT JOIN users u ON pf.referred_by = u.id
      LEFT JOIN users c ON pf.counselor_id = c.id
      WHERE pf.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting form:', error);
    res.status(500).json({ error: 'Failed to get form' });
  }
});

// POST / - Create new form
router.post('/', async (req, res) => {
  try {
    const { student_id, tenant_id, referred_by, initiated_by } = req.body;
    
    // Get existing interventions for this student to auto-populate
    const interventionsResult = await pool.query(`
      SELECT intervention_name, start_date, status, notes
      FROM student_interventions
      WHERE student_id = $1
      ORDER BY start_date DESC
    `, [student_id]);
    
    const priorInterventions = interventionsResult.rows.map(i => ({
      name: i.intervention_name,
      start_date: i.start_date,
      status: i.status,
      duration: '',
      frequency: '',
      outcome: ''
    }));
    
    const result = await pool.query(`
      INSERT INTO prereferral_forms (
        student_id, tenant_id, referred_by, initiated_by, prior_interventions, status
      ) VALUES ($1, $2, $3, $4, $5, 'draft')
      RETURNING *
    `, [student_id, tenant_id, referred_by, initiated_by || 'staff', JSON.stringify(priorInterventions)]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating form:', error);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// PUT /:id - Update/save form draft
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const allowedFields = [
      'initiated_by', 'initiated_by_other', 'concern_areas', 'specific_concerns',
      'concern_description', 'concern_first_noticed', 'concern_frequency', 'concern_settings',
      'hearing_tested', 'hearing_test_date', 'hearing_test_result',
      'vision_tested', 'vision_test_date', 'vision_test_result',
      'medical_diagnoses', 'mental_health_diagnoses', 'medications', 'health_concerns',
      'current_grades', 'assessment_scores', 'support_classes', 'credits_status',
      'current_plans', 'plan_details', 'external_supports',
      'prior_interventions', 'other_interventions',
      'academic_strengths', 'social_strengths', 'interests', 'motivators',
      'parent_name', 'parent_relationship', 'parent_phone', 'parent_email',
      'preferred_contact', 'contact_date', 'contact_method', 'parent_informed',
      'parent_input', 'home_supports', 'parent_supports_referral',
      'why_tier1_insufficient', 'supporting_data', 'triggering_events',
      'recommended_tier', 'recommended_interventions', 'recommended_assessments',
      'recommended_supports', 'additional_recommendations',
      'meeting_date', 'meeting_attendees', 'meeting_summary',
      'decisions_made', 'follow_up_actions', 'next_meeting_date'
    ];
    
    const setClauses = [];
    const values = [];
    let paramCount = 1;
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = $${paramCount}`);
        // Handle JSONB fields
        if (['concern_areas', 'specific_concerns', 'concern_settings', 'current_plans', 'prior_interventions', 'recommended_interventions'].includes(key)) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
        paramCount++;
      }
    }
    
    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    
    const query = `
      UPDATE prereferral_forms 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating form:', error);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// PATCH /:id/submit - Submit form for approval
router.patch('/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const { referring_staff_name } = req.body;
    
    const result = await pool.query(`
      UPDATE prereferral_forms 
      SET status = 'submitted',
          referring_staff_name = $2,
          referring_staff_signed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status IN ('draft', 'changes_requested')
      RETURNING *
    `, [id, referring_staff_name]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found or cannot be submitted' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting form:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// PATCH /:id/approve - Counselor approves form
router.patch('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { counselor_name, counselor_id } = req.body;
    
    const result = await pool.query(`
      UPDATE prereferral_forms 
      SET status = 'approved',
          counselor_name = $2,
          counselor_id = $3,
          counselor_signed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'submitted'
      RETURNING *
    `, [id, counselor_name, counselor_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found or cannot be approved' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error approving form:', error);
    res.status(500).json({ error: 'Failed to approve form' });
  }
});

// PATCH /:id/request-changes - Counselor requests changes
router.patch('/:id/request-changes', async (req, res) => {
  try {
    const { id } = req.params;
    const { comments, counselor_id } = req.body;
    
    const result = await pool.query(`
      UPDATE prereferral_forms 
      SET status = 'changes_requested',
          change_request_comments = $2,
          counselor_id = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'submitted'
      RETURNING *
    `, [id, comments, counselor_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found or cannot request changes' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error requesting changes:', error);
    res.status(500).json({ error: 'Failed to request changes' });
  }
});

// PATCH /:id/archive - Archive form
router.patch('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      UPDATE prereferral_forms 
      SET status = 'archived',
          updated_at = CURRENT_TIMESTAMP
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

// DELETE /:id - Delete draft form
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      DELETE FROM prereferral_forms 
      WHERE id = $1 AND status = 'draft'
      RETURNING id
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found or cannot be deleted (only drafts can be deleted)' });
    }
    
    res.json({ message: 'Form deleted successfully' });
  } catch (error) {
    console.error('Error deleting form:', error);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
