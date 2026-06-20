const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();
const {
  sanitizeBooleanFlag,
  sanitizeGender,
  sanitizeRaceEthnicity,
} = require('../constants/studentDemographics');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================
// Operator-console STUDENT-IMPORT VALIDATE-ONLY (Slice 3)
//
// Registered on the existing operator router (routes/operatorDistricts.js)
// as:
//   POST /api/operator/districts/:districtId/schools/:schoolTenantId/student-import/validate
//
// The route lives on operatorDistricts.js so that router's single
// `router.use(requireAuth, platformAdminOnly)` runs auth ONCE for this
// surface; only the handler + its multer config live here, in their own
// module. Same hang-off-the-existing-router rationale as the staff-import
// validate surface (routes/operatorStaffImport.js).
//
// A DRY-RUN endpoint. It parses an uploaded student CSV for ONE school
// tenant and returns counts + per-row errors. It WRITES NOTHING — no
// INSERT/UPDATE, no audit row. The only DB access is two read-only §5
// pre-flights plus a read-only per-row external_id-existence check.
//
// This is intentionally a SEPARATE surface from the school-admin self-serve
// commit importer at routes/csvImport.js (POST /api/csv/students/:tenantId).
// That endpoint — header/access-bound tenant, immediate writes — is left
// untouched. The two duplicate the per-row student rules for now;
// extracting a shared pure validator is banked as a follow-up
// (chore/extract-student-import-row-validator), mirroring the staff-import
// sequence (validate-only first, shared validator extracted afterward).
//
// Tenant binding (§5) — STRUCTURAL, identical to the staff-import validate
// surface (routes/operatorStaffImport.js):
//   - districtId and schoolTenantId both come from the URL path (each
//     validated as a positive int32). There is NO "School" column in the
//     CSV — one upload binds to exactly one school_tenant_id.
//   - Two pre-flights run BEFORE the file is parsed:
//       (1) district exists                              → else 404
//       (2) school tenant exists AND type='school' AND
//           district_id === path districtId              → else 404
//   - resolveAccessibleTenantIds is deliberately NOT used: operators hold
//     zero user_school_access rows, so the membership helper would resolve
//     to an empty set and 404 every request. Same rationale as the staff
//     validate surface and the grant flow.
//
// §4B no-echo (STRICTER than the commit importer): per-row errors carry
// { row, error } ONLY. The offending student name / external_id (SIS ID) /
// grade / IEP-504-ELL / gender / race-ethnicity value is NEVER echoed back
// in an error string, the response body, or the logs. (The commit importer
// at routes/csvImport.js echoes `data: normalizedRow` in its required-field
// / tier / area / risk errors and echoes the external_id in its in-file-dup
// message; this surface deliberately does not — see the validator header.)
// Tier / area / risk_level are NOT student-identifying and may appear in
// error text, mirroring the staff surface's role/swa echo. Server logs are
// counts/codes only. The uploaded CSV is deleted from disk in EVERY exit
// path.
// ============================================================

// multer config — type + size validated before the handler runs.
// Mirrors routes/csvImport.js and routes/operatorStaffImport.js. Exported so
// operatorDistricts.js can wire `upload.single('file')` into the route's
// middleware chain.
const { InvalidFileTypeError } = require('../middleware/multerErrorHandler');

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new InvalidFileTypeError(), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

const INT4_MAX = 2147483647;

// Local positive-int32 validator. Duplicated from operatorStaffImport.js /
// operatorDistricts.js by design — deduping the copies is a separate chore
// (Followup #112/#124-validateIntParam-dedupe).
function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// Per-row enums. Duplicated from routes/csvImport.js (VALID_TIERS /
// VALID_RISK_LEVELS) by the approved duplicate-locally decision; these are
// not PII. Area is normalized case-insensitively to its canonical form.
const VALID_TIERS = [1, 2, 3];
const VALID_RISK_LEVELS = ['low', 'moderate', 'high'];

