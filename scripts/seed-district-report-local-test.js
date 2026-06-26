#!/usr/bin/env node
/**
 * scripts/seed-district-report-local-test.js
 *
 * Local-only seed script to populate SYNTHETIC, district-scoped screener_results
 * so the District Report endpoint (GET /api/districts/:id/screener-report) can
 * be smoke-tested with real cross-school aggregation AND cross-district
 * isolation — not just an empty 200.
 *
 * What it seeds (all targets are DERIVED, never hardcoded — §3):
 *   - The first district_admin with a non-NULL district_id is located, and
 *     THAT admin's accessible schools (via user_school_access) are seeded.
 *     This guarantees the report's "in-district" case shows nonzero counts in
 *     exactly the schools the admin can see.
 *   - One school in a DIFFERENT district is also seeded (the negative case):
 *     it must NEVER appear in the admin's report.
 *
 * Data safety:
 *   - SYNTHETIC data only. Students are created with surrogate names
 *     (first_name 'Test', last_name 'Student-<tenant>-<n>') and a sentinel
 *     external_id ('DRPT-SEED-<tenant>-<n>'). NO real names/emails/slugs.
 *   - Scores/percentiles/benchmarks are synthetic constants below.
 *   - Idempotent: synthetic students are reused by sentinel external_id;
 *     screener rows use ON CONFLICT DO UPDATE on the existing per-period
 *     UNIQUE constraint. Re-running refreshes rather than duplicating.
 *
 * Safety guards (BOTH must pass, or the script refuses to run):
 *   1. DATABASE_URL must parse to host=localhost (or 127.0.0.1), port=5432,
 *      database=tiertrak. Anything else -> abort before any write.
 *   2. The flag --local-only must be passed on the command line.
 *
 * Usage:
 *   node scripts/seed-district-report-local-test.js --local-only
 */

require('dotenv').config();
const { Pool } = require('pg');

const SCHOOL_YEAR = '2025-2026';
const PERIOD = 'Fall';
const SUBJECT = 'Reading';
const ASSESSMENT_TYPE = 'STAR';
// Three students per school, one benchmark category each, so by_benchmark is
// nonzero and spread across the real category vocabulary.
const BENCHMARKS = [
  { benchmarkCategory: 'Below Benchmark', scaledScore: 412, percentileRank: 18 },
  { benchmarkCategory: 'Near Benchmark', scaledScore: 488, percentileRank: 34 },
  { benchmarkCategory: 'At/Above Benchmark', scaledScore: 551, percentileRank: 52 }
];

// ------------------------------------------------------------------
// Safety guard 1: require --local-only flag.
// ------------------------------------------------------------------
if (!process.argv.includes('--local-only')) {
  console.error('Refusing to run without --local-only flag.');
  console.error('Usage: node scripts/seed-district-report-local-test.js --local-only');
  process.exit(1);
}

// ------------------------------------------------------------------
// Safety guard 2: DATABASE_URL must point to local tiertrak DB.
// ------------------------------------------------------------------
function parseDatabaseUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return { host: u.hostname, port: u.port || '5432', database: u.pathname.replace(/^\//, '') };
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

// Reuse a synthetic student by sentinel external_id, else create it. Returns id.
async function ensureSyntheticStudent(client, tenantId, n) {
  const externalId = `DRPT-SEED-${tenantId}-${n}`;
  const existing = await client.query(
    'SELECT id FROM students WHERE tenant_id = $1 AND external_id = $2',
    [tenantId, externalId]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO students (tenant_id, first_name, last_name, grade, enrollment_status, external_id)
     VALUES ($1, 'Test', $2, '3', 'active', $3)
     RETURNING id`,
    [tenantId, `Student-${tenantId}-${n}`, externalId]
  );
  return inserted.rows[0].id;
}

async function seedSchool(client, tenantId, count) {
  let rows = 0;
  for (let i = 0; i < count; i++) {
    const studentId = await ensureSyntheticStudent(client, tenantId, i + 1);
    const b = BENCHMARKS[i % BENCHMARKS.length];
    await client.query(
      `INSERT INTO screener_results
         (tenant_id, student_id, student_first_name, student_last_name,
          grade, screener_name, assessment_type, subject, screening_period,
          school_year, test_date, scaled_score, percentile_rank,
          benchmark_category, uploaded_by, uploaded_at)
       VALUES ($1, $2, 'Test', $3, '3', $4, $5, $6, $7, $8, '2025-09-15', $9, $10, $11, NULL, NOW())
       ON CONFLICT (tenant_id, student_id, assessment_type, subject, screening_period, school_year)
       DO UPDATE SET
         scaled_score = EXCLUDED.scaled_score,
         percentile_rank = EXCLUDED.percentile_rank,
         benchmark_category = EXCLUDED.benchmark_category,
         uploaded_at = NOW()`,
      [
        tenantId, studentId, `Student-${tenantId}-${i + 1}`,
        `${ASSESSMENT_TYPE} ${SUBJECT}`, ASSESSMENT_TYPE, SUBJECT, PERIOD,
        SCHOOL_YEAR, b.scaledScore, b.percentileRank, b.benchmarkCategory
      ]
    );
    rows++;
  }
  return rows;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log('Local district-report test seed');
  console.log(`  Target: ${parsed.host}:${parsed.port}/${parsed.database}\n`);

  // Derive the target district_admin and that admin's accessible schools.
  const admin = (await pool.query(
    `SELECT id, district_id FROM users
      WHERE role = 'district_admin' AND district_id IS NOT NULL
      ORDER BY id LIMIT 1`
  )).rows[0];
  if (!admin) {
    console.error('Refusing to run: no district_admin with a district_id found in local DB.');
    await pool.end();
    process.exit(1);
  }
  const inDistrictSchools = (await pool.query(
    `SELECT school_tenant_id FROM user_school_access
      WHERE user_id = $1 AND district_id = $2 ORDER BY school_tenant_id`,
    [admin.id, admin.district_id]
  )).rows.map((r) => r.school_tenant_id);
  if (inDistrictSchools.length === 0) {
    console.error(`Refusing to run: district_admin #${admin.id} has no user_school_access rows to seed.`);
    await pool.end();
    process.exit(1);
  }
  // One school in a DIFFERENT district (the negative/isolation case).
  const otherSchool = (await pool.query(
    `SELECT id, district_id FROM tenants
      WHERE type = 'school' AND district_id IS NOT NULL AND district_id <> $1
      ORDER BY id LIMIT 1`,
    [admin.district_id]
  )).rows[0];

  console.log(`  district_admin #${admin.id} → district ${admin.district_id}`);
  console.log(`  in-district schools to seed: [${inDistrictSchools.join(', ')}]`);
  console.log(`  other-district school to seed: ${otherSchool ? `${otherSchool.id} (district ${otherSchool.district_id})` : '(none found)'}\n`);

  const client = await pool.connect();
  let total = 0;
  try {
    await client.query('BEGIN');
    for (const tid of inDistrictSchools) {
      const n = await seedSchool(client, tid, 3);
      total += n;
      console.log(`  + ${n} screener rows in in-district school ${tid}`);
    }
    if (otherSchool) {
      const n = await seedSchool(client, otherSchool.id, 2);
      total += n;
      console.log(`  + ${n} screener rows in OTHER-district school ${otherSchool.id} (must NOT appear in the report)`);
    }
    await client.query('COMMIT');
    console.log(`\n✓ Seeded ${total} synthetic screener rows. Re-running refreshes (ON CONFLICT), it does not duplicate.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed script failed:', err.message);
  process.exit(1);
});
