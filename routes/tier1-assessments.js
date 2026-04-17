const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const {
  ITEM_BANK_VERSION,
  ITEMS,
  ITEMS_BY_ID,
  MAX_SCORE,
  bandForPercentage
} = require('../data/tier1-assessment-items');

let pool;
const initializePool = (dbPool) => { pool = dbPool; };

// Roles allowed to create, edit responses, and complete a Tier 1 assessment.
// Teachers and parents can view (via GET) but cannot modify.
const ROLES_WHO_CAN_EDIT = [
  'district_admin',
  'school_admin',
  'counselor',
  'student_support_specialist',
  'behavior_specialist',
  'mtss_support'
];

// Extract the current user from the httpOnly auth_token cookie and attach
// { id, role, tenant_id } to req.user. Replaces the legacy x-user-* header
// pattern used by older route files; all new routes use this.
const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { rows } = await pool.query(
      'SELECT id, role, tenant_id FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Not authenticated' });

    req.user = rows[0];
    next();
  } catch (err) {
    console.error('[tier1 requireAuth]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// ============================================
// POST /api/tier1-assessments
// Create a new in_progress assessment for the caller's tenant.
// Body: none required; tenant_id and created_by come from req.user.
// ============================================
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!ROLES_WHO_CAN_EDIT.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // App-layer guard for "one in_progress per tenant". The unique partial
    // index in Migration 019 is a safety net; this check gives a clean 409
    // response instead of surfacing a raw DB constraint error.
    const existing = await pool.query(
      `SELECT id FROM tier1_assessments
       WHERE tenant_id = $1 AND status = 'in_progress' AND archived = FALSE`,
      [req.user.tenant_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'An assessment is already in progress for this tenant',
        in_progress_id: existing.rows[0].id
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertResult = await client.query(
        `INSERT INTO tier1_assessments
           (tenant_id, created_by, status, item_bank_version)
         VALUES ($1, $2, 'in_progress', $3)
         RETURNING id, tenant_id, created_by, completed_by, status,
                   total_score, max_score, overall_percentage, score_band,
                   item_bank_version, scope, subject_tenant_id,
                   archived, archived_at, archived_by, archived_reason,
                   created_at, updated_at, completed_at`,
        [req.user.tenant_id, req.user.id, ITEM_BANK_VERSION]
      );
      const assessment = insertResult.rows[0];

      await client.query(
        `INSERT INTO tier1_assessment_events
           (assessment_id, tenant_id, event_type, user_id)
         VALUES ($1, $2, 'created', $3)`,
        [assessment.id, req.user.tenant_id, req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json({ assessment, responses: [] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[tier1 POST /]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// GET /api/tier1-assessments/:id
// Fetch a single assessment + all its responses, scoped to the caller's
// tenant. Cross-tenant access returns 404 (not 403) to avoid leaking
// existence of assessments belonging to other tenants.
// ============================================
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const idInt = parseInt(req.params.id, 10);
    if (!Number.isInteger(idInt) || idInt <= 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const assessResult = await pool.query(
      `SELECT id, tenant_id, created_by, completed_by, status,
              total_score, max_score, overall_percentage, score_band,
              item_bank_version, scope, subject_tenant_id,
              archived, archived_at, archived_by, archived_reason,
              created_at, updated_at, completed_at
       FROM tier1_assessments
       WHERE id = $1 AND tenant_id = $2`,
      [idInt, req.user.tenant_id]
    );

    if (assessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const assessment = assessResult.rows[0];

    const responsesResult = await pool.query(
      `SELECT id, item_id, domain_number, score, evidence_url, notes,
              created_at, updated_at
       FROM tier1_assessment_responses
       WHERE assessment_id = $1 AND tenant_id = $2
       ORDER BY item_id`,
      [assessment.id, req.user.tenant_id]
    );

    res.json({ assessment, responses: responsesResult.rows });
  } catch (err) {
    console.error('[tier1 GET /:id]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// PATCH /api/tier1-assessments/:id/responses/:itemId
// Autosave a single item's response. Accepts any combination of
// { score, evidence_url, notes }. A field that is NOT in the body is
// preserved unchanged; a field sent as null (or empty string for url/notes)
// is cleared. At least one of the three fields must be present.
//
// Only works while the assessment is in_progress. Completed or archived
// assessments return 409. No server-side PII detection — that is a
// client-side concern per the v5 spec.
// ============================================
router.patch('/:id/responses/:itemId', requireAuth, async (req, res) => {
  try {
    if (!ROLES_WHO_CAN_EDIT.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const idInt = parseInt(req.params.id, 10);
    if (!Number.isInteger(idInt) || idInt <= 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Validate item_id against the code-stored item bank. Unknown ids 404.
    const itemId = req.params.itemId;
    const item = ITEMS_BY_ID[itemId];
    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }

    const body = req.body || {};
    const scoreSent = Object.prototype.hasOwnProperty.call(body, 'score');
    const urlSent = Object.prototype.hasOwnProperty.call(body, 'evidence_url');
    const notesSent = Object.prototype.hasOwnProperty.call(body, 'notes');

    if (!scoreSent && !urlSent && !notesSent) {
      return res.status(400).json({ error: 'No fields provided' });
    }

    // Field validation
    let scoreValue = null;
    if (scoreSent) {
      const s = body.score;
      if (s !== null && !(s === 0 || s === 1 || s === 2)) {
        return res.status(400).json({ error: 'Invalid score' });
      }
      scoreValue = s;
    }

    let urlValue = null;
    if (urlSent) {
      const u = body.evidence_url;
      if (u === null || u === '') {
        urlValue = null;
      } else if (typeof u !== 'string') {
        return res.status(400).json({ error: 'Invalid evidence_url' });
      } else {
        let parsed;
        try {
          parsed = new URL(u);
        } catch (_) {
          return res.status(400).json({ error: 'Invalid evidence_url' });
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'Invalid evidence_url' });
        }
        urlValue = u;
      }
    }

    let notesValue = null;
    if (notesSent) {
      const n = body.notes;
      if (n === null || n === '') {
        notesValue = null;
      } else if (typeof n !== 'string') {
        return res.status(400).json({ error: 'Invalid notes' });
      } else if (n.length > 300) {
        return res.status(400).json({ error: 'Notes exceed 300 characters' });
      } else {
        notesValue = n;
      }
    }

    // Assessment must exist, belong to this tenant, and be in_progress.
    const assessResult = await pool.query(
      `SELECT id, status FROM tier1_assessments
       WHERE id = $1 AND tenant_id = $2`,
      [idInt, req.user.tenant_id]
    );
    if (assessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const assessmentStatus = assessResult.rows[0].status;
    if (assessmentStatus !== 'in_progress') {
      return res.status(409).json({ error: 'Assessment is not editable' });
    }

    // UPSERT. For the CONFLICT branch, only overwrite the columns that were
    // actually sent in the body; preserve the rest via CASE ... ELSE table.col.
    const result = await pool.query(
      `INSERT INTO tier1_assessment_responses
         (assessment_id, tenant_id, item_id, domain_number, score, evidence_url, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (assessment_id, item_id) DO UPDATE SET
         score = CASE WHEN $8::boolean THEN EXCLUDED.score
                      ELSE tier1_assessment_responses.score END,
         evidence_url = CASE WHEN $9::boolean THEN EXCLUDED.evidence_url
                             ELSE tier1_assessment_responses.evidence_url END,
         notes = CASE WHEN $10::boolean THEN EXCLUDED.notes
                      ELSE tier1_assessment_responses.notes END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, assessment_id, item_id, domain_number,
                 score, evidence_url, notes, created_at, updated_at`,
      [
        idInt, req.user.tenant_id, itemId, item.domain,
        scoreValue, urlValue, notesValue,
        scoreSent, urlSent, notesSent
      ]
    );

    res.json({ response: result.rows[0] });
  } catch (err) {
    console.error('[tier1 PATCH /:id/responses/:itemId]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// POST /api/tier1-assessments/:id/complete
// Finalize an in_progress assessment. Requires every item in the current
// item bank to have a non-null score. Computes total/max/percentage/band,
// stamps completed_at and completed_by, and logs a 'completed' event in
// the same transaction as the UPDATE.
// ============================================
router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    if (!ROLES_WHO_CAN_EDIT.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const idInt = parseInt(req.params.id, 10);
    if (!Number.isInteger(idInt) || idInt <= 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const assessResult = await pool.query(
      `SELECT id, status FROM tier1_assessments
       WHERE id = $1 AND tenant_id = $2`,
      [idInt, req.user.tenant_id]
    );
    if (assessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (assessResult.rows[0].status !== 'in_progress') {
      return res.status(409).json({ error: 'Assessment is not editable' });
    }

    // Fetch all responses and verify every item in the current bank has a
    // non-null score. Defensive: ignore rows whose item_id is no longer in
    // the bank (e.g., item retired in a future version).
    const responsesResult = await pool.query(
      `SELECT item_id, score
       FROM tier1_assessment_responses
       WHERE assessment_id = $1 AND tenant_id = $2`,
      [idInt, req.user.tenant_id]
    );

    const scoreByItemId = new Map();
    for (const row of responsesResult.rows) {
      scoreByItemId.set(row.item_id, row.score);
    }

    const missing = [];
    let totalScore = 0;
    for (const item of ITEMS) {
      const s = scoreByItemId.get(item.id);
      if (s === undefined || s === null) {
        missing.push(item.id);
      } else {
        totalScore += s;
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Not all items have been scored',
        missing_item_ids: missing
      });
    }

    const overallPct = Math.round((totalScore / MAX_SCORE) * 10000) / 100;
    const band = bandForPercentage(overallPct);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateResult = await client.query(
        `UPDATE tier1_assessments SET
           status = 'completed',
           completed_at = CURRENT_TIMESTAMP,
           completed_by = $1,
           total_score = $2,
           max_score = $3,
           overall_percentage = $4,
           score_band = $5,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $6 AND tenant_id = $7 AND status = 'in_progress'
         RETURNING id, tenant_id, created_by, completed_by, status,
                   total_score, max_score, overall_percentage, score_band,
                   item_bank_version, scope, subject_tenant_id,
                   archived, archived_at, archived_by, archived_reason,
                   created_at, updated_at, completed_at`,
        [req.user.id, totalScore, MAX_SCORE, overallPct, band, idInt, req.user.tenant_id]
      );

      // Guard against a race: if the status changed between our earlier
      // SELECT and the UPDATE (e.g., a parallel complete), the UPDATE
      // matches zero rows. Roll back and report the conflict.
      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Assessment is not editable' });
      }

      await client.query(
        `INSERT INTO tier1_assessment_events
           (assessment_id, tenant_id, event_type, user_id)
         VALUES ($1, $2, 'completed', $3)`,
        [idInt, req.user.tenant_id, req.user.id]
      );

      await client.query('COMMIT');
      res.json({ assessment: updateResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[tier1 POST /:id/complete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
