const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { platformAdminOnly } = require('../middleware/platformAdminOnly');
const { seedDisciplineVocabsForTenant } = require('../data/discipline-vocab-seeds');
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

function parseDistrictId(req, res) {
  const id = Number(req.params.districtId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid district id' });
    return null;
  }
  return id;
}

// Create a new school-tenant under an existing district.
//
// v1 scope: net-new schools only. The only write is the INSERT below —
// there is deliberately NO `UPDATE tenants SET district_id`, so an
// existing standalone tenant can never be re-parented into a district.
//
// district_id is taken EXCLUSIVELY from the URL path (never the body),
// so a body-supplied district_id is structurally ignored. type is
// hard-coded to 'school' (the M029 CHECK is `type = 'school'`).
//
// Body: { name, subdomain }
//   - name: required, trimmed, non-empty.
//   - subdomain: required, trimmed + lowercased, must match ^[a-z0-9-]+$.
//     tenants.subdomain is globally UNIQUE (not district-scoped), so a
//     collision with any other tenant's subdomain 23505s.
//
// Wrapped in a single BEGIN/COMMIT so the tenant row, the starter
// intervention-bank seed, and the discipline-vocabulary seed all commit
// or all roll back together — no half-provisioned school is left behind.
// Mirrors the seed-in-transaction pattern of POST /api/tenants.
router.post('/:districtId/schools', async (req, res) => {
  const districtId = parseDistrictId(req, res);
  if (districtId === null) return;

  const { name, subdomain } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name is required' });
  }
  const normalizedSubdomain =
    typeof subdomain === 'string' ? subdomain.trim().toLowerCase() : '';
  if (!normalizedSubdomain || !/^[a-z0-9-]+$/.test(normalizedSubdomain)) {
    return res.status(400).json({
      error: 'subdomain is required and may contain only a-z, 0-9, and hyphens'
    });
  }

  const client = await pool.connect();
  try {
    // District-exists pre-flight: clean 404 instead of a downstream FK
    // (23503) error if the path points at a non-existent district.
    const district = await client.query(
      'SELECT 1 FROM districts WHERE id = $1 LIMIT 1',
      [districtId]
    );
    if (district.rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    // Subdomain-taken pre-flight: best-effort only. A concurrent insert
    // could race between this SELECT and the INSERT below — the 23505
    // catch is the real uniqueness guarantee.
    const taken = await client.query(
      'SELECT 1 FROM tenants WHERE subdomain = $1 LIMIT 1',
      [normalizedSubdomain]
    );
    if (taken.rows.length > 0) {
      return res.status(409).json({ error: 'Subdomain already in use' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO tenants (name, type, subdomain, district_id)
       VALUES ($1, 'school', $2, $3)
       RETURNING id, name, type, subdomain, district_id, created_at, updated_at`,
      [trimmedName, normalizedSubdomain, districtId]
    );
    const newTenant = result.rows[0];

    // Auto-seed starter interventions from the bank.
    const starterResult = await client.query(
      'SELECT id FROM intervention_templates WHERE tenant_id IS NULL AND is_starter = TRUE'
    );
    const starterIds = starterResult.rows.map((r) => r.id);
    if (starterIds.length > 0) {
      await client.query(
        `INSERT INTO tenant_intervention_bank (tenant_id, template_id)
         SELECT $1, unnest($2::int[])
         ON CONFLICT DO NOTHING`,
        [newTenant.id, starterIds]
      );
    }

    // Auto-seed discipline-referral default vocabularies (per M036).
    await seedDisciplineVocabsForTenant(client, newTenant.id);

    await client.query('COMMIT');
    res.status(201).json(newTenant);
  } catch (err) {
    // Swallow ROLLBACK errors so a dead connection during rollback can't
    // mask the original error. The finally block releases the client.
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid tenant type' });
    if (err.code === '23505') return res.status(409).json({ error: 'Subdomain already in use' });
    console.error('[operatorDistricts:createSchool]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