// Per-upload row cap. Fires AFTER parse, BEFORE any DB read — bounds the
// per-row external_id-existence loop (N sequential SELECTs) on this
// operator-gated, rate-limited surface. DESIGN DECISION (no staff parity:
// staff cap is 100; a single-school student roster is far larger): 1000
// rows per upload accommodates a typical single-school roster while keeping
// the existence-check loop bounded. Split larger rosters into multiple
// uploads. Adjust if real-world single-school rosters exceed this.
const STUDENT_IMPORT_ROW_CAP = 1000;
const STUDENT_IMPORT_ROW_CAP_MESSAGE =
  'Student CSV upload limited to 1000 rows. Split larger uploads into multiple files.';

// parseAndValidateStudentRows — pure (no res, no DB, no file deletion) CSV
// parse + per-row validation for the operator student-import validate-only
// surface (Slice 3). Kept pure + self-contained so a future commit slice and
// the banked shared-validator extraction can reuse it verbatim.
//
// Deliberately does NOT:
//   - bind/derive tenant_id — that is path-based and resolved by the caller;
//   - run the per-tenant external_id-existence check — that needs the bound
//     school_tenant_id and stays in the caller;
//   - apply the row cap or delete the upload — both are caller concerns.
//
// §4B: per-row errors carry { row, error } ONLY. Student name / external_id /
// grade / demographic values are NEVER echoed. Tier / area / risk_level are
// not student-identifying and may appear in error text. The shared
// demographic sanitizers (sanitizeBooleanFlag / sanitizeGender /
// sanitizeRaceEthnicity) already never echo the offending value.
//
// Resolves { results, validationErrors, duplicateErrors, totalRows } where
// results = [{ row, first_name, last_name, grade, tier, area, risk_level,
// external_id, iep_flag, sec_504_flag, ell_flag, gender, race_ethnicity }].
function parseAndValidateStudentRows(filePath) {
  const results = [];            // rows that passed all parse-time checks
  const validationErrors = [];   // required / tier / area / risk / demographics
  const duplicateErrors = [];    // in-file duplicate external_id
  // Within-upload dedup tracker: external_id value → first-occurrence row number.
  const externalIdFirstRow = new Map();
  let rowNumber = 1; // Start at 1 for header

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rowNumber++;

        const normalizedRow = {};
        Object.keys(row).forEach(key => {
          normalizedRow[key.trim().toLowerCase().replace(/\s+/g, '_')] = row[key]?.trim();
        });

        // Required columns. Values (incl. names / grade) are NEVER echoed.
        if (!normalizedRow.first_name || !normalizedRow.last_name || !normalizedRow.grade) {
          validationErrors.push({
            row: rowNumber,
            error: 'Missing required fields (first_name, last_name, grade).'
          });
          return;
        }

        // Tier — value is not student-identifying, may appear in error text.
        let tier = 1;
        if (normalizedRow.tier) {
          tier = parseInt(normalizedRow.tier, 10);
          if (!VALID_TIERS.includes(tier)) {
            validationErrors.push({
              row: rowNumber,
              error: `Invalid tier "${normalizedRow.tier}". Must be 1, 2, or 3.`
            });
            return;
          }
        }

        // Area — case-insensitive match to canonical form; not PII.
        let area = null;
        if (normalizedRow.area) {
          const areaLower = normalizedRow.area.toLowerCase();
          if (areaLower === 'academic') area = 'Academic';
          else if (areaLower === 'behavior') area = 'Behavior';
          else if (areaLower === 'social-emotional' || areaLower === 'social emotional' || areaLower === 'socialemotional') area = 'Social-Emotional';
          else if (normalizedRow.area !== '') {
            validationErrors.push({
              row: rowNumber,
              error: `Invalid area "${normalizedRow.area}". Must be Academic, Behavior, or Social-Emotional.`
            });
            return;
          }
        }

        // Risk level — not PII.
        let riskLevel = 'low';
        if (normalizedRow.risk_level) {
          riskLevel = normalizedRow.risk_level.toLowerCase();
          if (!VALID_RISK_LEVELS.includes(riskLevel)) {
            validationErrors.push({
              row: rowNumber,
              error: `Invalid risk_level "${normalizedRow.risk_level}". Must be low, moderate, or high.`
            });
            return;
          }
        }

        // external_id — optional free-form SIS identifier = PII. The VALUE is
        // NEVER echoed (§4B narrowing: the commit importer at
        // routes/csvImport.js:357 echoes it; this surface deliberately does
        // not). In-file duplicate is reported with row numbers only.
        const externalId = normalizedRow.external_id || null;
        if (externalId !== null) {
          if (externalIdFirstRow.has(externalId)) {
            const firstRow = externalIdFirstRow.get(externalId);
            duplicateErrors.push({
              row: rowNumber,
              error: `Duplicate external_id within upload; first seen at row ${firstRow}.`
            });
            return;
          }
          externalIdFirstRow.set(externalId, rowNumber);
        }

        // M042 demographic fields — all OPTIONAL, absent / blank → null
        // (unknown). The shared sanitizers cite column + valid-set on error
        // and NEVER echo the offending value (§4B).
        const iepResult = sanitizeBooleanFlag(normalizedRow.iep_flag, 'iep_flag');
        if (iepResult.error) {
          validationErrors.push({ row: rowNumber, error: iepResult.error });
          return;
        }
        const sec504Result = sanitizeBooleanFlag(normalizedRow.sec_504_flag, 'sec_504_flag');
        if (sec504Result.error) {
          validationErrors.push({ row: rowNumber, error: sec504Result.error });
          return;
        }
        const ellResult = sanitizeBooleanFlag(normalizedRow.ell_flag, 'ell_flag');
        if (ellResult.error) {
          validationErrors.push({ row: rowNumber, error: ellResult.error });
          return;
        }
        const genderResult = sanitizeGender(normalizedRow.gender);
        if (genderResult.error) {
          validationErrors.push({ row: rowNumber, error: genderResult.error });
          return;
        }
        const raceResult = sanitizeRaceEthnicity(normalizedRow.race_ethnicity);
        if (raceResult.error) {
          validationErrors.push({ row: rowNumber, error: raceResult.error });
          return;
        }

        // Parsed, fully-validated row. Demographic PII is kept in memory only
        // for a future commit slice / the existence check's external_id; the
        // handler NEVER echoes any of these field values back to the FE.
        results.push({
          row: rowNumber,
          first_name: normalizedRow.first_name,
          last_name: normalizedRow.last_name,
          grade: normalizedRow.grade,
          tier: tier,
          area: area,
          risk_level: riskLevel,
          external_id: externalId,
          iep_flag: iepResult.value,
          sec_504_flag: sec504Result.value,
          ell_flag: ellResult.value,
          gender: genderResult.value,
          race_ethnicity: raceResult.value
        });
      })
      .on('end', () => resolve({ results, validationErrors, duplicateErrors, totalRows: rowNumber - 1 }))
      .on('error', (error) => reject(error));
  });
}

