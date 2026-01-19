const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Valid roles
const VALID_ROLES = ['district_admin', 'school_admin', 'teacher', 'counselor', 'behavior_specialist'];

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

// Get a single user by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
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

// Create a new user
router.post('/', async (req, res) => {
  try {
    const { tenant_id, email, password, full_name, role } = req.body;
    
    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ 
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` 
      });
    }
    
    // For now, store password as plain text (we'll add proper hashing in authentication step)
    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, tenant_id, email, full_name, role, created_at`,
      [tenant_id, email, password, full_name, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A user with this email already exists for this tenant' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update a user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
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

// Delete a user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
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