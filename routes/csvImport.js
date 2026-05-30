const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');
require('dotenv').config();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { STAFF_ROLES, CREATE_STAFF_RULES } = require('./staffManagement');
const { ELEVATED_ROLES } = require('../constants/roles');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const resend = new Resend(process.env.RESEND_API_KEY);

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

const blockNonStaffCreator = (req, res, next) => {
  if (!Object.keys(CREATE_STAFF_RULES).includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
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
    columns: ['first_name', 'last_name', 'grade', 'external_id', 'tier', 'area', 'risk_level'],
    required: ['first_name', 'last_name', 'grade'],
    optional: ['external_id', 'tier', 'area', 'risk_level'],
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
    helpText: {
      grade: "Required. Free text — any non-empty value is accepted and stored as-is; there is no format check. Follow the convention shown in the example rows (ordinal labels like '3rd' and '5th', and 'K'/'Pre-K' for early grades); downstream sorting and display depend on that convention, not on validation.",
      external_id: "Optional. The student's SIS-issued ID (PowerSchool, Skyward, Infinite Campus, Aeries, etc.), stored verbatim as text. Blank coerces to null, and multiple blank rows are allowed. Must be unique within this school/tenant — a value repeated within the upload is rejected before insert with both row numbers surfaced, and a value already used by another student here is rejected as 'A student with this external_id already exists in this school.' Different tenants may legitimately reuse the same external_id."
    },
    exampleRows: [
      { first_name: 'John', last_name: 'Smith', grade: '3rd', external_id: 'STU-12345', tier: 1, area: 'Academic', risk_level: 'low' },
      { first_name: 'Jane', last_name: 'Doe', grade: '5th', external_id: 'STU-67890', tier: 2, area: 'Behavior', risk_level: 'moderate' }
    ]
  });
});

// Download CSV template
router.get('/template/download', requireAuth, (req, res) => {
  const csvContent = 'first_name,last_name,grade,external_id,tier,area,risk_level\nJohn,Smith,3rd,STU-12345,1,Academic,low\nJane,Doe,5th,STU-67890,2,Behavior,moderate';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=student_import_template.csv');
  res.send(csvContent);
});

// Get staff CSV template info
router.get('/staff/template', requireAuth, (req, res) => {
  res.json({
    columns: ['email', 'full_name', 'role', 'school_wide_access'],
    required: ['email', 'full_name', 'role'],
    optional: ['school_wide_access'],
    defaults: {},
    validValues: {
      role: STAFF_ROLES,
      school_wide_access: [true, false]
    },
    helpText: {
      school_wide_access: 'TRUE for district_admin, district_tech_admin, school_admin, counselor, interventionist. FALSE for teacher. If omitted, derived from role automatically. Setting TRUE on a teacher row or FALSE on an elevated-role row will be rejected as inconsistent with the role.'
    },
    exampleRows: [
      { email: 'jane.smith@example.edu', full_name: 'Jane Smith', role: 'teacher', school_wide_access: false },
      { email: 'alex.lee@example.edu', full_name: 'Alex Lee', role: 'counselor', school_wide_access: true }
    ]
  });
});

