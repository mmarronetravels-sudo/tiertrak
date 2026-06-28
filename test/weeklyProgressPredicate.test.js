// Unit tests for the frequency-aware overdue rule in routes/weeklyProgressCore.js.
// Run: node --test  (or: npm test)
//
// satisfyingWeeks is the single source of truth for "which week_of values clear
// overdue for a plan of this frequency"; the SQL CASE in getMissingLogsForStaff
// mirrors it. Pinning it here guarantees the dashboard card and the scheduled
// email agree on biweekly cadence. Imported from the pure core so the test does
// not load the router's auth/rate-limit middleware chain.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  satisfyingWeeks,
  getPriorWeekStart,
  getWeekStart,
} = require('../routes/weeklyProgressCore');

const CURRENT = '2026-09-07'; // a Monday
const PRIOR = '2026-08-31';   // the Monday before

test('satisfyingWeeks: biweekly is cleared by the current OR the prior week', () => {
  assert.deepStrictEqual(satisfyingWeeks('biweekly', CURRENT, PRIOR), [CURRENT, PRIOR]);
});

test('satisfyingWeeks: every non-biweekly frequency keeps weekly cadence (current only)', () => {
  for (const freq of ['weekly', 'daily', '3x_week', '2x_week', undefined, null, '', 'BIWEEKLY']) {
    assert.deepStrictEqual(
      satisfyingWeeks(freq, CURRENT, PRIOR), [CURRENT],
      `frequency ${JSON.stringify(freq)} must be weekly-cadence`
    );
  }
});

test('getPriorWeekStart returns the Monday 7 days before, no TZ drift', () => {
  assert.strictEqual(getPriorWeekStart(CURRENT), PRIOR);
  // Crossing a month boundary.
  assert.strictEqual(getPriorWeekStart('2026-03-02'), '2026-02-23');
  // Crossing a year boundary.
  assert.strictEqual(getPriorWeekStart('2027-01-04'), '2026-12-28');
});

test('getPriorWeekStart composes with getWeekStart to the same Monday boundary', () => {
  // getWeekStart of a date 7 days before the current Monday lands on the prior
  // Monday — the equivalence the dedup ledger relies on.
  const sevenDaysBefore = '2026-08-31'; // already a Monday
  assert.strictEqual(getWeekStart(sevenDaysBefore), PRIOR);
  assert.strictEqual(getPriorWeekStart(CURRENT), getWeekStart(sevenDaysBefore));
});
