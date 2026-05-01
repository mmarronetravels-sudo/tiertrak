#!/usr/bin/env node
/**
 * scripts/seed-tenant-sandbox-template.js
 *
 * Generic, school-agnostic sandbox seeder. Local-only SQL emitter for
 * provisioning a new sandbox tenant in the Render-hosted production
 * database, parameterized by an external roster file.
 *
 * This script DOES NOT connect to any database. It loads a roster from
 * the path passed via --roster, validates it, generates one random
 * password per account, bcrypt-hashes the passwords at 10 rounds locally,
 * and emits a transaction-wrapped SQL block to stdout. Paste the SQL
 * into Render's SQL console to provision the tenant. The plaintext
 * passwords are printed once to stderr at end-of-run for hand-delivery
 * to the customer.
 *
 * Usage:
 *   node scripts/seed-tenant-sandbox-template.js --roster <ABSOLUTE_PATH>
 *
 * The --roster argument is REQUIRED and MUST be an absolute path to a
 * `.js` file. The roster file is expected to live OUTSIDE this repo
 * (synthetic-but-customer-identifying data should not be committed).
 * See data/sandbox-roster-template.js for the canonical schema and
 * placeholder example.
 *
 * Behavior guarantees (read carefully — these are the security model):
 *   1. The script never opens a database connection. Period. There is
 *      no `pg` import, no DATABASE_URL read, no network. All it does is
 *      hash strings and write text.
 *   2. The plaintext passwords exist in this process's memory for the
 *      lifetime of the run, are written exactly once to stderr at the
 *      end, and are never written to stdout, never written to a file,
 *      never logged. After this process exits they are gone.
 *   3. Only bcrypt hashes ever appear in the emitted SQL.
 *   4. The emitted SQL hard-fails inside a single transaction if either
 *      the tenant subdomain OR any of the seed emails already exists.
 *      Partial state is impossible: the entire transaction either
 *      applies or rolls back.
 *
 * NOTE on --dry-run: the predecessor script (seed-humble-isd-sandbox.js)
 * accepted --dry-run as a no-op alias. This script does not. The script
 * has no other mode — it always emits SQL and never connects to a DB —
 * so a "dry-run" toggle is meaningless and was dropped intentionally.
 *
 * What you do with the output:
 *   - Redirect stdout to a temp file (e.g., /tmp/sandbox-seed.sql)
 *     outside the repo, paste into Render's SQL console, run, then
 *     delete the file.
 *   - Read the password table off your terminal and hand to the
 *     customer via a one-time secrets-sharing tool.
 *   - Do not paste the password table into Slack, email, or any logged
 *     channel.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BCRYPT_ROUNDS = 10;
const PASSWORD_BYTES = 12; // 12 random bytes → 16-char base64url string, ~96 bits entropy

const ALLOWED_ROLES = new Set([
  'district_admin', 'school_admin', 'teacher', 'counselor',
  'behavior_specialist', 'student_support_specialist',
  'mtss_support', 'parent',
]);
const ALLOWED_TIERS = new Set([1, 2, 3]);
const ALLOWED_AREAS = new Set(['Behavior', 'Academic', 'Social-Emotional']);
const ALLOWED_RISK_LEVELS = new Set(['low', 'moderate', 'high']);

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { roster: null, help: false };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      i += 1;
    } else if (a === '--roster') {
      if (i + 1 >= argv.length) {
        throw new Error('--roster requires a value (an absolute path to a .js roster file)');
      }
      if (args.roster !== null) {
        throw new Error('--roster specified more than once');
      }
      args.roster = argv[i + 1];
      i += 2;
    } else if (a.startsWith('--roster=')) {
      if (args.roster !== null) {
        throw new Error('--roster specified more than once');
      }
      args.roster = a.slice('--roster='.length);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

const USAGE = `Usage:
  node scripts/seed-tenant-sandbox-template.js --roster <ABSOLUTE_PATH>

The roster must be a .js file at an absolute path. See
data/sandbox-roster-template.js for the canonical schema.`;

// ---------------------------------------------------------------------------
// Roster loading
// ---------------------------------------------------------------------------

function loadRoster(rosterPath) {
  if (!path.isAbsolute(rosterPath)) {
    throw new Error(`--roster must be an absolute path; got: ${rosterPath}`);
  }
  if (path.extname(rosterPath) !== '.js') {
    throw new Error(`--roster must point to a .js file; got: ${rosterPath}`);
  }
  let stat;
  try {
    stat = fs.statSync(rosterPath);
  } catch (err) {
    throw new Error(`--roster file not found or not readable: ${rosterPath} (${err.code || err.message})`);
  }
  if (!stat.isFile()) {
    throw new Error(`--roster path is not a regular file: ${rosterPath}`);
  }
  let roster;
  try {
    roster = require(rosterPath);
  } catch (err) {
    throw new Error(`failed to load roster ${rosterPath}: ${err.message}`);
  }
  if (!roster || typeof roster !== 'object') {
    throw new Error(`roster ${rosterPath} did not export an object`);
  }
  return roster;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

function validateRoster(roster) {
  const errors = [];
  // Truncate stringified values in error messages so an operator who pastes
  // real PII into a malformed roster field doesn't splash a full identifying
  // record across stderr. 80 chars is enough to show the type and shape of
  // small primitives without leaking a whole record. Falls back to String(v)
  // when JSON.stringify returns undefined (functions, symbols, bare undefined)
  // and to a sentinel when stringify throws (circular refs, BigInt).
  const MAX_FMT_LENGTH = 80;
  const fmt = (v) => {
    let s;
    try {
      s = JSON.stringify(v);
    } catch (_err) {
      return '<unstringifiable>';
    }
    if (s === undefined) s = String(v);
    if (s.length <= MAX_FMT_LENGTH) return s;
    return s.slice(0, MAX_FMT_LENGTH - 3) + '...';
  };
  // TENANT.name flows raw into an emitted "-- " SQL comment header; an embedded
  // \n would terminate the comment and let arbitrary SQL ride along ahead of
  // BEGIN. Also reject on the other free-form display strings as defense in
  // depth, even though they only land inside single-quoted SQL string literals.
  const hasLineBreak = (s) => /[\r\n]/.test(s);

  // TENANT
  if (!roster.TENANT || typeof roster.TENANT !== 'object') {
    errors.push(`TENANT: must be an object with name, subdomain, type; got: ${fmt(roster.TENANT)}`);
  } else {
    const t = roster.TENANT;
    if (typeof t.name !== 'string' || !t.name.trim()) {
      errors.push(`TENANT.name: must be a non-empty string; got: ${fmt(t.name)}`);
    } else if (hasLineBreak(t.name)) {
      errors.push(`TENANT.name: must not contain carriage returns or newlines; got: ${fmt(t.name)}`);
    }
    if (typeof t.subdomain !== 'string' || !/^[a-z0-9-]+$/.test(t.subdomain)) {
      errors.push(`TENANT.subdomain: must match /^[a-z0-9-]+$/ (lowercase letters, digits, hyphens only); got: ${fmt(t.subdomain)}`);
    }
    if (typeof t.type !== 'string' || !t.type.trim()) {
      errors.push(`TENANT.type: must be a non-empty string; got: ${fmt(t.type)}`);
    } else if (hasLineBreak(t.type)) {
      errors.push(`TENANT.type: must not contain carriage returns or newlines; got: ${fmt(t.type)}`);
    }
  }

  // ADMINS
  if (!Array.isArray(roster.ADMINS) || roster.ADMINS.length === 0) {
    errors.push(`ADMINS: must be a non-empty array (at least one admin is required; the first admin's id is used as activated_by for tenant_intervention_bank); got: ${fmt(roster.ADMINS)}`);
  } else {
    roster.ADMINS.forEach((a, i) => {
      if (!a || typeof a !== 'object') {
        errors.push(`ADMINS[${i}]: must be an object; got: ${fmt(a)}`);
        return;
      }
      if (typeof a.email !== 'string' || !a.email.trim()) {
        errors.push(`ADMINS[${i}].email: must be a non-empty string; got: ${fmt(a.email)}`);
      }
      if (typeof a.full_name !== 'string' || !a.full_name.trim()) {
        errors.push(`ADMINS[${i}].full_name: must be a non-empty string; got: ${fmt(a.full_name)}`);
      } else if (hasLineBreak(a.full_name)) {
        errors.push(`ADMINS[${i}].full_name: must not contain carriage returns or newlines; got: ${fmt(a.full_name)}`);
      }
      // role is OPTIONAL on ADMINS. Defaults to 'district_admin' in buildSql.
      // If specified, must be one of ALLOWED_ROLES — typical override is
      // 'school_admin' for non-district tenants (charter, international).
      if (a.role !== undefined && !ALLOWED_ROLES.has(a.role)) {
        errors.push(`ADMINS[${i}].role: when specified, must be one of [${[...ALLOWED_ROLES].map(r => `'${r}'`).join(', ')}]; got: ${fmt(a.role)}`);
      }
    });
  }

  // STAFF
  if (!Array.isArray(roster.STAFF)) {
    errors.push(`STAFF: must be an array (may be empty); got: ${fmt(roster.STAFF)}`);
  } else {
    roster.STAFF.forEach((s, i) => {
      if (!s || typeof s !== 'object') {
        errors.push(`STAFF[${i}]: must be an object; got: ${fmt(s)}`);
        return;
      }
      if (typeof s.email !== 'string' || !s.email.trim()) {
        errors.push(`STAFF[${i}].email: must be a non-empty string; got: ${fmt(s.email)}`);
      }
      if (typeof s.full_name !== 'string' || !s.full_name.trim()) {
        errors.push(`STAFF[${i}].full_name: must be a non-empty string; got: ${fmt(s.full_name)}`);
      } else if (hasLineBreak(s.full_name)) {
        errors.push(`STAFF[${i}].full_name: must not contain carriage returns or newlines; got: ${fmt(s.full_name)}`);
      }
      if (typeof s.role !== 'string' || !ALLOWED_ROLES.has(s.role)) {
        errors.push(`STAFF[${i}].role: must be one of [${[...ALLOWED_ROLES].map(r => `'${r}'`).join(', ')}]; got: ${fmt(s.role)}`);
      }
      if (typeof s.school_wide_access !== 'boolean') {
        errors.push(`STAFF[${i}].school_wide_access: must be a boolean (true or false); got: ${fmt(s.school_wide_access)} (type: ${typeof s.school_wide_access}). This field is REQUIRED in the generic seed script. If you are migrating a roster from the Humble pattern, set school_wide_access explicitly on every STAFF entry — it is no longer inferred from role.`);
      }
    });
  }

  // Email uniqueness across ADMINS ∪ STAFF
  const collectEmails = (arr) =>
    Array.isArray(arr) ? arr.filter(x => x && typeof x.email === 'string').map(x => x.email) : [];
  const allEmails = [...collectEmails(roster.ADMINS), ...collectEmails(roster.STAFF)];
  const emailCounts = new Map();
  for (const e of allEmails) emailCounts.set(e, (emailCounts.get(e) || 0) + 1);
  for (const [email, count] of emailCounts) {
    if (count > 1) {
      errors.push(`email collision: ${fmt(email)} appears ${count} times across ADMINS+STAFF; emails must be unique within the roster`);
    }
  }

  // STUDENTS
  const studentIds = new Set();
  if (!Array.isArray(roster.STUDENTS) || roster.STUDENTS.length === 0) {
    errors.push(`STUDENTS: must be a non-empty array; got: ${fmt(roster.STUDENTS)}`);
  } else {
    const idCounts = new Map();
    roster.STUDENTS.forEach((s, i) => {
      if (!s || typeof s !== 'object') {
        errors.push(`STUDENTS[${i}]: must be an object; got: ${fmt(s)}`);
        return;
      }
      if (typeof s.external_id !== 'string' || !s.external_id.trim()) {
        errors.push(`STUDENTS[${i}].external_id: must be a non-empty string (used to cross-reference INTERVENTIONS, PROGRESS_NOTES, PARENT_LINK); got: ${fmt(s.external_id)}`);
      } else {
        idCounts.set(s.external_id, (idCounts.get(s.external_id) || 0) + 1);
        studentIds.add(s.external_id);
      }
      if (typeof s.first_name !== 'string' || !s.first_name.trim()) {
        errors.push(`STUDENTS[${i}].first_name: must be a non-empty string; got: ${fmt(s.first_name)}`);
      }
      if (typeof s.last_name !== 'string' || !s.last_name.trim()) {
        errors.push(`STUDENTS[${i}].last_name: must be a non-empty string; got: ${fmt(s.last_name)}`);
      }
      if (typeof s.grade !== 'string' || !s.grade.trim()) {
        errors.push(`STUDENTS[${i}].grade: must be a non-empty string; got: ${fmt(s.grade)}`);
      }
      if (!ALLOWED_TIERS.has(s.tier)) {
        errors.push(`STUDENTS[${i}].tier: must be one of [1, 2, 3]; got: ${fmt(s.tier)}`);
      }
      if (typeof s.area !== 'string' || !ALLOWED_AREAS.has(s.area)) {
        errors.push(`STUDENTS[${i}].area: must be one of [${[...ALLOWED_AREAS].map(a => `'${a}'`).join(', ')}]; got: ${fmt(s.area)}`);
      }
      if (typeof s.risk_level !== 'string' || !ALLOWED_RISK_LEVELS.has(s.risk_level)) {
        errors.push(`STUDENTS[${i}].risk_level: must be one of [${[...ALLOWED_RISK_LEVELS].map(r => `'${r}'`).join(', ')}]; got: ${fmt(s.risk_level)}`);
      }
    });
    for (const [id, count] of idCounts) {
      if (count > 1) {
        errors.push(`STUDENTS: external_id collision: ${fmt(id)} appears ${count} times; external_ids must be unique within STUDENTS`);
      }
    }
  }

  const accountEmails = new Set(allEmails);

  // INTERVENTIONS
  if (!Array.isArray(roster.INTERVENTIONS)) {
    errors.push(`INTERVENTIONS: must be an array (may be empty); got: ${fmt(roster.INTERVENTIONS)}`);
  } else {
    roster.INTERVENTIONS.forEach((iv, i) => {
      if (!iv || typeof iv !== 'object') {
        errors.push(`INTERVENTIONS[${i}]: must be an object; got: ${fmt(iv)}`);
        return;
      }
      if (typeof iv.student_external_id !== 'string') {
        errors.push(`INTERVENTIONS[${i}].student_external_id: must be a string; got: ${fmt(iv.student_external_id)}`);
      } else if (!studentIds.has(iv.student_external_id)) {
        errors.push(`INTERVENTIONS[${i}].student_external_id: ${fmt(iv.student_external_id)} does not match any STUDENTS[].external_id`);
      }
      if (typeof iv.template_name !== 'string' || !iv.template_name.trim()) {
        errors.push(`INTERVENTIONS[${i}].template_name: must be a non-empty string (must match an intervention_templates.name row where tenant_id IS NULL); got: ${fmt(iv.template_name)}`);
      }
      if (typeof iv.assigned_by_email !== 'string') {
        errors.push(`INTERVENTIONS[${i}].assigned_by_email: must be a string; got: ${fmt(iv.assigned_by_email)}`);
      } else if (!accountEmails.has(iv.assigned_by_email)) {
        errors.push(`INTERVENTIONS[${i}].assigned_by_email: ${fmt(iv.assigned_by_email)} does not match any ADMINS or STAFF email`);
      }
      if (!Number.isInteger(iv.progress) || iv.progress < 0 || iv.progress > 100) {
        errors.push(`INTERVENTIONS[${i}].progress: must be an integer in [0, 100]; got: ${fmt(iv.progress)}`);
      }
      if (!Number.isInteger(iv.start_age_days) || iv.start_age_days < 0) {
        errors.push(`INTERVENTIONS[${i}].start_age_days: must be a non-negative integer (days before today); got: ${fmt(iv.start_age_days)}`);
      }
      if (typeof iv.notes !== 'string') {
        errors.push(`INTERVENTIONS[${i}].notes: must be a string (may be empty); got: ${fmt(iv.notes)}`);
      }
    });
  }

  // PROGRESS_NOTES
  if (!Array.isArray(roster.PROGRESS_NOTES)) {
    errors.push(`PROGRESS_NOTES: must be an array (may be empty); got: ${fmt(roster.PROGRESS_NOTES)}`);
  } else {
    roster.PROGRESS_NOTES.forEach((n, i) => {
      if (!n || typeof n !== 'object') {
        errors.push(`PROGRESS_NOTES[${i}]: must be an object; got: ${fmt(n)}`);
        return;
      }
      if (typeof n.student_external_id !== 'string') {
        errors.push(`PROGRESS_NOTES[${i}].student_external_id: must be a string; got: ${fmt(n.student_external_id)}`);
      } else if (!studentIds.has(n.student_external_id)) {
        errors.push(`PROGRESS_NOTES[${i}].student_external_id: ${fmt(n.student_external_id)} does not match any STUDENTS[].external_id`);
      }
      if (typeof n.author_email !== 'string') {
        errors.push(`PROGRESS_NOTES[${i}].author_email: must be a string; got: ${fmt(n.author_email)}`);
      } else if (!accountEmails.has(n.author_email)) {
        errors.push(`PROGRESS_NOTES[${i}].author_email: ${fmt(n.author_email)} does not match any ADMINS or STAFF email`);
      }
      if (!Number.isInteger(n.age_days) || n.age_days < 0) {
        errors.push(`PROGRESS_NOTES[${i}].age_days: must be a non-negative integer (days before now); got: ${fmt(n.age_days)}`);
      }
      if (typeof n.note !== 'string' || !n.note.trim()) {
        errors.push(`PROGRESS_NOTES[${i}].note: must be a non-empty string; got: ${fmt(n.note)}`);
      }
    });
  }

  // PARENT_LINK (optional)
  if (roster.PARENT_LINK !== undefined && roster.PARENT_LINK !== null) {
    const link = roster.PARENT_LINK;
    if (typeof link !== 'object') {
      errors.push(`PARENT_LINK: must be an object or omitted; got: ${fmt(link)}`);
    } else {
      if (typeof link.parent_email !== 'string') {
        errors.push(`PARENT_LINK.parent_email: must be a string; got: ${fmt(link.parent_email)}`);
      } else if (!accountEmails.has(link.parent_email)) {
        errors.push(`PARENT_LINK.parent_email: ${fmt(link.parent_email)} does not match any ADMINS or STAFF email`);
      }
      if (typeof link.student_external_id !== 'string') {
        errors.push(`PARENT_LINK.student_external_id: must be a string; got: ${fmt(link.student_external_id)}`);
      } else if (!studentIds.has(link.student_external_id)) {
        errors.push(`PARENT_LINK.student_external_id: ${fmt(link.student_external_id)} does not match any STUDENTS[].external_id`);
      }
      if (typeof link.relationship !== 'string' || !link.relationship.trim()) {
        errors.push(`PARENT_LINK.relationship: must be a non-empty string; got: ${fmt(link.relationship)}`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function generatePassword() {
  return crypto.randomBytes(PASSWORD_BYTES).toString('base64url');
}

// Quote a string for embedding in a single-quoted SQL literal. Doubles any
// embedded single quotes. Bcrypt hashes contain `$`, `/`, `.`, alphanumerics
// — never a single quote, but we still go through the same escape path so
// the helper is safe for any string.
function sqlString(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

function sqlBool(b) {
  return b ? 'TRUE' : 'FALSE';
}

function sqlInt(n) {
  return String(parseInt(n, 10));
}

// ---------------------------------------------------------------------------
// Build SQL
// ---------------------------------------------------------------------------

async function buildSql(roster, rosterPath) {
  // Build accounts in stable order: admins first, then staff in roster
  // file order. This is also the order the password table will print.
  // ADMINS default to role='district_admin' but may override via a.role
  // (e.g., 'school_admin' for charter/international tenants).
  // school_wide_access stays hardcoded true for ADMINS.
  const accounts = [
    ...roster.ADMINS.map(a => ({
      email: a.email,
      full_name: a.full_name,
      role: a.role || 'district_admin',
      school_wide_access: true,
      kind: 'admin',
    })),
    ...roster.STAFF.map(s => ({
      email: s.email,
      full_name: s.full_name,
      role: s.role,
      school_wide_access: s.school_wide_access,
      kind: 'staff',
    })),
  ];

  // Index-based variable scheme: v_user_1 ... v_user_N, in account order.
  // First admin is always v_user_1 by construction (used as activated_by
  // for the tenant_intervention_bank auto-seed).
  const varByEmail = {};
  accounts.forEach((a, i) => { varByEmail[a.email] = `v_user_${i + 1}`; });

  // Generate one password + hash per account. Plaintext goes to a parallel
  // array we will print to stderr at the end. Hashes go into the SQL.
  const plaintexts = [];
  for (const a of accounts) {
    a.password = generatePassword();
    a.password_hash = await bcrypt.hash(a.password, BCRYPT_ROUNDS);
    plaintexts.push({ email: a.email, full_name: a.full_name, role: a.role, password: a.password });
  }

  const t = roster.TENANT;
  const allEmails = accounts.map(a => a.email);

  // Sanitize subdomain into a safe PL/pgSQL dollar-quote tag. Subdomain
  // hyphens are not legal in dollar-quote tags; replace any non-identifier
  // character with underscore. Fall back to 'sandbox' if everything was
  // stripped (the validator forbids that, but defense in depth).
  const tag = String(t.subdomain).replace(/[^a-zA-Z0-9_]/g, '_');
  const safeTag = tag || 'sandbox';

  const lines = [];

  lines.push('-- =========================================================================');
  lines.push(`-- Sandbox tenant '${t.name}' — provisioning SQL`);
  lines.push(`-- Generated by scripts/seed-tenant-sandbox-template.js from ${path.basename(rosterPath)}`);
  lines.push('-- Synthetic data only. No real PII. Email domain in the roster must be');
  lines.push('-- fictional or operator-controlled — never a real customer domain.');
  lines.push(`-- ${accounts.length} account(s), ${roster.STUDENTS.length} student(s), ${roster.INTERVENTIONS.length} intervention(s), ${roster.PROGRESS_NOTES.length} progress note(s)`);
  lines.push('-- Single transaction, hard-fails on existing subdomain or seed email.');
  lines.push('-- =========================================================================');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');
  lines.push(`DO $${safeTag}$`);
  lines.push('DECLARE');
  lines.push('  v_tenant_id      INTEGER;');
  // Emit one INTEGER variable per account, with a trailing comment naming
  // the email so the operator pasting the SQL can read which row is which.
  for (let i = 0; i < accounts.length; i += 1) {
    const a = accounts[i];
    lines.push(`  v_user_${i + 1}        INTEGER; -- ${a.email} (${a.role})`);
  }
  lines.push('  v_existing_email TEXT;');
  lines.push('BEGIN');
  lines.push('  -- Preflight 1: tenant subdomain must not already exist.');
  lines.push(`  IF EXISTS (SELECT 1 FROM tenants WHERE subdomain = ${sqlString(t.subdomain)}) THEN`);
  lines.push(`    RAISE EXCEPTION 'ABORT: tenant with subdomain % already exists', ${sqlString(t.subdomain)};`);
  lines.push('  END IF;');
  lines.push('');
  lines.push('  -- Preflight 2: none of the seed emails may already exist (any tenant).');
  lines.push('  SELECT email INTO v_existing_email FROM users WHERE email IN (');
  lines.push('    ' + allEmails.map(sqlString).join(', '));
  lines.push('  ) LIMIT 1;');
  lines.push('  IF v_existing_email IS NOT NULL THEN');
  lines.push('    RAISE EXCEPTION \'ABORT: seed email % already exists in users table\', v_existing_email;');
  lines.push('  END IF;');
  lines.push('');

  // Preflight 3: every distinct intervention template name referenced by
  // the roster must map to exactly one row in the system-default bank.
  // Without this, a missing name would silently insert NULL into
  // student_interventions.intervention_template_id, and a duplicate name
  // would silently rely on Postgres' arbitrary row pick. Both are loud
  // failures only because of this preflight. Skip entirely if the roster
  // has no interventions — there's nothing to gate on.
  if (roster.INTERVENTIONS.length > 0) {
    const distinctTemplateNames = [...new Set(roster.INTERVENTIONS.map(i => i.template_name))];
    lines.push('  -- Preflight 3: every intervention template referenced by the roster must');
    lines.push('  -- match exactly one row in the system-default bank (tenant_id IS NULL).');
    lines.push('  -- A missing or duplicated name would otherwise silently produce a NULL');
    lines.push('  -- intervention_template_id or an arbitrary pick.');
    lines.push('  DECLARE');
    lines.push('    v_template_name    TEXT;');
    lines.push('    v_template_count   INTEGER;');
    lines.push('  BEGIN');
    lines.push('    FOR v_template_name IN SELECT unnest(ARRAY[');
    lines.push('      ' + distinctTemplateNames.map(sqlString).join(', '));
    lines.push('    ]::TEXT[]) LOOP');
    lines.push('      SELECT COUNT(*) INTO v_template_count');
    lines.push('      FROM intervention_templates');
    lines.push('      WHERE name = v_template_name AND tenant_id IS NULL;');
    lines.push('      IF v_template_count <> 1 THEN');
    lines.push('        RAISE EXCEPTION \'ABORT: intervention template % matches % system-default rows (expected exactly 1)\', v_template_name, v_template_count;');
    lines.push('      END IF;');
    lines.push('    END LOOP;');
    lines.push('  END;');
    lines.push('');
  }

  lines.push('  -- ----- Tenant -----');
  lines.push('  INSERT INTO tenants (name, type, subdomain)');
  lines.push(`  VALUES (${sqlString(t.name)}, ${sqlString(t.type)}, ${sqlString(t.subdomain)})`);
  lines.push('  RETURNING id INTO v_tenant_id;');
  lines.push('');
  lines.push('  -- ----- User accounts -----');
  lines.push('  -- Each account gets a bcrypt-hashed password generated locally and');
  lines.push('  -- printed to operator stderr at script-run time. Hashes only appear');
  lines.push('  -- here; plaintext lives nowhere persistent.');
  lines.push('');

  for (const a of accounts) {
    lines.push(`  -- ${a.email} (${a.role})`);
    lines.push('  INSERT INTO users (tenant_id, email, password_hash, full_name, role, school_wide_access)');
    lines.push(`  VALUES (v_tenant_id, ${sqlString(a.email)}, ${sqlString(a.password_hash)}, ${sqlString(a.full_name)}, ${sqlString(a.role)}, ${sqlBool(a.school_wide_access)})`);
    lines.push(`  RETURNING id INTO ${varByEmail[a.email]};`);
    lines.push('');
  }

  lines.push('  -- ----- Students -----');
  for (const s of roster.STUDENTS) {
    lines.push(
      `  INSERT INTO students (tenant_id, first_name, last_name, grade, tier, area, risk_level) VALUES ` +
      `(v_tenant_id, ${sqlString(s.first_name)}, ${sqlString(s.last_name)}, ${sqlString(s.grade)}, ${sqlInt(s.tier)}, ${sqlString(s.area)}, ${sqlString(s.risk_level)});`
    );
  }
  lines.push('');

  if (roster.INTERVENTIONS.length > 0) {
    lines.push('  -- ----- Active interventions (Tier 2 + Tier 3) -----');
    lines.push('  -- intervention_template_id is looked up by name from the system-default');
    lines.push('  -- bank (tenant_id IS NULL). assigned_by is the user-id variable for the');
    lines.push('  -- staff member listed in the roster. start_date is computed from today.');
    lines.push('');
    for (const iv of roster.INTERVENTIONS) {
      const student = roster.STUDENTS.find(s => s.external_id === iv.student_external_id);
      // Validator already guarantees these resolve, but defense in depth:
      if (!student) throw new Error(`Roster mismatch: no student for ${iv.student_external_id}`);
      const assignerVar = varByEmail[iv.assigned_by_email];
      if (!assignerVar) throw new Error(`Roster mismatch: no user var for ${iv.assigned_by_email}`);
      lines.push(`  -- ${student.first_name} ${student.last_name} (${student.external_id}) — ${iv.template_name}`);
      lines.push('  INSERT INTO student_interventions (student_id, intervention_template_id, assigned_by, intervention_name, notes, status, progress, start_date)');
      lines.push('  SELECT s.id,');
      // No LIMIT 1: Preflight 3 guarantees exactly one match, and dropping
      // LIMIT 1 means a future regression (someone duplicates a template
      // name) would surface as a Postgres error instead of an arbitrary-
      // pick silent bug.
      lines.push('         (SELECT id FROM intervention_templates WHERE name = ' + sqlString(iv.template_name) + ' AND tenant_id IS NULL),');
      lines.push(`         ${assignerVar},`);
      lines.push(`         ${sqlString(iv.template_name)},`);
      lines.push(`         ${sqlString(iv.notes)},`);
      lines.push(`         'active',`);
      lines.push(`         ${sqlInt(iv.progress)},`);
      lines.push(`         CURRENT_DATE - INTERVAL '${sqlInt(iv.start_age_days)} days'`);
      lines.push(`  FROM students s WHERE s.tenant_id = v_tenant_id AND s.first_name = ${sqlString(student.first_name)} AND s.last_name = ${sqlString(student.last_name)};`);
      lines.push('');
    }
  }

  if (roster.PROGRESS_NOTES.length > 0) {
    lines.push('  -- ----- Progress notes -----');
    lines.push('  -- created_at = CURRENT_TIMESTAMP - INTERVAL \'<age_days> days\' so the');
    lines.push('  -- chronology renders correctly in the activity feed.');
    lines.push('');
    for (const n of roster.PROGRESS_NOTES) {
      const student = roster.STUDENTS.find(s => s.external_id === n.student_external_id);
      if (!student) throw new Error(`Roster mismatch: no student for ${n.student_external_id}`);
      const authorVar = varByEmail[n.author_email];
      if (!authorVar) throw new Error(`Roster mismatch: no user var for ${n.author_email}`);
      lines.push('  INSERT INTO progress_notes (student_id, author_id, note, created_at)');
      lines.push('  SELECT s.id,');
      lines.push(`         ${authorVar},`);
      lines.push(`         ${sqlString(n.note)},`);
      lines.push(`         CURRENT_TIMESTAMP - INTERVAL '${sqlInt(n.age_days)} days'`);
      lines.push(`  FROM students s WHERE s.tenant_id = v_tenant_id AND s.first_name = ${sqlString(student.first_name)} AND s.last_name = ${sqlString(student.last_name)};`);
    }
    lines.push('');
  }

  if (roster.PARENT_LINK) {
    lines.push('  -- ----- Parent → student link -----');
    lines.push('  -- parent_student_links has NO tenant_id column (known followup; see CLAUDE.md');
    lines.push('  -- and routes/auth.js:341).');
    const link = roster.PARENT_LINK;
    const student = roster.STUDENTS.find(s => s.external_id === link.student_external_id);
    if (!student) throw new Error(`Roster mismatch: no student for parent link ${link.student_external_id}`);
    const parentVar = varByEmail[link.parent_email];
    if (!parentVar) throw new Error(`Roster mismatch: no user var for ${link.parent_email}`);
    lines.push('  INSERT INTO parent_student_links (parent_user_id, student_id, relationship)');
    lines.push(`  SELECT ${parentVar}, s.id, ${sqlString(link.relationship)}`);
    lines.push(`  FROM students s WHERE s.tenant_id = v_tenant_id AND s.first_name = ${sqlString(student.first_name)} AND s.last_name = ${sqlString(student.last_name)};`);
    lines.push('');
  }

  lines.push('  -- ----- Tenant intervention bank (mirror routes/tenants.js:53-66 auto-seed) -----');
  lines.push('  -- The API\'s POST /api/tenants endpoint auto-activates every system-default');
  lines.push('  -- template flagged is_starter = TRUE. We are bypassing that endpoint by');
  lines.push('  -- inserting the tenant directly, so we mirror the same logic here. activated_by');
  lines.push('  -- is set to the first admin (v_user_1) so the audit trail points somewhere');
  lines.push('  -- sensible.');
  lines.push('  INSERT INTO tenant_intervention_bank (tenant_id, template_id, activated_by)');
  lines.push('  SELECT v_tenant_id, id, v_user_1');
  lines.push('  FROM intervention_templates');
  lines.push('  WHERE tenant_id IS NULL AND is_starter = TRUE');
  lines.push('  ON CONFLICT (tenant_id, template_id) DO NOTHING;');
  lines.push('');
  lines.push(`  RAISE NOTICE 'Sandbox tenant ''${t.name.replace(/'/g, "''")}'' provisioned. Tenant id: %', v_tenant_id;`);
  lines.push('END');
  lines.push(`$${safeTag}$;`);
  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  return { sql: lines.join('\n'), plaintexts };
}

// ---------------------------------------------------------------------------
// Render password table to stderr (never stdout, never disk)
// ---------------------------------------------------------------------------

function printPasswordTable(plaintexts, tenantName) {
  const stderr = process.stderr;

  const headers = ['Email', 'Role', 'Full name', 'Password'];
  const rows = plaintexts.map(p => [p.email, p.role, p.full_name, p.password]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));

  const fmtRow = (cells) =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '+-' + widths.map(w => '-'.repeat(w)).join('-+-') + '-+';

  stderr.write('\n');
  stderr.write('=========================================================================\n');
  stderr.write(`  Sandbox tenant '${tenantName}' — generated passwords (one-time output)\n`);
  stderr.write('=========================================================================\n');
  stderr.write('\n');
  stderr.write(sep + '\n');
  stderr.write(fmtRow(headers) + '\n');
  stderr.write(sep + '\n');
  for (const r of rows) stderr.write(fmtRow(r) + '\n');
  stderr.write(sep + '\n');
  stderr.write('\n');
  stderr.write('Hand these to the customer via a one-time secret-sharing channel.\n');
  stderr.write('They are not stored anywhere. Re-running this script generates new ones,\n');
  stderr.write('which would not match the bcrypt hashes already pasted into Render.\n');
  stderr.write('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`seed-tenant-sandbox-template: ${err.message}\n\n${USAGE}\n`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  if (!args.roster) {
    process.stderr.write(`seed-tenant-sandbox-template: missing required argument --roster <ABSOLUTE_PATH>\n\n${USAGE}\n`);
    process.exit(2);
  }

  let roster;
  try {
    roster = loadRoster(args.roster);
  } catch (err) {
    process.stderr.write(`seed-tenant-sandbox-template: ${err.message}\n`);
    process.exit(2);
  }

  const errors = validateRoster(roster);
  if (errors.length > 0) {
    process.stderr.write(`seed-tenant-sandbox-template: roster validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(3);
  }

  const { sql, plaintexts } = await buildSql(roster, args.roster);

  // SQL → stdout (suitable for `> seed.sql` redirect).
  process.stdout.write(sql);

  // Passwords → stderr (visible to operator even when stdout is redirected).
  printPasswordTable(plaintexts, roster.TENANT.name);
}

main().catch(err => {
  process.stderr.write(`seed-tenant-sandbox-template: ${err.message}\n`);
  process.exit(1);
});
