// operatorOverdueLogOptouts — operator-only opt-out surface for the scheduled
// weekly overdue-progress-logs staff email (gate item (a), migration-051).
//
// Mounted at /api/operator/overdue-log-reminders in server.js. Two writers:
//
//   PUT /schools/:tenantId      body: { enabled }  -> opt one school-tenant
//   PUT /districts/:districtId  body: { enabled }  -> opt one whole district
//
// Why a dedicated operator file (not folded into operatorDistricts.js): the
// district-admin self-service route lives in routes/districtAccess.js, but a
// district_admin can only act within an existing district. Single-school /
// legacy customers are standalone tenant rows with district_id = NULL and have
// NO district to address them through -- which is EVERY production tenant today
// (M029: tenants.type is school-only in prod, districts un-seedable). The
// schools route below addresses a tenant by id directly, so it is the writer
// that actually makes the prod opt-out gate satisfiable. operatorDistricts.js
// is district-path-shaped (/:districtId/...) and cannot reach a NULL-district
// tenant, so this surface is kept separate and cohesive.
//
// Authz: operator-only. router.use(requireAuth, platformAdminOnly) runs once
// for the whole surface (mirrors operatorDistricts.js). Operators sit ABOVE the
// tenant model and hold zero user_school_access rows, so resolveAccessibleTenantIds
// is deliberately NOT in the chain -- scope is enforced by the existence
// pre-flights below, and the writes are top-level config rows, not tenant data.
//
// §3 rate limiting: mutationUserLimiter on each write route. The global /api
// CSRF enforce (server.js) protects these state-changing PUTs.
//
// §4B: requests, 200 bodies, and logs carry integers + a boolean only -- no
// student/staff names, emails, or intervention data. The opt-out table stores
// nothing but integer refs + state (see migration-051 header).
//
// §5: each write is keyed strictly by the path id (a tenant id or a district
// id), validated to exist, so a write can never land against another scope.
// reminders_enabled = false suppresses; true re-enables (reversible). The
// per-scope partial-unique index makes each UPSERT idempotent.

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { platformAdminOnly } = require('../middleware/platformAdminOnly');
const { mutationUserLimiter } = require('../middleware/rateLimiters');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.use(requireAuth, platformAdminOnly);

const INT4_MAX = 2147483647;

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

function validateBool(value) {
  return typeof value === 'boolean' ? value : null;
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

// PUT /schools/:tenantId — opt a single school-tenant out of (or back into) the
// weekly overdue-logs email. Works for both standalone tenants and schools
// under a district, since both are tenants rows with type = 'school'.
router.put('/schools/:tenantId', mutationUserLimiter, async (req, res) => {
  try {
    const tenantId = validateIntParam(req.params.tenantId);
    if (tenantId === null) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }
    const enabled = validateBool(req.body && req.body.enabled);
    if (enabled === null) {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const actorId = actorIdFrom(req, res, '[operatorOverdueLogOptouts:school]');
    if (actorId === null) return;

    // Existence pre-flight: a clean 404 if the tenant is missing or is not a
    // school. type = 'school' mirrors the operatorDistricts grant precedent.
    const tenant = await pool.query(
      "SELECT id FROM tenants WHERE id = $1 AND type = 'school'",
      [tenantId]
    );
    if (tenant.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await pool.query(
      `INSERT INTO overdue_log_reminder_optouts
         (school_tenant_id, reminders_enabled, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (school_tenant_id) WHERE school_tenant_id IS NOT NULL
       DO UPDATE SET reminders_enabled = EXCLUDED.reminders_enabled,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING school_tenant_id, district_id, reminders_enabled`,
      [tenantId, enabled, actorId]
    );
    res.json({ message: 'Updated', ...result.rows[0] });
  } catch (err) {
    console.error('[operatorOverdueLogOptouts:school]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /districts/:districtId — opt a whole district out of (or back into) the
// weekly overdue-logs email. Suppresses every school under the district via the
// digest per-user skip.
router.put('/districts/:districtId', mutationUserLimiter, async (req, res) => {
  try {
    const districtId = validateIntParam(req.params.districtId);
    if (districtId === null) {
      return res.status(400).json({ error: 'Invalid district id' });
    }
    const enabled = validateBool(req.body && req.body.enabled);
    if (enabled === null) {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const actorId = actorIdFrom(req, res, '[operatorOverdueLogOptouts:district]');
    if (actorId === null) return;

    const district = await pool.query(
      'SELECT id FROM districts WHERE id = $1',
      [districtId]
    );
    if (district.rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    const result = await pool.query(
      `INSERT INTO overdue_log_reminder_optouts
         (district_id, reminders_enabled, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (district_id) WHERE district_id IS NOT NULL
       DO UPDATE SET reminders_enabled = EXCLUDED.reminders_enabled,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING school_tenant_id, district_id, reminders_enabled`,
      [districtId, enabled, actorId]
    );
    res.json({ message: 'Updated', ...result.rows[0] });
  } catch (err) {
    console.error('[operatorOverdueLogOptouts:district]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
