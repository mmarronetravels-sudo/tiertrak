const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();
const {
  resolveStudentMatch,
  parseAndValidateScreenerFile,
  upsertScreenerRow,
  SCREENER_TYPE_CONTRACTS,
  SCREENER_IMPORT_ROW_CAP_MESSAGE
} = require('./screenerImportCore');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================
// Operator-console SCREENER-IMPORT (H-11 Slice C)
//
// Registered on the existing operator router (routes/operatorDistricts.js) as:
//   POST /api/operator/districts/:districtId/schools/:schoolTenantId/screener-import/validate
//   POST /api/operator/districts/:districtId/schools/:schoolTenantId/screener-import/commit
//
// The routes live on operatorDistricts.js so that router's single
// `router.use(requireAuth, platformAdminOnly)` runs auth ONCE for this
// surface; only the handlers + this multer config live here. Same
// hang-off-the-existing-router rationale as the operator student/staff
// importers.
//
// Reuses the shared screener core (screenerImportCore.js — resolveStudentMatch,
// parseAndValidateScreenerFile, upsertScreenerRow) and the SAME lifecycle as
// the school-admin file surface (routes/screener.js, Slice B): true dry-run
// validate (counts-only, no writes), all-or-nothing transactional commit,
// MATCHED-ONLY persistence (never write a student_id = NULL row → no
// NULLS NOT DISTINCT collapse), 1000-row cap, cleanup() in finally. STAR only;
// MAP stays deferred (feat/multi-screener-map).
//
// Provenance is uploaded_by/uploaded_at on screener_results only — NO audit
// table and NO app.actor_user_id GUC (§4A). (The student importer writes a
// student_import_audit row + sets the GUC; screener_results has no such table
// and the upsert refreshes uploaded_by/uploaded_at, so neither is carried.)
//
// §5 — tenant binding is STRUCTURAL from the URL path, NOT from a body field.
// This is the key difference from the Slice B school-admin path (which uses
// resolveAndBindTargetTenant on a body target_tenant_id). Here:
//   - districtId and schoolTenantId both come from the URL path (each
//     validated as a positive int32). There is NO tenant field in the body.
//   - Two pre-flights run BEFORE any matching/write:
//       (1) district exists                                  → else 404
//       (2) school tenant exists AND type='school' AND
//           district_id === path districtId                  → else 404
//   - resolveAccessibleTenantIds is deliberately NOT used: operators
//     (platformAdminOnly) hold zero user_school_access rows; the membership
//     helper would resolve to an empty set and 404 every request. The operator
//     gate is platformAdminOnly (router.use) plus the structural pre-flights —
//     identical to the operator student/staff importers.
//   - Every resolveStudentMatch / upsertScreenerRow call binds the
//     path-derived schoolTenantId. No CSV/body value is ever a tenant.
//
// §4B — per-row errors carry { row, error } ONLY; unmatched/ambiguous rows are
// returned by ROW NUMBER (unmatchedRows / ambiguousRows), never by name. Server
// logs are counts/codes only. The uploaded CSV is deleted in EVERY exit path
// (cleanup() in finally).
// ============================================================

// multer config — type + size validated before the handler runs. Mirrors
// routes/operatorStudentImport.js (5MB, CSV-only, disk dest). Exported so
// operatorDistricts.js can wire `upload.single('file')` into the route chain.
// (MulterError normalization is the shared banked follow-up
// #multer-error-normalizer; same gap as the other importers.)
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

const INT4_MAX = 2147483647;

// Local positive-int32 validator. Duplicated from operatorStudentImport.js /
// operatorDistricts.js by the approved duplicate-locally decision (Followup
// #124-validateIntParam-dedupe).
function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// Validate the form-field metadata. assessment_type must be a known per-type
// contract (STAR only in Phase 1; an unsupported value such as MAP → 400);
// subject/screeningPeriod/schoolYear required non-empty. Static strings only
// (§4B). Returns { assessmentType, subject, screeningPeriod, schoolYear } or
// { error: { status, body } }.
function validateScreenerMeta(req) {
  const b = req.body || {};
  const assessmentType = (b.assessmentType || '').trim();
  const subject = (b.subject || '').trim();
  const screeningPeriod = (b.screeningPeriod || '').trim();
  const schoolYear = (b.schoolYear || '').trim();
  if (!SCREENER_TYPE_CONTRACTS[assessmentType]) {
    return { error: { status: 400, body: { error: 'Unknown or missing assessment type.' } } };
  }
  if (!subject || !screeningPeriod || !schoolYear) {
    return { error: { status: 400, body: { error: 'Missing required fields: subject, screeningPeriod, schoolYear.' } } };
  }
  return { assessmentType, subject, screeningPeriod, schoolYear, error: null };
}

// §5 pre-flights, shared by validate + commit. `db` is a pg Pool/Client so the
// binding is unit-testable. Resolves { schoolTenantId } on success or
// { error: { status, body } } if the path district/school is invalid or the
// school does not belong to the district. Returns 404 (not 403) for every
// reject — mirroring the operator student/staff importers, so the response
// does not leak whether a given district/school id exists.
async function resolvePathTenant(db, districtId, schoolTenantId) {
  const district = await db.query('SELECT id FROM districts WHERE id = $1', [districtId]);
  if (district.rows.length === 0) {
    return { error: { status: 404, body: { error: 'Not found' } } };
  }
  const schoolTenant = await db.query(
    "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
    [schoolTenantId]
  );
  if (schoolTenant.rows.length === 0 || schoolTenant.rows[0].district_id !== districtId) {
    return { error: { status: 404, body: { error: 'Not found' } } };
  }
  return { schoolTenantId, error: null };
}

