const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { ITEM_BANK_VERSION } = require('../data/tier1-assessment-items');

let pool;
const initializePool = (dbPool) => { pool = dbPool; };

const ROLES_WHO_CAN_CREATE = [
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
    if (!ROLES_WHO_CAN_CREATE.includes(req.user.role)) {
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

module.exports = router;
module.exports.initializePool = initializePool;
