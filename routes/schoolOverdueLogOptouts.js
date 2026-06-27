// schoolOverdueLogOptouts — school_admin self-service surface for the scheduled
// weekly overdue-progress-logs staff email (gate item (a), migration-051).
//
// Mounted at /api/school/overdue-log-reminders in server.js. A school_admin
// turns their OWN school's reminder on or off without an operator:
//
//   GET  /   -> current on/off state for the caller's school + feature_enabled
//   PUT  /   body: { enabled, school_tenant_id? } -> set on/off for own school
//
// Why a dedicated school file (separate from the operator and district-admin
// writers from #337): this surface is school_admin ONLY and resolves the
// target school strictly from resolveAccessibleTenantIds(req.user). The
// operator writer (operatorOverdueLogOptouts.js) addresses any tenant by path
// id; the district writer (districtAccess.js) governs a whole district. This
// one is the narrowest grain: a school_admin acting on a school in their own
// access set, and nothing else.
//
// Authz (§5): requireAuth for the whole surface; the role gate (school_admin
// only) and the school-membership check both live in schoolOverdueLogOptoutsCore
// .resolveOwnSchoolId, so the target school can never be taken from request
// input that the caller does not already have access to. district_tech_admin
// (read-only by design) and district_admin (own #337 endpoint) are excluded.
//
// §3 rate limiting: mutationUserLimiter on the PUT. The global /api CSRF
// enforce (server.js) protects the state-changing PUT.
//
// §4B: requests, 200 bodies, and logs carry integers + a boolean only — no
// student/staff names, emails, or intervention data. The opt-out table stores
// nothing but integer refs + state (see migration-051 header).
//
// Audit trail: every UPSERT writes updated_by = the acting user id (created_by
// on first insert), so there is a record of who flipped the toggle.
//
// Not flag-gated: a school may pre-declare its opt-out before
// OVERDUE_LOGS_REMINDERS_ENABLED is turned on (the M051 gate-item-(a) contract).
// The flag only gates the digest cron and the toggle's visibility, not the write.

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { mutationUserLimiter } = require('../middleware/rateLimiters');
const {
  validateBool,
  featureEnabled,
  resolveOwnSchoolId,
} = require('./schoolOverdueLogOptoutsCore');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.use(requireAuth);

// GET / — current on/off state for the caller's own school. Absence of a row
// means eligible (default-on / opt-out semantics), so report reminders_enabled
// = true. feature_enabled tells the FE whether to show the toggle at all.
router.get('/', async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const { schoolTenantId, error } = resolveOwnSchoolId(
      req.user.role, accessible, req.query.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const result = await pool.query(
      'SELECT reminders_enabled FROM overdue_log_reminder_optouts WHERE school_tenant_id = $1',
      [schoolTenantId]
    );
    const remindersEnabled = result.rows.length === 0
      ? true
      : result.rows[0].reminders_enabled;

    res.json({
      school_tenant_id: schoolTenantId,
      reminders_enabled: remindersEnabled,
      feature_enabled: featureEnabled(process.env),
    });
  } catch (err) {
    console.error('[schoolOverdueLogOptouts:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT / — set the caller's own school opted out (enabled=false) or back in
// (enabled=true). Reversible. Idempotent UPSERT on the per-school partial-
// unique index. Role gate runs before the enabled parse (role-gate-before-parse).
router.put('/', mutationUserLimiter, async (req, res) => {
  try {
    const accessible = await resolveAccessibleTenantIds(req.user);
    const { schoolTenantId, error } = resolveOwnSchoolId(
      req.user.role, accessible, req.body && req.body.school_tenant_id
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const enabled = validateBool(req.body && req.body.enabled);
    if (enabled === null) {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[schoolOverdueLogOptouts:put]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
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
      [schoolTenantId, enabled, actorId]
    );
    res.json({ message: 'Updated', ...result.rows[0] });
  } catch (err) {
    console.error('[schoolOverdueLogOptouts:put]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
