const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const {
  requireAuth,
  requireStudentReadAccess,
  requireTenantStaffAccess
} = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
//   - POST /upload (bulk-import screener rows) — in scope.
//     Binding is PER-REQUEST, not per-row inside the bulk loop:
//     one resolved target_tenant_id governs the whole batch. The
//     ON CONFLICT (tenant_id, student_id, assessment_type, subject,
//     screening_period, school_year) tuple on screener_results is
//     unaffected — tenant_id remains the first key column.
//
// Helper is duplicated module-local per Followup #132 (consolidation
// deferred to a chore PR post-PR-S3-D-4).
// ============================================================

// PR1 backward-compat default: any upload row missing assessment_type is
// treated as STAR (the only vendor any prior UI ever produced). Migration
// 024's catch-all backfill uses the same default for unlisted tenants.
// PR2 adds a UI-driven dropdown of assessment types and the body field
// becomes required at that point — remove this default then.
const DEFAULT_ASSESSMENT_TYPE = 'STAR';

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

// GET /api/screener-results/student/:studentId — single student's screener
// history. Parent gate: parent_student_links via requireStudentReadAccess.
// Staff gate: tenant match via requireStudentReadAccess. Defense-in-depth
// tenant-bound JOIN catches any future drift where sr.tenant_id and the
// student's tenant_id disagree.
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    // Explicit projection per privacy-reviewer WARN (PR #47): drop the
    // denormalized student_first_name / student_last_name / external_student_id
    // columns since the caller already knows the student (URL carries
    // studentId). Mirrors the §504 routes' "parent-scoped reads MUST
    // explicitly project parent-visible columns and never use SELECT *"
    // discipline. Dashboard list handler (GET /:tenantId) DOES project
    // these for unmatched-name surfacing — different consumer, different
    // need.
    const result = await pool.query(`
      SELECT sr.id, sr.tenant_id, sr.student_id, sr.grade, sr.screener_name,
             sr.assessment_type, sr.subject, sr.screening_period, sr.school_year,
             sr.test_date, sr.scaled_score, sr.percentile_rank,
             sr.benchmark_category, sr.uploaded_by, sr.uploaded_at
      FROM screener_results sr
      JOIN students s ON s.id = sr.student_id AND s.tenant_id = $2
      WHERE sr.student_id = $1
      ORDER BY sr.school_year DESC, sr.screening_period ASC, sr.subject ASC
    `, [req.student.id, req.student.tenant_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('[screener GET /student/:studentId]', err.message);
    res.status(500).json({ error: 'Failed to fetch screener results' });
  }
});

