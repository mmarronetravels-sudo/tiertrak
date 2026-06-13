const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { platformAdminOnly } = require('../middleware/platformAdminOnly');
const { seedDisciplineVocabsForTenant } = require('../data/discipline-vocab-seeds');
const { csvImportLimiter } = require('../middleware/rateLimiters');
const { upload: staffImportUpload, validateStaffImport, commitStaffImport } = require('./operatorStaffImport');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// All routes are operator-only. requireAuth populates req.user from the
// auth cookie + DB re-query; platformAdminOnly checks the user id against
// the PLATFORM_ADMIN_USER_IDS env-allowlist. Customer-facing roles never
// reach these handlers. resolveAccessibleTenantIds is deliberately NOT in
// the chain — operators have no user_school_access rows and this endpoint
// creates a top-level entity rather than scoping into a tenant set.
router.use(requireAuth, platformAdminOnly);

const ALLOWED_AUTH_MODES = ['sso', 'password', 'disabled'];

// Create a new district. This endpoint mints a districts row only — it
// does not attach any tenants, mint any users, or seed user_school_access
// rows. Those flows are separate later endpoints.
//
// Body: { name, auth_mode }
//   - auth_mode is required and has no default (M034 fail-safe design;
//     every district INSERT must specify an auth policy explicitly).
//   - name is required. The 409 below is a best-effort pre-flight only:
//     districts.name has no UNIQUE constraint at the DB layer yet
//     (Followup #107). Two concurrent operator clicks could race-insert
//     duplicates between the SELECT and the INSERT. Treat the 409 as
//     informational, not a uniqueness guarantee.
router.post('/', async (req, res) => {
  const { name, auth_mode } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!auth_mode || !ALLOWED_AUTH_MODES.includes(auth_mode)) {
    return res.status(400).json({ error: 'auth_mode must be one of: sso, password, disabled' });
  }
  try {
    const existing = await pool.query(
      'SELECT 1 FROM districts WHERE name = $1 LIMIT 1',
      [trimmedName]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'District name already exists' });
    }

    const result = await pool.query(
      `INSERT INTO districts (name, auth_mode)
       VALUES ($1, $2)
       RETURNING id, name, auth_mode, created_at, updated_at`,
      [trimmedName, auth_mode]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid auth_mode' });
    if (err.code === '23505') return res.status(409).json({ error: 'District name already exists' });
    console.error('[operatorDistricts:create]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

function parseDistrictId(req, res) {
  const id = Number(req.params.districtId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid district id' });
    return null;
  }
  return id;
}

// Local positive-int32 validator for path/body integers other than the
// district id (which parseDistrictId already covers). Kept local to this
// file by design — districtAccess.js has its own copy; deduping the two is
// explicitly out of scope for this PR.
const INT4_MAX = 2147483647;

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

// Create a new school-tenant under an existing district.
//
// v1 scope: net-new schools only. The only write is the INSERT below —
// there is deliberately NO `UPDATE tenants SET district_id`, so an
// existing standalone tenant can never be re-parented into a district.
//
// district_id is taken EXCLUSIVELY from the URL path (never the body),
// so a body-supplied district_id is structurally ignored. type is
// hard-coded to 'school' (the M029 CHECK is `type = 'school'`).
//
// Body: { name, subdomain }
//   - name: required, trimmed, non-empty.
//   - subdomain: required, trimmed + lowercased, must match ^[a-z0-9-]+$.
//     tenants.subdomain is globally UNIQUE (not district-scoped), so a
//     collision with any other tenant's subdomain 23505s.
//
// Wrapped in a single BEGIN/COMMIT so the tenant row, the starter
// intervention-bank seed, and the discipline-vocabulary seed all commit
// or all roll back together — no half-provisioned school is left behind.
// Mirrors the seed-in-transaction pattern of POST /api/tenants.
router.post('/:districtId/schools', async (req, res) => {
  const districtId = parseDistrictId(req, res);
  if (districtId === null) return;

  const { name, subdomain } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name is required' });
  }
  const normalizedSubdomain =
    typeof subdomain === 'string' ? subdomain.trim().toLowerCase() : '';
  if (!normalizedSubdomain || !/^[a-z0-9-]+$/.test(normalizedSubdomain)) {
    return res.status(400).json({
      error: 'subdomain is required and may contain only a-z, 0-9, and hyphens'
    });
  }

  const client = await pool.connect();
  try {
    // District-exists pre-flight: clean 404 instead of a downstream FK
    // (23503) error if the path points at a non-existent district.
    const district = await client.query(
      'SELECT 1 FROM districts WHERE id = $1 LIMIT 1',
      [districtId]
    );
    if (district.rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    // Subdomain-taken pre-flight: best-effort only. A concurrent insert
    // could race between this SELECT and the INSERT below — the 23505
    // catch is the real uniqueness guarantee.
    const taken = await client.query(
      'SELECT 1 FROM tenants WHERE subdomain = $1 LIMIT 1',
      [normalizedSubdomain]
    );
    if (taken.rows.length > 0) {
      return res.status(409).json({ error: 'Subdomain already in use' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO tenants (name, type, subdomain, district_id)
       VALUES ($1, 'school', $2, $3)
       RETURNING id, name, type, subdomain, district_id, created_at, updated_at`,
      [trimmedName, normalizedSubdomain, districtId]
    );
    const newTenant = result.rows[0];

    // Auto-seed starter interventions from the bank.
    const starterResult = await client.query(
      'SELECT id FROM intervention_templates WHERE tenant_id IS NULL AND is_starter = TRUE'
    );
    const starterIds = starterResult.rows.map((r) => r.id);
    if (starterIds.length > 0) {
      await client.query(
        `INSERT INTO tenant_intervention_bank (tenant_id, template_id)
         SELECT $1, unnest($2::int[])
         ON CONFLICT DO NOTHING`,
        [newTenant.id, starterIds]
      );
    }

    // Auto-seed discipline-referral default vocabularies (per M036).
    await seedDisciplineVocabsForTenant(client, newTenant.id);

    await client.query('COMMIT');
    res.status(201).json(newTenant);
  } catch (err) {
    // Swallow ROLLBACK errors so a dead connection during rollback can't
    // mask the original error. The finally block releases the client.
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid tenant type' });
    if (err.code === '23505') return res.status(409).json({ error: 'Subdomain already in use' });
    console.error('[operatorDistricts:createSchool]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Create the first (or an additional) district_admin user for an existing
// district. This mints ONE users row and nothing else — no
// user_school_access grant (Option 2). A district_admin's school scope is
// the membership of user_school_access, which is intentionally empty at
// creation; a separate later flow grants school access. The row is usable
// at login immediately because #270 made /login, /me, /google LEFT JOIN
// tenants, so a tenant_id = NULL user is no longer dropped by the join.
//
// district_id is taken EXCLUSIVELY from the URL path (never the body), and
// role is hard-coded server-side to 'district_admin' — a body-supplied
// role or district_id is structurally ignored (only { email, full_name }
// are destructured).
//
// Column values, all server-controlled:
//   - tenant_id        = NULL  (district-level user owns no school data;
//                               the one legitimate null-tenant write)
//   - school_wide_access = FALSE (Finding B: staffManagement defaults this
//                               to ELEVATED_ROLES.includes(role) = TRUE for
//                               district_admin, but district scope here is
//                               user_school_access membership, NOT the
//                               school-wide flag — so it is forced FALSE)
//   - password_hash    omitted -> NULL (Google SSO only; nullable per M025)
//
// Body: { email, full_name }
//   - both required, trimmed, non-empty. email is lowercased to match the
//     login lookup (auth.js resolves users by LOWER-insensitive email = $1).
//   - Duplicate-email pre-flight is GLOBAL, not tenant-scoped: login looks
//     users up by email across all tenants and takes rows[0], so a colliding
//     email would make login non-deterministic. UNIQUE(tenant_id, email)
//     does NOT protect us here — NULL tenant_id is distinct under a UNIQUE
//     constraint, so it permits duplicate null-tenant emails and never fires
//     against a non-null-tenant row. This app-layer SELECT is therefore the
//     only guard, and like the districts.name/subdomain 409s it is
//     best-effort: a concurrent insert could race between the SELECT and the
//     INSERT. No DB unique index backstops the null-tenant case, so the
//     race window cannot be closed by a 23505 catch here.
router.post('/:districtId/admins', async (req, res) => {
  const districtId = parseDistrictId(req, res);
  if (districtId === null) return;

  const { email, full_name } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const trimmedFullName = typeof full_name === 'string' ? full_name.trim() : '';
  if (!normalizedEmail || !trimmedFullName) {
    return res.status(400).json({ error: 'email and full_name are required' });
  }

  try {
    // District-exists pre-flight: clean 404 instead of a downstream FK
    // (23503) error if the path points at a non-existent district.
    const district = await pool.query(
      'SELECT 1 FROM districts WHERE id = $1 LIMIT 1',
      [districtId]
    );
    if (district.rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    // GLOBAL duplicate-email pre-flight (see header comment). Best-effort.
    const existing = await pool.query(
      'SELECT 1 FROM users WHERE email = $1 LIMIT 1',
      [normalizedEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const result = await pool.query(
      `INSERT INTO users (email, full_name, role, tenant_id, school_wide_access, district_id)
       VALUES ($1, $2, 'district_admin', NULL, FALSE, $3)
       RETURNING id, email, full_name, role, district_id, created_at`,
      [normalizedEmail, trimmedFullName, districtId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A user with this email already exists' });
    console.error('[operatorDistricts:createAdmin]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /:districtId/admins/:userId/access — operator grants a single
// school-tenant to a district user. The intended caller flow: an operator
// has just minted a district's first district_admin via POST
// /:districtId/admins (whose user_school_access set is empty at creation),
// and now gives that admin its school scope so it goes from zero accessible
// rows to its granted school(s). This is the operator analog of the
// district_admin-driven POST /api/districts/:id/users/:userId/access in
// routes/districtAccess.js.
//
// Why no resolveAccessibleTenantIds: operators hold ZERO user_school_access
// rows (they sit above the tenant model — see the router.use comment), so
// the membership helper would resolve to an empty set and 404 every grant.
// Scope is instead enforced STRUCTURALLY by the two §5 pre-flights below
// (target user in-district AND school tenant in-district); M028's composite
// FKs are the schema-layer cross-district backstop (a mismatched triple
// raises 23503, mapped to 404).
//
// Body: { school_tenant_id } — validateIntParam (positive, <= INT4_MAX).
//
// Writes mirror districtAccess.js POST exactly: one txn that sets the
// app.actor_user_id GUC to the OPERATOR's own users.id, INSERTs the grant
// row (created_by = operator), then app-writes the 'grant' audit row
// (M031's trigger fires only on DELETE, so 'grant' is app-layer).
//
// Grant-only: school_wide_access and every other user column are untouched.
// The 201 echoes only the operator-submitted integer scalars — never any
// target-user PII (email / full_name) in the body, logs, or URL.
router.post('/:districtId/admins/:userId/access', async (req, res) => {
  const districtId = parseDistrictId(req, res);
  if (districtId === null) return;

  const userId = validateIntParam(req.params.userId);
  if (userId === null) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const schoolTenantId = validateIntParam(req.body && req.body.school_tenant_id);
  if (schoolTenantId === null) {
    return res.status(400).json({ error: 'Invalid school_tenant_id' });
  }

  const actorId = Number(req.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    console.error('[operatorDistricts:grantAccess]', 'invalid req.user.id from JWT');
    return res.status(500).json({ error: 'Server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(actorId)]
    );

    // §5 pre-flight 1: target user exists AND belongs to this district.
    const targetUser = await client.query(
      'SELECT id, district_id FROM users WHERE id = $1',
      [userId]
    );
    if (targetUser.rows.length === 0 || targetUser.rows[0].district_id !== districtId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    // §5 pre-flight 2: school tenant exists AND is a school AND belongs to
    // this district. type = 'school' guards against granting a school-scope
    // row against a type = 'district' tenant in the same district (matches
    // the createSchool handler's hard-coded type = 'school' precedent).
    const schoolTenant = await client.query(
      "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
      [schoolTenantId]
    );
    if (schoolTenant.rows.length === 0 || schoolTenant.rows[0].district_id !== districtId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    await client.query(
      `INSERT INTO user_school_access (user_id, district_id, school_tenant_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, districtId, schoolTenantId, actorId]
    );

    await client.query(
      `INSERT INTO user_school_access_audit
         (user_id, district_id, school_tenant_id, action, actor_user_id)
       VALUES ($1, $2, $3, 'grant', $4)`,
      [userId, districtId, schoolTenantId, actorId]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Granted',
      user_id: userId,
      district_id: districtId,
      school_tenant_id: schoolTenantId
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already granted' });
    }
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('[operatorDistricts:grantAccess]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /:districtId/admins/:userId/access — list the user's
// user_school_access grants within this district so an operator can verify
// a grant landed. IDs only (school_tenant_id + created_at); no PII.
// Read-only, so it runs against the pool (no txn). Same parseDistrictId +
// int-validate + in-district pre-flight as the grant handler. Unlike
// districtAccess.js GET there is NO resolveAccessibleTenantIds filter — the
// operator sits above the tenant model and sees every grant in the
// district, scoped strictly to the path district_id by the WHERE clause.
router.get('/:districtId/admins/:userId/access', async (req, res) => {
  const districtId = parseDistrictId(req, res);
  if (districtId === null) return;

  const userId = validateIntParam(req.params.userId);
  if (userId === null) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  try {
    // §5 pre-flight: target user exists AND belongs to this district.
    const targetUser = await pool.query(
      'SELECT id, district_id FROM users WHERE id = $1',
      [userId]
    );
    if (targetUser.rows.length === 0 || targetUser.rows[0].district_id !== districtId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const grants = await pool.query(
      `SELECT school_tenant_id, created_at
       FROM user_school_access
       WHERE user_id = $1 AND district_id = $2
       ORDER BY school_tenant_id`,
      [userId, districtId]
    );

    res.json({ grants: grants.rows });
  } catch (err) {
    console.error('[operatorDistricts:listAccess]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /:districtId/admins — list the district_admin users of one district
// so an operator can see who has been onboarded and pick one to grant a
// school to. district_id is taken EXCLUSIVELY from the URL path (validated
// by parseDistrictId) and the query filters strictly on `district_id = $1`,
// so this can never return another district's users. Read-only, so it runs
// against the pool (no txn), mirroring the GET schools/grants handlers.
//
// A district-exists pre-flight returns a clean 404 when the path points at
// a non-existent district, distinguishing it from an existing district that
// simply has zero admins (200 + []).
//
// §4B: this projection surfaces staff PII (email + full_name) into the
// response body, which the operator console is authorized to display. The
// PII is rendered to the DOM only — it is never logged (tag-only
// console.error below) and never placed in an error body or URL.
router.get('/:districtId/admins', async (req, res) => {
  const districtId = parseDistrictId(req, res);
  if (districtId === null) return;

  try {
    const district = await pool.query(
      'SELECT 1 FROM districts WHERE id = $1 LIMIT 1',
      [districtId]
    );
    if (district.rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    const result = await pool.query(
      `SELECT id, email, full_name, created_at
       FROM users
       WHERE district_id = $1 AND role = 'district_admin'
       ORDER BY full_name`,
      [districtId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[operatorDistricts:listAdmins]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// List all districts. Operator-only, cross-district by design (these
// routes sit above the tenant model — see the router.use comment above),
// so this list is intentionally unscoped, mirroring GET /api/tenants.
//
// Explicit projection excludes nothing sensitive (districts holds no
// student/staff PII), but stays narrow to what the operator console needs.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, auth_mode, created_at FROM districts ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[operatorDistricts:list]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// List the schools for one district. district_id is taken EXCLUSIVELY
// from the URL path (validated by parseDistrictId) and the query filters
// strictly on `district_id = $1`, so this can never return another
// district's schools.
//
// A district-exists pre-flight returns a clean 404 when the path points
// at a non-existent district, distinguishing it from an existing district
// that simply has zero schools (200 + []).
//
// Explicit projection excludes tenants.settings (opaque JSONB config the
// console does not need) and tenants.type (always 'school' here).
router.get('/:districtId/schools', async (req, res) => {
  const districtId = parseDistrictId(req, res);
  if (districtId === null) return;

  try {
    const district = await pool.query(
      'SELECT 1 FROM districts WHERE id = $1 LIMIT 1',
      [districtId]
    );
    if (district.rows.length === 0) {
      return res.status(404).json({ error: 'District not found' });
    }

    const result = await pool.query(
      `SELECT id, name, subdomain, district_id, created_at
       FROM tenants
       WHERE district_id = $1
       ORDER BY name`,
      [districtId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[operatorDistricts:listSchools]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Staff-import VALIDATE-ONLY (Slice 1). Registered here so the router-level
// requireAuth + platformAdminOnly above run ONCE for this surface. The
// handler + its multer config live in routes/operatorStaffImport.js.
// csvImportLimiter is route-level (it necessarily runs after the
// router.use auth chain; pre-auth IP limiting for the whole operator mount
// is tracked separately as Followup #122). Path preserves the
// /:districtId/schools/:schoolTenantId/... shape.
router.post(
  '/:districtId/schools/:schoolTenantId/staff-import/validate',
  csvImportLimiter,
  staffImportUpload.single('file'),
  validateStaffImport
);

// Staff-import COMMIT (Slice 2). Same router (auth runs once), same
// csvImportLimiter + multer chain, same /:districtId/schools/:schoolTenantId
// path shape as the validate route above. Dry-run (validate) stays the
// default surface; this is the explicit write counterpart. Single
// transaction per import; all-or-nothing. See routes/operatorStaffImport.js
// commitStaffImport for the §4B/§5 contract.
router.post(
  '/:districtId/schools/:schoolTenantId/staff-import/commit',
  csvImportLimiter,
  staffImportUpload.single('file'),
  commitStaffImport
);

module.exports = router;
