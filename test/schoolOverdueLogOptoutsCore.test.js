// Unit tests for routes/schoolOverdueLogOptoutsCore.js — pure helpers, no DB.
// Run: node --test  (or: npm test)
//
// These pin the authorization-relevant branching for the school_admin
// self-service overdue-logs opt-out surface: the school_admin-only role gate,
// the §5 "resolve own school from the accessible set, never from input"
// contract, the type-safe membership check, and the feature flag.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  SELF_SERVICE_ROLES,
  validateIntParam,
  validateBool,
  featureEnabled,
  resolveOwnSchoolId,
} = require('../routes/schoolOverdueLogOptoutsCore');

// --- allowlist is exactly school_admin -------------------------------------

test('SELF_SERVICE_ROLES is school_admin ONLY (no district_admin / district_tech_admin)', () => {
  assert.deepStrictEqual(SELF_SERVICE_ROLES, ['school_admin']);
});

// --- validateIntParam / validateBool ---------------------------------------

test('validateIntParam accepts a positive int, rejects junk and out-of-range', () => {
  assert.strictEqual(validateIntParam('42'), 42);
  assert.strictEqual(validateIntParam(42), 42);
  assert.strictEqual(validateIntParam('0'), null);
  assert.strictEqual(validateIntParam('-1'), null);
  assert.strictEqual(validateIntParam('abc'), null);
  assert.strictEqual(validateIntParam('2147483648'), null); // > INT4_MAX
});

test('validateBool accepts only real booleans', () => {
  assert.strictEqual(validateBool(true), true);
  assert.strictEqual(validateBool(false), false);
  assert.strictEqual(validateBool('true'), null);
  assert.strictEqual(validateBool(1), null);
  assert.strictEqual(validateBool(undefined), null);
});

// --- featureEnabled: server-authoritative flag -----------------------------

test('featureEnabled is true only when the env var is exactly the string "true"', () => {
  assert.strictEqual(featureEnabled({ OVERDUE_LOGS_REMINDERS_ENABLED: 'true' }), true);
  assert.strictEqual(featureEnabled({ OVERDUE_LOGS_REMINDERS_ENABLED: 'false' }), false);
  assert.strictEqual(featureEnabled({ OVERDUE_LOGS_REMINDERS_ENABLED: '1' }), false);
  assert.strictEqual(featureEnabled({}), false);
  assert.strictEqual(featureEnabled(undefined), false);
});

// --- resolveOwnSchoolId: HAPPY PATH (school_admin on their OWN school) ------

test('GET/PUT happy path: sole-building school_admin, no id supplied -> own school', () => {
  // GET passes req.query.school_tenant_id (undefined when absent); PUT passes
  // req.body.school_tenant_id (undefined when absent). Both reach here as
  // `requested = undefined` and must resolve to the single accessible school.
  const { schoolTenantId, error } = resolveOwnSchoolId('school_admin', [42], undefined);
  assert.strictEqual(error, undefined);
  assert.strictEqual(schoolTenantId, 42);
});

test('happy path: school_admin names their own school explicitly -> success', () => {
  const { schoolTenantId, error } = resolveOwnSchoolId('school_admin', [42, 77], '77');
  assert.strictEqual(error, undefined);
  assert.strictEqual(schoolTenantId, 77);
});

test('type-safety: string-typed accessible entries do NOT wrongly 403 a valid own-school request', () => {
  // Guards the number-vs-string footgun: if a tenant id ever arrives as a
  // string from either side, the coerced membership check must still match.
  const fromRequest = resolveOwnSchoolId('school_admin', ['42'], '42');
  assert.strictEqual(fromRequest.error, undefined);
  assert.strictEqual(fromRequest.schoolTenantId, 42);

  const soleStringEntry = resolveOwnSchoolId('school_admin', ['42'], undefined);
  assert.strictEqual(soleStringEntry.error, undefined);
  assert.strictEqual(soleStringEntry.schoolTenantId, 42);
});

// --- resolveOwnSchoolId: 403 / 400 rejection cases -------------------------

test('403: a non-school_admin role is rejected before any input parse', () => {
  for (const role of ['district_admin', 'district_tech_admin', 'teacher', 'counselor', 'operator', 'parent']) {
    const { schoolTenantId, error } = resolveOwnSchoolId(role, [42], '42');
    assert.strictEqual(schoolTenantId, undefined, `role ${role} must not resolve a school`);
    assert.strictEqual(error.status, 403, `role ${role} must be 403`);
  }
});

test('403: school_admin requesting a school NOT in their accessible set (cross-school)', () => {
  const { schoolTenantId, error } = resolveOwnSchoolId('school_admin', [42], '99');
  assert.strictEqual(schoolTenantId, undefined);
  assert.strictEqual(error.status, 403);
});

test('400: invalid school_tenant_id shape', () => {
  const { error } = resolveOwnSchoolId('school_admin', [42], 'not-a-number');
  assert.strictEqual(error.status, 400);
});

test('400: multi-building school_admin with no school named must specify one', () => {
  const { error } = resolveOwnSchoolId('school_admin', [42, 77], undefined);
  assert.strictEqual(error.status, 400);
});

test('400: school_admin with an empty accessible set and no id', () => {
  const { error } = resolveOwnSchoolId('school_admin', [], undefined);
  assert.strictEqual(error.status, 400);
});

test('403: empty accessible set still rejects an explicitly named school', () => {
  // No grants yet -> cannot act on any school, even one named in the request.
  const { error } = resolveOwnSchoolId('school_admin', [], '42');
  assert.strictEqual(error.status, 403);
});
