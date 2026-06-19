// Shared row-processing core for screener-result imports (H-11).
//
// Slice A is a behavior-preserving extraction: the field normalizers and the
// parameterized INSERT ... ON CONFLICT upsert were lifted verbatim out of the
// POST /api/screener-results/upload handler so the legacy JSON path and the
// upcoming file validate/commit paths share one code path. Student matching is
// intentionally NOT moved here in Slice A — it stays name-only and inline in
// routes/screener.js. Slice B introduces external_id-first matching here.

const fs = require('fs');
const csv = require('csv-parser');

// PR1 backward-compat default: any upload row missing assessment_type is
// treated as STAR (the only vendor any prior UI ever produced). Migration
// 024's catch-all backfill uses the same default for unlisted tenants.
// PR2 adds a UI-driven dropdown of assessment types and the body field
// becomes required at that point — remove this default then.
const DEFAULT_ASSESSMENT_TYPE = 'STAR';

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (s === '-' || s === '') return null;
  // MM/DD/YYYY → YYYY-MM-DD (some CSV exports use slashes; mirrors the FE
  // parseDateToISO). Slice B addition; a no-op for the JSON path's inputs
  // (already ISO or YY-MM-DD), which carry no slashes.
  const slash = s.split('/');
  if (slash.length === 3) {
    return slash[2] + '-' + slash[0].padStart(2, '0') + '-' + slash[1].padStart(2, '0');
  }
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

// Score/percentile cleaning: dash or empty → null, otherwise parseInt base-10.
function parseScoreValue(val) {
  if (val && String(val).trim() !== '-' && String(val).trim() !== '') {
    return parseInt(val, 10);
  }
  return null;
}

// Parameterized upsert. tenant_id is the leading conflict key (§5). The caller
// supplies the resolved tenantId, the (possibly null) studentId, and the
// uploadedBy actor id — none are read from untrusted body fields here.
const SCREENER_UPSERT_SQL = `
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
`;

// Normalize one raw upload row and execute the upsert. `db` is a pg Pool or
// client. Returns the inserted/updated screener_results.id. Behavior is
// identical to the pre-extraction inline logic.
async function upsertScreenerRow(db, { row, tenantId, studentId, screeningPeriod, schoolYear, uploadedBy }) {
  const benchmarkCategory = normalizeBenchmark(row.benchmarkCategory);
  const cleanDate = normalizeDate(row.testDate);
  const cleanScore = parseScoreValue(row.scaledScore);
  const cleanPct = parseScoreValue(row.percentileRank);
  const assessmentType = row.assessmentType || DEFAULT_ASSESSMENT_TYPE;

  const insertResult = await db.query(SCREENER_UPSERT_SQL, [
    tenantId, studentId, row.firstName, row.lastName,
    row.externalStudentId || null, row.grade || null, row.screenerName || null,
    assessmentType, row.subject,
    screeningPeriod, schoolYear, cleanDate,
    cleanScore, cleanPct, benchmarkCategory, uploadedBy
  ]);
  return insertResult.rows[0].id;
}

// ============================================================
// Slice B (H-11): student matching, per-type file contracts, file parsing.
// ============================================================

// Per-upload row cap. Mirrors the operator importer; the route enforces it
// before any DB work.
const SCREENER_IMPORT_ROW_CAP = 1000;
const SCREENER_IMPORT_ROW_CAP_MESSAGE =
  'Screener CSV upload limited to 1000 rows. Split larger uploads into multiple files.';

/**
 * Resolve a screener row to a student id within the caller's tenant.
 *
 * Precedence (spec §3 Q2, §3A):
 *   1. external_id-first: if the row carries a non-empty external_student_id,
 *      match ONLY on students.external_id within the tenant. The partial
 *      unique index idx_students_tenant_external_id guarantees ≤1 hit, so the
 *      result is matched (1) or unmatched (0). A present SIS id is
 *      authoritative — NO name fallback, since falling back on a non-matching
 *      id risks mis-attribution.
 *   2. name fallback (row has no external_id): tenant-bound LOWER(first/last)
 *      equality. 1 hit → matched; >1 → ambiguous (student_id = NULL); 0 →
 *      unmatched.
 *
 * @param {object} db - pg Pool or pooled Client (so it runs in a transaction).
 * @returns {Promise<{studentId: number|null, matchStatus: 'matched'|'unmatched'|'ambiguous'}>}
 */
async function resolveStudentMatch(db, tenantId, row) {
  const extId = (row.externalStudentId != null && String(row.externalStudentId).trim() !== '')
    ? String(row.externalStudentId).trim()
    : null;

  if (extId) {
    const r = await db.query(
      'SELECT id FROM students WHERE tenant_id = $1 AND external_id = $2',
      [tenantId, extId]
    );
    if (r.rows.length === 1) return { studentId: r.rows[0].id, matchStatus: 'matched' };
    return { studentId: null, matchStatus: 'unmatched' };
  }

  const firstName = row.firstName != null ? String(row.firstName).trim() : '';
  const lastName = row.lastName != null ? String(row.lastName).trim() : '';
  if (!firstName && !lastName) return { studentId: null, matchStatus: 'unmatched' };

  const r = await db.query(
    `SELECT id FROM students
     WHERE tenant_id = $1
       AND LOWER(first_name) = LOWER($2)
       AND LOWER(last_name) = LOWER($3)`,
    [tenantId, firstName, lastName]
  );
  if (r.rows.length === 1) return { studentId: r.rows[0].id, matchStatus: 'matched' };
  if (r.rows.length > 1) return { studentId: null, matchStatus: 'ambiguous' };
  return { studentId: null, matchStatus: 'unmatched' };
}

