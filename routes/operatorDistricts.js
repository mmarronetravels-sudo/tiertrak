const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { platformAdminOnly } = require('../middleware/platformAdminOnly');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// All routes are operator-only. requireAuth populates req.user from the
// auth cookie + DB re-query; platformAdminOnly checks the user id against
// the PLATFORM_ADMIN_USER_IDS env-allowlist. Customer-facing roles never
// reach these handlers. resolveAccessibleTenantIds is deliberately NOT in
// the chain — operators have no user_school_access rows and this endpoint
// creates a top-level entity rather than scoping into a tenant set.
router.use(requireAuth, platformAdminOnly);

const ALLOWED_AUTH_MODES = ['sso', 'password', 'disabled'];

// Create a new district. This endpoint mints a districts row only — it
// does not attach any tenants, mint any users, or seed user_school_access
// rows. Those flows are separate later endpoints.
//
// Body: { name, auth_mode }
//   - auth_mode is required and has no default (M034 fail-safe design;
//     every district INSERT must specify an auth policy explicitly).
//   - name is required. The 409 below is a best-effort pre-flight only:
//     districts.name has no UNIQUE constraint at the DB layer yet
//     (Followup #107). Two concurrent operator clicks could race-insert
//     duplicates between the SELECT and the INSERT. Treat the 409 as
//     informational, not a uniqueness guarantee.
router.post('/', async (req, res) => {
  const { name, auth_mode } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!auth_mode || !ALLOWED_AUTH_MODES.includes(auth_mode)) {
    return res.status(400).json({ error: 'auth_mode must be one of: sso, password, disabled' });
  }
  try {
    const existing = await pool.query(
      'SELECT 1 FROM districts WHERE name = $1 LIMIT 1',
      [trimmedName]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'District name already exists' });
    }

    const result = await pool.query(
      `INSERT INTO districts (name, auth_mode)
       VALUES ($1, $2)
       RETURNING id, name, auth_mode, created_at, updated_at`,
      [trimmedName, auth_mode]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid auth_mode' });
    if (err.code === '23505') return res.status(409).json({ error: 'District name already exists' });
    console.error('[operatorDistricts:create]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
