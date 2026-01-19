const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Get all tenants
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tenants ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single tenant by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM tenants WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new tenant
router.post('/', async (req, res) => {
  try {
    const { name, type, subdomain, settings } = req.body;
    const result = await pool.query(
      `INSERT INTO tenants (name, type, subdomain, settings) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [name, type, subdomain, settings || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a tenant
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, subdomain, settings } = req.body;
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a tenant
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM tenants WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json({ message: 'Tenant deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;