'use strict';

// Unit tests for the shared district_admin authorization prefix
// (routes/districtAuthzCore.authorizeDistrictAdmin). DB-free and req/res-free:
// the helper is a pure function over (user, rawId), so these tests need no
// router, no live DB, and no JWT — the dominant *Core-helper pattern in this
// repo (cf. test/schoolAcademicCalendarCore.test.js, test/screenerResetCore.test.js).
//
// Covers the §5 gate every district surface depends on: bad id -> 400; any
// non-district_admin role -> 403; district mismatch -> 403; legacy null
// district -> 403 (fail closed); exact match -> { districtId }.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { authorizeDistrictAdmin } = require('../routes/districtAuthzCore');

test('bad district id -> 400 Invalid district id', () => {
  const r = authorizeDistrictAdmin({ role: 'district_admin', district_id: 7 }, 'abc');
  assert.deepEqual(r, { error: { status: 400, message: 'Invalid district id' } });
});

test("role 'staff' -> 403 Forbidden", () => {
  const r = authorizeDistrictAdmin({ role: 'staff', district_id: 7 }, '7');
  assert.deepEqual(r, { error: { status: 403, message: 'Forbidden' } });
});

test("role 'district_tech_admin' -> 403 Forbidden", () => {
  const r = authorizeDistrictAdmin({ role: 'district_tech_admin', district_id: 7 }, '7');
  assert.deepEqual(r, { error: { status: 403, message: 'Forbidden' } });
});

test('district_admin with mismatched district_id -> 403 Forbidden', () => {
  const r = authorizeDistrictAdmin({ role: 'district_admin', district_id: 8 }, '7');
  assert.deepEqual(r, { error: { status: 403, message: 'Forbidden' } });
});

test('district_admin with district_id null -> 403 (fail closed)', () => {
  const r = authorizeDistrictAdmin({ role: 'district_admin', district_id: null }, '7');
  assert.deepEqual(r, { error: { status: 403, message: 'Forbidden' } });
});

test('valid district_admin whose district_id matches -> { districtId }', () => {
  const r = authorizeDistrictAdmin({ role: 'district_admin', district_id: 7 }, '7');
  assert.deepEqual(r, { districtId: 7 });
  assert.equal(typeof r.districtId, 'number');
});
