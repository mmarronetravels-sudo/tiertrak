const express = require('express');
const router = express.Router();
const {
  requireAuth,
  requireStudentReadAccess
} = require('../middleware/authorizeInterventionAccess');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// Roles authorized to mutate MTSS meetings (POST / PUT / DELETE). Defined
// route-local; closest semantic peer is ROLES_WHO_CAN_EDIT in
// routes/tier1-assessments.js. Teachers and parents are intentionally
// excluded — meetings are an MTSS team action, not a teacher-led one.
const MEETING_WRITE_ROLES = [
  'district_admin',
  'school_admin',
  'counselor',
  'interventionist'
];

const FORBIDDEN_BODY = { error: 'Not authorized' };

// Caps intervention_reviews.length on POST/PUT /api/mtss-meetings to
// bound the per-row authorization loop. See PR #81 security-reviewer M1.
const MAX_INTERVENTION_REVIEWS = 50;

// Get dropdown options for the form
router.get('/options', requireAuth, async (req, res) => {
  try {
    const options = {
      meeting_types: [
        { value: '4-week', label: '4-Week Review' },
        { value: '6-week', label: '6-Week Review' },
        { value: 'final-review', label: 'Final Review' },
        { value: 'other', label: 'Other' }
      ],
      meeting_numbers: [
        { value: 1, label: '1st Meeting' },
        { value: 2, label: '2nd Meeting' },
        { value: 3, label: '3rd Meeting (Final)' }
      ],
      attendee_types: [
        { value: 'teacher', label: 'Teacher' },
        { value: 'counselor', label: 'Counselor' },
        { value: 'admin', label: 'Administrator' },
        { value: 'parent', label: 'Parent/Guardian' },
        { value: 'specialist', label: 'Behavior Specialist' },
        { value: 'other', label: 'Other' }
      ],
      implementation_fidelity: [
        { value: 'yes', label: 'Yes, as planned' },
        { value: 'partial', label: 'Partially' },
        { value: 'no', label: 'No' }
      ],
      progress_toward_goal: [
        { value: 'met', label: 'Goal Met' },
        { value: 'progressing', label: 'Progressing' },
        { value: 'minimal', label: 'Minimal Progress' },
        { value: 'no_progress', label: 'No Progress' },
        { value: 'regression', label: 'Regression' }
      ],
      recommendation: [
        { value: 'continue', label: 'Continue as-is' },
        { value: 'modify', label: 'Modify intervention' },
        { value: 'discontinue_met', label: 'Discontinue - goal met' },
        { value: 'discontinue_ineffective', label: 'Discontinue - ineffective' },
        { value: 'add_support', label: 'Add additional support' }
      ],
      tier_decisions: [
        { value: 'stay_tier2_continue', label: 'Stay at Tier 2 - Continue current interventions' },
        { value: 'stay_tier2_modify', label: 'Stay at Tier 2 - Modify interventions' },
        { value: 'move_tier1', label: 'Move to Tier 1 - Goals met, step down supports' },
        { value: 'move_tier3', label: 'Move to Tier 3 - Needs more intensive support' },
        { value: 'refer_sped', label: 'Refer for Special Education evaluation' },
        { value: 'refer_504', label: 'Refer for 504 Plan evaluation' }
      ]
    };
    res.json(options);
  } catch (error) {
    console.error('Error fetching options:', error.message);
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// Get all meetings for a student
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.*,
        u.full_name as created_by_name,
        (
          SELECT json_agg(
            json_build_object(
              'id', mi.id,
              'student_intervention_id', mi.student_intervention_id,
              'intervention_name', si.intervention_name,
              'implementation_fidelity', mi.implementation_fidelity,
              'progress_toward_goal', mi.progress_toward_goal,
              'recommendation', mi.recommendation,
              'notes', mi.notes,
              'avg_rating', mi.avg_rating,
              'total_logs', mi.total_logs,
              'weekly_progress_snapshot', mi.weekly_progress_snapshot
            )
          )
          FROM mtss_meeting_interventions mi
          JOIN student_interventions si ON mi.student_intervention_id = si.id
          WHERE mi.mtss_meeting_id = m.id
        ) as intervention_reviews
      FROM mtss_meetings m
      LEFT JOIN users u ON m.created_by = u.id
      WHERE m.student_id = $1 AND m.tenant_id = $2
      ORDER BY m.meeting_date DESC, m.created_at DESC
    `, [req.student.id, req.student.tenant_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching meetings:', error.message);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

// Get single meeting with full details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Tenant-and-parent-link-bound SELECT. Single query closes the auth
    // gate atomically with the data fetch. Branches:
    //   - role !== 'parent': caller's tenant_id must match meeting's tenant_id
    //   - role === 'parent': caller must be linked to the meeting's student
    //     via parent_student_links
    // Not-found and not-authorized are indistinguishable to the caller
    // (uniform 403 FORBIDDEN_BODY mirrors POST/PUT/DELETE precedent).
    const meetingResult = await pool.query(`
      SELECT
        m.*,
        u.full_name as created_by_name,
        s.first_name, s.last_name, s.grade, s.tier, s.area
      FROM mtss_meetings m
      LEFT JOIN users u ON m.created_by = u.id
      LEFT JOIN students s ON m.student_id = s.id
      WHERE m.id = $1
        AND (
          ($2 != 'parent' AND m.tenant_id = $3)
          OR
          ($2 = 'parent' AND EXISTS (
            SELECT 1 FROM parent_student_links psl
            WHERE psl.parent_user_id = $4 AND psl.student_id = m.student_id
          ))
        )
    `, [id, req.user.role, req.user.tenant_id, req.user.id]);

    if (meetingResult.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    
    // mi.* covers weekly_progress_snapshot — explicit projection not
    // needed here; flagged so future readers know the snapshot inclusion
    // is intentional, not an oversight.
    const interventionsResult = await pool.query(`
      SELECT
        mi.*,
        si.intervention_name,
        si.goal_description,
        si.goal_target_date,
        si.goal_target_rating,
        si.start_date,
        si.status as intervention_status
      FROM mtss_meeting_interventions mi
      JOIN student_interventions si ON mi.student_intervention_id = si.id
      WHERE mi.mtss_meeting_id = $1
    `, [id]);
    
    const meeting = meetingResult.rows[0];
    meeting.intervention_reviews = interventionsResult.rows;
    
    res.json(meeting);
  } catch (error) {
    console.error('Error fetching meeting:', error.message);
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
});

// Get active interventions with progress stats for a student (for pre-populating the form)
router.get('/student/:studentId/interventions-summary', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    // Defense-in-depth tenant binding: requireStudentReadAccess already
    // verified the student belongs to the caller's tenant (staff path) or
    // that the caller is a linked parent. The SELECT is bound to tenant via
    // JOIN so any future bypass still fails closed — mirrors the
    // computeWeeklyProgressSnapshot precedent below.
    const result = await pool.query(`
      SELECT
        si.id,
        si.intervention_name,
        si.start_date,
        si.status,
        si.goal_description,
        si.goal_target_date,
        si.goal_target_rating,
        si.notes as intervention_notes,
        si.no_progress_monitoring_required,
        COALESCE(AVG(wp.rating), 0) as avg_rating,
        COUNT(wp.id) as total_logs,
        MAX(wp.rating) as highest_rating,
        MIN(wp.rating) as lowest_rating
      FROM student_interventions si
      JOIN students s ON s.id = si.student_id AND s.tenant_id = $2
      LEFT JOIN weekly_progress wp ON si.id = wp.student_intervention_id
      WHERE si.student_id = $1 AND si.status = 'active'
      GROUP BY si.id
      ORDER BY si.start_date DESC
    `, [req.student.id, req.student.tenant_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching interventions summary:', error.message);
    res.status(500).json({ error: 'Failed to fetch interventions' });
  }
});

// Compute the immutable weekly_progress snapshot for a single intervention
// at meeting save time. Joined to students with a tenant_id bind for
// defense-in-depth. The body-trust IDOR is now closed upstream: POST/PUT/
// DELETE on this router enforce requireAuth + MEETING_WRITE_ROLES + a
// server-resolved tenant gate before any transaction begins. The tenant_id
// passed here is server-derived (req.user.tenant_id for POST, the meeting's
// own tenant_id from a tenant-bound SELECT-by-id for PUT) — body.tenant_id
// is never trusted. This JOIN is now belt-and-suspenders, not the only line
// of defense.
async function computeWeeklyProgressSnapshot(client, studentInterventionId, tenantId) {
  const result = await client.query(`
    SELECT wp.week_of, wp.status, wp.rating, wp.response, wp.notes,
           wp.created_at,
           u.full_name AS logged_by_name,
           u.role AS logged_by_role
    FROM weekly_progress wp
    JOIN student_interventions si ON wp.student_intervention_id = si.id
    JOIN students s ON si.student_id = s.id AND s.tenant_id = $2
    LEFT JOIN users u ON wp.logged_by = u.id
    WHERE wp.student_intervention_id = $1
    ORDER BY wp.week_of ASC
  `, [studentInterventionId, tenantId]);
  return result.rows;
}

// Server-authoritative read of student_interventions.no_progress_monitoring_required
// used by meeting POST (always) and meeting PUT (only for newly-added
// interventions; existing interventions on a meeting edit preserve the
// prior snapshot value — see PUT preserve-on-edit semantics below).
// Same tenant-bind defense-in-depth as computeWeeklyProgressSnapshot:
// catches forgery where body.tenant_id doesn't match the intervention's
// actual tenant. If the bind fails (0 rows), default to false rather than
// silently suppress monitoring on a row we couldn't authoritatively read.
async function readNoProgressMonitoringFlag(client, studentInterventionId, tenantId) {
  const result = await client.query(`
    SELECT si.no_progress_monitoring_required
    FROM student_interventions si
    JOIN students s ON s.id = si.student_id AND s.tenant_id = $2
    WHERE si.id = $1
  `, [studentInterventionId, tenantId]);
  return result.rows[0]?.no_progress_monitoring_required === true;
}

// Create new meeting
// Auth model: requireAuth + MEETING_WRITE_ROLES + a server-resolved tenant
// gate (body.student_id verified against req.user.tenant_id) all run BEFORE
// any transaction BEGIN — a 403 cannot leave a half-written row. body.tenant_id
// and body.created_by are intentionally ignored; both are server-derived
// from req.user. Per-row intervention_reviews[].student_intervention_id is
// also pre-verified to belong to the same student + tenant. Uniform 403
// { error: 'Not authorized' } for not-found-or-mismatch (mirrors
// authorizeByInterventionId).
router.post('/', requireAuth, async (req, res) => {
  if (!MEETING_WRITE_ROLES.includes(req.user.role)) {
    return res.status(403).json(FORBIDDEN_BODY);
  }

  const {
    student_id,
    meeting_date,
    meeting_number,
    meeting_type,
    attendees,
    parent_attended,
    progress_summary,
    tier_decision,
    next_steps,
    next_meeting_date,
    intervention_reviews
  } = req.body;

  if (!student_id) {
    return res.status(400).json({ error: 'Missing required field: student_id' });
  }

  if (intervention_reviews !== undefined && intervention_reviews !== null) {
    if (!Array.isArray(intervention_reviews)) {
      return res.status(400).json({ error: 'intervention_reviews must be an array' });
    }
    if (intervention_reviews.length > MAX_INTERVENTION_REVIEWS) {
      return res.status(400).json({ error: `Too many intervention reviews (max ${MAX_INTERVENTION_REVIEWS})` });
    }
  }

  const tenantId = req.user.tenant_id;
  const createdBy = req.user.id;

  // Tenant gate on the student. Tenant-bound SELECT — not-found and
  // wrong-tenant are indistinguishable to the caller.
  const studentLookup = await pool.query(
    'SELECT id FROM students WHERE id = $1 AND tenant_id = $2',
    [student_id, tenantId]
  );
  if (studentLookup.rows.length === 0) {
    return res.status(403).json(FORBIDDEN_BODY);
  }

  // Per-row intervention gate: each student_intervention_id must belong to
  // this student AND this tenant. Pre-flight so a 403 never opens a
  // transaction.
  if (intervention_reviews && intervention_reviews.length > 0) {
    for (const review of intervention_reviews) {
      const interventionCheck = await pool.query(
        `SELECT 1 FROM student_interventions si
         JOIN students s ON s.id = si.student_id
         WHERE si.id = $1 AND si.student_id = $2 AND s.tenant_id = $3`,
        [review.student_intervention_id, student_id, tenantId]
      );
      if (interventionCheck.rows.length === 0) {
        return res.status(403).json(FORBIDDEN_BODY);
      }
    }
  }

  // All authorization checks passed — open the transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cleanNextMeetingDate = next_meeting_date === '' ? null : next_meeting_date;
    const cleanTierDecision = tier_decision === '' ? null : tier_decision;

    const meetingResult = await client.query(`
      INSERT INTO mtss_meetings (
        student_id, tenant_id, meeting_date, meeting_number, meeting_type,
        attendees, parent_attended, progress_summary, tier_decision,
        next_steps, next_meeting_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      student_id, tenantId, meeting_date, meeting_number, meeting_type,
      JSON.stringify(attendees), parent_attended, progress_summary, cleanTierDecision,
      next_steps, cleanNextMeetingDate, createdBy
    ]);

    const meeting = meetingResult.rows[0];

    // Insert intervention reviews — each row carries an immutable JSONB
    // snapshot of the underlying weekly_progress logs at this moment,
    // computed inside the same transaction.
    if (intervention_reviews && intervention_reviews.length > 0) {
      for (const review of intervention_reviews) {
        const cleanFidelity = review.implementation_fidelity === '' ? null : review.implementation_fidelity;
        const cleanProgress = review.progress_toward_goal === '' ? null : review.progress_toward_goal;
        const cleanRecommendation = review.recommendation === '' ? null : review.recommendation;

        const snapshot = await computeWeeklyProgressSnapshot(
          client,
          review.student_intervention_id,
          tenantId
        );

        // Option α snapshot (Migration 023): server-read the live flag
        // from student_interventions and freeze it onto this meeting row.
        // Future flag-flips on the live row will not retroactively change
        // what this meeting recorded.
        const noProgressMonitoringRequired = await readNoProgressMonitoringFlag(
          client,
          review.student_intervention_id,
          tenantId
        );

        await client.query(`
          INSERT INTO mtss_meeting_interventions (
            mtss_meeting_id, student_intervention_id,
            implementation_fidelity, progress_toward_goal, recommendation, notes,
            avg_rating, total_logs, weekly_progress_snapshot,
            no_progress_monitoring_required
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          meeting.id,
          review.student_intervention_id,
          cleanFidelity,
          cleanProgress,
          cleanRecommendation,
          review.notes,
          review.avg_rating,
          review.total_logs,
          JSON.stringify(snapshot),
          noProgressMonitoringRequired
        ]);
      }
    }

    await client.query('COMMIT');

    res.status(201).json(meeting);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating meeting:', error.message);
    res.status(500).json({ error: 'Failed to create meeting' });
  } finally {
    client.release();
  }
});

// Update meeting
// Auth model: requireAuth + MEETING_WRITE_ROLES + a server-resolved tenant
// gate (tenant-bound SELECT-by-id on mtss_meetings) all run BEFORE any
// transaction BEGIN. body.tenant_id is intentionally ignored; the snapshot
// helpers receive the meeting's own tenant_id from the SELECT. Per-row
// intervention_reviews[].student_intervention_id is pre-verified to belong
// to the meeting's student + tenant. Uniform 403 for not-found-or-mismatch.
//
// Preserve-on-edit snapshot semantics (per Q1 (b)): interventions already
// present in the saved meeting keep their existing weekly_progress_snapshot
// as-is — even an empty-array legacy snapshot stays empty rather than
// being silently refreshed from current live data. Newly-added interventions
// get a fresh snapshot computed via computeWeeklyProgressSnapshot. This is
// the "frozen at first save" contract: editing a meeting (typo fix, late
// recommendation, attendee correction) does NOT silently rewrite the audit
// trail of what data the team reviewed.
router.put('/:id', requireAuth, async (req, res) => {
  if (!MEETING_WRITE_ROLES.includes(req.user.role)) {
    return res.status(403).json(FORBIDDEN_BODY);
  }

  const { id } = req.params;

  // Tenant gate. Tenant-bound SELECT — not-found and wrong-tenant are
  // indistinguishable to the caller (mirrors authorizeByInterventionId).
  const meetingLookup = await pool.query(
    'SELECT id, tenant_id, student_id FROM mtss_meetings WHERE id = $1 AND tenant_id = $2',
    [id, req.user.tenant_id]
  );
  if (meetingLookup.rows.length === 0) {
    return res.status(403).json(FORBIDDEN_BODY);
  }
  const meetingTenantId = meetingLookup.rows[0].tenant_id;
  const meetingStudentId = meetingLookup.rows[0].student_id;

  const {
    meeting_date,
    meeting_number,
    meeting_type,
    attendees,
    parent_attended,
    progress_summary,
    tier_decision,
    next_steps,
    next_meeting_date,
    intervention_reviews
  } = req.body;

  if (intervention_reviews !== undefined && intervention_reviews !== null) {
    if (!Array.isArray(intervention_reviews)) {
      return res.status(400).json({ error: 'intervention_reviews must be an array' });
    }
    if (intervention_reviews.length > MAX_INTERVENTION_REVIEWS) {
      return res.status(400).json({ error: `Too many intervention reviews (max ${MAX_INTERVENTION_REVIEWS})` });
    }
  }

  // Per-row intervention gate: each student_intervention_id must belong to
  // this meeting's student AND tenant. Pre-flight so a 403 never opens a
  // transaction.
  if (intervention_reviews && intervention_reviews.length > 0) {
    for (const review of intervention_reviews) {
      const interventionCheck = await pool.query(
        `SELECT 1 FROM student_interventions si
         JOIN students s ON s.id = si.student_id
         WHERE si.id = $1 AND si.student_id = $2 AND s.tenant_id = $3`,
        [review.student_intervention_id, meetingStudentId, meetingTenantId]
      );
      if (interventionCheck.rows.length === 0) {
        return res.status(403).json(FORBIDDEN_BODY);
      }
    }
  }

  // All authorization checks passed — open the transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cleanNextMeetingDate = next_meeting_date === '' ? null : next_meeting_date;
    const cleanTierDecision = tier_decision === '' ? null : tier_decision;

    // Tenant-bound UPDATE for belt-and-suspenders. The pre-flight already
    // verified ownership; this catches the (vanishingly rare) race where
    // the meeting was deleted or re-tenanted between pre-flight and here.
    const meetingResult = await client.query(`
      UPDATE mtss_meetings SET
        meeting_date = $1,
        meeting_number = $2,
        meeting_type = $3,
        attendees = $4,
        parent_attended = $5,
        progress_summary = $6,
        tier_decision = $7,
        next_steps = $8,
        next_meeting_date = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10 AND tenant_id = $11
      RETURNING *
    `, [
      meeting_date, meeting_number, meeting_type,
      JSON.stringify(attendees), parent_attended, progress_summary, cleanTierDecision,
      next_steps, cleanNextMeetingDate, id, meetingTenantId
    ]);

    if (meetingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json(FORBIDDEN_BODY);
    }

    // Capture existing snapshots BEFORE the DELETE so we can preserve
    // them on re-INSERT for interventions that were already in the
    // meeting. Coalesce null → [] defensively (Migration 020's column
    // default should prevent null, but if anything slips through, treat
    // it as a legacy empty snapshot rather than computing fresh — that
    // would conjure data that wasn't captured at original save time).
    const priorRows = await client.query(
      'SELECT student_intervention_id, weekly_progress_snapshot, no_progress_monitoring_required FROM mtss_meeting_interventions WHERE mtss_meeting_id = $1',
      [id]
    );
    const priorSnapshots = new Map();
    // Parallel Map for the Option α flag (Migration 023). Same preserve-on-edit
    // contract as priorSnapshots: a flag-flip after the meeting was first saved
    // does NOT silently rewrite the historical record of what the team reviewed.
    const priorMonitoringFlags = new Map();
    for (const row of priorRows.rows) {
      priorSnapshots.set(row.student_intervention_id, row.weekly_progress_snapshot ?? []);
      priorMonitoringFlags.set(row.student_intervention_id, row.no_progress_monitoring_required === true);
    }

    // Delete existing intervention reviews and re-insert
    await client.query('DELETE FROM mtss_meeting_interventions WHERE mtss_meeting_id = $1', [id]);

    if (intervention_reviews && intervention_reviews.length > 0) {
      for (const review of intervention_reviews) {
        const cleanFidelity = review.implementation_fidelity === '' ? null : review.implementation_fidelity;
        const cleanProgress = review.progress_toward_goal === '' ? null : review.progress_toward_goal;
        const cleanRecommendation = review.recommendation === '' ? null : review.recommendation;

        // Q1 (b): preserve prior snapshot if this intervention was already
        // in the meeting; compute fresh only for newly-added interventions.
        // Snapshot helpers receive the meeting's server-resolved tenant_id
        // — body.tenant_id is never trusted.
        const snapshot = priorSnapshots.has(review.student_intervention_id)
          ? priorSnapshots.get(review.student_intervention_id)
          : await computeWeeklyProgressSnapshot(client, review.student_intervention_id, meetingTenantId);

        // Same preserve-on-edit semantics for the Option α monitoring flag:
        // existing interventions keep their prior snapshot value; newly-added
        // interventions read fresh from student_interventions.
        const noProgressMonitoringRequired = priorMonitoringFlags.has(review.student_intervention_id)
          ? priorMonitoringFlags.get(review.student_intervention_id)
          : await readNoProgressMonitoringFlag(client, review.student_intervention_id, meetingTenantId);

        await client.query(`
          INSERT INTO mtss_meeting_interventions (
            mtss_meeting_id, student_intervention_id,
            implementation_fidelity, progress_toward_goal, recommendation, notes,
            avg_rating, total_logs, weekly_progress_snapshot,
            no_progress_monitoring_required
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          id,
          review.student_intervention_id,
          cleanFidelity,
          cleanProgress,
          cleanRecommendation,
          review.notes,
          review.avg_rating,
          review.total_logs,
          JSON.stringify(snapshot),
          noProgressMonitoringRequired
        ]);
      }
    }

    await client.query('COMMIT');

    res.json(meetingResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating meeting:', error.message);
    res.status(500).json({ error: 'Failed to update meeting' });
  } finally {
    client.release();
  }
});

// Delete meeting
// Auth model: requireAuth + MEETING_WRITE_ROLES + tenant-bound DELETE. The
// tenant gate is folded into the DELETE WHERE clause — atomic auth check
// and delete, no TOCTOU window. Uniform 403 for not-found-or-mismatch.
router.delete('/:id', requireAuth, async (req, res) => {
  if (!MEETING_WRITE_ROLES.includes(req.user.role)) {
    return res.status(403).json(FORBIDDEN_BODY);
  }

  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM mtss_meetings WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, req.user.tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    res.json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Error deleting meeting:', error.message);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

// Get meeting counts for a student (useful for knowing which meeting number they're on)
router.get('/student/:studentId/count', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as meeting_count, MAX(meeting_number) as last_meeting_number
      FROM mtss_meetings
      WHERE student_id = $1 AND tenant_id = $2
    `, [req.student.id, req.student.tenant_id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching meeting count:', error.message);
    res.status(500).json({ error: 'Failed to fetch meeting count' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