// Handler for POST /:districtId/schools/:schoolTenantId/student-import/validate.
// requireAuth + platformAdminOnly have already run on the parent router, so
// req.user is populated and the caller is a verified operator.
async function validateStudentImport(req, res) {
  const cleanup = () => {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
  };

  const districtId = validateIntParam(req.params.districtId);
  if (districtId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid district id' });
  }
  const schoolTenantId = validateIntParam(req.params.schoolTenantId);
  if (schoolTenantId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid school_tenant_id' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // §5 pre-flight 1: district exists.
    const district = await pool.query('SELECT id FROM districts WHERE id = $1', [districtId]);
    if (district.rows.length === 0) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // §5 pre-flight 2: school tenant exists AND is a school AND belongs to
    // this district. type='school' mirrors the staff-import precedent.
    const schoolTenant = await pool.query(
      "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
      [schoolTenantId]
    );
    if (schoolTenant.rows.length === 0 || schoolTenant.rows[0].district_id !== districtId) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // Parse + per-row validation via the pure validator (§4B no-echo;
    // row + field-level reason only). The per-tenant existence check stays
    // in this handler — see the parseAndValidateStudentRows header.
    const { results, validationErrors, duplicateErrors, totalRows } =
      await parseAndValidateStudentRows(req.file.path);

    // 1000-row cap. Fires AFTER parse, BEFORE the existence-check reads.
    if (totalRows > STUDENT_IMPORT_ROW_CAP) {
      cleanup();
      return res.status(400).json({ error: STUDENT_IMPORT_ROW_CAP_MESSAGE });
    }

    // Read-only per-row external_id-existence pre-check, scoped to the bound
    // school tenant. No write occurs. Only rows that carry a non-null
    // external_id can collide; rows without one cannot and count as valid.
    // §4B: the result carries the ROW NUMBER only — the external_id (SIS ID)
    // is NEVER echoed.
    const alreadyExistsErrors = [];
    let validCount = 0;
    for (const student of results) {
      if (student.external_id === null) {
        validCount++;
        continue;
      }
      const existing = await pool.query(
        'SELECT id FROM students WHERE external_id = $1 AND tenant_id = $2',
        [student.external_id, schoolTenantId]
      );
      if (existing.rows.length > 0) {
        alreadyExistsErrors.push({
          row: student.row,
          error: 'A student with this external_id already exists at this school.'
        });
      } else {
        validCount++;
      }
    }

    cleanup();

    // Counts-only logging — no PII, no row data.
    console.log(
      '[operator:student-import-validate] district:', districtId,
      'school:', schoolTenantId,
      'totalRows:', totalRows,
      'valid:', validCount,
      'validationErrors:', validationErrors.length,
      'duplicatesInFile:', duplicateErrors.length,
      'alreadyExists:', alreadyExistsErrors.length
    );

    res.json({
      validateOnly: true,
      summary: {
        totalRows: totalRows,
        valid: validCount,
        validationErrors: validationErrors.length,
        duplicatesInFile: duplicateErrors.length,
        alreadyExists: alreadyExistsErrors.length
      },
      errors: [...validationErrors, ...duplicateErrors, ...alreadyExistsErrors]
    });

  } catch (error) {
    cleanup();
    console.error('[operator:student-import-validate] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
}

// Handler for POST /:districtId/schools/:schoolTenantId/student-import/commit.
// requireAuth + platformAdminOnly have already run on the parent router, so
// req.user is populated and the caller is a verified operator.
//
// This is the WRITE counterpart of validateStudentImport (Slice 4). It reuses
// the same two §5 pre-flights, the same shared row validator
// (parseAndValidateStudentRows — BYTE-IDENTICAL rules), and the same §4B
// no-echo doctrine, then actually creates the student education records.
//
// Students are RECORDS, not login accounts: this path generates NO setup
// token and sends NO email. There is no Resend call and no credential of any
// kind here (contrast routes/operatorStaffImport.js commitStaffImport, whose
// post-commit email step has no analogue on this surface). The email-throttle
// work that gates the staff surface does not apply.
//
// ALL-OR-NOTHING (per Slice 4 spec, mirroring commitStaffImport):
//   1. If the parsed CSV has ANY row error (validation or in-file duplicate
//      external_id) → 422, write nothing. Re-run the dry-run and fix every row.
//   2. If ANY external_id already exists at this school → 422, write nothing.
//   3. Otherwise every student row is inserted inside ONE transaction together
//      with its student_race_ethnicity child rows (M042) AND its
//      student_import_audit row (M048). A failure on any row (e.g. a 23505 race
//      with a concurrent create on idx_students_tenant_external_id) rolls the
//      WHOLE import back — 0 student records created. There is no partial commit.
//
// §5 tenant binding is STRUCTURAL and identical to the validate handler:
// districtId + schoolTenantId come from the URL path. students.tenant_id is the
// path schoolTenantId — NEVER a CSV column. The student_race_ethnicity child
// INSERT binds tenant_id to the SAME path schoolTenantId (never parent.tenant_id
// read back), so the Migration-021 composite FK (student_id, tenant_id) →
// students(id, tenant_id) enforces same-school containment by construction and
// the §5 intent is legible at the call site (mirrors routes/csvImport.js:440-451).
//
// §4B: per-row errors and the response carry row numbers + internal ids only.
// No name / external_id / grade / demographic value is ever echoed. The audit
// student_id is the INTERNAL students.id from RETURNING id — never external_id.
// Server logs are counts/codes only. The uploaded CSV is deleted on EVERY exit
// path.
async function commitStudentImport(req, res) {
  const cleanup = () => {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
  };

  const districtId = validateIntParam(req.params.districtId);
  if (districtId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid district id' });
  }
  const schoolTenantId = validateIntParam(req.params.schoolTenantId);
  if (schoolTenantId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid school_tenant_id' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const actorId = Number(req.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    cleanup();
    console.error('[operator:student-import-commit] invalid req.user.id from JWT');
    return res.status(500).json({ error: 'Server error' });
  }

  try {
    // §5 pre-flight 1: district exists. Identical to the validate handler.
    const district = await pool.query('SELECT id FROM districts WHERE id = $1', [districtId]);
    if (district.rows.length === 0) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // §5 pre-flight 2: school tenant exists AND is a school AND belongs to
    // this district.
    const schoolTenant = await pool.query(
      "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
      [schoolTenantId]
    );
    if (schoolTenant.rows.length === 0 || schoolTenant.rows[0].district_id !== districtId) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // Parse + per-row validation via the shared validator (same rules as the
    // dry-run; §4B no-echo).
    const { results, validationErrors, duplicateErrors, totalRows } =
      await parseAndValidateStudentRows(req.file.path);

    // 1000-row cap. Fires AFTER parse, BEFORE any DB read/write.
    if (totalRows > STUDENT_IMPORT_ROW_CAP) {
      cleanup();
      return res.status(400).json({ error: STUDENT_IMPORT_ROW_CAP_MESSAGE });
    }

    // ALL-OR-NOTHING gate 1: any row error → reject the whole import, write
    // nothing. The dry-run is where these are meant to be discovered.
    if (validationErrors.length > 0 || duplicateErrors.length > 0) {
      cleanup();
      console.log(
        '[operator:student-import-commit] rejected-row-errors district:', districtId,
        'school:', schoolTenantId,
        'totalRows:', totalRows,
        'validationErrors:', validationErrors.length,
        'duplicatesInFile:', duplicateErrors.length
      );
      return res.status(422).json({
        error: 'Import rejected: the CSV has row-level errors. Re-run validate and fix every row before committing.',
        errors: [...validationErrors, ...duplicateErrors]
      });
    }

    if (results.length === 0) {
      cleanup();
      return res.status(422).json({ error: 'Import rejected: no valid rows to import.' });
    }

    // ALL-OR-NOTHING gate 2: per-tenant external_id-existence pre-check
    // (read-only, scoped to the bound school). Only rows carrying a non-null
    // external_id can collide; rows without one cannot. If ANY row collides,
    // reject the whole import — no partial commit. Row numbers only (§4B).
    const alreadyExistsErrors = [];
    for (const student of results) {
      if (student.external_id === null) continue;
      const existing = await pool.query(
        'SELECT id FROM students WHERE external_id = $1 AND tenant_id = $2',
        [student.external_id, schoolTenantId]
      );
      if (existing.rows.length > 0) {
        alreadyExistsErrors.push({
          row: student.row,
          error: 'A student with this external_id already exists at this school.'
        });
      }
    }
    if (alreadyExistsErrors.length > 0) {
      cleanup();
      console.log(
        '[operator:student-import-commit] rejected-already-exists district:', districtId,
        'school:', schoolTenantId,
        'totalRows:', totalRows,
        'alreadyExists:', alreadyExistsErrors.length
      );
      return res.status(422).json({
        error: 'Import rejected: one or more external_ids already exist at this school. No student records were created.',
        errors: alreadyExistsErrors
      });
    }

    // Single transaction for the whole import: every students INSERT, its
    // student_race_ethnicity child rows, and its student_import_audit row
    // commit together or not at all. No tokens, no emails — students are
    // records, not accounts.
    const importBatchId = crypto.randomUUID();
    const imported = []; // { row, id } — internal ids only, for the response body
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Actor capture for any DB-layer audit/trigger plumbing, mirroring the
      // staff-import commit and the grant flow.
      await client.query("SELECT set_config('app.actor_user_id', $1, true)", [String(actorId)]);

      for (const student of results) {
        // students.tenant_id is the PATH schoolTenantId — never a CSV column.
        // Column set mirrors routes/csvImport.js:432 verbatim.
        const inserted = await client.query(
          `INSERT INTO students (tenant_id, first_name, last_name, grade, tier, area, risk_level, external_id, iep_flag, sec_504_flag, ell_flag, gender)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [schoolTenantId, student.first_name, student.last_name, student.grade, student.tier, student.area, student.risk_level, student.external_id,
           student.iep_flag, student.sec_504_flag, student.ell_flag, student.gender]
        );
        const studentId = inserted.rows[0].id;

        // M042 race/ethnicity child rows (0..N codes, already deduped by the
        // sanitizer). tenant_id is bound EXPLICITLY to the path schoolTenantId
        // — never read back from the parent row — so the Migration-021
        // composite FK (student_id, tenant_id) → students(id, tenant_id)
        // enforces same-school containment and the §5 intent is explicit at
        // this call site (mirrors routes/csvImport.js:446-451).
        for (const code of student.race_ethnicity) {
          await client.query(
            `INSERT INTO student_race_ethnicity (student_id, tenant_id, category)
             VALUES ($1, $2, $3)`,
            [studentId, schoolTenantId, code]
          );
        }

        // Audit row (M048). student_id is the INTERNAL students.id from
        // RETURNING id — never external_id. school_tenant_id is the path
        // school; district_id is the path district the import targeted. No
        // PII, no string columns.
        await client.query(
          `INSERT INTO student_import_audit (import_batch_id, student_id, school_tenant_id, district_id, actor_user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [importBatchId, studentId, schoolTenantId, districtId, actorId]
        );

        imported.push({ row: student.row, id: studentId });
      }

      await client.query('COMMIT');
    } catch (dbError) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackErr) {
        // ROLLBACK on a broken connection can throw; the import has already
        // failed. Swallow the secondary error.
      }
      client.release();
      cleanup();
      // 23505 on idx_students_tenant_external_id means a concurrent create won
      // the race between the pre-check and the INSERT. All-or-nothing: the
      // whole transaction rolled back, 0 student records created. pg messages
      // can echo column values, so code/constraint are logged server-side only.
      if (dbError.code === '23505' && dbError.constraint === 'idx_students_tenant_external_id') {
        return res.status(409).json({ error: 'Import aborted: an external_id collided with a concurrent change. No student records were created. Re-run validate and retry.' });
      }
      console.error('[operator:student-import-commit] insert error code:', dbError.code, 'constraint:', dbError.constraint);
      return res.status(500).json({ error: 'Server error' });
    }
    client.release();

    // CSV deleted immediately after the DB work.
    cleanup();

    // Counts-only logging — no PII, no row data.
    console.log(
      '[operator:student-import-commit] committed district:', districtId,
      'school:', schoolTenantId,
      'batch:', importBatchId,
      'totalRows:', totalRows,
      'imported:', imported.length
    );

    res.status(201).json({
      committed: true,
      summary: {
        totalRows: totalRows,
        imported: imported.length
      },
      // ids + row numbers only — no name / external_id / demographic in the body.
      imported: imported
    });

  } catch (error) {
    cleanup();
    console.error('[operator:student-import-commit] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  upload,
  validateStudentImport,
  commitStudentImport,
  parseAndValidateStudentRows,
  STUDENT_IMPORT_ROW_CAP,
  STUDENT_IMPORT_ROW_CAP_MESSAGE,
};
