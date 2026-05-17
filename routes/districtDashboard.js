// districtDashboard — read-only aggregate counts for the district-admin
// landing page.
//
// Mounted at /api/districts in server.js (alongside districtAccess,
// which owns the grant/revoke write surface). One handler:
//
//   GET /:id/dashboard
//
// Returns { schools: [{ school_tenant_id, school_name, student_count,
// staff_count, active_intervention_count }, ...] } — one row per
// school the caller has user_school_access to within the requested
// district.
//
// Authz model (§5 + mirrors districtAccess.js):
//   1. requireAuth                                  (middleware)
//   2. role === 'district_admin' AND
//      req.user.district_id === pathDistrictId      (else 403)
//   3. accessible = resolveAccessibleTenantIds()    — defense-in-
//      depth at the query layer; helper enforces user_school_access
//      membership and district scope.
//
// Tenant isolation: every aggregate sub-query filters on
// tenant_id = ANY($accessible) AND the outer WHERE additionally
// constrains t.district_id = $districtId. Cross-district reads are
// structurally impossible (M028 composite FK) and defensively barred
// at the query layer. A district-A admin cannot see counts for any
// school in district B even if accessible were ever wrong.
//
// "Staff" = users.role NOT IN ('parent','district_admin',
// 'district_tech_admin') — counts school-resident staff only,
// excludes district-scope roles per S81 Q2.
//
// "Active interventions" = student_interventions.status = 'active'
// (per S81 Q1). student_interventions has no tenant_id column;
// scoping is via the JOIN on students.tenant_id.
//
// Error mapping:
//   400  parseInt validation failure on path id
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

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

router.get('/:id/dashboard', requireAuth, async (req, res) => {
  try {
    const districtId = validateIntParam(req.params.id);
    if (districtId === null) {
      return res.status(400).json({ error: 'Invalid district id' });
    }

    if (req.user.role !== 'district_admin' || req.user.district_id !== districtId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (accessible.length === 0) {
      return res.json({ schools: [] });
    }

    const { rows } = await pool.query(
      `SELECT
         t.id            AS school_tenant_id,
         t.name          AS school_name,
         COALESCE(s.student_count, 0)              AS student_count,
         COALESCE(st.staff_count, 0)               AS staff_count,
         COALESCE(i.active_intervention_count, 0)  AS active_intervention_count
       FROM tenants t
       LEFT JOIN (
         SELECT tenant_id, COUNT(*) AS student_count
         FROM students
         WHERE tenant_id = ANY($1::int[]) AND archived = FALSE
         GROUP BY tenant_id
       ) s ON s.tenant_id = t.id
       LEFT JOIN (
         SELECT tenant_id, COUNT(*) AS staff_count
         FROM users
         WHERE tenant_id = ANY($1::int[])
           AND role NOT IN ('parent', 'district_admin', 'district_tech_admin')
         GROUP BY tenant_id
       ) st ON st.tenant_id = t.id
       LEFT JOIN (
         SELECT students.tenant_id, COUNT(*) AS active_intervention_count
         FROM student_interventions si
         JOIN students ON students.id = si.student_id
         WHERE students.tenant_id = ANY($1::int[]) AND si.status = 'active'
         GROUP BY students.tenant_id
       ) i ON i.tenant_id = t.id
       WHERE t.id = ANY($1::int[])
         AND t.district_id = $2
       ORDER BY t.name`,
      [accessible, districtId]
    );

    res.json({ schools: rows });
  } catch (err) {
    console.error('[districtDashboard:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
