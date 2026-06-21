const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const {
  requireAuth,
  requireStudentReadAccess,
  requireTenantStaffAccess
} = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { csvImportLimiter, mutationUserLimiter, screenerResetLimiter } = require('../middleware/rateLimiters');
const { validateResetScope, buildScopeWhere } = require('./screenerResetCore');
const multer = require('multer');
const fs = require('fs');
const {
  upsertScreenerRow,
  resolveStudentMatch,
  parseAndValidateScreenerFile,
  SCREENER_TYPE_CONTRACTS,
  SCREENER_IMPORT_ROW_CAP_MESSAGE
} = require('./screenerImportCore');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// multer config for the file validate/commit routes — type + size validated
// before the handler runs. Mirrors routes/operatorStudentImport.js (5MB,
// CSV-only, disk dest). (MulterError normalization is the shared banked
// follow-up #multer-error-normalizer; same gap as the operator importers.)
const { handleCsvUploadError, InvalidFileTypeError } = require('../middleware/multerErrorHandler');

const screenerUpload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new InvalidFileTypeError(), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Normalize the multipart target_tenant_id: multer delivers form fields as
// strings, but resolveAndBindTargetTenant expects a number or absent. Empty →
// absent (falls back to req.user.tenant_id); numeric string → number; anything
// else is left as-is so isPositiveInt() rejects it with a 400.
function normalizeTargetTenantId(req) {
  if (!req.body) return;
  const v = req.body.target_tenant_id;
  if (v == null || String(v).trim() === '') { delete req.body.target_tenant_id; return; }
  const n = Number(v);
  req.body.target_tenant_id = Number.isInteger(n) ? n : v;
}

