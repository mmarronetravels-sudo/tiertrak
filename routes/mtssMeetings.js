const express = require('express');
const router = express.Router();

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// Get dropdown options for the form
router.get('/options', async (req, res) => {
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
    console.error('Error fetching options:', error);
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// Get all meetings for a student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
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
              'total_logs', mi.total_logs
            )
          )
          FROM mtss_meeting_interventions mi
          JOIN student_interventions si ON mi.student_intervention_id = si.id
          WHERE mi.mtss_meeting_id = m.id
        ) as intervention_reviews
      FROM mtss_meetings m
      LEFT JOIN users u ON m.created_by = u.id
      WHERE m.student_id = $1
      ORDER BY m.meeting_date DESC, m.created_at DESC
    `, [studentId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

// Get single meeting with full details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const meetingResult = await pool.query(`
      SELECT 
        m.*,
        u.full_name as created_by_name,
        s.first_name, s.last_name, s.grade, s.tier, s.area
      FROM mtss_meetings m
      LEFT JOIN users u ON m.created_by = u.id
      LEFT JOIN students s ON m.student_id = s.id
      WHERE m.id = $1
    `, [id]);
    
    if (meetingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
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
    console.error('Error fetching meeting:', error);
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
});

// Get active interventions with progress stats for a student (for pre-populating the form)
router.get('/student/:studentId/interventions-summary', async (req, res) => {
  try {
    const { studentId } = req.params;
    
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
        COALESCE(AVG(wp.rating), 0) as avg_rating,
        COUNT(wp.id) as total_logs,
        MAX(wp.rating) as highest_rating,
        MIN(wp.rating) as lowest_rating
      FROM student_interventions si
      LEFT JOIN weekly_progress wp ON si.id = wp.student_intervention_id
      WHERE si.student_id = $1 AND si.status = 'active'
      GROUP BY si.id
      ORDER BY si.start_date DESC
    `, [studentId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching interventions summary:', error);
    res.status(500).json({ error: 'Failed to fetch interventions' });
  }
});

// Compute the immutable weekly_progress snapshot for a single intervention
// at meeting save time. Joined to students with a tenant_id bind for
// defense-in-depth — this catches sloppy forgery of student_intervention_id
// where the interventions's actual tenant differs from the body's tenant_id.
// It does NOT close the broader IDOR on this route (POST/PUT lack
// requireAuth — that's master-index Followup 67's territory). A targeted
// attacker who matches the tenant_id correctly can still bypass this JOIN.
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

// Create new meeting
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      student_id,
      tenant_id,
      meeting_date,
      meeting_number,
      meeting_type,
      attendees,
      parent_attended,
      progress_summary,
      tier_decision,
      next_steps,
      next_meeting_date,
      created_by,
      intervention_reviews // Array of intervention evaluations
    } = req.body;
