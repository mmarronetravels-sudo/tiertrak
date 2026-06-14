const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
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

module.exports = {
  upload,
  validateStudentImport,
  parseAndValidateStudentRows,
  STUDENT_IMPORT_ROW_CAP,
  STUDENT_IMPORT_ROW_CAP_MESSAGE,
};
