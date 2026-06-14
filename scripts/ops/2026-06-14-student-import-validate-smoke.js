// Behavioral smoke for the operator student-import VALIDATE-ONLY endpoint
// (Slice 3). SYNTHETIC data only. Seeds a throwaway district + school + one
// existing student (with an external_id) in the LOCAL DEV DB, drives
// validateStudentImport via a mock req/res (auth is not under test here),
// prints counts-only results, then tears the synthetic rows down. Run with:
//   NODE_ENV=development node scripts/ops/2026-06-14-student-import-validate-smoke.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();
const { validateStudentImport } = require('../../routes/operatorStudentImport');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function mkRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

function writeCsv(lines) {
  const p = path.join(os.tmpdir(), 'student-smoke-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.csv');
  fs.writeFileSync(p, lines.join('\n'));
  return p;
}

async function callHandler(districtId, schoolTenantId, csvPath) {
  const req = {
    params: { districtId: String(districtId), schoolTenantId: String(schoolTenantId) },
    file: { path: csvPath },
    user: { id: 999999, role: 'district_admin' }
  };
  const res = mkRes();
  await validateStudentImport(req, res);
  // cleanup() uses fire-and-forget async fs.unlink; poll briefly for the I/O
  // macrotask to land before asserting deletion.
  let fileGone = !fs.existsSync(csvPath);
  for (let i = 0; i < 40 && !fileGone; i++) {
    await new Promise(r => setTimeout(r, 5));
    fileGone = !fs.existsSync(csvPath);
  }
  return { status: res.statusCode, body: res.body, fileDeleted: fileGone };
}

