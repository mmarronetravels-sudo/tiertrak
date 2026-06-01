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

module.exports = router;
module.exports.initializePool = initializePool;
