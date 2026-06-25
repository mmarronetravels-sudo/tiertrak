#!/usr/bin/env node
/**
 * scripts/seed-screener-local-test.js
 *
 * Local-only seed script to populate synthetic screener_results rows so the
 * per-student Screener History section on the Student Profile page can be
 * smoke-tested end-to-end.
 *
 * Data safety:
 *   - Operates ONLY on tenant 1 (Lincoln Elementary) in the local dev DB.
 *   - References students that already exist in that tenant's local seed
 *     (Emma Wilson, Liam Brown, ...). These are fictional dev-seed names —
 *     NO real student PII is introduced by this script.
 *   - Scores/percentiles/benchmarks are synthetic constants below.
 *   - Idempotent: the UNIQUE(tenant_id, student_id, assessment_type, subject,
 *     screening_period, school_year) constraint lets us ON CONFLICT DO UPDATE,
 *     so re-running refreshes rather than duplicating.
 *
 * Safety guards (BOTH must pass, or the script refuses to run):
 *   1. DATABASE_URL must parse to host=localhost (or 127.0.0.1), port=5432,
 *      database=tiertrak. Anything else -> abort before any write.
 *   2. The flag --local-only must be passed on the command line.
 *
 * Usage:
 *   node scripts/seed-screener-local-test.js --local-only
 */

require('dotenv').config();
const { Pool } = require('pg');

// Tenant 1 = Lincoln Elementary in the local dev seed. Tenant-scoped by design.
const SEED_TENANT_ID = 1;
const SCHOOL_YEAR = '2025-2026';

// ------------------------------------------------------------------
// Safety guard 1: require --local-only flag.
// ------------------------------------------------------------------
if (!process.argv.includes('--local-only')) {
  console.error('Refusing to run without --local-only flag.');
  console.error('Usage: node scripts/seed-screener-local-test.js --local-only');
  process.exit(1);
}

// ------------------------------------------------------------------
// Safety guard 2: DATABASE_URL must point to local tiertrak DB.
// ------------------------------------------------------------------
function parseDatabaseUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return {
      host: u.hostname,
      port: u.port || '5432',
      database: u.pathname.replace(/^\//, '')
    };
  } catch {
    return null;
  }
}

const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
if (!parsed) {
  console.error('Refusing to run: could not parse DATABASE_URL from .env');
  process.exit(1);
}

const hostOk = parsed.host === 'localhost' || parsed.host === '127.0.0.1';
const portOk = parsed.port === '5432';
const dbOk = parsed.database === 'tiertrak';

if (!hostOk || !portOk || !dbOk) {
  console.error('Refusing to run against non-local DB.');
  console.error(`  Parsed host: ${parsed.host} (want localhost or 127.0.0.1)`);
  console.error(`  Parsed port: ${parsed.port} (want 5432)`);
  console.error(`  Parsed database: ${parsed.database} (want tiertrak)`);
  process.exit(1);
}

// ------------------------------------------------------------------
// Synthetic screener rows, keyed by the order students come back. Each entry
// is { subject, assessmentType, period, testDate, scaledScore, percentileRank,
// benchmarkCategory }. Benchmark vocabulary matches normalizeBenchmark /
// deriveBenchmarkFromPercentile in routes/screenerImportCore.js.
// ------------------------------------------------------------------
function rowsForStudent(seq) {
  // Vary the trajectory by student so the UI shows a mix of categories.
  const variants = [
    // Improving over the year (Reading, STAR).
    [
      { subject: 'Reading', assessmentType: 'STAR', period: 'Fall',   testDate: '2025-09-15', scaledScore: 412, percentileRank: 18, benchmarkCategory: 'Below Benchmark' },
      { subject: 'Reading', assessmentType: 'STAR', period: 'Winter', testDate: '2026-01-20', scaledScore: 488, percentileRank: 34, benchmarkCategory: 'Near Benchmark' },
      { subject: 'Reading', assessmentType: 'STAR', period: 'Spring', testDate: '2026-04-28', scaledScore: 551, percentileRank: 52, benchmarkCategory: 'At/Above Benchmark' }
    ],
    // Steady at/above (Math, MAP).
    [
      { subject: 'Math', assessmentType: 'MAP', period: 'Fall',   testDate: '2025-09-18', scaledScore: 198, percentileRank: 61, benchmarkCategory: 'At/Above Benchmark' },
      { subject: 'Math', assessmentType: 'MAP', period: 'Winter', testDate: '2026-01-22', scaledScore: 205, percentileRank: 64, benchmarkCategory: 'At/Above Benchmark' }
    ],
    // Slipping (Reading, STAR).
    [
      { subject: 'Reading', assessmentType: 'STAR', period: 'Fall',   testDate: '2025-09-16', scaledScore: 470, percentileRank: 38, benchmarkCategory: 'Near Benchmark' },
      { subject: 'Reading', assessmentType: 'STAR', period: 'Winter', testDate: '2026-01-21', scaledScore: 441, percentileRank: 22, benchmarkCategory: 'Near Benchmark' },
      { subject: 'Reading', assessmentType: 'STAR', period: 'Spring', testDate: '2026-04-29', scaledScore: 405, percentileRank: 15, benchmarkCategory: 'Below Benchmark' }
    ]
  ];
  return variants[seq % variants.length];
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('Local screener-history test seed');
  console.log(`  Target: ${parsed.host}:${parsed.port}/${parsed.database}`);
  console.log(`  Tenant: ${SEED_TENANT_ID} (Lincoln Elementary)\n`);

  // Pull a handful of existing tenant-1 students (fictional dev-seed names).
  const studentsRes = await pool.query(
    `SELECT id, first_name, last_name, grade
       FROM students
      WHERE tenant_id = $1
      ORDER BY id
      LIMIT 5`,
    [SEED_TENANT_ID]
  );

  if (studentsRes.rows.length === 0) {
    console.error(`Refusing to run: no students found in tenant ${SEED_TENANT_ID}.`);
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');

    for (let i = 0; i < studentsRes.rows.length; i++) {
      const stu = studentsRes.rows[i];
      const rows = rowsForStudent(i);
      for (const r of rows) {
        await client.query(
          `INSERT INTO screener_results
             (tenant_id, student_id, student_first_name, student_last_name,
              grade, screener_name, assessment_type, subject, screening_period,
              school_year, test_date, scaled_score, percentile_rank,
              benchmark_category, uploaded_by, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, NOW())
           ON CONFLICT (tenant_id, student_id, assessment_type, subject, screening_period, school_year)
           DO UPDATE SET
             test_date = EXCLUDED.test_date,
             scaled_score = EXCLUDED.scaled_score,
             percentile_rank = EXCLUDED.percentile_rank,
             benchmark_category = EXCLUDED.benchmark_category,
             uploaded_at = NOW()`,
          [
            SEED_TENANT_ID, stu.id, stu.first_name, stu.last_name,
            stu.grade, `${r.assessmentType} ${r.subject}`, r.assessmentType,
            r.subject, r.period, SCHOOL_YEAR, r.testDate, r.scaledScore,
            r.percentileRank, r.benchmarkCategory
          ]
        );
        inserted++;
      }
      console.log(`  + ${rows.length} screener rows for student #${stu.id} (${stu.first_name} ${stu.last_name})`);
    }

    await client.query('COMMIT');
    console.log(`\n✓ Seeded ${inserted} screener rows across ${studentsRes.rows.length} students in tenant ${SEED_TENANT_ID}.`);
    console.log('Done. Re-running this script refreshes rows (ON CONFLICT), it does not duplicate.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Seed script failed:', err.message);
  process.exit(1);
});
