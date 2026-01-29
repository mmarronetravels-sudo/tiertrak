const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET;
const VALID_ROLES = ['district_admin', 'school_admin', 'teacher', 'counselor', 'behavior_specialist'];

// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { tenant_id, email, password, full_name, role } = req.body;
    
    // Validate required fields
    if (!tenant_id || !email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ 
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` 
      });
    }
    
    // Hash the password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    // Insert the user
    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, tenant_id, email, full_name, role, created_at`,
      [tenant_id, email, password_hash, full_name, role]
    );
    
    res.status(201).json({ 
      message: 'User registered successfully',
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find the user
    const result = await pool.query(
      `SELECT u.*, t.name as tenant_name 
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1`,
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Create token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        tenant_id: user.tenant_id
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        tenant_id: user.tenant_id,
        tenant_name: user.tenant_name,
        school_wide_access: user.school_wide_access
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
} catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user info (requires token)

// Get current user info (requires token)
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.tenant_id, t.name as tenant_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1`,
      [decoded.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
