// Unit tests for routes/screenerResetCore.js — pure helpers, no DB.
// Run: node --test  (or: npm test)
const { test } = require('node:test');
const assert = require('node:assert');
const { validateResetScope, buildScopeWhere } = require('../routes/screenerResetCore');

// --- validateResetScope: mandatory filters ---------------------------------

test('validateResetScope rejects missing schoolYear with 400', () => {
  const { scope, error } = validateResetScope({ screeningPeriod: 'BOY', subject: 'Math' });
  assert.strictEqual(scope, undefined);
  assert.strictEqual(error.status, 400);
});

test('validateResetScope rejects missing screeningPeriod with 400', () => {
  const { scope, error } = validateResetScope({ schoolYear: '2025-2026', subject: 'Math' });
  assert.strictEqual(scope, undefined);
  assert.strictEqual(error.status, 400);
});

test('validateResetScope rejects missing subject with 400', () => {
  const { scope, error } = validateResetScope({ schoolYear: '2025-2026', screeningPeriod: 'BOY' });
  assert.strictEqual(scope, undefined);
  assert.strictEqual(error.status, 400);
});

test('validateResetScope rejects whitespace-only mandatory field with 400', () => {
  const { scope, error } = validateResetScope({ schoolYear: '   ', screeningPeriod: 'BOY', subject: 'Math' });
  assert.strictEqual(scope, undefined);
  assert.strictEqual(error.status, 400);
});

test('validateResetScope rejects an empty body with 400', () => {
  const { error } = validateResetScope(undefined);
  assert.strictEqual(error.status, 400);
});

// --- validateResetScope: optional assessment_type --------------------------

test('validateResetScope accepts scope WITH assessmentType', () => {
  const { scope, error } = validateResetScope({
    schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math', assessmentType: 'STAR'
  });
  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(scope, {
    schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math', assessmentType: 'STAR'
  });
});

test('validateResetScope accepts scope WITHOUT assessmentType (null, not "")', () => {
  const { scope, error } = validateResetScope({
    schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math'
  });
  assert.strictEqual(error, undefined);
  assert.strictEqual(scope.assessmentType, null);
});

test('validateResetScope collapses blank assessmentType to null, never ""', () => {
  const { scope } = validateResetScope({
    schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math', assessmentType: '   '
  });
  assert.strictEqual(scope.assessmentType, null);
});

test('validateResetScope trims surrounding whitespace on all scope fields', () => {
  const { scope } = validateResetScope({
    schoolYear: ' 2025-2026 ', screeningPeriod: ' BOY ', subject: ' Math ', assessmentType: ' STAR '
  });
  assert.deepStrictEqual(scope, {
    schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math', assessmentType: 'STAR'
  });
});

// --- buildScopeWhere: param order + optional append ------------------------

test('buildScopeWhere leads with tenant_id = $1 and binds the 3 mandatory filters', () => {
  const scope = { schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math', assessmentType: null };
  const { whereSql, params } = buildScopeWhere(42, scope);
  assert.strictEqual(
    whereSql,
    'tenant_id = $1 AND school_year = $2 AND screening_period = $3 AND subject = $4'
  );
  assert.deepStrictEqual(params, [42, '2025-2026', 'BOY', 'Math']);
});

test('buildScopeWhere appends assessment_type = $5 only when narrowed', () => {
  const scope = { schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math', assessmentType: 'STAR' };
  const { whereSql, params } = buildScopeWhere(42, scope);
  assert.strictEqual(
    whereSql,
    'tenant_id = $1 AND school_year = $2 AND screening_period = $3 AND subject = $4 AND assessment_type = $5'
  );
  assert.deepStrictEqual(params, [42, '2025-2026', 'BOY', 'Math', 'STAR']);
});

test('buildScopeWhere omits assessment_type when assessmentType is null', () => {
  const scope = { schoolYear: '2025-2026', screeningPeriod: 'BOY', subject: 'Math', assessmentType: null };
  const { whereSql, params } = buildScopeWhere(7, scope);
  assert.ok(!whereSql.includes('assessment_type'));
  assert.strictEqual(params.length, 4);
});

test('buildScopeWhere always places tenant_id first regardless of narrowing', () => {
  const narrowed = buildScopeWhere(9, { schoolYear: 'y', screeningPeriod: 'p', subject: 's', assessmentType: 'a' });
  const broad = buildScopeWhere(9, { schoolYear: 'y', screeningPeriod: 'p', subject: 's', assessmentType: null });
  assert.ok(narrowed.whereSql.startsWith('tenant_id = $1'));
  assert.ok(broad.whereSql.startsWith('tenant_id = $1'));
  assert.strictEqual(narrowed.params[0], 9);
  assert.strictEqual(broad.params[0], 9);
});