// Handler for POST /:districtId/schools/:schoolTenantId/screener-import/validate.
// requireAuth + platformAdminOnly have already run on the parent router. A
// DRY-RUN: parses the uploaded CSV, runs read-only matching + an upsert-conflict
// preview, and returns a counts-only summary. WRITES NOTHING.
async function validateScreenerImport(req, res) {
  const cleanup = () => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };
  try {
    const districtId = validateIntParam(req.params.districtId);
    if (districtId === null) return res.status(400).json({ error: 'Invalid district id' });
    const schoolTenantId = validateIntParam(req.params.schoolTenantId);
    if (schoolTenantId === null) return res.status(400).json({ error: 'Invalid school_tenant_id' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const meta = validateScreenerMeta(req);
    if (meta.error) return res.status(meta.error.status).json(meta.error.body);

    // §5 structural tenant binding from the path.
    const bind = await resolvePathTenant(pool, districtId, schoolTenantId);
    if (bind.error) return res.status(bind.error.status).json(bind.error.body);

    const { totalRows, rows, validationErrors, capExceeded, headerError } =
      await parseAndValidateScreenerFile(req.file.path, { assessmentType: meta.assessmentType });
    if (capExceeded) return res.status(400).json({ error: SCREENER_IMPORT_ROW_CAP_MESSAGE });
    if (headerError) return res.status(400).json({ error: headerError });

    // Read-only matching + upsert-conflict preview, bound to the path school.
    // Only MATCHED rows will be persisted on commit; unmatched/ambiguous are
    // reported by row number (§3A) and skipped from the preview.
    let matched = 0, alreadyExists = 0;
    const unmatchedRows = [];
    const ambiguousRows = [];
    for (const row of rows) {
      const { studentId, matchStatus } = await resolveStudentMatch(pool, schoolTenantId, row);
      if (matchStatus !== 'matched') {
        if (matchStatus === 'ambiguous') ambiguousRows.push(row.rowNumber);
        else unmatchedRows.push(row.rowNumber);
        continue;
      }
      matched++;
      const existing = await pool.query(
        `SELECT 1 FROM screener_results
         WHERE tenant_id = $1 AND student_id = $2
           AND assessment_type = $3 AND subject = $4
           AND screening_period = $5 AND school_year = $6
         LIMIT 1`,
        [schoolTenantId, studentId, meta.assessmentType, meta.subject, meta.screeningPeriod, meta.schoolYear]
      );
      if (existing.rows.length > 0) alreadyExists++;
    }

    // Counts-only logging — no PII, no row data.
    console.log('[operator:screener-import-validate] district:', districtId, 'school:', schoolTenantId,
      'type:', meta.assessmentType, 'totalRows:', totalRows, 'valid:', rows.length,
      'matched:', matched, 'unmatched:', unmatchedRows.length, 'ambiguous:', ambiguousRows.length,
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
  } catch (error) {
    console.error('[operator:screener-import-validate] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  } finally {
    cleanup();
  }
}

// Handler for POST /:districtId/schools/:schoolTenantId/screener-import/commit.
// The WRITE counterpart. Re-parses; ALL-OR-NOTHING: any row error → 422 before
// writing. Single transaction; MATCHED-ONLY persistence; 409 on a 23505 race.
async function commitScreenerImport(req, res) {
  const cleanup = () => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };
  try {
    const districtId = validateIntParam(req.params.districtId);
    if (districtId === null) return res.status(400).json({ error: 'Invalid district id' });
    const schoolTenantId = validateIntParam(req.params.schoolTenantId);
    if (schoolTenantId === null) return res.status(400).json({ error: 'Invalid school_tenant_id' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const meta = validateScreenerMeta(req);
    if (meta.error) return res.status(meta.error.status).json(meta.error.body);

    // uploaded_by provenance is the JWT-verified operator (§4A).
    const uploadedBy = Number(req.user.id);
    if (!Number.isInteger(uploadedBy) || uploadedBy <= 0) {
      console.error('[operator:screener-import-commit] invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    // §5 structural tenant binding from the path.
    const bind = await resolvePathTenant(pool, districtId, schoolTenantId);
    if (bind.error) return res.status(bind.error.status).json(bind.error.body);

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

    // Persist ONLY matched rows (no student_id = NULL writes → no NULLS NOT
    // DISTINCT collapse). Unmatched/ambiguous returned by row number (§3A).
    let matched = 0, saved = 0;
    const unmatchedRows = [];
    const ambiguousRows = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const { studentId, matchStatus } = await resolveStudentMatch(client, schoolTenantId, row);
        if (matchStatus !== 'matched') {
          if (matchStatus === 'ambiguous') ambiguousRows.push(row.rowNumber);
          else unmatchedRows.push(row.rowNumber);
          continue;
        }
        const upsertRow = {
          ...row,
          assessmentType: meta.assessmentType,
          subject: meta.subject,
          screenerName: meta.assessmentType + ' ' + meta.subject
        };
        await upsertScreenerRow(client, {
          row: upsertRow, tenantId: schoolTenantId, studentId,
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
      console.error('[operator:screener-import-commit] insert error code:', dbError.code);
      return res.status(500).json({ error: 'Server error' });
    }
    client.release();

    console.log('[operator:screener-import-commit] committed district:', districtId, 'school:', schoolTenantId,
      'type:', meta.assessmentType, 'totalRows:', totalRows, 'saved:', saved,
      'matched:', matched, 'unmatched:', unmatchedRows.length, 'ambiguous:', ambiguousRows.length);

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
  } catch (error) {
    console.error('[operator:screener-import-commit] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  } finally {
    cleanup();
  }
}

module.exports = {
  upload,
  validateScreenerImport,
  commitScreenerImport,
  // exported for the unit harness (no DB needed):
  validateScreenerMeta,
  resolvePathTenant
};
