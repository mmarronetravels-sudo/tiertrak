#!/usr/bin/env node
/**
 * scripts/seed-tier1-local-test.js
 *
 * Local-only seed script to prepare this project's local Postgres DB for
 * end-to-end testing of the Tier 1 Self-Assessment routes.
 *
 * What it does:
 *   - Updates password_hash on two existing Lincoln users so we can log in
 *     as each during testing.
 *   - Creates a second tenant (Parkview Elementary) and a school_admin user
 *     so we can exercise cross-tenant isolation tests.
 *
 * Safety guards (BOTH must pass, or the script refuses to run):
 *   1. DATABASE_URL must parse to host=localhost (or 127.0.0.1), port=5432,
 *      database=tiertrak. Anything else → abort before any write.
 *   2. The flag --local-only must be passed on the command line. Belt-and-
 *      suspenders so the script can't be run accidentally if DATABASE_URL is
 *      ever temporarily pointed elsewhere.
 *
 * Usage:
 *   node scripts/seed-tier1-local-test.js --local-only
 *
 * Passwords are read from stdin with echo suppressed. They are never logged,
 * never written to disk except as bcrypt hashes in the users table.
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 10;

// ------------------------------------------------------------------
// Safety guard 1: require --local-only flag.
// ------------------------------------------------------------------
if (!process.argv.includes('--local-only')) {
  console.error('Refusing to run without --local-only flag.');
  console.error('Usage: node scripts/seed-tier1-local-test.js --local-only');
  process.exit(1);
}

// ------------------------------------------------------------------
// Safety guard 2: DATABASE_URL must point to local tiertrak DB.
// ------------------------------------------------------------------
function parseDatabaseUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return {
      host: u.hostname,
      port: u.port || '5432',
      database: u.pathname.replace(/^\//, '')
    };
  } catch {
    return null;
  }
}

const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
if (!parsed) {
  console.error('Refusing to run: could not parse DATABASE_URL from .env');
  process.exit(1);
}

const hostOk = parsed.host === 'localhost' || parsed.host === '127.0.0.1';
const portOk = parsed.port === '5432';
const dbOk = parsed.database === 'tiertrak';

if (!hostOk || !portOk || !dbOk) {
  console.error('Refusing to run against non-local DB.');
  console.error(`  Parsed host: ${parsed.host} (want localhost or 127.0.0.1)`);
  console.error(`  Parsed port: ${parsed.port} (want 5432)`);
  console.error(`  Parsed database: ${parsed.database} (want tiertrak)`);
  process.exit(1);
}

// ------------------------------------------------------------------
// Read a password from stdin without echoing it to the terminal.
// ------------------------------------------------------------------
function promptPassword(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error('stdin is not a TTY — cannot read password securely'));
    }
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let pw = '';
    const onData = (chunk) => {
      const str = chunk.toString('utf8');
      for (const ch of str) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          process.stdin.removeListener('data', onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          return resolve(pw);
        } else if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        } else if (ch === '\u007f' || ch === '\u0008') {
          if (pw.length > 0) pw = pw.slice(0, -1);
        } else {
          pw += ch;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function promptPasswordWithConfirm(label) {
  while (true) {
    const pw = await promptPassword(`${label}: `);
    if (pw.length < 1) {
      console.error('  Password cannot be empty. Try again.');
      continue;
    }
    const confirm = await promptPassword(`${label} (confirm): `);
    if (pw !== confirm) {
      console.error('  Passwords did not match. Try again.');
      continue;
    }
    return pw;
  }
}

// ------------------------------------------------------------------
// Main.
// ------------------------------------------------------------------
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('Local tier1 test seed');
  console.log(`  Target: ${parsed.host}:${parsed.port}/${parsed.database}\n`);

  // Preflight: verify the two Lincoln users exist before we prompt for
  // passwords — no point asking if we can't write them anywhere.
  const preflight = await pool.query(
    `SELECT email, role FROM users
     WHERE email IN ('admin@lincoln.edu', 'teacher1@lincoln.edu')
     ORDER BY email`
  );
  const foundEmails = preflight.rows.map(r => r.email);
  for (const need of ['admin@lincoln.edu', 'teacher1@lincoln.edu']) {
    if (!foundEmails.includes(need)) {
      console.error(`Refusing to run: expected user ${need} not found in local DB.`);
      await pool.end();
      process.exit(1);
    }
  }

  console.log('Enter a password for each test account (input is hidden).\n');

  const adminPw    = await promptPasswordWithConfirm('Password for admin@lincoln.edu   (school_admin, Lincoln)  ');
  const teacherPw  = await promptPasswordWithConfirm('Password for teacher1@lincoln.edu (teacher,      Lincoln)  ');
  const parkviewPw = await promptPasswordWithConfirm('Password for admin@parkview.edu  (school_admin, Parkview) ');

  const adminHash    = await bcrypt.hash(adminPw,    BCRYPT_ROUNDS);
  const teacherHash  = await bcrypt.hash(teacherPw,  BCRYPT_ROUNDS);
  const parkviewHash = await bcrypt.hash(parkviewPw, BCRYPT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update Lincoln users.
    await client.query(
      `UPDATE users SET password_hash = $1 WHERE email = 'admin@lincoln.edu'`,
      [adminHash]
    );
    await client.query(
      `UPDATE users SET password_hash = $1 WHERE email = 'teacher1@lincoln.edu'`,
      [teacherHash]
    );

    // 2. Find-or-create the Parkview tenant. The tenants table has no
    // unique constraint on name, so we can't use ON CONFLICT — check first
    // and only insert if missing. type is a required column with a CHECK
    // constraint allowing only 'school' or 'district'.
    const existingTenant = await client.query(
      `SELECT id FROM tenants WHERE name = 'Parkview Elementary' LIMIT 1`
    );
    let parkviewTenantId;
    if (existingTenant.rows.length > 0) {
      parkviewTenantId = existingTenant.rows[0].id;
    } else {
      const insertedTenant = await client.query(
        `INSERT INTO tenants (name, type)
         VALUES ('Parkview Elementary', 'school')
         RETURNING id`
      );
      parkviewTenantId = insertedTenant.rows[0].id;
    }

    // 3. Insert or update the Parkview user.
    await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES ($1, 'admin@parkview.edu', $2, 'Parkview Admin', 'school_admin')
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role`,
      [parkviewTenantId, parkviewHash]
    );

    await client.query('COMMIT');

    console.log('');
    console.log(`\u2713 Updated admin@lincoln.edu    (school_admin, tenant Lincoln Elementary)`);
    console.log(`\u2713 Updated teacher1@lincoln.edu (teacher,      tenant Lincoln Elementary)`);
    console.log(`\u2713 Parkview Elementary tenant ready (id=${parkviewTenantId})`);
    console.log(`\u2713 admin@parkview.edu          (school_admin, tenant Parkview Elementary)`);
    console.log('');
    console.log('Done. Passwords never left your terminal.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Seed script failed:', err.message);
  process.exit(1);
});
