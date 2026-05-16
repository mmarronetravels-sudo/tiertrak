const express = require('express');
const router = express.Router();
const {
  requireAuth,
  requireTenantStaffAccess,
  requireStudentReadAccess
} = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// ============================================================
// Tenant-binding doctrine (POST handlers in this file)
//
// Per Followup #125 (per-school binding), POST handlers compute the
// target tenant via resolveAndBindTargetTenant(req):
//   - Optional req.body.target_tenant_id (positive integer).
//   - Absent → falls back to req.user.tenant_id (backwards-compat
//     for the current single-tenant users whose JWT carries their
//     only accessible tenant).
//   - Present → validated against resolveAccessibleTenantIds(req.user);
//     not-in-set returns 403 before any INSERT, so a body-explicit
//     cross-tenant probe collapses to 403, not 400-FK.
//
// Supersedes the day-one rule "Routes NEVER read req.body.tenant_id"
// (master-index Followup 67) for the multi-school case only. The
// rule remains in force for any field NOT named target_tenant_id;
// GET handlers continue to derive scope from
// resolveAccessibleTenantIds(req.user) directly.
//
// Scope in THIS file:
//   - POST / (create form) — in scope.
//   - PUT /:id, PATCH /:id/submit, /:id/approve, /:id/request-changes,
//     /:id/archive, DELETE /:id — OUT of scope. These operate on an
//     existing prereferral_forms row; loadFormAndAssertTenant (below)
//     governs the tenant assertion via the row's own tenant_id
//     verified against resolveAccessibleTenantIds(req.user). That
//     helper is unchanged.
//
// Helper is duplicated module-local per Followup #132 (consolidation
// deferred to a chore PR post-PR-S3-D-4).
// ============================================================

const FORBIDDEN_BODY = { error: 'Not authorized' };

// Role sets for transition/delete endpoints. Parent is implicitly excluded
// (not in either set) — no separate parent-block line needed where these
// are used. Narrower-then-loosen design call: schema's counselor_* column
// naming signals the original intent for approve/request-changes; admin-
// only on archive/delete reflects the destructive nature of the latter
// and the recoverable-but-cleanup nature of the former.
const APPROVE_ROLES = ['counselor', 'school_admin', 'district_admin'];
const ADMIN_ROLES = ['school_admin', 'district_admin'];