// Validate the form-field metadata shared by the validate + commit routes.
// assessment_type must be a known per-type contract; subject/period/year are
// required non-empty. Static strings only (§4B). Returns { meta } or { error }.
function validateScreenerImportMeta(req) {
  const assessmentType = (req.body.assessmentType || '').trim();
  const subject = (req.body.subject || '').trim();
  const screeningPeriod = (req.body.screeningPeriod || '').trim();
  const schoolYear = (req.body.schoolYear || '').trim();
  if (!SCREENER_TYPE_CONTRACTS[assessmentType]) {
    return { error: { status: 400, body: { error: 'Unknown or missing assessment type.' } } };
  }
  if (!subject || !screeningPeriod || !schoolYear) {
    return { error: { status: 400, body: { error: 'Missing required fields: subject, screeningPeriod, schoolYear.' } } };
  }
  return { meta: { assessmentType, subject, screeningPeriod, schoolYear } };
}

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
    if (req.user.tenant_id == null) {
      return { targetTenantId: null, error: { status: 400, body: { error: 'target_tenant_id is required' } } };
    }
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

    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);
    const uploadedBy = req.user.id;
    let matched = 0;
    const unmatched = [];
    const savedIds = [];

    for (const row of rows) {
      // Tenant-bound matching via the shared helper (Slice B). BEHAVIOR
      // CHANGE: matching is now external_id-first then name-fallback; an
      // ambiguous name (>1 hit) no longer silently takes the first match. And
      // ONLY matched rows are persisted — unmatched/ambiguous rows are not
      // written, so no student_id = NULL row is created and the NULLS NOT
      // DISTINCT collapse cannot occur (symmetry with the file /commit, §3A).
      // This JSON path's sole caller is the FE modal (no external_id sent →
      // name-only); unmatched names are still returned for that UI.
      const { studentId, matchStatus } = await resolveStudentMatch(pool, tenantId, row);
      if (matchStatus !== 'matched') {
        unmatched.push(row.firstName + ' ' + row.lastName);
        continue;
      }
      // Field normalization + upsert live in the shared core (Slice A, H-11)
      // so the file validate/commit paths reuse identical logic.
      const savedId = await upsertScreenerRow(pool, {
        row, tenantId, studentId, screeningPeriod, schoolYear, uploadedBy
      });
      savedIds.push(savedId);
      matched++;
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

// POST /api/screener-results/upload/validate — file dry-run (Slice B, H-11).
// Parses an uploaded per-type screener CSV and returns a COUNTS-ONLY summary.
// WRITES NOTHING (read-only matching + upsert-conflict preview only). Mirrors
// the operator student-importer's validate surface.
//
// §4B: per-row errors carry { row, error } with ROW NUMBERS ONLY — never a
// student name or other PII. The uploaded file is deleted on EVERY exit path
// (cleanup() in finally). §5: tenant_id is server-derived via
// resolveAndBindTargetTenant → resolveAccessibleTenantIds (403 before any
// work); the student match is tenant-bound. Metadata (assessment_type,
// subject, period, year) comes from multipart form fields.
async function validateScreenerUpload(req, res) {
  const cleanup = () => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };
  try {
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Not authorized' });

    normalizeTargetTenantId(req);
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);

    const { meta, error: metaError } = validateScreenerImportMeta(req);
    if (metaError) return res.status(metaError.status).json(metaError.body);

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { totalRows, rows, validationErrors, capExceeded, headerError } =
      await parseAndValidateScreenerFile(req.file.path, { assessmentType: meta.assessmentType });
    if (capExceeded) return res.status(400).json({ error: SCREENER_IMPORT_ROW_CAP_MESSAGE });
    if (headerError) return res.status(400).json({ error: headerError });

    // Read-only matching. Only MATCHED rows will be persisted on commit;
    // unmatched/ambiguous rows are reported by row number (§3A unlinked-rows
    // policy) and skipped from the upsert-conflict preview.
    let matched = 0, alreadyExists = 0;
    const unmatchedRows = [];
    const ambiguousRows = [];
    for (const row of rows) {
      const { studentId, matchStatus } = await resolveStudentMatch(pool, tenantId, row);
      if (matchStatus !== 'matched') {
        if (matchStatus === 'ambiguous') ambiguousRows.push(row.rowNumber);
        else unmatchedRows.push(row.rowNumber);
        continue;
      }
      matched++;
      // upsert-conflict preview (matched rows only — the only ones written).
      const existing = await pool.query(
        `SELECT 1 FROM screener_results
         WHERE tenant_id = $1 AND student_id = $2
           AND assessment_type = $3 AND subject = $4
           AND screening_period = $5 AND school_year = $6
         LIMIT 1`,
        [tenantId, studentId, meta.assessmentType, meta.subject, meta.screeningPeriod, meta.schoolYear]
      );
      if (existing.rows.length > 0) alreadyExists++;
    }

    // Counts-only logging — no PII, no row data.
    console.log('[screener:import-validate] tenant:', tenantId, 'type:', meta.assessmentType,
      'totalRows:', totalRows, 'valid:', rows.length, 'matched:', matched,
      'unmatched:', unmatchedRows.length, 'ambiguous:', ambiguousRows.length,
      'validationErrors:', validationErrors.length, 'alreadyExists:', alreadyExists);

    res.json({
      validateOnly: true,
      assessmentType: meta.assessmentType,
      summary: {
        totalRows,
        valid: rows.length,
        validationErrors: validationErrors.length,
        matched,
        unmatched: unmatchedRows.length,
        ambiguous: ambiguousRows.length,
        alreadyExists
      },
      errors: validationErrors, // [{ row, error }] — row numbers only (§4B)
      unmatchedRows,            // row numbers only — will NOT be persisted (§4B)
      ambiguousRows             // row numbers only — will NOT be persisted (§4B)
    });
  } catch (err) {
    console.error('[screener:import-validate] error code:', err.code);
    res.status(500).json({ error: 'Failed to validate screener upload' });
  } finally {
    cleanup();
  }
}
router.post('/upload/validate', requireAuth, csvImportLimiter, screenerUpload.single('file'), validateScreenerUpload, handleCsvUploadError);

