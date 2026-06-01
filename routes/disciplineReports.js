const express = require('express');
const router = express.Router();
const {
  requireAuth,
  requireTenantStaffAccess,
} = require('../middleware/authorizeInterventionAccess');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// ============================================================
// SWIS-style aggregate report cuts for the discipline-referral
// family. Three de-identified cuts in v1:
//   - by-location          (GROUP BY discipline_locations.label)
//   - by-incident-type     (GROUP BY discipline_behaviors.label)
//   - by-time-of-day       (GROUP BY EXTRACT(HOUR FROM incident_time))
//
// Aggregate counts only. No student, staff, or notes columns
// appear in any projection or error log. Visibility gate matches
// the discipline-referral admin/queue surface: school_admin,
// district_admin, counselor, interventionist. Teacher and parent
// are 403 on these tenant-wide cuts — the per-author and per-
// student paths live on other routes and have their own gates.
//
// Tenant scope: requireTenantStaffAccess verifies path :tenantId
// is in the caller's accessible-tenant set per §5 dual-path. The
// SQL filter then binds tenant_id = $1 for defense in depth.
// ============================================================

const FORBIDDEN_BODY = { error: 'Not authorized' };

// Mirrors VIEW_ROLES in routes/disciplineReferrals.js:44. Declared
// locally rather than imported so the two routers stay
// independently reviewable; any future widening must be made in
// both places intentionally.
const VIEW_ROLES = ['school_admin', 'district_admin', 'counselor', 'interventionist'];

const STATUS_VALUES = ['submitted', 'under_review', 'resolved'];

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// parseDateParam(raw, fieldName) — validate an optional YYYY-MM-DD
// query param. Mirrors the shape-regex used by the future-
// incident_date guard in routes/disciplineReferrals.js:380.
//
// Returns { ok: true, value: 'YYYY-MM-DD' | null } on success
// (absent / empty string collapses to null so the SQL filter is
// skipped) or { ok: false, error } on shape failure. The error
// message is generic — never echoes the bad input.
function parseDateParam(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, error: `Invalid ${fieldName}` };
  }
  return { ok: true, value: raw };
}

// ============================================================
// GET /by-location/:tenantId — referral count grouped by location.
//
// Query params (all optional):
//   start_date=YYYY-MM-DD  (incident_date >= start_date)
//   end_date=YYYY-MM-DD    (incident_date <= end_date)
//   status=submitted|under_review|resolved
//
// Visibility gate: VIEW_ROLES; parent and teacher 403. Path
// :tenantId int-validated, then membership-checked via
// requireTenantStaffAccess. SQL filter uses tenant_id = $1 for
// defense in depth.
//
// PII discipline (§4B): projection is location_id, location_label,
// referral_count. No student names, staff names, notes. Error log
// carries tenant_id (int) + user_id (int) + err.message only.
// ============================================================
router.get('/by-location/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    if (!VIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const tenantId = Number(req.params.tenantId);
    if (!isPositiveInt(tenantId)) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    const startParsed = parseDateParam(req.query.start_date, 'start_date');
    if (!startParsed.ok) return res.status(400).json({ error: startParsed.error });
    const endParsed = parseDateParam(req.query.end_date, 'end_date');
    if (!endParsed.ok) return res.status(400).json({ error: endParsed.error });

    const status = typeof req.query.status === 'string' ? req.query.status : null;
    if (status !== null && !STATUS_VALUES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    const result = await pool.query(
      `SELECT
         dl.id         AS location_id,
         dl.label      AS location_label,
         COUNT(*)::int AS referral_count
       FROM discipline_referrals dr
       JOIN discipline_locations dl
         ON dl.id = dr.location_id AND dl.tenant_id = dr.tenant_id
       WHERE dr.tenant_id = $1
         AND ($2::date IS NULL OR dr.incident_date >= $2::date)
         AND ($3::date IS NULL OR dr.incident_date <= $3::date)
         AND ($4::text IS NULL OR dr.status = $4::text)
       GROUP BY dl.id, dl.label, dl.sort_order
       ORDER BY referral_count DESC, dl.sort_order, dl.label`,
      [tenantId, startParsed.value, endParsed.value, status]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      '[disciplineReports:byLocation]',
      'tenant_id=', req.params.tenantId,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load report' });
  }
});