(async () => {
  const suf = Date.now().toString();
  let districtId, otherDistrictId, schoolTenantId;
  const existingExternalId = `SIS-EXIST-${suf}`;
  let pass = 0, fail = 0;
  const check = (label, cond) => { (cond ? pass++ : fail++); console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`); };

  try {
    // ---- seed (synthetic) ----
    districtId = (await pool.query(
      'INSERT INTO districts (name, auth_mode) VALUES ($1, $2) RETURNING id',
      [`SMOKE_DISTRICT_${suf}`, 'disabled']
    )).rows[0].id;
    otherDistrictId = (await pool.query(
      'INSERT INTO districts (name, auth_mode) VALUES ($1, $2) RETURNING id',
      [`SMOKE_DISTRICT2_${suf}`, 'disabled']
    )).rows[0].id;
    schoolTenantId = (await pool.query(
      "INSERT INTO tenants (name, type, subdomain, district_id) VALUES ($1, 'school', $2, $3) RETURNING id",
      [`SMOKE_SCHOOL_${suf}`, `smoke-${suf}`, districtId]
    )).rows[0].id;
    await pool.query(
      "INSERT INTO students (tenant_id, first_name, last_name, grade, external_id) VALUES ($1, $2, $3, '3rd', $4)",
      [schoolTenantId, 'Existing', 'Student', existingExternalId]
    );

    const studentsBefore = Number((await pool.query('SELECT count(*)::int AS c FROM students')).rows[0].c);
    console.log(`seed: district=${districtId} otherDistrict=${otherDistrictId} school=${schoolTenantId} studentsBefore=${studentsBefore}\n`);

    // ---- Fixture A: all-valid CSV (incl. IEP/504/ELL + race) ----
    console.log('Fixture A — all-valid CSV:');
    const aPath = writeCsv([
      'first_name,last_name,grade,tier,area,risk_level,external_id,iep_flag,sec_504_flag,ell_flag,gender,race_ethnicity',
      `Alice,Smoke,3rd,1,Academic,low,SIS-A-${suf},TRUE,FALSE,FALSE,F,ASIAN;WHITE`,
      `Bob,Smoke,5th,2,Behavior,moderate,SIS-B-${suf},,,,M,`
    ]);
    const a = await callHandler(districtId, schoolTenantId, aPath);
    console.log('  result:', JSON.stringify(a));
    check('status 200', a.status === 200);
    check('summary {totalRows:2, valid:2, validationErrors:0, duplicatesInFile:0, alreadyExists:0}',
      a.body && a.body.summary.totalRows === 2 && a.body.summary.valid === 2 &&
      a.body.summary.validationErrors === 0 && a.body.summary.duplicatesInFile === 0 &&
      a.body.summary.alreadyExists === 0 && a.body.errors.length === 0);
    check('temp CSV deleted', a.fileDeleted);

    // ---- Fixture B: missing-required + bad tier + bad iep_flag + in-file
    //      dup external_id + already-exists ----
    console.log('\nFixture B — mixed errors:');
    const bPath = writeCsv([
      'first_name,last_name,grade,tier,area,risk_level,external_id,iep_flag,sec_504_flag,ell_flag,gender,race_ethnicity',
      `,NoFirst,3rd,1,Academic,low,SIS-MISS-${suf},,,,,`,            // row2: missing first_name
      `Carl,Smoke,4th,9,Academic,low,SIS-TIER-${suf},,,,,`,          // row3: bad tier
      `Dana,Smoke,4th,1,Academic,low,SIS-IEP-${suf},MAYBE,,,,`,      // row4: bad iep_flag
      `Quinn,Alpha,5th,1,Academic,low,SIS-DUP-${suf},,,,,`,          // row5: first occurrence (valid)
      `Quinn,Beta,5th,1,Academic,low,SIS-DUP-${suf},,,,,`,           // row6: in-file dup external_id
      `Existing,Student,3rd,1,Academic,low,${existingExternalId},,,,,` // row7: already-exists
    ]);
    const b = await callHandler(districtId, schoolTenantId, bPath);
    console.log('  result:', JSON.stringify(b));
    const byRow = {};
    if (b.body) b.body.errors.forEach(e => { byRow[e.row] = e.error; });
    check('status 200', b.status === 200);
    check('row2 → Missing required fields', byRow[2] === 'Missing required fields (first_name, last_name, grade).');
    check('row3 → Invalid tier "9"', byRow[3] === 'Invalid tier "9". Must be 1, 2, or 3.');
    check('row4 → Invalid iep_flag (no echo of "MAYBE")',
      typeof byRow[4] === 'string' && /^Invalid iep_flag\./.test(byRow[4]) && !byRow[4].includes('MAYBE'));
    check('row6 → Duplicate external_id; first seen at row 5 (no SIS ID echoed)',
      byRow[6] === 'Duplicate external_id within upload; first seen at row 5.');
    check('row7 → already exists at this school (no SIS ID echoed)',
      byRow[7] === 'A student with this external_id already exists at this school.');
    // §4B: no error string may contain the unique synthetic suffix (which is
    // embedded in every external_id / would mark an echoed SIS ID or name),
    // and none may echo a student name from the fixtures.
    // Distinctive fixture names chosen to NOT be substrings of any canonical
    // (non-PII) error message — so a hit here means a real name echo, not a
    // coincidental wording collision (e.g. 'Dup' ⊂ 'Duplicate').
    const NAMES = ['NoFirst', 'Carl', 'Dana', 'Quinn', 'Alpha', 'Beta', 'Existing', 'Alice', 'Bob'];
    check('no external_id (SIS ID) echoed in any error', b.body && b.body.errors.every(e => !e.error.includes(suf)));
    check('no student name echoed in any error', b.body && b.body.errors.every(e => !NAMES.some(n => e.error.includes(n))));
    check('summary {totalRows:6, valid:1, validationErrors:3, duplicatesInFile:1, alreadyExists:1}',
      b.body && b.body.summary.totalRows === 6 && b.body.summary.valid === 1 &&
      b.body.summary.validationErrors === 3 && b.body.summary.duplicatesInFile === 1 &&
      b.body.summary.alreadyExists === 1);
    check('temp CSV deleted', b.fileDeleted);

    // ---- Fixture C: wrong-district schoolTenantId → 404 ----
    console.log('\nFixture C — wrong-district schoolTenantId:');
    const cPath = writeCsv([
      'first_name,last_name,grade',
      `Carol,Smoke,3rd`
    ]);
    const c = await callHandler(otherDistrictId, schoolTenantId, cPath); // school not in otherDistrict
    console.log('  result:', JSON.stringify(c));
    check('status 404', c.status === 404);
    check('body {error:"Not found"} (no PII)', c.body && c.body.error === 'Not found');
    check('temp CSV deleted', c.fileDeleted);

    // ---- writes-nothing proof ----
    const studentsAfter = Number((await pool.query('SELECT count(*)::int AS c FROM students')).rows[0].c);
    console.log(`\nwrites-nothing: studentsBefore=${studentsBefore} studentsAfter=${studentsAfter}`);
    check('SELECT count(*) on students unchanged by validate-only', studentsAfter === studentsBefore);

    console.log(`\n==== ${fail === 0 ? 'ALL PASS' : 'FAILURES PRESENT'} : ${pass} passed, ${fail} failed ====`);
  } catch (err) {
    console.error('SMOKE ERROR:', err.message);
    fail++;
  } finally {
    // ---- teardown (delete synthetic rows; handler created none) ----
    try {
      if (schoolTenantId) await pool.query('DELETE FROM students WHERE tenant_id = $1', [schoolTenantId]);
      if (schoolTenantId) await pool.query('DELETE FROM tenants WHERE id = $1', [schoolTenantId]);
      if (districtId) await pool.query('DELETE FROM districts WHERE id = $1', [districtId]);
      if (otherDistrictId) await pool.query('DELETE FROM districts WHERE id = $1', [otherDistrictId]);
      console.log('teardown: synthetic rows removed');
    } catch (e) {
      console.error('teardown error (manual cleanup may be needed):', e.message);
    }
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  }
})();
