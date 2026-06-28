// operatorAcademicCalendar — operator-only CRUD for any school's academic
// calendar (school_academic_calendar, migration-052). An operator sets term/
// break ranges for ANY school, addressing it by tenant path id — the
// counterpart to the school_admin self-service surface
// (routes/schoolAcademicCalendar.js).
//
// Mounted at /api/operator/academic-calendar in server.js.
//
//   GET    /schools/:tenantId          -> list one school's calendar rows
//   POST   /schools/:tenantId          body: { period_type, start_date,
//                                              end_date, label? } -> create row
//   PUT    /schools/:tenantId/:id      -> update one of that school's rows
//   DELETE /schools/:tenantId/:id      -> delete one of that school's rows
//
// School-only by design: district-level calendar inheritance is deferred (spec
// decision #8), so there is no /districts route here. Each row is keyed to one
// school_tenant_id.
//
// Authz (gate 2): router.use(requireAuth, platformAdminOnly) runs once for the
// whole surface (mirrors operatorOverdueLogOptouts.js). Operators sit ABOVE the
// tenant model and hold zero user_school_access rows, so resolveAccessibleTenantIds
// is deliberately NOT in the chain — scope is enforced by the tenants existence
// + type='school' pre-flight before every read and write, and the writes target
// a config row keyed strictly by the validated path tenant id.
//
// §3 rate limiting: mutationUserLimiter on each write. The global /api CSRF
// enforce (server.js) protects the state-changing routes.
//
// §4B: requests, response bodies, and logs carry integers, dates, period_type,
// and the optional non-PII label only — no student/staff names, emails, or
// intervention data. label is returned to the UI but never logged (gate 5).

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { platformAdminOnly } = require('../middleware/platformAdminOnly');
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

router.use(requireAuth, platformAdminOnly);

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

// Existence pre-flight: the tenant must exist and be a school. Returns the
// tenant row (with district_id for denormalization) on success, or null after
// having already sent the 400/404 response.
async function resolveSchoolTenant(req, res) {
  const tenantId = validateIntParam(req.params.tenantId);
  if (tenantId === null) {
    res.status(400).json({ error: 'Invalid tenant id' });
    return null;
  }
  const tenant = await pool.query(
    "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
    [tenantId]
  );
  if (tenant.rows.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return { tenantId, districtId: tenant.rows[0].district_id };
}

// GET /schools/:tenantId — list one school's calendar rows, scoped by the
// validated school_tenant_id (gate 3/4).
router.get('/schools/:tenantId', async (req, res) => {
  try {
    const school = await resolveSchoolTenant(req, res);
    if (school === null) return;

    const result = await pool.query(
      `SELECT ${ROW_COLUMNS}
         FROM school_academic_calendar
        WHERE school_tenant_id = $1
        ORDER BY start_date, id`,
      [school.tenantId]
    );
    res.json({ school_tenant_id: school.tenantId, rows: result.rows });
  } catch (err) {
    console.error('[operatorAcademicCalendar:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /schools/:tenantId — create one row for the given school.
router.post('/schools/:tenantId', mutationUserLimiter, async (req, res) => {
  try {
    const school = await resolveSchoolTenant(req, res);
    if (school === null) return;

    const fields = validateCalendarBody(req.body);
    if (fields.error) {
      return res.status(fields.error.status).json({ error: fields.error.message });
    }

    const actorId = actorIdFrom(req, res, '[operatorAcademicCalendar:post]');
    if (actorId === null) return;

    const result = await pool.query(
      `INSERT INTO school_academic_calendar
         (school_tenant_id, district_id, period_type, start_date, end_date,
          label, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING ${ROW_COLUMNS}`,
      [school.tenantId, school.districtId, fields.periodType, fields.startDate,
       fields.endDate, fields.label, actorId]
    );
    res.status(201).json({ message: 'Created', ...result.rows[0] });
  } catch (err) {
    console.error('[operatorAcademicCalendar:post]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /schools/:tenantId/:id — update one of that school's rows. The WHERE
// clause is scoped by both the row id and the school_tenant_id, so a row id
// from another school yields a clean 404.
router.put('/schools/:tenantId/:id', mutationUserLimiter, async (req, res) => {
  try {
    const id = validateIntParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const school = await resolveSchoolTenant(req, res);
    if (school === null) return;

    const fields = validateCalendarBody(req.body);
    if (fields.error) {
      return res.status(fields.error.status).json({ error: fields.error.message });
    }

    const actorId = actorIdFrom(req, res, '[operatorAcademicCalendar:put]');
    if (actorId === null) return;

    const result = await pool.query(
      `UPDATE school_academic_calendar
          SET period_type = $1, start_date = $2, end_date = $3, label = $4,
              updated_by = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND school_tenant_id = $7
       RETURNING ${ROW_COLUMNS}`,
      [fields.periodType, fields.startDate, fields.endDate, fields.label,
       actorId, id, school.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ message: 'Updated', ...result.rows[0] });
  } catch (err) {
    console.error('[operatorAcademicCalendar:put]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /schools/:tenantId/:id — delete one of that school's rows, scoped by
// both id and school_tenant_id.
router.delete('/schools/:tenantId/:id', mutationUserLimiter, async (req, res) => {
  try {
    const id = validateIntParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const school = await resolveSchoolTenant(req, res);
    if (school === null) return;

    const result = await pool.query(
      `DELETE FROM school_academic_calendar
        WHERE id = $1 AND school_tenant_id = $2
       RETURNING id`,
      [id, school.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ message: 'Deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('[operatorAcademicCalendar:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
