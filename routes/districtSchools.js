// districtSchools — district_admin read of the school-tenant roster for their
// OWN district. Sibling of routes/districtAccess.js (grant management) and
// routes/districtAcademicCalendar.js (per-school calendar CRUD); mounted on the
// same /api/districts router in server.js.
//
//   GET /:id/schools  ->  { schools: [{ school_tenant_id, school_name }, ...] }
//
// Why this exists (§5 scope choice): the district calendar/reminder surfaces
// govern policy for EVERY school where tenants.district_id = :id (Model B), but
// the only district-scoped school list a district_admin could otherwise read
// (GET /:id/dashboard) is filtered by resolveAccessibleTenantIds — the
// grant-based subset. A district_admin with no user_school_access rows gets an
// empty dashboard list, which would leave the FE school-picker empty even
// though the calendar/reminder endpoints accept any in-district school. This
// endpoint returns the Model-B set the picker actually needs, so it
// DELIBERATELY does NOT call resolveAccessibleTenantIds.
//
// Authz (§5): requireAuth for the whole surface (router.use below). The role +
// scope gate is the SAME prefix the calendar surface's resolveDistrictSchool
// uses, minus the school step: validate the district id, then enforce
// role === 'district_admin' AND req.user.district_id === :id. Any other role
// (including district_tech_admin) is rejected with 403. The district_id match
// makes a cross-district read structurally impossible — the WHERE clause is
// scoped to the path district and only ever returns that district's schools.
//
// §4B: the request, the 200 body, and all logs carry integers and school names
// only — no student/staff names, emails, or intervention data. School/tenant
// names are not student/staff PII. logs are static-tag + err.message only; no
// request data is ever echoed into a log line or an error body.

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { authorizeDistrictAdmin } = require('./districtAuthzCore');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.use(requireAuth);

// GET /:id/schools — list every school-tenant in the caller's own district.
router.get('/:id/schools', async (req, res) => {
  try {
    const gate = authorizeDistrictAdmin(req.user, req.params.id);
    if (gate.error) {
      return res.status(gate.error.status).json({ error: gate.error.message });
    }
    const { districtId } = gate;

    const result = await pool.query(
      `SELECT id AS school_tenant_id, name AS school_name
         FROM tenants
        WHERE district_id = $1 AND type = 'school'
        ORDER BY name`,
      [districtId]
    );
    res.json({ schools: result.rows });
  } catch (err) {
    console.error('[districtSchools:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
