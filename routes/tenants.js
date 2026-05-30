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
// reach these handlers.
router.use(requireAuth, platformAdminOnly);

function parseTenantId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid tenant id' });
    return null;
  }
  return id;
}

// Get all tenants
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tenants ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('[tenants:list]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get a single tenant by ID
router.get('/:id', async (req, res) => {
  const id = parseTenantId(req, res);
  if (id === null) return;
  try {
    const result = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[tenants:get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new tenant.
//
// Wrapped in a single BEGIN/COMMIT so that the tenant row, the starter
// intervention-bank seed, and the discipline-vocabulary seed all commit
// or all roll back together. The intervention-bank seed pre-dates this
// transaction wrapper — previously a bank-insert failure would leave
// the tenant row committed without its starter bank. Folding it into
// the same transaction as the new vocab seed closes that latent gap.
router.post('/', async (req, res) => {
  const { name, type, subdomain, settings } = req.body || {};
  if (!name || !type || !subdomain) {
    return res.status(400).json({ error: 'name, type, subdomain are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO tenants (name, type, subdomain, settings)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, type, subdomain, settings || {}]
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
    // tenants.type CHECK (M029) restricts type to 'school', so every
    // tenant that reaches this point is a school-tenant and warrants
    // the seed; no extra filter required.
    await seedDisciplineVocabsForTenant(client, newTenant.id);

    await client.query('COMMIT');
    res.status(201).json(newTenant);
  } catch (err) {
    // Swallow ROLLBACK errors so a dead connection during rollback can't
    // mask the original error, skip the 23514/23505 redirects, or fall
    // through to Express's default error handler. The finally block
    // releases the client regardless.
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid tenant type' });
    if (err.code === '23505') return res.status(409).json({ error: 'Subdomain already in use' });
    console.error('[tenants:create]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Update a tenant
router.put('/:id', async (req, res) => {
  const id = parseTenantId(req, res);
  if (id === null) return;
  const { name, type, subdomain, settings } = req.body || {};
  if (!name || !type || !subdomain) {
    return res.status(400).json({ error: 'name, type, subdomain are required' });
  }
  try {
    const result = await pool.query(
      `UPDATE tenants
       SET name = $1, type = $2, subdomain = $3, settings = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [name, type, subdomain, settings, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid tenant type' });
    if (err.code === '23505') return res.status(409).json({ error: 'Subdomain already in use' });
    console.error('[tenants:update]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a tenant
router.delete('/:id', async (req, res) => {
  const id = parseTenantId(req, res);
  if (id === null) return;
  try {
    const result = await pool.query(
      'DELETE FROM tenants WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json({ message: 'Tenant deleted successfully' });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Tenant has dependent records' });
    console.error('[tenants:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
