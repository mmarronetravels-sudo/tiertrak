// districtAcademicCalendar — district_admin management of the per-school academic
// calendar (school_academic_calendar, migration-052) for ANY school within their
// OWN district. Sibling of routes/schoolAcademicCalendar.js (school_admin, own
// building only) and routes/operatorAcademicCalendar.js (operator, any tenant).
//
// Mounted at /api/districts in server.js (alongside districtAccess); the routes
// are namespaced under /:id/academic-calendar:
//
//   GET    /:id/academic-calendar?school_tenant_id=X  -> list X's calendar rows
//   POST   /:id/academic-calendar  body { school_tenant_id, period_type,
//            start_date, end_date, label? }            -> create one row
//   PUT    /:id/academic-calendar/:rowId  body { school_tenant_id, ... } -> update
//   DELETE /:id/academic-calendar/:rowId?school_tenant_id=X              -> delete
//
// Authz (§5): requireAuth for the whole surface. The role + scope gate is the
// SAME contract the district overdue-log opt-out handler uses
// (routes/districtAccess.js): role === 'district_admin' AND
// req.user.district_id === :id. Unlike the school_admin surface (which scopes via
// resolveAccessibleTenantIds — the schools a user personally holds a grant for),
// a district_admin governs calendar policy for their WHOLE district, so the
// target school is validated by tenants.district_id === :id (Model B). That
// district_id match makes a cross-district read/write structurally impossible:
// a school in another district yields a clean 404, never a cross-tenant mutation.
// school_tenant_id is REQUIRED on every call (a district has many schools; there
// is no sole-building shortcut here).
//
// §3 rate limiting: mutationUserLimiter on every write (POST/PUT/DELETE). The
// global /api CSRF enforce (server.js) protects the state-changing routes.
//
// §4B: requests, response bodies, and logs carry integers, dates, period_type,
// and the optional non-PII label only — no student/staff names, emails, or
// intervention data. label is returned in GET bodies for the management UI but
// is NEVER written to a log line (gate 5).

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { mutationUserLimiter } = require('../middleware/rateLimiters');
const {
  validateIntParam,
  validateCalendarBody,
} = require('./schoolAcademicCalendarCore');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.use(requireAuth);

// Columns returned to the management UI. Mirrors the school surface exactly:
// created_at is intentionally omitted (no over-fetch); label is included
// because the UI needs it.
const ROW_COLUMNS =
  'id, school_tenant_id, period_type, start_date, end_date, label, updated_at';

// Resolve and authorize the (district, school) pair for a request. Returns
// { districtId, schoolTenantId } on success, or { error: { status, message } }.
//
// Gate order (mirrors districtAccess + role-gate-before-parse): validate the
// district id, enforce role === 'district_admin' AND district ownership, THEN
// validate the school id and confirm it is a school-tenant within THIS district
// (the §5 cross-district fence). The DB membership check is the load-bearing
// isolation property — the school is never trusted from request input alone.
async function resolveDistrictSchool(req, rawSchoolTenantId) {
  const districtId = validateIntParam(req.params.id);
  if (districtId === null) {
    return { error: { status: 400, message: 'Invalid district id' } };
  }
  if (req.user.role !== 'district_admin' || req.user.district_id !== districtId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }
  if (rawSchoolTenantId === undefined || rawSchoolTenantId === null) {
    return { error: { status: 400, message: 'school_tenant_id required' } };
  }
  const schoolTenantId = validateIntParam(rawSchoolTenantId);
  if (schoolTenantId === null) {
    return { error: { status: 400, message: 'Invalid school_tenant_id' } };
  }
  const school = await pool.query(
    "SELECT id FROM tenants WHERE id = $1 AND district_id = $2 AND type = 'school'",
    [schoolTenantId, districtId]
  );
  if (school.rows.length === 0) {
    return { error: { status: 404, message: 'Not found' } };
  }
  return { districtId, schoolTenantId };
}

function actorIdFrom(req, res, tag) {
  const actorId = Number(req.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    console.error(tag, 'invalid req.user.id from JWT');
    res.status(500).json({ error: 'Server error' });
    return null;
  }
  return actorId;
}