// POST /api/screener-results/upload/commit — file write (Slice B, H-11).
// Re-parses the CSV; ALL-OR-NOTHING: any row error → 422 before writing.
// Single transaction (BEGIN/COMMIT, ROLLBACK on error); 409 on a 23505 race.
// Provenance is uploaded_by/uploaded_at only — NO audit table, NO actor GUC
// (§4A). §4B cleanup() in finally; §5 server-derived tenant + tenant-bound
// match passed the pooled client so matching runs inside the transaction.
async function commitScreenerUpload(req, res) {
  const cleanup = () => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };
  try {
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Not authorized' });

    normalizeTargetTenantId(req);
    const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) return res.status(bindError.status).json(bindError.body);

    const { meta, error: metaError } = validateScreenerImportMeta(req);
    if (metaError) return res.status(metaError.status).json(metaError.body);

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const uploadedBy = req.user.id;

    const { totalRows, rows, validationErrors, capExceeded, headerError } =
      await parseAndValidateScreenerFile(req.file.path, { assessmentType: meta.assessmentType });
    if (capExceeded) return res.status(400).json({ error: SCREENER_IMPORT_ROW_CAP_MESSAGE });
    if (headerError) return res.status(400).json({ error: headerError });

    // ALL-OR-NOTHING: any row error → reject before writing (no partial commit).
    if (validationErrors.length > 0) {
      return res.status(422).json({
        error: 'Import rejected: the CSV has row-level errors. Re-run validate and fix every row before committing.',
        errors: validationErrors
      });
    }
    if (rows.length === 0) return res.status(422).json({ error: 'Import rejected: no valid rows to import.' });

    // Persist ONLY matched rows. Rows with no student link (unmatched or
    // ambiguous) are NOT written — this avoids any student_id = NULL row and
    // therefore the NULLS NOT DISTINCT collapse entirely (§3A). The skipped
    // rows are returned by row number so the uploader can add the student /
    // SIS id and re-upload.
    let matched = 0, saved = 0;
    const unmatchedRows = [];
    const ambiguousRows = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const { studentId, matchStatus } = await resolveStudentMatch(client, tenantId, row);
        if (matchStatus !== 'matched') {
          if (matchStatus === 'ambiguous') ambiguousRows.push(row.rowNumber);
          else unmatchedRows.push(row.rowNumber);
          continue;
        }
        // Attach form-field metadata; mapped per-row values are pre-normalized
        // (upsertScreenerRow re-normalizes idempotently).
        const upsertRow = {
          ...row,
          assessmentType: meta.assessmentType,
          subject: meta.subject,
          screenerName: meta.assessmentType + ' ' + meta.subject
        };
        await upsertScreenerRow(client, {
          row: upsertRow, tenantId, studentId,
          screeningPeriod: meta.screeningPeriod, schoolYear: meta.schoolYear, uploadedBy
        });
        matched++;
        saved++;
      }
      await client.query('COMMIT');
    } catch (dbError) {
      try { await client.query('ROLLBACK'); } catch (_rollbackErr) { /* connection may be broken */ }
      client.release();
      if (dbError.code === '23505') {
        return res.status(409).json({ error: 'Import aborted: a concurrent change collided. No records were saved. Re-run validate and retry.' });
      }
      console.error('[screener:import-commit] insert error code:', dbError.code);
      return res.status(500).json({ error: 'Failed to commit screener upload' });
    }
    client.release();

    console.log('[screener:import-commit] committed tenant:', tenantId, 'type:', meta.assessmentType,
      'totalRows:', totalRows, 'saved:', saved, 'matched:', matched,
      'unmatched:', unmatchedRows.length, 'ambiguous:', ambiguousRows.length);

    res.status(201).json({
      committed: true,
      assessmentType: meta.assessmentType,
      summary: {
        totalRows, saved, matched,
        unmatched: unmatchedRows.length,
        ambiguous: ambiguousRows.length
      },
      unmatchedRows, // row numbers only — NOT persisted (§4B)
      ambiguousRows  // row numbers only — NOT persisted (§4B)
    });
  } catch (err) {
    console.error('[screener:import-commit] error code:', err.code);
    res.status(500).json({ error: 'Failed to commit screener upload' });
  } finally {
    cleanup();
  }
}
router.post('/upload/commit', requireAuth, csvImportLimiter, screenerUpload.single('file'), commitScreenerUpload, handleCsvUploadError);

// ============================================================
// Scoped screener-data RESET (feat/screener-data-reset)
//
// Two-step, mirroring validate→commit: POST /reset/preview returns a COUNT
// only; POST /reset hard-deletes the matching screener_results rows and records
// the action in screener_reset_audit (M049) in the SAME transaction.
//
// Authz (stricter than the upload routes' "any non-parent"): RESET_ADMIN_ROLES
// only. A destructive PII delete is admin-grade.
//
// §5: the target tenant is resolved from resolveAccessibleTenantIds — the
// request may only SELECT among the caller's accessible schools (membership is
// mandatory, 403 otherwise); it can never name a tenant outside that set. For a
// destructive op we refuse to guess across multiple schools (400 when the
// account can reach >1 school and none is selected).
// ============================================================

const RESET_ADMIN_ROLES = ['school_admin', 'district_admin'];

