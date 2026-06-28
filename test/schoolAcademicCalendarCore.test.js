// Unit tests for routes/schoolAcademicCalendarCore.js — pure helpers, no DB.
// Run: node --test  (or: npm test)
//
// Two things are pinned here:
//   1. The NEW calendar value validators (period_type, strict YYYY-MM-DD dates,
//      end>=start, optional length-capped label).
//   2. That the §5 gate-1 contract is the SAME resolveOwnSchoolId helper as the
//      #339 schoolOverdueLogOptoutsCore (identity), and that its
//      authorization-relevant branches still hold when consumed here. The
//      cross-school 403 case is the unit-level proof that a cross-school write
//      is rejected BEFORE any pool.query runs (the router calls resolveOwnSchoolId
//      first and returns on error), i.e. "no row written".
const { test } = require('node:test');
const assert = require('node:assert');
const {
  PERIOD_TYPES,
  LABEL_MAX,
  validatePeriodType,
  validateDate,
  validateCalendarBody,
  resolveOwnSchoolId,
  validateIntParam,
  SELF_SERVICE_ROLES,
} = require('../routes/schoolAcademicCalendarCore');
const optoutsCore = require('../routes/schoolOverdueLogOptoutsCore');

// --- gate 1: resolveOwnSchoolId is the #339 helper, not a re-implementation --

test('resolveOwnSchoolId is the SAME reference imported from schoolOverdueLogOptoutsCore', () => {
  assert.strictEqual(resolveOwnSchoolId, optoutsCore.resolveOwnSchoolId);
  assert.strictEqual(validateIntParam, optoutsCore.validateIntParam);
  assert.deepStrictEqual(SELF_SERVICE_ROLES, ['school_admin']);
});

test('gate 1 cross-school write -> 403 BEFORE any DB call (no row written)', () => {
  // school_admin of school 42 naming school 99 (not in their accessible set).
  // The router runs this first and returns on error, so the INSERT/UPDATE/DELETE
  // is never reached -> no row written.
  const { schoolTenantId, error } = resolveOwnSchoolId('school_admin', [42], '99');
  assert.strictEqual(schoolTenantId, undefined);
  assert.strictEqual(error.status, 403);
});

test('gate 1 non-school_admin role -> 403 before input parse', () => {
  for (const role of ['district_admin', 'district_tech_admin', 'teacher', 'operator', 'parent']) {
    const { error } = resolveOwnSchoolId(role, [42], '42');
    assert.strictEqual(error.status, 403, `role ${role} must be 403`);
  }
});

test('gate 1 sole-building school_admin, no id supplied -> own school', () => {
  const { schoolTenantId, error } = resolveOwnSchoolId('school_admin', [42], undefined);
  assert.strictEqual(error, undefined);
  assert.strictEqual(schoolTenantId, 42);
});

test('gate 1 invalid school_tenant_id shape -> 400', () => {
  const { error } = resolveOwnSchoolId('school_admin', [42], 'not-a-number');
  assert.strictEqual(error.status, 400);
});

// --- validatePeriodType -----------------------------------------------------

test('validatePeriodType accepts term/break only', () => {
  assert.deepStrictEqual(PERIOD_TYPES, ['term', 'break']);
  assert.strictEqual(validatePeriodType('term'), 'term');
  assert.strictEqual(validatePeriodType('break'), 'break');
  assert.strictEqual(validatePeriodType('Term'), null);
  assert.strictEqual(validatePeriodType('semester'), null);
  assert.strictEqual(validatePeriodType(''), null);
  assert.strictEqual(validatePeriodType(undefined), null);
  assert.strictEqual(validatePeriodType(1), null);
});

// --- validateDate: strict YYYY-MM-DD, calendar-valid -----------------------

test('validateDate accepts a real date and returns the canonical string', () => {
  assert.strictEqual(validateDate('2026-09-01'), '2026-09-01');
  assert.strictEqual(validateDate('2024-02-29'), '2024-02-29'); // leap year
});

