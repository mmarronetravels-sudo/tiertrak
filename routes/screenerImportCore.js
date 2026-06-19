// Shared row-processing core for screener-result imports (H-11).
//
// Slice A is a behavior-preserving extraction: the field normalizers and the
// parameterized INSERT ... ON CONFLICT upsert were lifted verbatim out of the
// POST /api/screener-results/upload handler so the legacy JSON path and the
// upcoming file validate/commit paths share one code path. Student matching is
// intentionally NOT moved here in Slice A — it stays name-only and inline in
// routes/screener.js. Slice B introduces external_id-first matching here.

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

module.exports = {
  DEFAULT_ASSESSMENT_TYPE,
  normalizeDate,
  normalizeBenchmark,
  parseScoreValue,
  SCREENER_UPSERT_SQL,
  upsertScreenerRow
};
