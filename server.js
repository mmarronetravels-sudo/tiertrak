const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Import routes
const tenantsRoutes = require('./routes/tenants');
const studentsRoutes = require('./routes/students');
const interventionsRoutes = require('./routes/interventions');
const progressNotesRoutes = require('./routes/progressNotes');
const usersRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const interventionLogsRoutes = require('./routes/interventionLogs');
const prereferralFormsRoutes = require('./routes/prereferralForms');
const csvImportRoutes = require('./routes/csvImport');
const weeklyProgressRoutes = require('./routes/weeklyProgress');

// Use routes
app.use('/api/tenants', tenantsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/interventions', interventionsRoutes);
app.use('/api/progress-notes', progressNotesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/intervention-logs', interventionLogsRoutes);
app.use('/api/prereferral-forms', prereferralFormsRoutes);
app.use('/api/csv', csvImportRoutes);
app.use('/api/weekly-progress', weeklyProgressRoutes);

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to TierTrak API!' });
});

// Test database connection
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'healthy',
      database: 'connected',
      time: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`TierTrak server running at http://localhost:${PORT}`);
});