// Resolve the school-tenant a reset will target. Authority is
// resolveAccessibleTenantIds(req.user); req.body.school_tenant_id is only a
// selector that MUST be a member of that set. Returns { tenantId } or
// { error: { status, body } }. Never trusts a request-supplied tenant as
// authoritative.
async function resolveResetTenant(req) {
  const accessible = await resolveAccessibleTenantIds(req.user);
  if (accessible.length === 0) {
    return { error: { status: 403, body: { error: 'No accessible schools for this account.' } } };
  }

  const raw = req.body ? req.body.school_tenant_id : undefined;
  if (raw == null || String(raw).trim() === '') {
    if (accessible.length === 1) return { tenantId: accessible[0] };
    return {
      error: {
        status: 400,
        body: { error: 'school_tenant_id is required when the account can access more than one school.' }
      }
    };
  }

  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { error: { status: 400, body: { error: 'Invalid school_tenant_id.' } } };
  }
  if (!accessible.includes(n)) {
    // Cross-tenant probe collapses to 403 before any DB scope work (§5).
    return { error: { status: 403, body: { error: 'Not authorized for the requested school.' } } };
  }
  return { tenantId: n };
}

// POST /api/screener-results/reset/preview — READ-ONLY count of the rows a
// reset with this scope would delete. Returns { count } only — never names,
// ids, or scores (§4B). Same auth, tenant resolution, and scope helpers as the
// delete, so the previewed count matches what /reset removes.
router.post('/reset/preview', requireAuth, mutationUserLimiter, async (req, res) => {
  try {
    if (!RESET_ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { tenantId, error: tenantError } = await resolveResetTenant(req);
    if (tenantError) return res.status(tenantError.status).json(tenantError.body);

    const { scope, error: scopeError } = validateResetScope(req.body);
    if (scopeError) return res.status(scopeError.status).json(scopeError.body);

    const { whereSql, params } = buildScopeWhere(tenantId, scope);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM screener_results WHERE ${whereSql}`,
      params
    );
    return res.json({ count: rows[0].count });
  } catch (err) {
    console.error('[screener:reset-preview] error code:', err.code);
    return res.status(500).json({ error: 'Failed to preview screener reset' });
  }
});

// POST /api/screener-results/reset — hard-delete the screener_results rows
// matching the scope for the resolved tenant, and record the action in
// screener_reset_audit. The DELETE and the audit INSERT run in ONE transaction:
// no delete without a matching audit row, and vice versa. deleted_count is the
// DELETE rowCount captured inside that transaction. Returns { deletedCount }.
router.post('/reset', requireAuth, screenerResetLimiter, async (req, res) => {
  try {
    if (!RESET_ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { tenantId, error: tenantError } = await resolveResetTenant(req);
    if (tenantError) return res.status(tenantError.status).json(tenantError.body);

    const { scope, error: scopeError } = validateResetScope(req.body);
    if (scopeError) return res.status(scopeError.status).json(scopeError.body);

    const { whereSql, params } = buildScopeWhere(tenantId, scope);

    const client = await pool.connect();
    let deletedCount;
    try {
      await client.query('BEGIN');
      // Capture the rowCount of the DELETE inside the transaction — this exact
      // number is what the audit row records.
      const del = await client.query(
        `DELETE FROM screener_results WHERE ${whereSql}`,
        params
      );
      deletedCount = del.rowCount;

      // Audit row: scope + actor + (default) occurred_at. district_id comes from
      // the resolved user, NULL for legacy single-tenant users. assessment_type
      // is NULL (not "") when the reset was not narrowed — validateResetScope
      // guarantees the null/empty distinction. No names/ids/scores (§4B).
      await client.query(
        `INSERT INTO screener_reset_audit
           (school_tenant_id, district_id, school_year, screening_period,
            subject, assessment_type, deleted_count, actor_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          req.user.district_id == null ? null : req.user.district_id,
          scope.schoolYear,
          scope.screeningPeriod,
          scope.subject,
          scope.assessmentType, // null when un-narrowed
          deletedCount,
          req.user.id
        ]
      );
      await client.query('COMMIT');
    } catch (dbError) {
      try { await client.query('ROLLBACK'); } catch (_rollbackErr) { /* connection may be broken */ }
      client.release();
      console.error('[screener:reset] db error code:', dbError.code);
      return res.status(500).json({ error: 'Failed to reset screener data' });
    }
    client.release();

    console.log('[screener:reset] tenant:', tenantId, 'deleted:', deletedCount,
      'actor:', req.user.id, 'narrowed:', scope.assessmentType !== null);

    return res.json({ deletedCount });
  } catch (err) {
    console.error('[screener:reset] error code:', err.code);
    return res.status(500).json({ error: 'Failed to reset screener data' });
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
// Test seams: the upload handlers are exported so the dependency-free
// req/res-recorder tests (test/screenerUploadHandlers.test.js) can drive
// the unknown-assessment-type path directly — it returns 400 before any
// DB/file work, so no live DB or HTTP harness is required.
module.exports.validateScreenerUpload = validateScreenerUpload;
module.exports.commitScreenerUpload = commitScreenerUpload;
