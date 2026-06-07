#!/usr/bin/env node
/**
 * scripts/seed-district-sandbox.js
 *
 * Local-only SQL emitter for provisioning the synthetic multi-school
 * sandbox district used by the §5 non-leakage proof for
 * GET /api/discipline-referrals/export (owed since PR #244).
 *
 * Reads data/sandbox-district-roster-template.js — the single source
 * of truth for the fixture's district / schools / users / students /
 * referrals. To change the fixture, edit that roster and re-run.
 *
 * SECURITY MODEL (mirrors scripts/seed-tenant-sandbox-template.js):
 *   1. The script never opens a database connection. No `pg` import,
 *      no DATABASE_URL read, no network. It hashes passwords locally
 *      and writes SQL to stdout.
 *   2. Generated plaintext passwords exist in this process's memory
 *      for the lifetime of the run, are written exactly once to
 *      stderr, and are never written to stdout, disk, or logs.
 *   3. Only bcrypt hashes appear in the emitted SQL.
 *   4. The emitted SQL hard-fails inside a single transaction if any
 *      preflight tripwire trips: existing district name, existing
 *      subdomain, or existing seed email. Partial state is impossible.
 *
 * SQL CONSTRUCTION DISCIPLINE:
 *   - Every roster string flows through sqlString() (single-quote-
 *     doubling escape). No raw template interpolation of roster
 *     values. Schema-derived literals (column names, table names) are
 *     ASCII and never user-controlled.
 *   - Roster integers flow through sqlInt() (parseInt) and roster
 *     booleans through sqlBool().
 *   - This script is the emitter, not the consumer. The pg driver's
 *     parameterized $1 placeholders are not available here because
 *     this script intentionally never connects to a DB — the
 *     operator pastes the SQL elsewhere. The escape helpers carry
 *     the same safety contract.
 *
 * FOUR-STEP SMOKE (run after applying the seed SQL):
 *   Login as district-admin@sandbox-district.example. With that
 *   session cookie:
 *
 *   1. GET /api/discipline-referrals/export
 *        Expected: CSV header + 5 data rows. ZERO rows from School C.
 *        The two School C referrals seeded with date+status overlap
 *        to A/B rows MUST NOT appear.
 *
 *   2. GET /api/discipline-referrals/export?school_tenant_id=<SCHOOL_A_ID>
 *        Expected: CSV header + 3 data rows (all from School A).
 *
 *   3. GET /api/discipline-referrals/export?school_tenant_id=<SCHOOL_C_ID>
 *        Expected: 403 Forbidden, indistinguishable from a request
 *        with a nonexistent tenant id (probe-resistant collapse).
 *
 *   4. Logout, login as school-a-counselor@sandbox-district.example,
 *      repeat step 1.
 *        Expected: CSV header + 3 data rows (all from School A).
 *        Zero rows from B and zero from C.
 *
 *   The seed RAISE NOTICE at COMMIT prints v_district_id and each
 *   v_school_<slug>_id so the operator can substitute SCHOOL_A_ID,
 *   SCHOOL_B_ID, SCHOOL_C_ID into the smoke URLs without an extra
 *   SELECT.
 *
 * Tear-down: scripts/teardown-district-sandbox.js emits the matching
 * delete SQL keyed on the district name. Audit rows in
 * user_school_access_audit are intentionally left behind per FERPA
 * §99.32 — see M031 header.
 *
 * Usage:
 *   node scripts/seed-district-sandbox.js > /tmp/sandbox-district-seed.sql
 *   # paste /tmp/sandbox-district-seed.sql into the target DB's psql
 *   # session; the password table prints to stderr (your terminal).
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');

const BCRYPT_ROUNDS = 10;
const PASSWORD_BYTES = 12; // ~96 bits entropy → 16-char base64url

const roster = require(path.join('..', 'data', 'sandbox-district-roster-template'));
const { ELEVATED_ROLES } = require('../constants/roles');
const {
  LOCATIONS,
  MOTIVATIONS,
  OTHERS_INVOLVED,
  CONSEQUENCES,
  HARASSMENT_SUBTYPES,
  WEAPON_SUBTYPES,
  BEHAVIORS,
} = require('../data/discipline-vocab-seeds');

// ---------------------------------------------------------------------------
// Escape helpers — every roster value passes through these.
// ---------------------------------------------------------------------------

function sqlString(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}
function sqlBool(b) { return b ? 'TRUE' : 'FALSE'; }
function sqlInt(n) { return String(parseInt(n, 10)); }

function generatePassword() {
  return crypto.randomBytes(PASSWORD_BYTES).toString('base64url');
}

// Sanity-check the roster — fixture is committed so we don't need a full
// validator, but guard against shape drift if someone edits the roster
// without re-reading the contract.
function sanityCheckRoster(r) {
  if (!r.DISTRICT || typeof r.DISTRICT.name !== 'string' || !r.DISTRICT.name.trim()) {
    throw new Error('roster.DISTRICT.name must be a non-empty string');
  }
  if (!Array.isArray(r.SCHOOLS) || r.SCHOOLS.length === 0) {
    throw new Error('roster.SCHOOLS must be a non-empty array');
  }
  const slugSet = new Set();
  for (const s of r.SCHOOLS) {
    if (!s.slug || !s.name || !s.subdomain) {
      throw new Error('roster.SCHOOLS[].slug/name/subdomain are all required');
    }
    if (!/^[a-z0-9-]+$/.test(s.subdomain)) {
      throw new Error(`roster.SCHOOLS[].subdomain must match /^[a-z0-9-]+$/; got: ${s.subdomain}`);
    }
    slugSet.add(s.slug);
  }
  if (!Array.isArray(r.USERS) || r.USERS.length === 0) {
    throw new Error('roster.USERS must be a non-empty array');
  }
  const emailSet = new Set();
  for (const u of r.USERS) {
    if (!u.email || !u.full_name || !u.role || !u.home_school_slug) {
      throw new Error('roster.USERS[].email/full_name/role/home_school_slug all required');
    }
    if (emailSet.has(u.email)) throw new Error(`roster.USERS: duplicate email ${u.email}`);
    emailSet.add(u.email);
    if (!slugSet.has(u.home_school_slug)) {
      throw new Error(`roster.USERS[${u.email}].home_school_slug '${u.home_school_slug}' not in SCHOOLS`);
    }
    if (!Array.isArray(u.school_access) || u.school_access.length === 0) {
      throw new Error(`roster.USERS[${u.email}].school_access must be a non-empty array`);
    }
    for (const sl of u.school_access) {
      if (!slugSet.has(sl)) {
        throw new Error(`roster.USERS[${u.email}].school_access references unknown slug '${sl}'`);
      }
    }
  }
  if (!Array.isArray(r.STUDENTS) || r.STUDENTS.length === 0) {
    throw new Error('roster.STUDENTS must be a non-empty array');
  }
  const externalIdSet = new Set();
  for (const s of r.STUDENTS) {
    if (!s.external_id || !s.tenant_slug || !s.first_name || !s.last_name || !s.grade) {
      throw new Error('roster.STUDENTS[].external_id/tenant_slug/first_name/last_name/grade all required');
    }
    if (externalIdSet.has(s.external_id)) {
      throw new Error(`roster.STUDENTS: duplicate external_id ${s.external_id}`);
    }
    externalIdSet.add(s.external_id);
    if (!slugSet.has(s.tenant_slug)) {
      throw new Error(`roster.STUDENTS[${s.external_id}].tenant_slug '${s.tenant_slug}' not in SCHOOLS`);
    }
  }
  if (!Array.isArray(r.REFERRALS)) {
    throw new Error('roster.REFERRALS must be an array (may be empty)');
  }
  for (const ref of r.REFERRALS) {
    if (!externalIdSet.has(ref.student_external_id)) {
      throw new Error(`roster.REFERRALS references unknown student_external_id '${ref.student_external_id}'`);
    }
    if (!emailSet.has(ref.referring_staff_email)) {
      throw new Error(`roster.REFERRALS references unknown referring_staff_email '${ref.referring_staff_email}'`);
    }
    if (!Number.isInteger(ref.incident_date_offset) || ref.incident_date_offset > 0) {
      throw new Error(`roster.REFERRALS.incident_date_offset must be a non-positive integer; got ${ref.incident_date_offset}`);
    }
    if (!['submitted', 'under_review', 'resolved'].includes(ref.status)) {
      throw new Error(`roster.REFERRALS.status must be one of submitted/under_review/resolved; got ${ref.status}`);
    }
  }
}

// Emit one of the 7 discipline-vocab INSERT blocks, scoped to a single
// tenant variable. Mirrors seedDisciplineVocabsForTenant from
// data/discipline-vocab-seeds.js but as PL/pgSQL inside the seed
// transaction instead of pg-driver parameterized SQL.
function emitVocabBlock(lines, tenantVar, table, cols) {
  const colList = cols.map((c) => c.name).join(', ');
  lines.push(`  INSERT INTO ${table} (tenant_id, ${colList})`);
  lines.push(`  SELECT ${tenantVar}, ${colList}`);
  const arrayClauses = cols.map((c) => {
    const lits = c.values.map((v) => {
      if (c.type === 'int') return sqlInt(v);
      if (c.type === 'boolean') return sqlBool(v);
      return sqlString(v);
    }).join(', ');
    return `ARRAY[${lits}]::${c.type}[]`;
  }).join(', ');
  lines.push(`  FROM unnest(${arrayClauses}) AS v(${colList})`);
  lines.push('  ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING;');
  lines.push('');
}

function emitAllVocabForTenant(lines, tenantVar) {
  emitVocabBlock(lines, tenantVar, 'discipline_locations', [
    { name: 'label', type: 'text', values: LOCATIONS.map((r) => r.label) },
    { name: 'sort_order', type: 'int', values: LOCATIONS.map((r) => r.sort_order) },
  ]);
  emitVocabBlock(lines, tenantVar, 'discipline_motivations', [
    { name: 'label', type: 'text', values: MOTIVATIONS.map((r) => r.label) },
    { name: 'sort_order', type: 'int', values: MOTIVATIONS.map((r) => r.sort_order) },
  ]);
  emitVocabBlock(lines, tenantVar, 'discipline_others_involved', [
    { name: 'label', type: 'text', values: OTHERS_INVOLVED.map((r) => r.label) },
    { name: 'sort_order', type: 'int', values: OTHERS_INVOLVED.map((r) => r.sort_order) },
  ]);
  emitVocabBlock(lines, tenantVar, 'discipline_consequences', [
    { name: 'label', type: 'text', values: CONSEQUENCES.map((r) => r.label) },
    { name: 'sort_order', type: 'int', values: CONSEQUENCES.map((r) => r.sort_order) },
    { name: 'is_restorative', type: 'boolean', values: CONSEQUENCES.map((r) => r.is_restorative) },
  ]);
  emitVocabBlock(lines, tenantVar, 'discipline_harassment_subtypes', [
    { name: 'label', type: 'text', values: HARASSMENT_SUBTYPES.map((r) => r.label) },
    { name: 'sort_order', type: 'int', values: HARASSMENT_SUBTYPES.map((r) => r.sort_order) },
  ]);
  emitVocabBlock(lines, tenantVar, 'discipline_weapon_subtypes', [
    { name: 'label', type: 'text', values: WEAPON_SUBTYPES.map((r) => r.label) },
    { name: 'sort_order', type: 'int', values: WEAPON_SUBTYPES.map((r) => r.sort_order) },
  ]);
  emitVocabBlock(lines, tenantVar, 'discipline_behaviors', [
    { name: 'label', type: 'text', values: BEHAVIORS.map((r) => r.label) },
    { name: 'sort_order', type: 'int', values: BEHAVIORS.map((r) => r.sort_order) },
    { name: 'severity_level', type: 'int', values: BEHAVIORS.map((r) => r.severity_level) },
    { name: 'managed_by', type: 'varchar', values: BEHAVIORS.map((r) => r.managed_by) },
  ]);
}

// ---------------------------------------------------------------------------
// Build SQL
// ---------------------------------------------------------------------------

async function buildSql() {
  sanityCheckRoster(roster);

  // ELEVATED_ROLES → school_wide_access=true; otherwise false. Computed
  // here so the roster doesn't carry the boolean (one less drift surface).
  const accountsWithAccess = roster.USERS.map((u) => ({
    ...u,
    school_wide_access: ELEVATED_ROLES.includes(u.role),
  }));

  // Variable naming maps.
  const schoolVarBySlug = {};
  roster.SCHOOLS.forEach((s) => { schoolVarBySlug[s.slug] = `v_school_${s.slug.toLowerCase()}_id`; });
  const userVarByEmail = {};
  accountsWithAccess.forEach((u, i) => { userVarByEmail[u.email] = `v_user_${i + 1}_id`; });
  const studentVarByExternalId = {};
  roster.STUDENTS.forEach((s, i) => { studentVarByExternalId[s.external_id] = `v_student_${i + 1}_id`; });

  // Generate one password + hash per account.
  const plaintexts = [];
  for (const a of accountsWithAccess) {
    a.password = generatePassword();
    a.password_hash = await bcrypt.hash(a.password, BCRYPT_ROUNDS);
    plaintexts.push({ email: a.email, full_name: a.full_name, role: a.role, password: a.password });
  }

  const allEmails = accountsWithAccess.map((a) => a.email);
  const allSubdomains = roster.SCHOOLS.map((s) => s.subdomain);

  const lines = [];
  const TAG = 'sandbox_district_fixture';

  lines.push('-- ============================================================================');
  lines.push(`-- Sandbox district fixture — ${roster.DISTRICT.name}`);
  lines.push('-- Generated by scripts/seed-district-sandbox.js');
  lines.push('-- Synthetic data only. No real PII. sandbox-district.example domain is');
  lines.push('-- RFC 2606 reserved (guaranteed non-routable, guaranteed no collision).');
  lines.push(`-- ${roster.SCHOOLS.length} school(s), ${accountsWithAccess.length} user(s), ${roster.STUDENTS.length} student(s), ${roster.REFERRALS.length} referral(s)`);
  lines.push('-- Single transaction; hard-fails on existing district name, existing');
  lines.push('-- subdomain, or existing seed email.');
  lines.push('-- ============================================================================');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');
  lines.push(`DO $${TAG}$`);
  lines.push('DECLARE');
  lines.push('  v_district_id    INTEGER;');
  for (const s of roster.SCHOOLS) {
    lines.push(`  ${schoolVarBySlug[s.slug]}  INTEGER; -- ${s.subdomain} (${s.name})`);
  }
  for (let i = 0; i < accountsWithAccess.length; i += 1) {
    const u = accountsWithAccess[i];
    lines.push(`  ${userVarByEmail[u.email]}     INTEGER; -- ${u.email} (${u.role})`);
  }
  for (let i = 0; i < roster.STUDENTS.length; i += 1) {
    const s = roster.STUDENTS[i];
    lines.push(`  ${studentVarByExternalId[s.external_id]}  INTEGER; -- ${s.external_id} (${s.first_name} ${s.last_name}, school ${s.tenant_slug})`);
  }
  lines.push('  v_existing_email TEXT;');
  lines.push('  v_existing_sub   TEXT;');
  lines.push('BEGIN');
  lines.push('  -- Preflight 1: district name must not already exist.');
  lines.push(`  IF EXISTS (SELECT 1 FROM districts WHERE name = ${sqlString(roster.DISTRICT.name)}) THEN`);
  lines.push(`    RAISE EXCEPTION 'ABORT: district name % already exists', ${sqlString(roster.DISTRICT.name)};`);
  lines.push('  END IF;');
  lines.push('');
  lines.push('  -- Preflight 2: none of the seed subdomains may already exist.');
  lines.push('  SELECT subdomain INTO v_existing_sub FROM tenants WHERE subdomain IN (');
  lines.push('    ' + allSubdomains.map(sqlString).join(', '));
  lines.push('  ) LIMIT 1;');
  lines.push('  IF v_existing_sub IS NOT NULL THEN');
  lines.push('    RAISE EXCEPTION \'ABORT: tenant subdomain % already exists\', v_existing_sub;');
  lines.push('  END IF;');
  lines.push('');
  lines.push('  -- Preflight 3: none of the seed emails may already exist (any tenant).');
  lines.push('  SELECT email INTO v_existing_email FROM users WHERE email IN (');
  lines.push('    ' + allEmails.map(sqlString).join(', '));
  lines.push('  ) LIMIT 1;');
  lines.push('  IF v_existing_email IS NOT NULL THEN');
  lines.push('    RAISE EXCEPTION \'ABORT: seed email % already exists in users table\', v_existing_email;');
  lines.push('  END IF;');
  lines.push('');

  // -- District --
  lines.push('  -- ----- District -----');
  lines.push('  INSERT INTO districts (name)');
  lines.push(`  VALUES (${sqlString(roster.DISTRICT.name)})`);
  lines.push('  RETURNING id INTO v_district_id;');
  lines.push('');

  // -- Schools (tenants) --
  lines.push('  -- ----- Schools (type=school, district_id=v_district_id) -----');
  for (const s of roster.SCHOOLS) {
    lines.push(`  -- ${s.slug}: ${s.name}`);
    lines.push('  INSERT INTO tenants (name, type, subdomain, district_id)');
    lines.push(`  VALUES (${sqlString(s.name)}, 'school', ${sqlString(s.subdomain)}, v_district_id)`);
    lines.push(`  RETURNING id INTO ${schoolVarBySlug[s.slug]};`);
    lines.push('');
  }

  // -- Users --
  // tenant_id = home_school var; district_id = v_district_id (so the
  // composite FK on user_school_access fires and the dual-path resolver
  // takes the district branch).
  lines.push('  -- ----- Users (district_id set; tenant_id = home school) -----');
  for (const u of accountsWithAccess) {
    const homeVar = schoolVarBySlug[u.home_school_slug];
    lines.push(`  -- ${u.email} (${u.role}) — home ${u.home_school_slug}, access [${u.school_access.join(',')}]`);
    lines.push('  INSERT INTO users (tenant_id, email, password_hash, full_name, role, school_wide_access, district_id)');
    lines.push(`  VALUES (${homeVar}, ${sqlString(u.email)}, ${sqlString(u.password_hash)}, ${sqlString(u.full_name)}, ${sqlString(u.role)}, ${sqlBool(u.school_wide_access)}, v_district_id)`);
    lines.push(`  RETURNING id INTO ${userVarByEmail[u.email]};`);
    lines.push('');
  }

  // -- user_school_access membership --
  // The composite FKs on user_school_access enforce that
  // (school_tenant_id, district_id) is a row in tenants and
  // (user_id, district_id) is a row in users. Cross-district rows are
  // rejected at the schema layer.
  lines.push('  -- ----- user_school_access (the §5 access membership) -----');
  for (const u of accountsWithAccess) {
    for (const slug of u.school_access) {
      const schoolVar = schoolVarBySlug[slug];
      const userVar = userVarByEmail[u.email];
      lines.push(`  -- ${u.email} → school ${slug}`);
      lines.push('  INSERT INTO user_school_access (user_id, district_id, school_tenant_id)');
      lines.push(`  VALUES (${userVar}, v_district_id, ${schoolVar});`);
    }
  }
  lines.push('');

  // -- Students --
  lines.push('  -- ----- Students (one per school, scoped via tenant_id) -----');
  for (const s of roster.STUDENTS) {
    const tenantVar = schoolVarBySlug[s.tenant_slug];
    const studentVar = studentVarByExternalId[s.external_id];
    lines.push(`  -- ${s.external_id} — ${s.first_name} ${s.last_name} (school ${s.tenant_slug})`);
    lines.push('  INSERT INTO students (tenant_id, external_id, first_name, last_name, grade)');
    lines.push(`  VALUES (${tenantVar}, ${sqlString(s.external_id)}, ${sqlString(s.first_name)}, ${sqlString(s.last_name)}, ${sqlString(s.grade)})`);
    lines.push(`  RETURNING id INTO ${studentVar};`);
    lines.push('');
  }

  // -- Discipline vocab per school --
  lines.push('  -- ----- Discipline-vocab seed (per-school, mirrors seedDisciplineVocabsForTenant) -----');
  for (const s of roster.SCHOOLS) {
    lines.push(`  -- vocab → school ${s.slug}`);
    emitAllVocabForTenant(lines, schoolVarBySlug[s.slug]);
  }

  // -- Discipline referrals --
  // location_id / behavior_id are resolved per-tenant via subquery
  // against the just-seeded vocab. The (tenant_id, lower(label)) WHERE
  // is_active = TRUE partial-unique index guarantees one match.
  lines.push('  -- ----- Discipline referrals -----');
  for (let i = 0; i < roster.REFERRALS.length; i += 1) {
    const ref = roster.REFERRALS[i];
    const student = roster.STUDENTS.find((s) => s.external_id === ref.student_external_id);
    const tenantVar = schoolVarBySlug[student.tenant_slug];
    const studentVar = studentVarByExternalId[ref.student_external_id];
    const staffVar = userVarByEmail[ref.referring_staff_email];
    lines.push(`  -- Referral ${i + 1}: school ${student.tenant_slug}, status=${ref.status}, date=CURRENT_DATE${ref.incident_date_offset}, behavior=${ref.behavior_label}`);
    lines.push('  INSERT INTO discipline_referrals (tenant_id, student_id, referring_staff_id, grade, incident_date, location_id, behavior_id, status)');
    lines.push(`  VALUES (${tenantVar}, ${studentVar}, ${staffVar}, ${sqlString(student.grade)},`);
    lines.push(`         CURRENT_DATE - INTERVAL '${sqlInt(Math.abs(ref.incident_date_offset))} days',`);
    lines.push(`         (SELECT id FROM discipline_locations WHERE tenant_id = ${tenantVar} AND label = ${sqlString(ref.location_label)} AND is_active = TRUE),`);
    lines.push(`         (SELECT id FROM discipline_behaviors WHERE tenant_id = ${tenantVar} AND label = ${sqlString(ref.behavior_label)} AND is_active = TRUE),`);
    lines.push(`         ${sqlString(ref.status)});`);
    lines.push('');
  }

  // -- Closing NOTICE block --
  lines.push('  RAISE NOTICE \'Sandbox district fixture provisioned.\';');
  lines.push('  RAISE NOTICE \'  v_district_id = %\', v_district_id;');
  for (const s of roster.SCHOOLS) {
    lines.push(`  RAISE NOTICE '  ${schoolVarBySlug[s.slug]} (${s.slug}: ${s.name.replace(/'/g, "''")}) = %', ${schoolVarBySlug[s.slug]};`);
  }
  lines.push('END');
  lines.push(`$${TAG}$;`);
  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  return { sql: lines.join('\n'), plaintexts };
}

// ---------------------------------------------------------------------------
// Password table → stderr (one-time output; never stdout, never disk)
// ---------------------------------------------------------------------------

function printPasswordTable(plaintexts) {
  const err = process.stderr;
  const headers = ['Email', 'Role', 'Full name', 'Password'];
  const rows = plaintexts.map((p) => [p.email, p.role, p.full_name, p.password]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmtRow = (cells) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '+-' + widths.map((w) => '-'.repeat(w)).join('-+-') + '-+';
  err.write('\n');
  err.write('=========================================================================\n');
  err.write('  Sandbox district fixture — generated passwords (one-time output)\n');
  err.write('=========================================================================\n');
  err.write('\n');
  err.write(sep + '\n');
  err.write(fmtRow(headers) + '\n');
  err.write(sep + '\n');
  for (const r of rows) err.write(fmtRow(r) + '\n');
  err.write(sep + '\n');
  err.write('\n');
  err.write('These exist nowhere persistent. Re-running this script generates new\n');
  err.write('passwords that would not match the bcrypt hashes already in the DB.\n');
  err.write('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { sql, plaintexts } = await buildSql();
  process.stdout.write(sql);
  printPasswordTable(plaintexts);
}

main().catch((err) => {
  process.stderr.write(`seed-district-sandbox: ${err.message}\n`);
  process.exit(1);
});
