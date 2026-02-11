const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { Resend } = require('resend');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET;
const VALID_ROLES = ['district_admin', 'school_admin', 'teacher', 'counselor', 'behavior_specialist', 'student_support_specialist', 'parent'];

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Resend email client
const resend = new Resend(process.env.RESEND_API_KEY);

// ============================================
// EXISTING ROUTES (unchanged)
// ============================================

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
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Google Sign-In. Please use the Google button to log in.' });
    }
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
      `SELECT u.id, u.email, u.full_name, u.role, u.tenant_id, t.name as tenant_name, u.school_wide_access
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

// ============================================
// NEW: GOOGLE SIGN-IN FOR STAFF
// ============================================

router.post('/google', async (req, res) => {
  try {
    const { credential, tenant_id } = req.body;
    
    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }
    
    // Verify the Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;
    
    // Check if user exists
    let result = await pool.query(
      `SELECT u.*, t.name as tenant_name 
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1`,
      [email]
    );
    
    let user;
    
    if (result.rows.length === 0) {
      // User doesn't exist - check if we should auto-create
      // For now, we only allow existing users to sign in with Google
      // Admins must first create the user account
      return res.status(401).json({ 
        error: 'No account found with this email. Please contact your administrator to create an account.' 
      });
    } else {
      user = result.rows[0];
      
      // Update google_id if not set
      if (!user.google_id) {
        await pool.query(
          'UPDATE users SET google_id = $1 WHERE id = $2',
          [googleId, user.id]
        );
      }
    }
    
    // Don't allow parents to use Google sign-in (they use email/password)
    if (user.role === 'parent') {
      return res.status(401).json({ 
        error: 'Parent accounts must use email and password to sign in.' 
      });
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
    console.error('Google auth error:', error);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

// ============================================
// NEW: ADMIN CREATES PARENT ACCOUNT
// ============================================

router.post('/create-parent', async (req, res) => {
  try {
    // Verify admin token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if user has permission to create parent accounts
    const adminCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [decoded.id]
    );
    
const allowedRoles = ['district_admin', 'school_admin', 'counselor', 'behavior_specialist', 'student_support_specialist'];
    if (!adminCheck.rows.length || !allowedRoles.includes(adminCheck.rows[0].role)) {
      return res.status(403).json({ error: 'You do not have permission to create parent accounts' });
    }
    
    const { email, full_name, student_ids } = req.body;
    
    if (!email || !full_name) {
      return res.status(400).json({ error: 'Email and full name are required' });
    }
    
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }
    
    // Generate password setup token (expires in 7 days)
    const setupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Create user without password (they'll set it via email link)
    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, full_name, role, password_reset_token, password_reset_expires) 
       VALUES ($1, $2, $3, 'parent', $4, $5) 
       RETURNING id, email, full_name, role`,
      [decoded.tenant_id, email, full_name, setupToken, setupTokenExpires]
    );
    
    const newUser = result.rows[0];
    
    // Link parent to students if provided
    if (student_ids && student_ids.length > 0) {
      for (const studentId of student_ids) {
        await pool.query(
          `INSERT INTO parent_student_links (parent_user_id, student_id, tenant_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [newUser.id, studentId, decoded.tenant_id]
        );
      }
    }
    
    // Send welcome email with password setup link
    const setupUrl = `${process.env.FRONTEND_URL}/set-password?token=${setupToken}`;
    
    try {
      await resend.emails.send({
        from: 'TierTrak <noreply@scholarpathsystems.org>',
        to: email,
        subject: 'Welcome to TierTrak - Set Up Your Account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">Welcome to TierTrak</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>Hello ${full_name},</p>
              <p>An account has been created for you to access your child's intervention progress in TierTrak.</p>
              <p>Please click the button below to set up your password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${setupUrl}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Set Up My Password</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">This link will expire in 7 days.</p>
              <p style="color: #6b7280; font-size: 14px;">If you didn't expect this email, please ignore it.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
              <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                TierTrak by ScholarPath Systems<br>
                FERPA Compliant • Student Data Protected
              </p>
            </div>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the request, but log the error
    }
    
    res.status(201).json({
      message: 'Parent account created. Setup email sent.',
      user: newUser
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }
    console.error('Create parent error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// NEW: PASSWORD RESET REQUEST
// ============================================

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Find user
    const result = await pool.query(
      'SELECT id, full_name, role FROM users WHERE email = $1',
      [email]
    );
    
    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
    }
    
    const user = result.rows[0];
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    // Save token to database
    await pool.query(
      'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [resetToken, resetExpires, user.id]
    );
    
    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    try {
      await resend.emails.send({
        from: 'TierTrak <noreply@scholarpathsystems.org>',
        to: email,
        subject: 'TierTrak - Password Reset Request',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">Password Reset</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>Hello ${user.full_name},</p>
              <p>We received a request to reset your TierTrak password.</p>
              <p>Click the button below to reset your password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset My Password</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">This link will expire in 1 hour.</p>
              <p style="color: #6b7280; font-size: 14px;">If you didn't request this, please ignore this email. Your password will not be changed.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
              <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                TierTrak by ScholarPath Systems<br>
                FERPA Compliant • Student Data Protected
              </p>
            </div>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
    }
    
    res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// ============================================
// NEW: SET/RESET PASSWORD (for both new accounts and resets)
// ============================================

router.post('/set-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Find user with valid token
    const result = await pool.query(
      `SELECT id, email, full_name FROM users 
       WHERE password_reset_token = $1 
       AND password_reset_expires > NOW()`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token. Please request a new password reset.' });
    }
    
    const user = result.rows[0];
    
    // Hash new password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    // Update password and clear token
    await pool.query(
      `UPDATE users 
       SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL 
       WHERE id = $2`,
      [password_hash, user.id]
    );
    
    res.json({ message: 'Password set successfully. You can now sign in.' });
    
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// ============================================
// NEW: VERIFY TOKEN (check if setup/reset token is valid)
// ============================================

router.get('/verify-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const result = await pool.query(
      `SELECT id, email, full_name FROM users 
       WHERE password_reset_token = $1 
       AND password_reset_expires > NOW()`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired token' });
    }
    
    res.json({ 
      valid: true, 
      email: result.rows[0].email,
      full_name: result.rows[0].full_name
    });
    
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ valid: false, error: 'An error occurred' });
  }
});

module.exports = router;