// GET /:id/academic-calendar — list one in-district school's calendar rows,
// scoped strictly by the resolved school_tenant_id (gate 3/4: scope on the
// school column, never an unscoped read and never keyed on district_id alone).
router.get('/:id/academic-calendar', async (req, res) => {
  try {
    const { schoolTenantId, error } = await resolveDistrictSchool(
      req, req.query.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const result = await pool.query(
      `SELECT ${ROW_COLUMNS}
         FROM school_academic_calendar
        WHERE school_tenant_id = $1
        ORDER BY start_date, id`,
      [schoolTenantId]
    );
    res.json({ school_tenant_id: schoolTenantId, rows: result.rows });
  } catch (err) {
    console.error('[districtAcademicCalendar:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /:id/academic-calendar — create one term/break row for an in-district
// school. district_id is the path district (the school was confirmed to belong
// to it), matching the denormalization the school surface performs.
router.post('/:id/academic-calendar', mutationUserLimiter, async (req, res) => {
  try {
    const { districtId, schoolTenantId, error } = await resolveDistrictSchool(
      req, req.body && req.body.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const fields = validateCalendarBody(req.body);
    if (fields.error) {
      return res.status(fields.error.status).json({ error: fields.error.message });
    }

    const actorId = actorIdFrom(req, res, '[districtAcademicCalendar:post]');
    if (actorId === null) return;

    const result = await pool.query(
      `INSERT INTO school_academic_calendar
         (school_tenant_id, district_id, period_type, start_date, end_date,
          label, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING ${ROW_COLUMNS}`,
      [schoolTenantId, districtId, fields.periodType, fields.startDate,
       fields.endDate, fields.label, actorId]
    );
    res.status(201).json({ message: 'Created', ...result.rows[0] });
  } catch (err) {
    console.error('[districtAcademicCalendar:post]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /:id/academic-calendar/:rowId — update one calendar row belonging to an
// in-district school. The WHERE clause is scoped by BOTH the row id and the
// resolved school_tenant_id, so a row id from another school (or another
// district) can never be mutated (clean 404). school_tenant_id and district_id
// are not changed by an update — a row stays in its school.
router.put('/:id/academic-calendar/:rowId', mutationUserLimiter, async (req, res) => {
  try {
    const rowId = validateIntParam(req.params.rowId);
    if (rowId === null) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const { schoolTenantId, error } = await resolveDistrictSchool(
      req, req.body && req.body.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const fields = validateCalendarBody(req.body);
    if (fields.error) {
      return res.status(fields.error.status).json({ error: fields.error.message });
    }

    const actorId = actorIdFrom(req, res, '[districtAcademicCalendar:put]');
    if (actorId === null) return;

    const result = await pool.query(
      `UPDATE school_academic_calendar
          SET period_type = $1, start_date = $2, end_date = $3, label = $4,
              updated_by = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND school_tenant_id = $7
       RETURNING ${ROW_COLUMNS}`,
      [fields.periodType, fields.startDate, fields.endDate, fields.label,
       actorId, rowId, schoolTenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ message: 'Updated', ...result.rows[0] });
  } catch (err) {
    console.error('[districtAcademicCalendar:put]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /:id/academic-calendar/:rowId — delete one calendar row belonging to an
// in-district school. Scoped by the resolved school_tenant_id in the WHERE
// clause; a row id from another school/district yields a clean 404.
// school_tenant_id is read from the query string (DELETE carries no body).
router.delete('/:id/academic-calendar/:rowId', mutationUserLimiter, async (req, res) => {
  try {
    const rowId = validateIntParam(req.params.rowId);
    if (rowId === null) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const { schoolTenantId, error } = await resolveDistrictSchool(
      req, req.query.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const result = await pool.query(
      `DELETE FROM school_academic_calendar
        WHERE id = $1 AND school_tenant_id = $2
       RETURNING id`,
      [rowId, schoolTenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ message: 'Deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('[districtAcademicCalendar:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