// Download staff CSV template
router.get('/staff/template/download', requireAuth, (req, res) => {
  const csvContent = 'email,full_name,role,school_wide_access\njane.smith@example.edu,Jane Smith,teacher,FALSE\nalex.lee@example.edu,Alex Lee,counselor,TRUE';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=staff_import_template.csv');
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
  const insertErrors = [];
  // Within-upload dedup tracker: external_id value → first-occurrence row number.
  // Used to reject a second row that re-claims a non-null external_id before any
  // INSERT runs (mirrors scripts/seed-tenant-sandbox-template.js:288-315 shape).
  const externalIdFirstRow = new Map();
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

          // external_id is optional, free-form text (no enum). Normalize step
          // already trimmed the value; empty-after-trim coerces to null. A
          // non-null value that re-appears within this upload is rejected
          // pre-INSERT with both row numbers surfaced so the operator can
          // correct the source.
          const externalId = normalizedRow.external_id || null;
          if (externalId !== null) {
            if (externalIdFirstRow.has(externalId)) {
              const firstRow = externalIdFirstRow.get(externalId);
              insertErrors.push({
                row: rowNumber,
                data: { external_id: externalId },
                error: `Row ${rowNumber}: duplicate external_id '${externalId}' (also appears in row ${firstRow})`
              });
              return;
            }
            externalIdFirstRow.set(externalId, rowNumber);
          }

          results.push({
            row: rowNumber,
            first_name: normalizedRow.first_name,
            last_name: normalizedRow.last_name,
            grade: normalizedRow.grade,
            tier: tier,
            area: area,
            risk_level: riskLevel,
            external_id: externalId
          });
        })
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });

    await parsePromise;

    // Insert valid students into database
    const inserted = [];

    for (const student of results) {
      try {
        const result = await pool.query(
          `INSERT INTO students (tenant_id, first_name, last_name, grade, tier, area, risk_level, external_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [tenantId, student.first_name, student.last_name, student.grade, student.tier, student.area, student.risk_level, student.external_id]
        );
        inserted.push({
          row: student.row,
          student: result.rows[0]
        });
      } catch (dbError) {
        // Translate the partial UNIQUE index from Migration 035 into a clean
        // operator-facing message. Same text as POST/PUT 409 path in
        // routes/students.js. Scoped STRICTLY to this constraint — broader
        // pg-error-code translation is deferred to fix/api-dberror-translation.
        const errorMessage = (dbError.code === '23505' && dbError.constraint === 'idx_students_tenant_external_id')
          ? 'A student with this external_id already exists in this school.'
          : dbError.message;
        insertErrors.push({
          row: student.row,
          data: student,
          error: errorMessage
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

// POST /staff/:tenantId — bulk import staff from CSV.
// Gate stack mirrors single-create POST at staffManagement.js: caller-role
// gate (router-level) → required-field/role-validity/role-rank/SWA gates →
// within-upload dedup → per-tenant email pre-check → INSERT → 23505 strict-
// equality on users_tenant_id_email_key. district_id derived from
// req.user.district_id, NEVER read from CSV (§5). Token + 7-day expires
// mirror routes/auth.js:338-339. password_hash omitted; google_id explicit
// NULL strengthens the parent-creation precedent which omits it.
router.post('/staff/:tenantId', requireAuth, blockNonStaffCreator, upload.single('file'), async (req, res) => {
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
  const insertErrors = [];
  // Within-upload dedup tracker: email → first-occurrence row number.
  // Narrowed data shape per §4B doctrine cited at App.jsx:5749-5751.
  const emailFirstRow = new Map();
  let rowNumber = 1; // Start at 1 for header

  try {
    const parsePromise = new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          rowNumber++;

          const normalizedRow = {};
          Object.keys(row).forEach(key => {
            normalizedRow[key.trim().toLowerCase().replace(/\s+/g, '_')] = row[key]?.trim();
          });

          if (!normalizedRow.email || !normalizedRow.full_name || !normalizedRow.role) {
            errors.push({
              row: rowNumber,
              data: normalizedRow,
              error: 'Missing required fields (email, full_name, role).'
            });
            return;
          }

          if (!STAFF_ROLES.includes(normalizedRow.role)) {
            errors.push({
              row: rowNumber,
              data: normalizedRow,
              error: `Invalid role "${normalizedRow.role}". Must be one of: ${STAFF_ROLES.join(', ')}.`
            });
            return;
          }

          if (!CREATE_STAFF_RULES[req.user.role].includes(normalizedRow.role)) {
            errors.push({
              row: rowNumber,
              data: normalizedRow,
              error: `Role "${normalizedRow.role}" cannot be created by ${req.user.role}.`
            });
            return;
          }

          // school_wide_access consistency guard. Only fires if the column
          // was provided non-empty; omitted/empty falls through to derivation.
          const expectedSwa = ELEVATED_ROLES.includes(normalizedRow.role);
          if (normalizedRow.school_wide_access) {
            const upper = normalizedRow.school_wide_access.toUpperCase();
            if (upper !== 'TRUE' && upper !== 'FALSE') {
              errors.push({
                row: rowNumber,
                data: normalizedRow,
                error: `Invalid school_wide_access "${normalizedRow.school_wide_access}". Must be TRUE or FALSE.`
              });
              return;
            }
            const providedSwa = upper === 'TRUE';
            if (providedSwa !== expectedSwa) {
              errors.push({
                row: rowNumber,
                data: normalizedRow,
                error: `Role "${normalizedRow.role}" requires school_wide_access=${expectedSwa ? 'TRUE' : 'FALSE'} (provided ${upper}).`
              });
              return;
            }
          }
          const schoolWideAccess = expectedSwa;

          // Within-upload dedup on email. SHAPE B — narrowed data.
          const emailLower = normalizedRow.email.toLowerCase();
          if (emailFirstRow.has(emailLower)) {
            const firstRow = emailFirstRow.get(emailLower);
            insertErrors.push({
              row: rowNumber,
              data: { email: normalizedRow.email },
              error: `Row ${rowNumber}: duplicate email '${normalizedRow.email}' (also appears in row ${firstRow})`
            });
            return;
          }
          emailFirstRow.set(emailLower, rowNumber);

          // district_id derivation — NEVER read from CSV. Derived from
          // req.user.district_id only for district-scoped roles per §5.
          const districtId = ['district_admin', 'district_tech_admin'].includes(normalizedRow.role)
            ? req.user.district_id
            : null;

          results.push({
            row: rowNumber,
            email: emailLower,
            full_name: normalizedRow.full_name,
            role: normalizedRow.role,
            school_wide_access: schoolWideAccess,
            district_id: districtId
          });
        })
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });

    await parsePromise;

    // 100-row cap. Fires AFTER parse, BEFORE any DB write.
    if (rowNumber - 1 > 100) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Staff CSV upload limited to 100 rows. Split larger uploads into multiple files.' });
    }

    const inserted = [];

    for (const staff of results) {
      // Per-tenant email-existence pre-check. Closes the cross-tenant
      // email-enumeration oracle (PR #129 doctrine). Race with concurrent
      // single-create POST is caught by the 23505 catch below.
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
        [staff.email, tenantId]
      );
      if (existing.rows.length > 0) {
        insertErrors.push({
          row: staff.row,
          data: staff,
          error: 'A user with this email already exists at this school.'
        });
        continue;
      }

      // Token + 7-day expires mirror routes/auth.js:338-339 verbatim.
      const setupToken = crypto.randomBytes(32).toString('hex');
      const setupTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      try {
        const result = await pool.query(
          `INSERT INTO users (tenant_id, email, full_name, role, school_wide_access, district_id, password_reset_token, password_reset_expires, google_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
           RETURNING id, email, full_name, role, school_wide_access`,
          [tenantId, staff.email, staff.full_name, staff.role, staff.school_wide_access, staff.district_id, setupToken, setupTokenExpires]
        );
        inserted.push({
          row: staff.row,
          user: result.rows[0],
          setupToken
        });
      } catch (dbError) {
        // 23505 strict-equality on users_tenant_id_email_key keeps the
        // translated message. All other pg errors redact to a generic
        // operator-facing string; code + constraint are logged
        // server-side only — pg messages can echo column values and
        // would surface row context to the FE.
        let errorMessage;
        if (dbError.code === '23505' && dbError.constraint === 'users_tenant_id_email_key') {
          errorMessage = 'A user with this email already exists at this school.';
        } else {
          errorMessage = 'Failed to create user';
          console.error('[csv:staff-import] insert error code:', dbError.code, 'constraint:', dbError.constraint);
        }
        insertErrors.push({
          row: staff.row,
          data: staff,
          error: errorMessage
        });
      }
    }

    // Send setup-link email per successfully-inserted staff row. Per the
    // c.3 design: keep sending on per-row failure, no rate-limit-aware
    // abort (banked as chore/csv-import-resend-rate-limit-aware-abort).
    // Mirrors the parent-creation Resend pattern at routes/auth.js:364-400.
    // Sanitization: err.message → first line → 200-char cap. Full SDK
    // error object is never serialized into emailErrors or logs.
    const emailErrors = [];
    for (const staff of inserted) {
      const setupUrl = `${process.env.FRONTEND_URL}/set-password?token=${staff.setupToken}`;
      try {
        const { error: sendError } = await resend.emails.send({
          from: 'ScholarPath Intervention Management <noreply@scholarpathsystems.org>',
          to: staff.user.email,
          subject: 'Set up your ScholarPath account',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0;">Welcome to ScholarPath</h1>
              </div>
              <div style="padding: 30px; background: #f9fafb;">
                <p>Hello ${staff.user.full_name},</p>
                <p>An account has been created for you in ScholarPath Intervention Management. To get started, set up your password using the link below.</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${setupUrl}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Set Up My Password</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">This link will expire in 7 days.</p>
                <p style="color: #6b7280; font-size: 14px;">If you didn't expect this email, please ignore it.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                  ScholarPath Intervention Management by ScholarPath Systems<br>
                  FERPA Compliant • Student Data Protected
                </p>
              </div>
            </div>
          `
        });
        if (sendError) {
          const sanitized = (sendError.message || 'Unknown error').split('\n')[0].slice(0, 200);
          emailErrors.push({ row: staff.row, email: staff.user.email, error: sanitized });
          console.error('[csv:staff-import] resend error:', sendError.statusCode || sendError.name || 'unknown');
        }
      } catch (err) {
        const sanitized = (err.message || 'Unknown error').split('\n')[0].slice(0, 200);
        emailErrors.push({ row: staff.row, email: staff.user.email, error: sanitized });
        console.error('[csv:staff-import] resend exception:', err.statusCode || err.name || 'unknown');
      }
    }

    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting temp file:', err);
    });

    res.json({
      success: true,
      summary: {
        totalRows: rowNumber - 1,
        imported: inserted.length,
        validationErrors: errors.length,
        insertErrors: insertErrors.length,
        emailErrors: emailErrors.length
      },
      imported: inserted.map(i => ({
        row: i.row,
        email: i.user.email,
        id: i.user.id
      })),
      errors: [...errors, ...insertErrors],
      emailErrors
    });

  } catch (error) {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    console.error('[csv:staff-import] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;