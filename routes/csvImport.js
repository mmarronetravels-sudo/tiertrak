const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

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

// ============================================================
// Tenant-binding doctrine (POST handlers in this file)
//
// Per Followup #125 (per-school binding), POST handlers compute the
// target tenant via resolveAndBindTargetTenant(req):
//   - Optional req.body.target_tenant_id (positive integer).
//   - Absent → falls back to req.user.tenant_id (backwards-compat
//     for the current single-tenant users whose JWT carries their
//     only accessible tenant).
//   - Present → validated against resolveAccessibleTenantIds(req.user);
//     not-in-set returns 403 before any INSERT, so a body-explicit
//     cross-tenant probe collapses to 403, not 400-FK.
//
// Supersedes the day-one rule "Routes NEVER read req.body.tenant_id"
// (master-index Followup 67) for the multi-school case only. The
// rule remains in force for any field NOT named target_tenant_id.
// The two GET handlers in this file (/template and /template/download)
// return tenant-agnostic static content and do not derive tenant
// scope; the GET-handler scope-derivation rule applies in other
// files in this codebase that DO read tenant-scoped data.
//
// Scope in THIS file:
//   - POST /students/:tenantId (CSV bulk-import) — in scope.
//     Binding is PER-REQUEST, not per-row inside the bulk-INSERT
//     loop: one resolved target_tenant_id governs every row in the
//     uploaded CSV. Multer populates req.body.target_tenant_id from
//     the multipart/form-data alongside the file field.
//   - URL :tenantId param is VESTIGIAL under per-school binding.
//     Pre-PR it was consumed by requireMatchingTenant (retired in
//     PR-S3-D-3 / 1b). Post-retirement the URL param is silently
//     accepted but does not govern the binding; the contract has
//     moved to req.body.target_tenant_id (with JWT fallback).
//     Route shape preserved for FE-contract stability per Cowork
//     decision; route-cleanup deferred to a future chore PR.
//
// Helper is duplicated module-local per Followup #132 (consolidation
// deferred to a chore PR post-PR-S3-D-4).
// ============================================================

// Valid options for validation
const VALID_TIERS = [1, 2, 3];
const VALID_AREAS = ['Academic', 'Behavior', 'Social-Emotional', ''];
const VALID_RISK_LEVELS = ['low', 'moderate', 'high'];

const blockParentRole = (req, res, next) => {
  if (req.user.role === 'parent') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  next();
};

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

/**
 * Resolve and validate the target tenant for a POST write handler.
 *
 * Per Followup #125 (per-school binding), POST handlers read an optional
 * target_tenant_id from req.body:
 *   - Absent → falls back to req.user.tenant_id (backwards-compat for
 *     the current single-tenant users whose JWT carries their only
 *     accessible tenant).
 *   - Present but not a positive integer → 400.
 *   - Present, positive integer, but not in
 *     resolveAccessibleTenantIds(req.user) → 403 (fires before any
 *     INSERT; a body-explicit cross-tenant probe collapses to 403,
 *     not 400-FK).
 *
 * Supersedes the day-one rule "Routes NEVER read req.body.tenant_id"
 * (master-index Followup 67) for the multi-school case only.
 *
 * @param {object} req - Express request. requireAuth must have already
 *   populated req.user; req.body may carry an optional target_tenant_id.
 * @returns {Promise<{targetTenantId: number|null, error: {status: number, body: object}|null}>}
 *   On success: { targetTenantId: <int>, error: null }.
 *   On failure: { targetTenantId: null, error: { status, body } } —
 *   caller should respond res.status(error.status).json(error.body).
 */
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

// Get CSV template info
router.get('/template', requireAuth, (req, res) => {
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
router.get('/template/download', requireAuth, (req, res) => {
  const csvContent = 'first_name,last_name,grade,tier,area,risk_level\nJohn,Smith,3rd,1,Academic,low\nJane,Doe,5th,2,Behavior,moderate';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=student_import_template.csv');
  res.send(csvContent);
});

// Import students from CSV
router.post('/students/:tenantId', requireAuth, blockParentRole, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { targetTenantId: tenantId, error: bindError } = await resolveAndBindTargetTenant(req);
  if (bindError) {
    fs.unlink(req.file.path, () => {});
    return res.status(bindError.status).json(bindError.body);
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