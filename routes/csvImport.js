const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Valid options for validation
const VALID_TIERS = [1, 2, 3];
const VALID_AREAS = ['Academic', 'Behavior', 'Social-Emotional', ''];
const VALID_RISK_LEVELS = ['low', 'moderate', 'high'];

// Get CSV template info
router.get('/template', (req, res) => {
  res.json({
    columns: ['first_name', 'last_name', 'grade', 'tier', 'area', 'risk_level'],
    required: ['first_name', 'last_name', 'grade'],
    optional: ['tier', 'area', 'risk_level'],
    defaults: {
      tier: 1,
      area: null,
      risk_level: 'low'
    },
    validValues: {
      tier: [1, 2, 3],
      area: ['Academic', 'Behavior', 'Social-Emotional'],
      risk_level: ['low', 'moderate', 'high']
    },
    exampleRows: [
      { first_name: 'John', last_name: 'Smith', grade: '3rd', tier: 1, area: 'Academic', risk_level: 'low' },
      { first_name: 'Jane', last_name: 'Doe', grade: '5th', tier: 2, area: 'Behavior', risk_level: 'moderate' }
    ]
  });
});

// Download CSV template
router.get('/template/download', (req, res) => {
  const csvContent = 'first_name,last_name,grade,tier,area,risk_level\nJohn,Smith,3rd,1,Academic,low\nJane,Doe,5th,2,Behavior,moderate';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=student_import_template.csv');
  res.send(csvContent);
});

// Import students from CSV
router.post('/students/:tenantId', upload.single('file'), async (req, res) => {
  const { tenantId } = req.params;
  
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const results = [];
  const errors = [];
  let rowNumber = 1; // Start at 1 for header

  try {
    // Parse CSV file
    const parsePromise = new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          rowNumber++;
          
          // Normalize column names (trim whitespace, lowercase)
          const normalizedRow = {};
          Object.keys(row).forEach(key => {
            normalizedRow[key.trim().toLowerCase().replace(/\s+/g, '_')] = row[key]?.trim();
          });

          // Validate required fields
          if (!normalizedRow.first_name || !normalizedRow.last_name || !normalizedRow.grade) {
            errors.push({
              row: rowNumber,
              data: normalizedRow,
              error: 'Missing required fields (first_name, last_name, grade)'
            });
            return;
          }

          // Parse and validate tier
          let tier = 1;
          if (normalizedRow.tier) {
            tier = parseInt(normalizedRow.tier);
            if (!VALID_TIERS.includes(tier)) {
              errors.push({
                row: rowNumber,
                data: normalizedRow,
                error: `Invalid tier "${normalizedRow.tier}". Must be 1, 2, or 3`
              });
              return;
            }
          }

          // Validate area
          let area = null;
          if (normalizedRow.area) {
            // Try to match case-insensitively
            const areaLower = normalizedRow.area.toLowerCase();
            if (areaLower === 'academic') area = 'Academic';
            else if (areaLower === 'behavior') area = 'Behavior';
            else if (areaLower === 'social-emotional' || areaLower === 'social emotional' || areaLower === 'socialemotional') area = 'Social-Emotional';
            else if (normalizedRow.area !== '') {
              errors.push({
                row: rowNumber,
                data: normalizedRow,
                error: `Invalid area "${normalizedRow.area}". Must be Academic, Behavior, or Social-Emotional`
              });
              return;
            }
          }

          // Validate risk level
          let riskLevel = 'low';
          if (normalizedRow.risk_level) {
            riskLevel = normalizedRow.risk_level.toLowerCase();
            if (!VALID_RISK_LEVELS.includes(riskLevel)) {
              errors.push({
                row: rowNumber,
                data: normalizedRow,
                error: `Invalid risk_level "${normalizedRow.risk_level}". Must be low, moderate, or high`
              });
              return;
            }
          }

          results.push({
            row: rowNumber,
            first_name: normalizedRow.first_name,
            last_name: normalizedRow.last_name,
            grade: normalizedRow.grade,
            tier: tier,
            area: area,
            risk_level: riskLevel
          });
        })
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });

    await parsePromise;

    // Insert valid students into database
    const inserted = [];
    const insertErrors = [];

    for (const student of results) {
      try {
        const result = await pool.query(
          `INSERT INTO students (tenant_id, first_name, last_name, grade, tier, area, risk_level)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [tenantId, student.first_name, student.last_name, student.grade, student.tier, student.area, student.risk_level]
        );
        inserted.push({
          row: student.row,
          student: result.rows[0]
        });
      } catch (dbError) {
        insertErrors.push({
          row: student.row,
          data: student,
          error: dbError.message
        });
      }
    }

    // Clean up uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting temp file:', err);
    });

    res.json({
      success: true,
      summary: {
        totalRows: rowNumber - 1, // Subtract header row
        imported: inserted.length,
        validationErrors: errors.length,
        insertErrors: insertErrors.length
      },
      imported: inserted.map(i => ({
        row: i.row,
        name: `${i.student.first_name} ${i.student.last_name}`,
        id: i.student.id
      })),
      errors: [...errors, ...insertErrors]
    });

  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;