// Split a "Last, First" name cell into { firstName, lastName }.
function splitLastCommaFirst(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (s === '') return { firstName: '', lastName: '' };
  const parts = s.split(',');
  return {
    lastName: parts[0] ? parts[0].trim() : '',
    firstName: parts[1] ? parts[1].trim() : ''
  };
}

function normalizeHeaderKey(k) {
  return String(k).trim().toLowerCase();
}

// Read the first non-empty value for any of the given normalized header
// aliases. Returns a trimmed string or null.
function pick(normRow, aliases) {
  for (const a of aliases) {
    if (Object.prototype.hasOwnProperty.call(normRow, a)) {
      const v = normRow[a];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return null;
}

// Per-type column contracts (§3A). The authoritative Phase-1 contract lives
// here in code (route-layer validation, no migration / no DB seed). Each
// contract declares its required header groups, maps a normalized row to the
// shared internal fields, and reports per-row validation errors WITHOUT echoing
// any PII (§4B). All types map into the same screener_results columns.
const SCREENER_TYPE_CONTRACTS = {
  STAR: {
    displayName: 'STAR',
    requiredHeaders: [
      { label: 'Student', aliases: ['student', 'student name'] },
      { label: 'Benchmark Category Level', aliases: ['benchmark category level'] }
    ],
    map(normRow) {
      const { firstName, lastName } = splitLastCommaFirst(pick(normRow, ['student', 'student name']));
      return {
        firstName,
        lastName,
        externalStudentId: pick(normRow, ['student id', 'sis id', 'student_id']),
        grade: pick(normRow, ['grade']),
        testDate: normalizeDate(pick(normRow, ['test date'])),
        scaledScore: parseScoreValue(pick(normRow, ['ss (star unified)', 'ss', 'scaled score'])),
        percentileRank: parseScoreValue(pick(normRow, ['pr', 'percentile'])),
        benchmarkCategory: normalizeBenchmark(pick(normRow, ['benchmark category level']))
      };
    },
    rowErrors(r) {
      const errs = [];
      if (!r.lastName) errs.push('Missing student name.');
      if (!r.benchmarkCategory) errs.push('Missing benchmark category.');
      return errs;
    }
  }
  // MAP (and other vendors) deferred to their own slice — the structure above
  // is per-type so a future entry adds its contract here. Preserved full MAP
  // work on branch feat/multi-screener-map.
};

/**
 * Parse + per-type validate a screener CSV. PURE: no DB, no writes, no file
 * deletion (the caller owns those). §4B: per-row errors carry { row, error }
 * with row numbers only — never a name or other PII value.
 *
 * Resolves {
 *   totalRows, rows: [{ rowNumber, ...mappedFields }],
 *   validationErrors: [{ row, error }], capExceeded: bool, headerError: string|null
 * }. Rows that fail validation are excluded from `rows`.
 */
function parseAndValidateScreenerFile(filePath, { assessmentType, rowCap = SCREENER_IMPORT_ROW_CAP } = {}) {
  const contract = SCREENER_TYPE_CONTRACTS[assessmentType];
  return new Promise((resolve, reject) => {
    if (!contract) {
      return resolve({ totalRows: 0, rows: [], validationErrors: [], capExceeded: false, headerError: 'Unknown assessment type.' });
    }
    const rows = [];
    const validationErrors = [];
    let headerError = null;
    let totalRows = 0;
    let capExceeded = false;
    let rowNumber = 1; // header is row 1
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const stream = fs.createReadStream(filePath).pipe(csv());
    stream.on('headers', (headers) => {
      const headerSet = new Set(headers.map(normalizeHeaderKey));
      const missing = [];
      for (const group of contract.requiredHeaders) {
        if (!group.aliases.some((a) => headerSet.has(a))) missing.push(group.label);
      }
      if (missing.length > 0) headerError = 'Missing required column(s): ' + missing.join(', ') + '.';
    });
    stream.on('data', (row) => {
      if (headerError) return;
      rowNumber++;
      totalRows++;
      if (totalRows > rowCap) { capExceeded = true; stream.destroy(); return; }
      const normRow = {};
      Object.keys(row).forEach((k) => { normRow[normalizeHeaderKey(k)] = row[k]; });
      const mapped = contract.map(normRow);
      const errs = contract.rowErrors(mapped);
      if (errs.length > 0) validationErrors.push({ row: rowNumber, error: errs.join(' ') });
      else rows.push({ rowNumber, ...mapped });
    });
    stream.on('close', () => {
      if (capExceeded) return settle({ totalRows, rows: [], validationErrors: [], capExceeded: true, headerError });
      settle({ totalRows, rows, validationErrors, capExceeded: false, headerError });
    });
    stream.on('end', () => settle({ totalRows, rows, validationErrors, capExceeded, headerError }));
    stream.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

module.exports = {
  DEFAULT_ASSESSMENT_TYPE,
  normalizeDate,
  normalizeBenchmark,
  parseScoreValue,
  SCREENER_UPSERT_SQL,
  upsertScreenerRow,
  resolveStudentMatch,
  SCREENER_TYPE_CONTRACTS,
  parseAndValidateScreenerFile,
  SCREENER_IMPORT_ROW_CAP,
  SCREENER_IMPORT_ROW_CAP_MESSAGE
};