test('validateDate rejects impossible calendar dates', () => {
  assert.strictEqual(validateDate('2026-13-01'), null); // month 13
  assert.strictEqual(validateDate('2026-00-10'), null); // month 0
  assert.strictEqual(validateDate('2026-02-30'), null); // Feb 30
  assert.strictEqual(validateDate('2025-02-29'), null); // not a leap year
  assert.strictEqual(validateDate('2026-04-31'), null); // Apr has 30
  assert.strictEqual(validateDate('2026-09-00'), null); // day 0
});

test('validateDate rejects malformed shapes and non-strings', () => {
  assert.strictEqual(validateDate('2026-9-1'), null);     // not zero-padded
  assert.strictEqual(validateDate('09/01/2026'), null);   // wrong separator
  assert.strictEqual(validateDate('2026-09-01T00:00'), null);
  assert.strictEqual(validateDate(''), null);
  assert.strictEqual(validateDate(undefined), null);
  assert.strictEqual(validateDate(20260901), null);       // number, not string
});

// --- validateCalendarBody: composite ---------------------------------------

test('validateCalendarBody happy path (with and without label)', () => {
  const withLabel = validateCalendarBody({
    period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20',
    label: '  Fall Semester  ',
  });
  assert.strictEqual(withLabel.error, undefined);
  assert.deepStrictEqual(withLabel, {
    periodType: 'term', startDate: '2026-08-15', endDate: '2026-12-20',
    label: 'Fall Semester', // trimmed
  });

  const noLabel = validateCalendarBody({
    period_type: 'break', start_date: '2026-12-21', end_date: '2027-01-04',
  });
  assert.strictEqual(noLabel.error, undefined);
  assert.strictEqual(noLabel.label, null);
});

test('validateCalendarBody same-day range is allowed (end == start)', () => {
  const r = validateCalendarBody({
    period_type: 'break', start_date: '2026-11-26', end_date: '2026-11-26',
  });
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.startDate, '2026-11-26');
});

test('validateCalendarBody rejects an inverted range (end < start) -> 400', () => {
  const r = validateCalendarBody({
    period_type: 'term', start_date: '2026-12-20', end_date: '2026-08-15',
  });
  assert.strictEqual(r.error.status, 400);
});

test('validateCalendarBody rejects bad period_type / dates -> 400', () => {
  assert.strictEqual(validateCalendarBody({
    period_type: 'semester', start_date: '2026-08-15', end_date: '2026-12-20',
  }).error.status, 400);
  assert.strictEqual(validateCalendarBody({
    period_type: 'term', start_date: '2026-02-30', end_date: '2026-12-20',
  }).error.status, 400);
  assert.strictEqual(validateCalendarBody({
    period_type: 'term', start_date: '2026-08-15', end_date: 'nope',
  }).error.status, 400);
});

test('validateCalendarBody label rules: empty -> null, over-cap -> 400, non-string -> 400', () => {
  const empty = validateCalendarBody({
    period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20', label: '   ',
  });
  assert.strictEqual(empty.error, undefined);
  assert.strictEqual(empty.label, null);

  const tooLong = validateCalendarBody({
    period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20',
    label: 'x'.repeat(LABEL_MAX + 1),
  });
  assert.strictEqual(tooLong.error.status, 400);

  const atCap = validateCalendarBody({
    period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20',
    label: 'x'.repeat(LABEL_MAX),
  });
  assert.strictEqual(atCap.error, undefined);
  assert.strictEqual(atCap.label.length, LABEL_MAX);

  const nonString = validateCalendarBody({
    period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20', label: 123,
  });
  assert.strictEqual(nonString.error.status, 400);
});

test('validateCalendarBody tolerates a null/undefined body -> 400 (period_type missing)', () => {
  assert.strictEqual(validateCalendarBody(undefined).error.status, 400);
  assert.strictEqual(validateCalendarBody(null).error.status, 400);
});
