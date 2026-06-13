const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const crypto = require('crypto');
const { Resend } = require('resend');
require('dotenv').config();
const { isOperator } = require('../middleware/platformAdminOnly');
const { STAFF_ROLES } = require('./staffManagement');
const { ELEVATED_ROLES, canAssignRole } = require('../constants/roles');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const resend = new Resend(process.env.RESEND_API_KEY);

// Roles whose scope is the district, not a single school. For these the
// users.district_id column is populated from the PATH districtId (verified
// by the pre-flight) — never from the CSV or the operator's own
// users.district_id. Mirrors the list in routes/csvImport.js.
const DISTRICT_SCOPED_ROLES = ['district_admin', 'district_tech_admin'];

// ============================================================
// Operator-console STAFF-IMPORT VALIDATE-ONLY (Slice 1)
//
// Registered on the existing operator router (routes/operatorDistricts.js)
// as:
//   POST /api/operator/districts/:districtId/schools/:schoolTenantId/staff-import/validate
//
// The route lives on operatorDistricts.js so that router's single
// `router.use(requireAuth, platformAdminOnly)` runs auth ONCE for this
// surface; only the handler + its multer config live here, in their own
// module. (An earlier draft mounted a second router under the same
// /api/operator/districts base, which double-ran requireAuth's DB
// re-query; that is fixed by hanging the handler off the existing router.)
//
// A DRY-RUN endpoint. It parses an uploaded staff CSV for ONE school
// tenant and returns counts + per-row errors. It WRITES NOTHING — no
// INSERT/UPDATE, no setup-email, no audit row. The only DB access is two
// read-only §5 pre-flights plus a read-only per-row email-existence check.
//
// This is intentionally a SEPARATE surface from the commit importer at
// routes/csvImport.js (POST /api/csv/staff/:tenantId). That endpoint is
// left untouched. The two duplicate the per-row staff rules for now;
// extracting a shared pure validator is banked as a follow-up
// (chore/extract-staff-import-row-validator).
//
// Tenant binding (§5) — STRUCTURAL, mirroring the operator grant flow at
// routes/operatorDistricts.js POST /:districtId/admins/:userId/access:
//   - districtId and schoolTenantId both come from the URL path (each
//     validated as a positive int32). There is NO "School" column in the
//     CSV — one upload binds to exactly one school_tenant_id.
//   - Two pre-flights run BEFORE the file is parsed:
//       (1) district exists                              → else 404
//       (2) school tenant exists AND type='school' AND
//           district_id === path districtId              → else 404
//   - resolveAccessibleTenantIds is deliberately NOT used: operators hold
//     zero user_school_access rows, so the membership helper would resolve
//     to an empty set and 404 every request. Same rationale as the grant
//     flow (routes/operatorDistricts.js:282-288).
//
// §4B no-echo narrowing (STRICTER than the commit importer): per-row
// errors carry { row, error } ONLY. The offending email / full_name is
// NEVER echoed back in an error string, the response body, or the logs.
// (The commit importer still echoes the email in its in-file-dup message;
// this surface deliberately does not.) Role and school_wide_access values
// are not PII and may appear in error text. Server logs are counts/codes
// only. The uploaded CSV is deleted from disk in EVERY exit path.
// ============================================================

// multer config — type + size validated before the handler runs.
// Mirrors routes/csvImport.js. Exported so operatorDistricts.js can wire
// `upload.single('file')` into the route's middleware chain.
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

const INT4_MAX = 2147483647;

