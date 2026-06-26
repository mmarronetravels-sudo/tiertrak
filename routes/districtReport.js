// districtReport — read-only, district-admin-only screener aggregate across
// the schools a district admin can access. The "District Report" surface.
//
// Mounted at /api/districts in server.js (sibling of districtDashboard and
// districtAccess). One handler:
//
//   GET /:id/screener-report?schoolYear=YYYY-YYYY
//        [&period=...] [&subject=...] [&assessmentType=...]
//
// Returns aggregate counts ONLY — no student-level rows ever cross the
// district boundary (data minimization, §4). Per-student drill-down stays
// on the existing per-school screener dashboard (GET /api/screener-results/
// :tenantId). Shape:
//
//   { school_year, filters: { period, subject, assessment_type },
//     schools: [ { school_tenant_id, school_name, total_results,
//                  students_assessed, by_benchmark: { "<category>": n } } ] }
//
// by_benchmark is keyed by the raw screener_results.benchmark_category text
// (GROUP BY + JS fold). Buckets are NOT hardcoded: an unexpected or new
// category surfaces under its own key, and NULL surfaces as "Uncategorized"
// — nothing is silently dropped.
//
// Authz model (§5 + mirrors districtDashboard.js / districtAccess.js):
//   1. requireAuth                                  (middleware)
//   2. role === 'district_admin' AND
//      req.user.district_id === pathDistrictId      (else 403)
//   3. accessible = resolveAccessibleTenantIds()    — defense-in-depth at
//      the query layer; helper enforces user_school_access membership and
//      district scope. Empty array → { schools: [] } (never "all").
//
// Tenant isolation: both aggregate queries constrain tenant_id = ANY(
// $accessible) AND join tenants with t.district_id = $districtId. Cross-
// district reads are structurally impossible (M028 composite FK) and
// defensively barred at the query layer. A district-A admin cannot see any
// school in district B even if `accessible` were ever wrong.
//
// Index: relies on idx_screener_results_dashboard_filters
// (tenant_id, school_year, screening_period, subject, assessment_type).
// No new index or materialized view for v1.
//
// Small-cell suppression: NOT applied in v1. The audience is district_admin,
// an internal role already authorized to view its own district's student-
// level data, so unmasked per-school benchmark counts disclose nothing the
// caller cannot already see. Recorded as a deliberate decision (see PR body);
// Product owns revisiting it if a lower-trust audience is ever added.
//
// Error mapping:
//   400  parseInt validation failure on path id, or missing schoolYear
//   403  caller is not district_admin OR district mismatch
//   500  unexpected error

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INT4_MAX = 2147483647;
const UNCATEGORIZED = 'Uncategorized';

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// Runs the two scoped aggregates and folds them into the per-school report.
// Exported for the read-only authz/rollup smoke; the HTTP handler is the only
// caller in production. `filters` values are passed as bound parameters
// (never interpolated). A NULL filter param means "do not constrain".
async function fetchDistrictScreenerReport(accessibleIds, districtId, filters) {
  const { period = null, subject = null, assessmentType = null } = filters || {};
  const params = [accessibleIds, filters.schoolYear, period, subject, assessmentType, districtId];

  // Per-school totals (includes schools with zero matching results).
  const totalsSql = `
    SELECT t.id   AS school_tenant_id,
           t.name AS school_name,
           COUNT(sr.id)::int                   AS total_results,
           COUNT(DISTINCT sr.student_id)::int  AS students_assessed
    FROM tenants t
    LEFT JOIN screener_results sr
      ON sr.tenant_id = t.id
     AND sr.school_year = $2
     AND ($3::text IS NULL OR sr.screening_period = $3)
     AND ($4::text IS NULL OR sr.subject = $4)
     AND ($5::text IS NULL OR sr.assessment_type = $5)
    WHERE t.id = ANY($1::int[])
      AND t.district_id = $6
    GROUP BY t.id, t.name
    ORDER BY t.name`;

  // Per-school per-category breakdown. Joined to tenants for the same
  // district guard; schools with no matching rows simply don't appear here
  // and default to an empty by_benchmark map below.
  const breakdownSql = `
    SELECT sr.tenant_id           AS school_tenant_id,
           sr.benchmark_category  AS benchmark_category,
           COUNT(*)::int          AS result_count
    FROM screener_results sr
    JOIN tenants t ON t.id = sr.tenant_id AND t.district_id = $6
    WHERE sr.tenant_id = ANY($1::int[])
      AND sr.school_year = $2
      AND ($3::text IS NULL OR sr.screening_period = $3)
      AND ($4::text IS NULL OR sr.subject = $4)
      AND ($5::text IS NULL OR sr.assessment_type = $5)
    GROUP BY sr.tenant_id, sr.benchmark_category`;

  const [totals, breakdown] = await Promise.all([
    pool.query(totalsSql, params),
    pool.query(breakdownSql, params)
  ]);

  const byBenchmark = new Map(); // school_tenant_id -> { category: count }
  for (const row of breakdown.rows) {
    const key = row.benchmark_category === null ? UNCATEGORIZED : row.benchmark_category;
    if (!byBenchmark.has(row.school_tenant_id)) byBenchmark.set(row.school_tenant_id, {});
    byBenchmark.get(row.school_tenant_id)[key] = row.result_count;
  }

  return totals.rows.map((s) => ({
    school_tenant_id: s.school_tenant_id,
    school_name: s.school_name,
    total_results: s.total_results,
    students_assessed: s.students_assessed,
    by_benchmark: byBenchmark.get(s.school_tenant_id) || {}
  }));
}

router.get('/:id/screener-report', requireAuth, async (req, res) => {
  try {
    const districtId = validateIntParam(req.params.id);
    if (districtId === null) {
      return res.status(400).json({ error: 'Invalid district id' });
    }

    const schoolYear = req.query.schoolYear;
    if (!schoolYear || typeof schoolYear !== 'string') {
      return res.status(400).json({ error: 'schoolYear is required' });
    }

    if (req.user.role !== 'district_admin' || req.user.district_id !== districtId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const filters = {
      schoolYear,
      period: typeof req.query.period === 'string' ? req.query.period : null,
      subject: typeof req.query.subject === 'string' ? req.query.subject : null,
      assessmentType: typeof req.query.assessmentType === 'string' ? req.query.assessmentType : null
    };

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (accessible.length === 0) {
      return res.json({
        school_year: schoolYear,
        filters: { period: filters.period, subject: filters.subject, assessment_type: filters.assessmentType },
        schools: []
      });
    }

    const schools = await fetchDistrictScreenerReport(accessible, districtId, filters);

    res.json({
      school_year: schoolYear,
      filters: { period: filters.period, subject: filters.subject, assessment_type: filters.assessmentType },
      schools
    });
  } catch (err) {
    console.error('[districtReport:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.fetchDistrictScreenerReport = fetchDistrictScreenerReport;
