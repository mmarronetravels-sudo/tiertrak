const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Valid roles (universe of valid role strings — used for malformed-input
// 400 rejection).
const VALID_ROLES = ['district_admin', 'school_admin', 'district_tech_admin', 'teacher', 'counselor', 'interventionist', 'parent'];

// Per-creator-role rules: which roles each creator can produce. Dict
// is the single source of truth for both the caller-allowed gate
// (Object.keys) and the per-call role-rank check. Closes role-
// escalation gap from PR #129 triad re-review (security-reviewer
// HIGH-1).
const CREATE_USER_RULES = {
  district_admin: VALID_ROLES,
  school_admin: ['school_admin', 'counselor', 'teacher', 'interventionist', 'parent']
};

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// Per Followup #125 (per-school binding), POST handlers read an optional
// target_tenant_id from req.body:
//   - Absent → falls back to req.user.tenant_id (backwards-compat for
//     legacy single-tenant users whose JWT carries their only accessible
//     tenant).
//   - Present but not a positive integer → 400.
//   - Present, positive integer, but not in
//     resolveAccessibleTenantIds(req.user) → 403 (fires before any
//     INSERT; a body-explicit cross-tenant probe collapses to 403, not
//     400-FK).
//
// Pattern E shape mirrored from routes/student504.js. Module-local copy
// — banked as new followup chore/consolidate-target-tenant-helper
// alongside Followup #108.
async function resolveAndBindTargetTenant(req) {
  const bodyTarget = req.body ? req.body.target_tenant_id : undefined;
  if (bodyTarget === undefined || bodyTarget === null) {
    return { targetTenantId: req.user.tenant_id, error: null };
  }
  if (!isPositiveInt(bodyTarget)) {
    return { targetTenantId: null, error: { status: 400, body: { error: 'Invalid target_tenant_id' } } };
  }
  const accessible = await resolveAccessibleTenantIds(req.user);
  if (!accessible.includes(bodyTarget)) {
    return { targetTenantId: null, error: { status: 403, body: { error: 'Not authorized for target tenant' } } };
  }
  return { targetTenantId: bodyTarget, error: null };
}

// Get all users for a tenant
router.get('/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const result = await pool.query(
      `SELECT id, tenant_id, email, full_name, role, created_at, updated_at 
       FROM users 
       WHERE tenant_id = $1 
       ORDER BY full_name`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET staff members for assignment dropdown (excludes parents)
router.get('/staff', async (req, res) => {
  try {
    const { tenant_id } = req.query;
    
    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const result = await pool.query(`
      SELECT id, full_name as name, email, role
      FROM users 
      WHERE tenant_id = $1 AND role != 'parent'
      ORDER BY full_name
    `, [tenant_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET parents for a tenant (for parent assignment dropdown)
router.get('/parents', async (req, res) => {
  try {
    const { tenant_id } = req.query;
    
    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const result = await pool.query(`
      SELECT u.id, u.full_name as name, u.email,
        COALESCE(json_agg(
          json_build_object('student_id', psl.student_id, 'relationship', psl.relationship)
        ) FILTER (WHERE psl.id IS NOT NULL), '[]') as linked_students
      FROM users u
      LEFT JOIN parent_student_links psl ON u.id = psl.parent_user_id
      WHERE u.tenant_id = $1 AND u.role = 'parent'
      GROUP BY u.id
      ORDER BY u.full_name
    `, [tenant_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching parents:', error);
    res.status(500).json({ error: error.message });
  }
});
// Get users by role for a tenant
router.get('/tenant/:tenantId/role/:role', async (req, res) => {
  try {
    const { tenantId, role } = req.params;
    const result = await pool.query(
      `SELECT id, tenant_id, email, full_name, role, created_at, updated_at 
       FROM users 
       WHERE tenant_id = $1 AND role = $2
       ORDER BY full_name`,
      [tenantId, role]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single user by ID. Gated by requireAuth + caller-role gate
// (Object.keys(CREATE_USER_RULES)) + positive-int :id validation.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_USER_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const result = await pool.query(
      `SELECT id, tenant_id, email, full_name, role, created_at, updated_at 
       FROM users 
       WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new user. Gated by requireAuth + caller-role gate
// (Object.keys(CREATE_USER_RULES)) + role-validity (VALID_ROLES → 400
// on malformed) + role-rank gate (CREATE_USER_RULES[caller] → 403 on
// rank-rejection) + §5 target_tenant_id binding via
// resolveAndBindTargetTenant. district_id inherited from creator on
// district-scoped role INSERTs. Closes POST half of Followup #116 +
// role-escalation finding from PR #129 triad re-review. Password-
// required (non-SSO) identity model preserved — staff onboarding via
// Google SSO uses POST /api/staff; this surface remains the password-
// required path (parents, etc.).
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_USER_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { email, password, full_name, role } = req.body;
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Email, password, full name, and role are required' });
    }

    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`
      });
    }

    if (!CREATE_USER_RULES[req.user.role].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { targetTenantId, error: bindError } = await resolveAndBindTargetTenant(req);
    if (bindError) {
      return res.status(bindError.status).json(bindError.body);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // district_id binding: district-scoped roles inherit creator's
    // district_id. The role-rank gate above ensures only district_admin
    // (which has non-null district_id) can reach this path with role IN
    // district-scoped roles, so districtId is non-null when needed.
    const districtId = ['district_admin', 'district_tech_admin'].includes(role) ? req.user.district_id : null;

    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, district_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, email, full_name, role, created_at`,
      [targetTenantId, email, hashedPassword, full_name, role, districtId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A user with this email already exists for this tenant' });
    }
    console.error('[users.js POST] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a user. Gated by requireAuth + caller-role gate
// (Object.keys(CREATE_USER_RULES)) + positive-int :id validation.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!Object.keys(CREATE_USER_RULES).includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { email, full_name, role } = req.body;
    
    // Validate role if provided
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ 
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` 
      });
    }
    
    const result = await pool.query(
      `UPDATE users 
       SET email = $1, full_name = $2, role = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 
       RETURNING id, tenant_id, email, full_name, role, updated_at`,
      [email, full_name, role, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a user. Gated by requireAuth + role authz + §5 helper-consumed
// scope check. Cascade to user_school_access via M028 ON DELETE CASCADE
// is captured by M031's user_school_access_audit_after_delete trigger.
// Followup #118: SELECT + DELETE run in an explicit transaction so a
// transaction-local set_config('app.actor_user_id', ...) propagates into
// M032's trigger body for cascade-row actor capture.
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
      console.error('[users:delete]', 'invalid req.user.id from JWT');
      return res.status(500).json({ error: 'Server error' });
    }

    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );

    const target = await client.query(
      'SELECT id, tenant_id FROM users WHERE id = $1',
      [id]
    );
    if (target.rows.length === 0) {
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
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[users:delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Get all teachers for a tenant (convenience route for dropdowns)
router.get('/tenant/:tenantId/teachers', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const result = await pool.query(
      `SELECT id, full_name 
       FROM users 
       WHERE tenant_id = $1 AND role = 'teacher'
       ORDER BY full_name`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
