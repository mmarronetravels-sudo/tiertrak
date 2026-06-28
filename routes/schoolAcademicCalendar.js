// schoolAcademicCalendar — school_admin self-service CRUD for the per-school
// academic calendar (school_academic_calendar, migration-052). A school_admin
// manages their OWN building's term/break date ranges, which a later PR reads
// to make the weekly overdue-progress-logs email calendar-aware.
//
// Mounted at /api/school/academic-calendar in server.js.
//
//   GET    /        -> list own school's calendar rows
//   POST   /        body: { period_type, start_date, end_date, label?,
//                            school_tenant_id? } -> create one row
//   PUT    /:id     body: { period_type, start_date, end_date, label?,
//                            school_tenant_id? } -> update one own-school row
//   DELETE /:id     -> delete one own-school row
//
// Authz (§5, gate 1): requireAuth for the whole surface. The school_admin-only
// role gate AND the "target school must be a member of the caller's accessible
// set" check both live in resolveOwnSchoolId (imported via
// schoolAcademicCalendarCore from the #339 schoolOverdueLogOptoutsCore helper).
// The school_tenant_id WRITTEN is always the resolved value, never req.body /
// req.params taken raw — so a row can never be created, updated, or deleted
// against a school the caller cannot access. PUT/DELETE additionally scope the
// WHERE clause by the resolved school_tenant_id, so guessing another school's
// row id yields a clean 404, not a cross-school mutation.
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
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { mutationUserLimiter } = require('../middleware/rateLimiters');
const {
  validateIntParam,
  resolveOwnSchoolId,
  validateCalendarBody,
} = require('./schoolAcademicCalendarCore');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.use(requireAuth);

// Columns returned to the management UI. created_at is intentionally omitted
// (no over-fetch); label is included because the UI needs it.
const ROW_COLUMNS =
  'id, school_tenant_id, period_type, start_date, end_date, label, updated_at';

function actorIdFrom(req, res, tag) {
  const actorId = Number(req.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    console.error(tag, 'invalid req.user.id from JWT');
    res.status(500).json({ error: 'Server error' });
    return null;
  }
  return actorId;
}

// GET / — list the caller's own school's calendar rows, scoped strictly by the
// resolved school_tenant_id (gate 3/4: scope on the school column, never an
// unscoped read and never keyed on district_id).
router.get('/', async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const { schoolTenantId, error } = resolveOwnSchoolId(
      req.user.role, accessible, req.query.school_tenant_id
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
    console.error('[schoolAcademicCalendar:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST / — create one term/break row for the caller's own school. The written
// school_tenant_id is the RESOLVED value; district_id is denormalized from the
// tenants row (gate 1).
router.post('/', mutationUserLimiter, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const { schoolTenantId, error } = resolveOwnSchoolId(
      req.user.role, accessible, req.body && req.body.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const fields = validateCalendarBody(req.body);
    if (fields.error) {
      return res.status(fields.error.status).json({ error: fields.error.message });
    }

    const actorId = actorIdFrom(req, res, '[schoolAcademicCalendar:post]');
    if (actorId === null) return;

    // Denormalize district_id from the school's tenants row (nullable for
    // single-school/legacy tenants — every prod tenant today, per M029).
    const tenant = await pool.query(
      "SELECT district_id FROM tenants WHERE id = $1 AND type = 'school'",
      [schoolTenantId]
    );
    if (tenant.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const districtId = tenant.rows[0].district_id;

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
    console.error('[schoolAcademicCalendar:post]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /:id — update one calendar row that belongs to the caller's own school.
// The WHERE clause is scoped by BOTH the row id and the resolved school_tenant
// _id, so another school's row id can never be mutated (clean 404). school
// _tenant_id and district_id are not changed by an update — a row stays in its
// school.
router.put('/:id', mutationUserLimiter, async (req, res) => {
  try {
    const id = validateIntParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    const { schoolTenantId, error } = resolveOwnSchoolId(
      req.user.role, accessible, req.body && req.body.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const fields = validateCalendarBody(req.body);
    if (fields.error) {
      return res.status(fields.error.status).json({ error: fields.error.message });
    }

    const actorId = actorIdFrom(req, res, '[schoolAcademicCalendar:put]');
    if (actorId === null) return;

    const result = await pool.query(
      `UPDATE school_academic_calendar
          SET period_type = $1, start_date = $2, end_date = $3, label = $4,
              updated_by = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND school_tenant_id = $7
       RETURNING ${ROW_COLUMNS}`,
      [fields.periodType, fields.startDate, fields.endDate, fields.label,
       actorId, id, schoolTenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ message: 'Updated', ...result.rows[0] });
  } catch (err) {
    console.error('[schoolAcademicCalendar:put]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /:id — delete one calendar row that belongs to the caller's own
// school. Scoped by the resolved school_tenant_id in the WHERE clause; a row id
// from another school yields a clean 404. school_tenant_id is read from the
// query string (DELETE carries no body), so a sole-building admin needs no id.
router.delete('/:id', mutationUserLimiter, async (req, res) => {
  try {
    const id = validateIntParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    const { schoolTenantId, error } = resolveOwnSchoolId(
      req.user.role, accessible, req.query.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const result = await pool.query(
      `DELETE FROM school_academic_calendar
        WHERE id = $1 AND school_tenant_id = $2
       RETURNING id`,
      [id, schoolTenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ message: 'Deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('[schoolAcademicCalendar:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