// Load a prereferral_forms row by id and assert it belongs to a tenant in
// the caller's accessible-tenant set (§5 dual-path doctrine via helper).
// Returns { ok: true, row } or { ok: false, status, body } so the caller
// can respond with a byte-identical 403 for both "row not found" and "wrong
// tenant" — preventing existence-disclosure across tenants.
async function loadFormAndAssertTenant(formId, user) {
  const result = await pool.query(
    'SELECT id, tenant_id, status FROM prereferral_forms WHERE id = $1',
    [formId]
  );
  if (result.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const accessible = await resolveAccessibleTenantIds(user);
  if (!accessible.includes(result.rows[0].tenant_id)) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  return { ok: true, row: result.rows[0] };
}

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

/**
 * Resolve and validate the target tenant for a POST write handler.
 *
 * Per Followup #125 (per-school binding), POST handlers read an optional
 * target_tenant_id from req.body:
 *   - Absent → falls back to req.user.tenant_id (backwards-compat for
 *     the current single-tenant users whose JWT carries their only
 *     accessible tenant).
 *   - Present but not a positive integer → 400.
 *   - Present, positive integer, but not in
 *     resolveAccessibleTenantIds(req.user) → 403 (fires before any
 *     INSERT; a body-explicit cross-tenant probe collapses to 403,
 *     not 400-FK).
 *
 * Supersedes the day-one rule "Routes NEVER read req.body.tenant_id"
 * (master-index Followup 67) for the multi-school case only.
 *
 * @param {object} req - Express request. requireAuth must have already
 *   populated req.user; req.body may carry an optional target_tenant_id.
 * @returns {Promise<{targetTenantId: number|null, error: {status: number, body: object}|null}>}
 *   On success: { targetTenantId: <int>, error: null }.
 *   On failure: { targetTenantId: null, error: { status, body } } —
 *   caller should respond res.status(error.status).json(error.body).
 */
async function resolveAndBindTargetTenant(req) {
  const bodyTarget = req.body ? req.body.target_tenant_id : undefined;
  if (bodyTarget === undefined || bodyTarget === null) {
    return { targetTenantId: req.user.tenant_id, error: null };
  }
  if (!isPositiveInt(bodyTarget)) {
    return { targetTenantId: null, error: { status: 400, body: { error: 'Invalid target_tenant_id' } } };
  }
  const accessible = await resolveAccessibleTenantIds(req.user);
  if (!accessible.includes(bodyTarget)) {
    return { targetTenantId: null, error: { status: 403, body: { error: 'Not authorized for target tenant' } } };
  }
  return { targetTenantId: bodyTarget, error: null };
}

// GET /options - Get dropdown options for form
router.get('/options', requireAuth, async (req, res) => {
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
// requireTenantStaffAccess (PR-S3-A swept) validated the path :tenantId is
// in the caller's accessible-tenant set via resolveAccessibleTenantIds per
// §5 dual-path doctrine. Path-tenant scoped: SQL filter uses
// Number(req.params.tenantId); middleware-membership-check validated access.
router.get('/tenant/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
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
    const params = [Number(req.params.tenantId)];

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
// requireTenantStaffAccess (PR-S3-A swept) validated the path :tenantId is
// in the caller's accessible-tenant set. Path-tenant scoped: SQL filter
// uses Number(req.params.tenantId); middleware-membership-check validated.
router.get('/pending/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE status = 'submitted') as submitted_count,
        COUNT(*) FILTER (WHERE status = 'changes_requested') as changes_requested_count
      FROM prereferral_forms
      WHERE tenant_id = $1
    `, [Number(req.params.tenantId)]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting pending counts:', error);
    res.status(500).json({ error: 'Failed to get pending counts' });
  }
});

// GET /student/:studentId - Get forms for a student
// Parents are blocked even if linked to the student: pre-referral forms hold
// medical/mental-health PII not appropriate for parent disclosure via this surface.
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(`
      SELECT pf.*, u.full_name as referred_by_name
      FROM prereferral_forms pf
      LEFT JOIN users u ON pf.referred_by = u.id
      WHERE pf.student_id = $1 AND pf.tenant_id = ANY($2::int[])
      ORDER BY pf.created_at DESC
    `, [req.params.studentId, accessible]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting student forms:', error);
    res.status(500).json({ error: 'Failed to get student forms' });
  }
});

// GET /check-approved/:studentId - Check if student has approved form
// Parents are blocked even if linked: existence-of-form is itself sensitive
// (implies a referral has been initiated, which is a FERPA-protected fact).
router.get('/check-approved/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(`
      SELECT id, status FROM prereferral_forms
      WHERE student_id = $1 AND tenant_id = ANY($2::int[]) AND status = 'approved'
      ORDER BY created_at DESC
      LIMIT 1
    `, [req.params.studentId, accessible]);

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
// Most PII-rich endpoint in this file: returns medical_diagnoses,
// mental_health_diagnoses, medications, parent contact, and the full
// intervention narrative. Parents are blocked even if linked to the
// student. Cross-tenant probes resolve to a byte-identical 403 — the
// previous 404 was an existence-disclosure vector.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const auth = await loadFormAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const accessible = await resolveAccessibleTenantIds(req.user);
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
      WHERE pf.id = $1 AND pf.tenant_id = ANY($2::int[])
    `, [req.params.id, accessible]);

    if (result.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting form:', error);
    res.status(500).json({ error: 'Failed to get form' });
  }
});

// POST / - Create new form
// tenant_id and referred_by are derived from req.user (server-side actor
// identity) — body values for these are ignored. Mirrors the
// student-ownership check pattern from PR #55's POST /referral-monitoring
// (routes/students.js:295). initiated_by stays body-driven per design call:
// it's metadata about how the referral was initiated (staff/parent/student/
// other), not the actor identity of the request.
router.post('/', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const { student_id, initiated_by } = req.body;
    if (!student_id) {
      return res.status(400).json({ error: 'Missing required field: student_id' });
    }

    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);

    // Tenant verification: student must belong to caller's tenant.
    const studentResult = await pool.query(
      'SELECT tenant_id FROM students WHERE id = $1',
      [student_id]
    );
    if (studentResult.rows.length === 0
        || studentResult.rows[0].tenant_id !== tenantId) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    // Auto-populate prior interventions for this (now tenant-verified) student
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
    `, [student_id, tenantId, req.user.id, initiated_by || 'staff', JSON.stringify(priorInterventions)]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating form:', error);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// PUT /:id - Update/save form draft
// tenant_id, student_id, referred_by, status, and the *_signed_at /
// counselor_id / referring_staff_name actor-identity columns are NOT in
// allowedFields — those transitions go through their dedicated endpoints
// (POST, /submit, /approve, /request-changes) which derive actor identity
// from req.user.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const auth = await loadFormAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

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
        setClauses.push(key + ' = $' + paramCount);
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
    
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    const accessible = await resolveAccessibleTenantIds(req.user);
    values.push(accessible);

    const query = `
      UPDATE prereferral_forms
      SET ${setClauses.join(', ')}
      WHERE id = $${paramCount} AND tenant_id = ANY($${paramCount + 1}::int[])
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating form:', error);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// PATCH /:id/submit - Submit form for approval
// referring_staff_name is derived from users.full_name via req.user.id —
// body's referring_staff_name is ignored. Previous behavior trusted body,
// allowing any authenticated caller to sign as anyone.
router.patch('/:id/submit', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const auth = await loadFormAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const userResult = await pool.query(
      'SELECT full_name FROM users WHERE id = $1',
      [req.user.id]
    );
    const referringStaffName = userResult.rows[0]?.full_name || null;

    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'submitted',
          referring_staff_name = $3,
          referring_staff_signed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = ANY($2::int[]) AND status IN ('draft', 'changes_requested')
      RETURNING *
    `, [req.params.id, accessible, referringStaffName]);

    if (result.rows.length === 0) {
      // Form exists in caller's tenant (helper verified) but is in a non-
      // submittable status (already submitted/approved/archived). Return 400
      // to distinguish from cross-tenant 403; existence is not leaked
      // because the helper already confirmed the form exists for this caller.
      return res.status(400).json({ error: 'Form is not in a submittable state' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting form:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// PATCH /:id/approve - Counselor approves form
// counselor_id and counselor_name are derived from req.user — body values
// are ignored. Same actor-spoofing fix as commit 4 row 9.
router.patch('/:id/approve', requireAuth, async (req, res) => {
  try {
    if (!APPROVE_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const auth = await loadFormAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const userResult = await pool.query(
      'SELECT full_name FROM users WHERE id = $1',
      [req.user.id]
    );
    const counselorName = userResult.rows[0]?.full_name || null;

    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'approved',
          counselor_name = $3,
          counselor_id = $4,
          counselor_signed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = ANY($2::int[]) AND status = 'submitted'
      RETURNING *
    `, [req.params.id, accessible, counselorName, req.user.id]);

    if (result.rows.length === 0) {
      // See commit 4 row 9 comment: tenant assert passed, so this is
      // operational state (form is not in 'submitted' status), not authz.
      return res.status(400).json({ error: 'Form is not in an approvable state' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error approving form:', error);
    res.status(500).json({ error: 'Failed to approve form' });
  }
});

// PATCH /:id/request-changes - Counselor requests changes
// counselor_id is derived from req.user.id — body value is ignored.
router.patch('/:id/request-changes', requireAuth, async (req, res) => {
  try {
    if (!APPROVE_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const auth = await loadFormAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const { comments } = req.body;

    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'changes_requested',
          change_request_comments = $3,
          counselor_id = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = ANY($2::int[]) AND status = 'submitted'
      RETURNING *
    `, [req.params.id, accessible, comments, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Form is not in a state to request changes' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error requesting changes:', error);
    res.status(500).json({ error: 'Failed to request changes' });
  }
});

// PATCH /:id/archive - Archive form
// Admin-only: orphan endpoint with no FE pressure; status flip is
// recoverable so admin-only is reversible if product reality needs wider.
router.patch('/:id/archive', requireAuth, async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const auth = await loadFormAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(`
      UPDATE prereferral_forms
      SET status = 'archived',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = ANY($2::int[])
      RETURNING *
    `, [req.params.id, accessible]);

    if (result.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving form:', error);
    res.status(500).json({ error: 'Failed to archive form' });
  }
});

// DELETE /:id - Delete draft form
// Admin-only: permanent destruction of medical/mental-health PII row.
// status='draft' guard retained — only drafts deletable, protects against
// losing approved/submitted forms.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const auth = await loadFormAndAssertTenant(req.params.id, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const accessible = await resolveAccessibleTenantIds(req.user);
    const result = await pool.query(`
      DELETE FROM prereferral_forms
      WHERE id = $1 AND tenant_id = ANY($2::int[]) AND status = 'draft'
      RETURNING id
    `, [req.params.id, accessible]);

    if (result.rows.length === 0) {
      // Tenant assert passed, so this is operational state (form is not
      // in 'draft' status). Same pattern as rows 9, 10, 11.
      return res.status(400).json({ error: 'Only draft forms can be deleted' });
    }

    res.json({ message: 'Form deleted successfully' });
  } catch (error) {
    console.error('Error deleting form:', error);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