// Local positive-int32 validator. Duplicated from operatorDistricts.js /
// districtAccess.js by design — deduping the copies is a separate chore
// (Followup #112/#124-validateIntParam-dedupe).
function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// Deliberately simple structural email check — NOT RFC 5322. It rejects
// obviously malformed values (missing @, missing domain dot, embedded
// whitespace) so the dry-run can flag them; full address validity is
// established later by the setup-email delivery, not here. The repo has no
// shared email regex (emails are otherwise only trimmed + lowercased), so
// this is intentionally local to this validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared row cap for staff CSV imports (validate + commit). Fires AFTER
// parse, BEFORE any DB read/write. The constant + message are shared so the
// two operator surfaces cannot drift on the limit or the wording.
const STAFF_IMPORT_ROW_CAP = 100;
const STAFF_IMPORT_ROW_CAP_MESSAGE =
  'Staff CSV upload limited to 100 rows. Split larger uploads into multiple files.';

// parseAndValidateStaffRows — pure (no res, no DB, no file deletion) CSV
// parse + per-row validation shared by the operator validate-only (Slice 1)
// and commit (Slice 2) handlers so their per-row rules stay BYTE-IDENTICAL:
// one source, no third copy, no drift. (Extracted from the inline block that
// used to live in validateStaffImport; this is the banked
// chore/extract-staff-import-row-validator, scoped to the two operator
// surfaces only — the separate csvImport.js commit importer is intentionally
// NOT touched here.)
//
// Deliberately does NOT:
//   - derive district_id — that is path-based and resolved by each caller
//     (the operator surface derives it from the URL districtId, never from
//     the CSV or the operator's own users.district_id);
//   - run the per-tenant email-existence check — that needs the bound
//     school_tenant_id and stays in the caller;
//   - apply the row cap or delete the upload — both are caller concerns.
//
// §4B: per-row errors carry { row, error } ONLY — the offending email /
// full_name is NEVER echoed. Role and school_wide_access are not PII and may
// appear in error text.
//
// Resolves { results, validationErrors, duplicateErrors, totalRows } where
// results = [{ row, email (lowercased), full_name, role, school_wide_access }].
function parseAndValidateStaffRows(filePath, reqUser) {
  const results = [];            // rows that passed all parse-time checks
  const validationErrors = [];   // required / email / role / assignability / swa
  const duplicateErrors = [];    // in-file duplicate email
  // Within-upload dedup tracker: email(lower) → first-occurrence row number.
  const emailFirstRow = new Map();
  let rowNumber = 1; // Start at 1 for header

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rowNumber++;

        const normalizedRow = {};
        Object.keys(row).forEach(key => {
          normalizedRow[key.trim().toLowerCase().replace(/\s+/g, '_')] = row[key]?.trim();
        });

        // Required columns.
        if (!normalizedRow.email || !normalizedRow.full_name || !normalizedRow.role) {
          validationErrors.push({
            row: rowNumber,
            error: 'Missing required fields (email, full_name, role).'
          });
          return;
        }

        // Email format — value is NEVER echoed (§4B).
        if (!EMAIL_RE.test(normalizedRow.email)) {
          validationErrors.push({
            row: rowNumber,
            error: 'Invalid email format.'
          });
          return;
        }

        // Role universe — the 7 assignable roles. "MTSS" and any other
        // non-CHECK value is rejected here. Role string is not PII.
        if (!STAFF_ROLES.includes(normalizedRow.role)) {
          validationErrors.push({
            row: rowNumber,
            error: `Invalid role "${normalizedRow.role}". Must be one of: ${STAFF_ROLES.join(', ')}.`
          });
          return;
        }

        // Role-rank/assignability. Under platformAdminOnly the actor is
        // always an operator, so canAssignRole returns true for every role
        // in ROLE_RANK; kept for symmetry with the commit importer and as
        // defense-in-depth if the gate ever changes.
        if (!canAssignRole(reqUser.role, normalizedRow.role, isOperator(reqUser.id))) {
          validationErrors.push({
            row: rowNumber,
            error: `Role "${normalizedRow.role}" cannot be assigned by your account.`
          });
          return;
        }

        // school_wide_access consistency guard. Only fires when the column
        // was provided non-empty; omitted/empty is derived from the role.
        // Values here are not PII.
        const expectedSwa = ELEVATED_ROLES.includes(normalizedRow.role);
        if (normalizedRow.school_wide_access) {
          const upper = normalizedRow.school_wide_access.toUpperCase();
          if (upper !== 'TRUE' && upper !== 'FALSE') {
            validationErrors.push({
              row: rowNumber,
              error: `Invalid school_wide_access "${normalizedRow.school_wide_access}". Must be TRUE or FALSE.`
            });
            return;
          }
          const providedSwa = upper === 'TRUE';
          if (providedSwa !== expectedSwa) {
            validationErrors.push({
              row: rowNumber,
              error: `Role "${normalizedRow.role}" requires school_wide_access=${expectedSwa ? 'TRUE' : 'FALSE'} (provided ${upper}).`
            });
            return;
          }
        }

        // In-file duplicate email. §4B narrowing: row numbers only, the
        // email value is NOT echoed (the commit importer in csvImport.js
        // does echo it; this surface deliberately does not).
        const emailLower = normalizedRow.email.toLowerCase();
        if (emailFirstRow.has(emailLower)) {
          const firstRow = emailFirstRow.get(emailLower);
          duplicateErrors.push({
            row: rowNumber,
            error: `Duplicate email within upload; first seen at row ${firstRow}.`
          });
          return;
        }
        emailFirstRow.set(emailLower, rowNumber);

        // Parsed, fully-validated row. school_wide_access is the role-derived
        // value (expectedSwa) so the commit caller can persist it directly.
        // district_id is intentionally NOT derived here — see header.
        results.push({
          row: rowNumber,
          email: emailLower,
          full_name: normalizedRow.full_name,
          role: normalizedRow.role,
          school_wide_access: expectedSwa
        });
      })
      .on('end', () => resolve({ results, validationErrors, duplicateErrors, totalRows: rowNumber - 1 }))
      .on('error', (error) => reject(error));
  });
}

