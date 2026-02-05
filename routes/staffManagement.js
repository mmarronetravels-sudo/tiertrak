const express = require('express');
const router = express.Router();

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// Staff roles (not parent)
const STAFF_ROLES = [
  'school_admin',
  'counselor', 
  'teacher',
  'behavior_specialist',
  'student_support_specialist'
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
           WHEN 'school_admin' THEN 2
           WHEN 'counselor' THEN 3
           WHEN 'behavior_specialist' THEN 4
           WHEN 'student_support_specialist' THEN 5
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
    const schoolWideAccess = ['school_admin', 'district_admin', 'counselor', 'behavior_specialist', 'student_support_specialist'].includes(role);

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
      ? ['school_admin', 'district_admin', 'counselor', 'behavior_specialist', 'student_support_specialist'].includes(role)
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

// DELETE /api/staff/:id - Remove a staff member
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Don't allow deleting yourself
    // (the calling user's ID would need to be passed or decoded from token)
    
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 AND role != $2 RETURNING id, email, full_name',
      [id, 'parent']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    res.json({ message: 'Staff member removed', user: result.rows[0] });
  } catch (error) {
    console.error('Error deleting staff:', error);
    res.status(500).json({ error: error.message });
  }
});

router.initializePool = initializePool;
module.exports = router;