// Convert empty strings to null for date fields
    const cleanNextMeetingDate = next_meeting_date === '' ? null : next_meeting_date;
    const cleanTierDecision = tier_decision === '' ? null : tier_decision;

    // Insert meeting
    const meetingResult = await client.query(`
  INSERT INTO mtss_meetings (
    student_id, tenant_id, meeting_date, meeting_number, meeting_type,
    attendees, parent_attended, progress_summary, tier_decision,
    next_steps, next_meeting_date, created_by
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING *
`, [
  student_id, tenant_id, meeting_date, meeting_number, meeting_type,
  JSON.stringify(attendees), parent_attended, progress_summary, cleanTierDecision,
  next_steps, cleanNextMeetingDate, created_by
]);

    const meeting = meetingResult.rows[0];

    // Insert intervention reviews — each row carries an immutable JSONB
    // snapshot of the underlying weekly_progress logs at this moment,
    // computed inside the same transaction.
    if (intervention_reviews && intervention_reviews.length > 0) {
      for (const review of intervention_reviews) {
        // Convert empty strings to null for fields with constraints
        const cleanFidelity = review.implementation_fidelity === '' ? null : review.implementation_fidelity;
        const cleanProgress = review.progress_toward_goal === '' ? null : review.progress_toward_goal;
        const cleanRecommendation = review.recommendation === '' ? null : review.recommendation;

        const snapshot = await computeWeeklyProgressSnapshot(
          client,
          review.student_intervention_id,
          tenant_id
        );

        await client.query(`
          INSERT INTO mtss_meeting_interventions (
            mtss_meeting_id, student_intervention_id,
            implementation_fidelity, progress_toward_goal, recommendation, notes,
            avg_rating, total_logs, weekly_progress_snapshot
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          meeting.id,
          review.student_intervention_id,
          cleanFidelity,
          cleanProgress,
          cleanRecommendation,
          review.notes,
          review.avg_rating,
          review.total_logs,
          JSON.stringify(snapshot)
        ]);
      }
    }

    await client.query('COMMIT');

    res.status(201).json(meeting);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: 'Failed to create meeting' });
  } finally {
    client.release();
  }
});

// Update meeting
// Preserve-on-edit snapshot semantics (per Q1 (b)): interventions already
// present in the saved meeting keep their existing weekly_progress_snapshot
// as-is — even an empty-array legacy snapshot stays empty rather than
// being silently refreshed from current live data. Newly-added interventions
// get a fresh snapshot computed via computeWeeklyProgressSnapshot. This is
// the "frozen at first save" contract: editing a meeting (typo fix, late
// recommendation, attendee correction) does NOT silently rewrite the audit
// trail of what data the team reviewed.
router.put('/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;
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
      tenant_id,
      intervention_reviews
    } = req.body;
    // Convert empty strings to null for fields with constraints
const cleanNextMeetingDate = next_meeting_date === '' ? null : next_meeting_date;
const cleanTierDecision = tier_decision === '' ? null : tier_decision;

    // Update meeting
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
      WHERE id = $10
      RETURNING *
    `, [
      meeting_date, meeting_number, meeting_type,
      JSON.stringify(attendees), parent_attended, progress_summary, cleanTierDecision,
      next_steps, cleanNextMeetingDate, id
    ]);

    if (meetingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Capture existing snapshots BEFORE the DELETE so we can preserve
    // them on re-INSERT for interventions that were already in the
    // meeting. Coalesce null → [] defensively (Migration 020's column
    // default should prevent null, but if anything slips through, treat
    // it as a legacy empty snapshot rather than computing fresh — that
    // would conjure data that wasn't captured at original save time).
    const priorRows = await client.query(
      'SELECT student_intervention_id, weekly_progress_snapshot FROM mtss_meeting_interventions WHERE mtss_meeting_id = $1',
      [id]
    );
    const priorSnapshots = new Map();
    for (const row of priorRows.rows) {
      priorSnapshots.set(row.student_intervention_id, row.weekly_progress_snapshot ?? []);
    }

    // Delete existing intervention reviews and re-insert
    await client.query('DELETE FROM mtss_meeting_interventions WHERE mtss_meeting_id = $1', [id]);


          // Insert intervention reviews
    if (intervention_reviews && intervention_reviews.length > 0) {
      for (const review of intervention_reviews) {
        // Convert empty strings to null for fields with constraints
        const cleanFidelity = review.implementation_fidelity === '' ? null : review.implementation_fidelity;
        const cleanProgress = review.progress_toward_goal === '' ? null : review.progress_toward_goal;
        const cleanRecommendation = review.recommendation === '' ? null : review.recommendation;

        // Q1 (b): preserve prior snapshot if this intervention was already
        // in the meeting; compute fresh only for newly-added interventions.
        const snapshot = priorSnapshots.has(review.student_intervention_id)
          ? priorSnapshots.get(review.student_intervention_id)
          : await computeWeeklyProgressSnapshot(client, review.student_intervention_id, tenant_id);

        await client.query(`
          INSERT INTO mtss_meeting_interventions (
            mtss_meeting_id, student_intervention_id,
            implementation_fidelity, progress_toward_goal, recommendation, notes,
            avg_rating, total_logs, weekly_progress_snapshot
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          id,
          review.student_intervention_id,
          cleanFidelity,
          cleanProgress,
          cleanRecommendation,
          review.notes,
          review.avg_rating,
          review.total_logs,
          JSON.stringify(snapshot)
        ]);
      }
    }

    await client.query('COMMIT');

    res.json(meetingResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating meeting:', error);
    res.status(500).json({ error: 'Failed to update meeting' });
  } finally {
    client.release();
  }
});

// Delete meeting
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM mtss_meetings WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    
    res.json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

// Get meeting counts for a student (useful for knowing which meeting number they're on)
router.get('/student/:studentId/count', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT COUNT(*) as meeting_count, MAX(meeting_number) as last_meeting_number
      FROM mtss_meetings
      WHERE student_id = $1
    `, [studentId]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching meeting count:', error);
    res.status(500).json({ error: 'Failed to fetch meeting count' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