// Handler for POST /:districtId/schools/:schoolTenantId/staff-import/validate.
// requireAuth + platformAdminOnly have already run on the parent router, so
// req.user is populated and the caller is a verified operator.
async function validateStaffImport(req, res) {
  const cleanup = () => {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
  };

  const districtId = validateIntParam(req.params.districtId);
  if (districtId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid district id' });
  }
  const schoolTenantId = validateIntParam(req.params.schoolTenantId);
  if (schoolTenantId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid school_tenant_id' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // §5 pre-flight 1: district exists.
    const district = await pool.query('SELECT id FROM districts WHERE id = $1', [districtId]);
    if (district.rows.length === 0) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // §5 pre-flight 2: school tenant exists AND is a school AND belongs to
    // this district. type='school' mirrors the grant-flow precedent.
    const schoolTenant = await pool.query(
      "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
      [schoolTenantId]
    );
    if (schoolTenant.rows.length === 0 || schoolTenant.rows[0].district_id !== districtId) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // Parse + per-row validation via the shared validator (§4B no-echo;
    // row + field-level reason only). district_id derivation and the
    // per-tenant email-existence check stay in this handler — see the
    // parseAndValidateStaffRows header.
    const { results, validationErrors, duplicateErrors, totalRows } =
      await parseAndValidateStaffRows(req.file.path, req.user);

    // 100-row cap. Fires AFTER parse, BEFORE the existence-check reads.
    // Shared constant + message with the commit importer (no drift).
    if (totalRows > STAFF_IMPORT_ROW_CAP) {
      cleanup();
      return res.status(400).json({ error: STAFF_IMPORT_ROW_CAP_MESSAGE });
    }

    // Read-only per-row email-existence pre-check, scoped to the bound
    // school tenant. No write occurs. Row numbers only in the result
    // (§4B) — the email is never echoed.
    const alreadyExistsErrors = [];
    let validCount = 0;
    for (const staff of results) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
        [staff.email, schoolTenantId]
      );
      if (existing.rows.length > 0) {
        alreadyExistsErrors.push({
          row: staff.row,
          error: 'A user with this email already exists at this school.'
        });
      } else {
        validCount++;
      }
    }

    cleanup();

    // Counts-only logging — no PII, no row data.
    console.log(
      '[operator:staff-import-validate] district:', districtId,
      'school:', schoolTenantId,
      'totalRows:', totalRows,
      'valid:', validCount,
      'validationErrors:', validationErrors.length,
      'duplicatesInFile:', duplicateErrors.length,
      'alreadyExists:', alreadyExistsErrors.length
    );

    res.json({
      validateOnly: true,
      summary: {
        totalRows: totalRows,
        valid: validCount,
        validationErrors: validationErrors.length,
        duplicatesInFile: duplicateErrors.length,
        alreadyExists: alreadyExistsErrors.length
      },
      errors: [...validationErrors, ...duplicateErrors, ...alreadyExistsErrors]
    });

  } catch (error) {
    cleanup();
    console.error('[operator:staff-import-validate] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
}

// Handler for POST /:districtId/schools/:schoolTenantId/staff-import/commit.
// requireAuth + platformAdminOnly have already run on the parent router, so
// req.user is populated and the caller is a verified operator.
//
// This is the WRITE counterpart of validateStaffImport. It reuses the same
// pre-flights, the same shared row validator, and the same §4B no-echo
// doctrine, then actually provisions accounts.
//
// ALL-OR-NOTHING (per Slice 2 spec):
//   1. If the parsed CSV has ANY row error (validation or in-file duplicate)
//      → 422, write nothing. Re-run the dry-run and fix every row first.
//   2. If ANY email already exists at this school → 422, write nothing.
//   3. Otherwise every row is inserted inside ONE transaction together with
//      its staff_import_audit row. A failure on any row (e.g. a 23505 race
//      with a concurrent create) rolls the WHOLE import back — 0 accounts
//      created. There is no partial commit.
//
// Setup-credential flow mirrors routes/csvImport.js POST /staff/:tenantId
// VERBATIM: crypto.randomBytes(32) token + 7-day expiry stored in
// password_reset_token / password_reset_expires; password_hash omitted;
// google_id explicit NULL; Resend setup email sent AFTER COMMIT (emails are
// not transactional — never sent inside the txn, never rolled back).
//
// §5 tenant binding is STRUCTURAL and identical to the validate handler:
// districtId + schoolTenantId come from the URL path; users.tenant_id is the
// path schoolTenantId; district_id for district-scoped roles is the path
// districtId (never CSV, never the operator's own district_id, so the
// operator-null footgun does not arise).
//
// §4B: the setup token is a credential — never logged, never in the
// response body, only in the email's setup link. Per-row errors and the
// response carry row numbers + ids only; no email / full_name is echoed.
// Server logs are counts/codes only. The uploaded CSV is deleted on EVERY
// exit path.
async function commitStaffImport(req, res) {
  const cleanup = () => {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
  };

  const districtId = validateIntParam(req.params.districtId);
  if (districtId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid district id' });
  }
  const schoolTenantId = validateIntParam(req.params.schoolTenantId);
  if (schoolTenantId === null) {
    cleanup();
    return res.status(400).json({ error: 'Invalid school_tenant_id' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const actorId = Number(req.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    cleanup();
    console.error('[operator:staff-import-commit] invalid req.user.id from JWT');
    return res.status(500).json({ error: 'Server error' });
  }

  try {
    // §5 pre-flight 1: district exists. Identical to the validate handler.
    const district = await pool.query('SELECT id FROM districts WHERE id = $1', [districtId]);
    if (district.rows.length === 0) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // §5 pre-flight 2: school tenant exists AND is a school AND belongs to
    // this district.
    const schoolTenant = await pool.query(
      "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
      [schoolTenantId]
    );
    if (schoolTenant.rows.length === 0 || schoolTenant.rows[0].district_id !== districtId) {
      cleanup();
      return res.status(404).json({ error: 'Not found' });
    }

    // Parse + per-row validation via the shared validator (same rules as the
    // dry-run; §4B no-echo).
    const { results, validationErrors, duplicateErrors, totalRows } =
      await parseAndValidateStaffRows(req.file.path, req.user);

    // 100-row cap. Shared constant + message with the validate handler.
    if (totalRows > STAFF_IMPORT_ROW_CAP) {
      cleanup();
      return res.status(400).json({ error: STAFF_IMPORT_ROW_CAP_MESSAGE });
    }

    // ALL-OR-NOTHING gate 1: any row error → reject the whole import, write
    // nothing. The dry-run is where these are meant to be discovered.
    if (validationErrors.length > 0 || duplicateErrors.length > 0) {
      cleanup();
      console.log(
        '[operator:staff-import-commit] rejected-row-errors district:', districtId,
        'school:', schoolTenantId,
        'totalRows:', totalRows,
        'validationErrors:', validationErrors.length,
        'duplicatesInFile:', duplicateErrors.length
      );
      return res.status(422).json({
        error: 'Import rejected: the CSV has row-level errors. Re-run validate and fix every row before committing.',
        errors: [...validationErrors, ...duplicateErrors]
      });
    }

    if (results.length === 0) {
      cleanup();
      return res.status(422).json({ error: 'Import rejected: no valid rows to import.' });
    }

    // ALL-OR-NOTHING gate 2: per-tenant email-existence pre-check (read-only,
    // scoped to the bound school). If ANY row collides, reject the whole
    // import — no partial commit. Row numbers only (§4B).
    const alreadyExistsErrors = [];
    for (const staff of results) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
        [staff.email, schoolTenantId]
      );
      if (existing.rows.length > 0) {
        alreadyExistsErrors.push({
          row: staff.row,
          error: 'A user with this email already exists at this school.'
        });
      }
    }
    if (alreadyExistsErrors.length > 0) {
      cleanup();
      console.log(
        '[operator:staff-import-commit] rejected-already-exists district:', districtId,
        'school:', schoolTenantId,
        'totalRows:', totalRows,
        'alreadyExists:', alreadyExistsErrors.length
      );
      return res.status(422).json({
        error: 'Import rejected: one or more emails already exist at this school. No accounts were created.',
        errors: alreadyExistsErrors
      });
    }

    // Single transaction for the whole import: all user INSERTs + their
    // audit rows commit together or not at all. Setup tokens are generated
    // per row; emails are deferred until AFTER COMMIT.
    const importBatchId = crypto.randomUUID();
    const provisioned = []; // { row, user, setupToken } — token kept in memory only for the email step
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Actor capture for any DB-layer audit/trigger plumbing, mirroring the
      // grant flow at routes/operatorDistricts.js.
      await client.query("SELECT set_config('app.actor_user_id', $1, true)", [String(actorId)]);

      for (const staff of results) {
        // district_id: PATH-derived for district-scoped roles, else NULL.
        // Never from CSV, never from the operator's own users.district_id.
        const rowDistrictId = DISTRICT_SCOPED_ROLES.includes(staff.role) ? districtId : null;

        // Token + 7-day expiry mirror routes/auth.js:338-339 /
        // routes/csvImport.js:697-698 verbatim.
        const setupToken = crypto.randomBytes(32).toString('hex');
        const setupTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const inserted = await client.query(
          `INSERT INTO users (tenant_id, email, full_name, role, school_wide_access, district_id, password_reset_token, password_reset_expires, google_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
           RETURNING id, email, full_name, role, school_wide_access`,
          [schoolTenantId, staff.email, staff.full_name, staff.role, staff.school_wide_access, rowDistrictId, setupToken, setupTokenExpires]
        );
        const user = inserted.rows[0];

        // Audit row (M047). district_id is the PATH district the import
        // targeted; school_tenant_id is the path school. No PII / no token.
        await client.query(
          `INSERT INTO staff_import_audit (import_batch_id, user_id, role, school_tenant_id, district_id, actor_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [importBatchId, user.id, user.role, schoolTenantId, districtId, actorId]
        );

        provisioned.push({ row: staff.row, user, setupToken });
      }

      await client.query('COMMIT');
    } catch (dbError) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackErr) {
        // ROLLBACK on a broken connection can throw; the import has already
        // failed. Swallow the secondary error.
      }
      client.release();
      cleanup();
      // 23505 on users_tenant_id_email_key means a concurrent create won the
      // race between the pre-check and the INSERT. All-or-nothing: the whole
      // transaction rolled back, 0 accounts created. pg messages can echo
      // column values, so code/constraint are logged server-side only.
      if (dbError.code === '23505' && dbError.constraint === 'users_tenant_id_email_key') {
        return res.status(409).json({ error: 'Import aborted: an email collided with a concurrent change. No accounts were created. Re-run validate and retry.' });
      }
      console.error('[operator:staff-import-commit] insert error code:', dbError.code, 'constraint:', dbError.constraint);
      return res.status(500).json({ error: 'Server error' });
    }
    client.release();

    // CSV deleted immediately after the DB work, before the email step.
    cleanup();

    // Setup-link email per provisioned account. Sent AFTER COMMIT: a send
    // failure is non-fatal (the account exists with a valid 7-day token) and
    // is reported as emailErrors, mirroring routes/csvImport.js. The token is
    // NEVER logged; only statusCode/name is logged on failure.
    const emailErrors = [];
    for (const p of provisioned) {
      const setupUrl = `${process.env.FRONTEND_URL}/set-password?token=${p.setupToken}`;
      try {
        const { error: sendError } = await resend.emails.send({
          from: 'ScholarPath Intervention Management <noreply@scholarpathsystems.org>',
          to: p.user.email,
          subject: 'Set up your ScholarPath account',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0;">Welcome to ScholarPath</h1>
              </div>
              <div style="padding: 30px; background: #f9fafb;">
                <p>Hello ${p.user.full_name},</p>
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
          // §4B (privacy LOW-1): do NOT surface the raw Resend error in the
          // response body — its message can embed the recipient address.
          // Fixed string only; statusCode/name logged server-side for
          // diagnosis. Stricter than the csvImport.js precedent.
          emailErrors.push({ row: p.row, error: 'Email delivery failed' });
          console.error('[operator:staff-import-commit] resend error:', sendError.statusCode || sendError.name || 'unknown');
        }
      } catch (err) {
        emailErrors.push({ row: p.row, error: 'Email delivery failed' });
        console.error('[operator:staff-import-commit] resend exception:', err.statusCode || err.name || 'unknown');
      }
    }

    // Counts-only logging — no PII, no token, no row data.
    console.log(
      '[operator:staff-import-commit] committed district:', districtId,
      'school:', schoolTenantId,
      'batch:', importBatchId,
      'totalRows:', totalRows,
      'imported:', provisioned.length,
      'emailErrors:', emailErrors.length
    );

    res.status(201).json({
      committed: true,
      summary: {
        totalRows: totalRows,
        imported: provisioned.length,
        emailErrors: emailErrors.length
      },
      // ids + row numbers only — no email / full_name / token in the body.
      imported: provisioned.map(p => ({ row: p.row, id: p.user.id })),
      emailErrors
    });

  } catch (error) {
    cleanup();
    console.error('[operator:staff-import-commit] error code:', error.code);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  upload,
  validateStaffImport,
  commitStaffImport,
  parseAndValidateStaffRows,
  STAFF_IMPORT_ROW_CAP,
  STAFF_IMPORT_ROW_CAP_MESSAGE,
};