// POST /api/screener-results/upload — bulk-import screener rows. tenant_id
// is server-derived from req.user.tenant_id, NOT from req.body.tenantId
// (which is now ignored — the existing frontend sends it for backward
// compat but the server treats it as untrusted). Role gate: parent role
// rejected; staff roles permitted.
//
// Per-row student_id resolution is bound to req.user.tenant_id so a caller
// cannot match against another tenant's students even if first/last name
// collides cross-tenant. uploaded_by is now populated from the JWT-verified
// caller (was hardcoded to NULL prior to PR1 — no audit trail).
//
// Registered before GET /:tenantId so URL matching is unambiguous (POST
// vs GET are different methods anyway, but ordering keeps intent clear).
router.post('/upload', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { screeningPeriod, schoolYear, rows } = req.body || {};

    if (!screeningPeriod || !schoolYear || !Array.isArray(rows)) {
      return res.status(400).json({ error: 'Missing required fields: screeningPeriod, schoolYear, rows' });
    }

    const tenantId = req.user.tenant_id;
    const uploadedBy = req.user.id;
    let matched = 0;
    const unmatched = [];
    const savedIds = [];

    function normalizeDate(dateStr) {
      if (!dateStr) return null;
      const s = String(dateStr).trim();
      if (s === '-' || s === '') return null;
      const parts = s.split('-');
      if (parts.length === 3 && parts[0].length === 2) {
        return '20' + parts[0] + '-' + parts[1] + '-' + parts[2];
      }
      return s;
    }
    function normalizeBenchmark(val) {
      if (!val) return val;
      const v = String(val).trim();
      if (v === 'Intervention') return 'Below Benchmark';
      if (v === 'On Watch') return 'Near Benchmark';
      return v;
    }

    for (const row of rows) {
      const benchmarkCategory = normalizeBenchmark(row.benchmarkCategory);
      const cleanDate = normalizeDate(row.testDate);
      const cleanScore = (row.scaledScore && String(row.scaledScore).trim() !== '-' && String(row.scaledScore).trim() !== '')
        ? parseInt(row.scaledScore, 10)
        : null;
      const cleanPct = (row.percentileRank && String(row.percentileRank).trim() !== '-' && String(row.percentileRank).trim() !== '')
        ? parseInt(row.percentileRank, 10)
        : null;
      const assessmentType = row.assessmentType || DEFAULT_ASSESSMENT_TYPE;

      // Tenant-bound student resolution: NEVER cross-tenant. A first/last
      // name collision against another tenant's student returns no match
      // here, so the row lands as unmatched (student_id = NULL) rather
      // than mis-attributed.
      const studentResult = await pool.query(
        `SELECT id FROM students
         WHERE tenant_id = $1
           AND LOWER(first_name) = LOWER($2)
           AND LOWER(last_name) = LOWER($3)`,
        [tenantId, row.firstName, row.lastName]
      );
      const studentId = studentResult.rows.length > 0 ? studentResult.rows[0].id : null;
      if (studentId) { matched++; }
      else { unmatched.push(row.firstName + ' ' + row.lastName); }

      const insertResult = await pool.query(`
        INSERT INTO screener_results
          (tenant_id, student_id, student_first_name, student_last_name,
           external_student_id, grade, screener_name, assessment_type, subject,
           screening_period, school_year, test_date, scaled_score,
           percentile_rank, benchmark_category, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (tenant_id, student_id, assessment_type, subject, screening_period, school_year)
        DO UPDATE SET
          scaled_score = EXCLUDED.scaled_score,
          percentile_rank = EXCLUDED.percentile_rank,
          benchmark_category = EXCLUDED.benchmark_category,
          test_date = EXCLUDED.test_date,
          uploaded_by = EXCLUDED.uploaded_by,
          uploaded_at = NOW()
        RETURNING id
      `, [
        tenantId, studentId, row.firstName, row.lastName,
        row.externalStudentId || null, row.grade || null, row.screenerName || null,
        assessmentType, row.subject,
        screeningPeriod, schoolYear, cleanDate,
        cleanScore, cleanPct, benchmarkCategory, uploadedBy
      ]);
      savedIds.push(insertResult.rows[0].id);
    }

    res.json({
      success: true,
      totalRows: rows.length,
      matched,
      unmatched,
      savedCount: savedIds.length
    });
  } catch (err) {
    console.error('[screener POST /upload]', err.message);
    res.status(500).json({ error: 'Failed to upload screener results' });
  }
});

// GET /api/screener-results/:tenantId — dashboard list, scoped to the
// caller's tenant. requireTenantStaffAccess (PR-S3-A swept) refuses parent
// role and verifies that the path :tenantId is in the caller's accessible-
// tenant set via resolveAccessibleTenantIds per §5 dual-path doctrine.
// Path-tenant scoped: SQL filter uses Number(req.params.tenantId);
// middleware-membership-check validated access.
//
// Optional query params (all filter additively):
//   schoolYear, period, subject, assessmentType.
//   assessmentType is unused by PR1's frontend; PR2 wires it up.
router.get('/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    const conditions = ['sr.tenant_id = $1'];
    const values = [Number(req.params.tenantId)];
    let idx = 2;

    if (req.query.schoolYear) {
      conditions.push(`sr.school_year = $${idx}`);
      values.push(req.query.schoolYear);
      idx++;
    }
    if (req.query.period) {
      conditions.push(`sr.screening_period = $${idx}`);
      values.push(req.query.period);
      idx++;
    }
    if (req.query.subject) {
      conditions.push(`sr.subject = $${idx}`);
      values.push(req.query.subject);
      idx++;
    }
    if (req.query.assessmentType) {
      conditions.push(`sr.assessment_type = $${idx}`);
      values.push(req.query.assessmentType);
      idx++;
    }

    const sql = `
      SELECT sr.*, s.first_name, s.last_name,
             COALESCE(s.grade, sr.grade) AS grade
      FROM screener_results sr
      LEFT JOIN students s ON sr.student_id = s.id AND s.tenant_id = $1
      WHERE ${conditions.join(' AND ')}
      ORDER BY sr.grade, sr.student_last_name, sr.student_first_name
    `;
    const result = await pool.query(sql, values);
    res.json(result.rows);
  } catch (err) {
    console.error('[screener GET /:tenantId]', err.message);
    res.status(500).json({ error: 'Failed to fetch screener results' });
  }
});

module.exports = router;