// ============================================================
// GET /by-incident-type/:tenantId — referral count grouped by
// behavior (incident type), including severity_level so the
// caller can render Level 1/2/3 segmentation without a second
// round-trip.
//
// Query params (all optional):
//   start_date=YYYY-MM-DD  (incident_date >= start_date)
//   end_date=YYYY-MM-DD    (incident_date <= end_date)
//   status=submitted|under_review|resolved
//
// Gates and scoping identical to /by-location/:tenantId.
//
// PII discipline (§4B): projection is behavior_id, behavior_label,
// severity_level, referral_count. The behavior label is district-
// customizable vocab from discipline_behaviors (tenant-scoped, not
// PII). No student names, staff names, notes. Error log carries
// tenant_id (int) + user_id (int) + err.message only.
// ============================================================
router.get('/by-incident-type/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    if (!VIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const tenantId = Number(req.params.tenantId);
    if (!isPositiveInt(tenantId)) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    const startParsed = parseDateParam(req.query.start_date, 'start_date');
    if (!startParsed.ok) return res.status(400).json({ error: startParsed.error });
    const endParsed = parseDateParam(req.query.end_date, 'end_date');
    if (!endParsed.ok) return res.status(400).json({ error: endParsed.error });

    const status = typeof req.query.status === 'string' ? req.query.status : null;
    if (status !== null && !STATUS_VALUES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    const result = await pool.query(
      `SELECT
         db.id             AS behavior_id,
         db.label          AS behavior_label,
         db.severity_level AS severity_level,
         COUNT(*)::int     AS referral_count
       FROM discipline_referrals dr
       JOIN discipline_behaviors db
         ON db.id = dr.behavior_id AND db.tenant_id = dr.tenant_id
       WHERE dr.tenant_id = $1
         AND ($2::date IS NULL OR dr.incident_date >= $2::date)
         AND ($3::date IS NULL OR dr.incident_date <= $3::date)
         AND ($4::text IS NULL OR dr.status = $4::text)
       GROUP BY db.id, db.label, db.severity_level, db.sort_order
       ORDER BY referral_count DESC, db.severity_level, db.sort_order, db.label`,
      [tenantId, startParsed.value, endParsed.value, status]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      '[disciplineReports:byIncidentType]',
      'tenant_id=', req.params.tenantId,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load report' });
  }
});

// ============================================================
// GET /by-time-of-day/:tenantId — referral count grouped by hour
// of the incident_time column.
//
// incident_time is nullable on discipline_referrals (the column
// is optional at create-time per the SWIS model). Null values are
// surfaced as a separate row with hour = null so admins can see
// the data-quality picture without inflating any concrete hour
// bucket.
//
// Query params (all optional):
//   start_date=YYYY-MM-DD  (incident_date >= start_date)
//   end_date=YYYY-MM-DD    (incident_date <= end_date)
//   status=submitted|under_review|resolved
//
// Gates and scoping identical to /by-location/:tenantId.
//
// PII discipline (§4B): projection is hour, referral_count. The
// hour bucket is derived from incident_time (TIME) and carries no
// identifying information. No student names, staff names, notes.
// Error log carries tenant_id (int) + user_id (int) + err.message
// only.
// ============================================================
router.get('/by-time-of-day/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    if (!VIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const tenantId = Number(req.params.tenantId);
    if (!isPositiveInt(tenantId)) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    const startParsed = parseDateParam(req.query.start_date, 'start_date');
    if (!startParsed.ok) return res.status(400).json({ error: startParsed.error });
    const endParsed = parseDateParam(req.query.end_date, 'end_date');
    if (!endParsed.ok) return res.status(400).json({ error: endParsed.error });

    const status = typeof req.query.status === 'string' ? req.query.status : null;
    if (status !== null && !STATUS_VALUES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    // EXTRACT(HOUR FROM incident_time) returns NULL when
    // incident_time is NULL, so the GROUP BY naturally produces
    // one row for unknown-hour rather than dropping them. Cast
    // to int so JSON carries a plain integer, not a numeric
    // string. NULLS LAST keeps the unknown-hour row at the end.
    const result = await pool.query(
      `SELECT
         EXTRACT(HOUR FROM dr.incident_time)::int AS hour,
         COUNT(*)::int                             AS referral_count
       FROM discipline_referrals dr
       WHERE dr.tenant_id = $1
         AND ($2::date IS NULL OR dr.incident_date >= $2::date)
         AND ($3::date IS NULL OR dr.incident_date <= $3::date)
         AND ($4::text IS NULL OR dr.status = $4::text)
       GROUP BY hour
       ORDER BY hour NULLS LAST`,
      [tenantId, startParsed.value, endParsed.value, status]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      '[disciplineReports:byTimeOfDay]',
      'tenant_id=', req.params.tenantId,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load report' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
