const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// Staff roles (not parent)
const STAFF_ROLES = [
  'school_admin',
  'counselor',
  'teacher',
  'interventionist'
];

// GET /api/staff/:tenantId - List all staff for a tenant
router.get('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const result = await pool.query(
      `SELECT id, email, full_name, role, school_wide_access, google_id,
              created_at
       FROM users 
       WHERE tenant_id = $1 AND role != 'parent'
       ORDER BY 
         CASE role
           WHEN 'district_admin' THEN 1
           WHEN 'district_tech_admin' THEN 2
           WHEN 'school_admin' THEN 3
           WHEN 'counselor' THEN 4
           WHEN 'interventionist' THEN 5
           WHEN 'teacher' THEN 6
         END,
         full_name ASC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/staff - Create a new staff member
router.post('/', async (req, res) => {
  try {
    const { email, full_name, role, tenant_id } = req.body;

    if (!email || !full_name || !role || !tenant_id) {
      return res.status(400).json({ error: 'Email, full name, role, and tenant are required' });
    }

    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Set school_wide_access based on role
    const schoolWideAccess = ['school_admin', 'district_admin', 'counselor', 'interventionist'].includes(role);

    // Insert without password — they'll use Google SSO
    const result = await pool.query(
      `INSERT INTO users (email, full_name, role, tenant_id, school_wide_access)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role, school_wide_access, created_at`,
      [email.toLowerCase().trim(), full_name.trim(), role, tenant_id, schoolWideAccess]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating staff:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/staff/:id - Update a staff member's role or name
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, role } = req.body;

    if (role && !STAFF_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    // Recalculate school_wide_access if role changed
    const schoolWideAccess = role 
      ? ['school_admin', 'district_admin', 'counselor', 'interventionist'].includes(role)
      : undefined;

    const result = await pool.query(
      `UPDATE users 
       SET full_name = COALESCE($1, full_name),
           role = COALESCE($2, role),
           school_wide_access = COALESCE($3, school_wide_access)
       WHERE id = $4
       RETURNING id, email, full_name, role, school_wide_access`,
      [full_name || null, role || null, schoolWideAccess, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating staff:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/staff/:id - Remove a staff member. Gated by requireAuth +
// role authz + §5 helper-consumed scope check. Parents are not staff
// (404 'Not found' on this route); they are deletable via /api/users/:id.
// Cascade to user_school_access via M028 ON DELETE CASCADE is captured by
// M031's trigger. Followup #118: SELECT + DELETE run in an explicit
// transaction so a transaction-local set_config('app.actor_user_id', ...)
// propagates into M032's trigger body for cascade-row actor capture.
router.delete('/:id', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (id === req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const ADMIN_DELETE_ROLES = ['district_admin', 'school_admin'];
    if (!ADMIN_DELETE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const actorId = Number(req.user.id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      console.error('[staff:delete]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );

    const target = await client.query(
      'SELECT id, tenant_id, role FROM users WHERE id = $1',
      [id]
    );
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (target.rows[0].role === 'parent') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(target.rows[0].tenant_id)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await client.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json({ message: 'Staff member removed' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[staff:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.initializePool = initializePool;
module.exports = router;
