// Unit tests for services/schoolCalendar.js — pure helpers, no DB.
// Run: node --test  (or: npm test)
//
// Pins the in-session rule the calendar-aware overdue digest depends on:
//   - explicit break always wins (even inside a term, even with no terms)
//   - term-declared schools: in session iff inside some term and no break
//   - no-term schools: in session except the default window AND any explicit
//     break (entered breaks are never discarded — decision (b))
//   - default break window parsing (default, env override, malformed, wrap)
//   - label is never read (rows with a label yield identical results)
//   - row dates may be pg Date objects or strings
const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_BREAK_START,
  DEFAULT_BREAK_END,
  toYmd,
  parseDefaultBreakWindow,
  inDefaultBreak,
  isWeekInSession,
} = require('../services/schoolCalendar');

const NO_ENV = {}; // default break window (mid-June -> mid-Aug)

// --- toYmd -----------------------------------------------------------------

test('toYmd normalizes Date (local components) and string inputs', () => {
  assert.strictEqual(toYmd('2026-09-01'), '2026-09-01');
  assert.strictEqual(toYmd('2026-09-01T00:00:00Z'), '2026-09-01');
  assert.strictEqual(toYmd(new Date(2026, 8, 1)), '2026-09-01'); // month is 0-based
});

// --- parseDefaultBreakWindow / inDefaultBreak ------------------------------

test('parseDefaultBreakWindow defaults to mid-June -> mid-Aug', () => {
  assert.deepStrictEqual(parseDefaultBreakWindow(NO_ENV), {
    start: DEFAULT_BREAK_START, end: DEFAULT_BREAK_END,
  });
  assert.deepStrictEqual(parseDefaultBreakWindow(undefined), {
    start: '06-15', end: '08-15',
  });
});

test('parseDefaultBreakWindow honors a valid env override, falls back on junk', () => {
  assert.deepStrictEqual(
    parseDefaultBreakWindow({ OVERDUE_LOGS_DEFAULT_BREAK: '07-01:07-31' }),
    { start: '07-01', end: '07-31' }
  );
  // malformed -> default
  for (const bad of ['nonsense', '7-1:7-31', '13-01:08-15', '06-15', '06-15:99-99']) {
    assert.deepStrictEqual(
      parseDefaultBreakWindow({ OVERDUE_LOGS_DEFAULT_BREAK: bad }),
      { start: '06-15', end: '08-15' }, `"${bad}" should fall back to default`
    );
  }
});

test('inDefaultBreak: non-wrapping default window (mid-June -> mid-Aug)', () => {
  assert.strictEqual(inDefaultBreak('2026-07-13', NO_ENV), true);  // mid-July
  assert.strictEqual(inDefaultBreak('2026-06-15', NO_ENV), true);  // start boundary
  assert.strictEqual(inDefaultBreak('2026-08-15', NO_ENV), true);  // end boundary
  assert.strictEqual(inDefaultBreak('2026-06-14', NO_ENV), false); // day before
  assert.strictEqual(inDefaultBreak('2026-08-16', NO_ENV), false); // day after
  assert.strictEqual(inDefaultBreak('2026-10-05', NO_ENV), false); // October
});

test('inDefaultBreak: wrapping window (winter, start > end) matches across year-end', () => {
  const env = { OVERDUE_LOGS_DEFAULT_BREAK: '12-20:01-05' };
  assert.strictEqual(inDefaultBreak('2026-12-28', env), true);
  assert.strictEqual(inDefaultBreak('2026-01-02', env), true);
  assert.strictEqual(inDefaultBreak('2026-07-01', env), false);
});

// --- isWeekInSession: term-declared schools --------------------------------

const FALL = { period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20' };
const SPRING = { period_type: 'term', start_date: '2027-01-06', end_date: '2027-05-28' };
const WINTER_BREAK = { period_type: 'break', start_date: '2026-12-21', end_date: '2027-01-05' };

test('term school: in session inside a term, out between terms', () => {
  assert.strictEqual(isWeekInSession('2026-09-07', [FALL, SPRING], NO_ENV), true);
  assert.strictEqual(isWeekInSession('2027-02-01', [FALL, SPRING], NO_ENV), true);
  // gap between Fall end and Spring start (and not covered by a break row here)
  assert.strictEqual(isWeekInSession('2026-12-28', [FALL, SPRING], NO_ENV), false);
});

test('term school: term boundaries are inclusive', () => {
  assert.strictEqual(isWeekInSession('2026-08-15', [FALL], NO_ENV), true); // start
  assert.strictEqual(isWeekInSession('2026-12-20', [FALL], NO_ENV), true); // end
  assert.strictEqual(isWeekInSession('2026-12-21', [FALL], NO_ENV), false); // day after
});

test('term school: an explicit break inside a term makes it out of session', () => {
  // A spring-break week that sits inside the Fall/Spring terms.
  const springBreak = { period_type: 'break', start_date: '2027-03-15', end_date: '2027-03-19' };
  assert.strictEqual(isWeekInSession('2027-03-16', [FALL, SPRING, springBreak], NO_ENV), false);
  // ...but the week just before the break, still in Spring term, is in session.
  assert.strictEqual(isWeekInSession('2027-03-08', [FALL, SPRING, springBreak], NO_ENV), true);
});

test('term school: a winter-break week between terms is out (break wins)', () => {
  assert.strictEqual(isWeekInSession('2026-12-28', [FALL, SPRING, WINTER_BREAK], NO_ENV), false);
});

// --- isWeekInSession: no-term schools (decision (b)) -----------------------

test('no-term school: in session except the default window', () => {
  assert.strictEqual(isWeekInSession('2026-10-05', [], NO_ENV), true);   // October -> in
  assert.strictEqual(isWeekInSession('2026-07-13', [], NO_ENV), false);  // mid-July -> default break
});

test('no-term school: an explicit break is still honored (never discarded)', () => {
  // A school with no term rows but one entered break in October. That October
  // week must be out of session even though it is outside the default window.
  const octBreak = { period_type: 'break', start_date: '2026-10-12', end_date: '2026-10-16' };
  assert.strictEqual(isWeekInSession('2026-10-13', [octBreak], NO_ENV), false); // in the entered break
  assert.strictEqual(isWeekInSession('2026-10-05', [octBreak], NO_ENV), true);  // outside it -> in session
});

// --- gate 5: label is never read -------------------------------------------

test('label on the rows does not affect the result (label is ignored)', () => {
  const withLabel = [
    { period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20', label: 'Fall Semester' },
    { period_type: 'break', start_date: '2026-11-25', end_date: '2026-11-27', label: 'Thanksgiving' },
  ];
  const withoutLabel = [
    { period_type: 'term', start_date: '2026-08-15', end_date: '2026-12-20' },
    { period_type: 'break', start_date: '2026-11-25', end_date: '2026-11-27' },
  ];
  for (const wk of ['2026-09-07', '2026-11-26', '2026-12-28']) {
    assert.strictEqual(
      isWeekInSession(wk, withLabel, NO_ENV),
      isWeekInSession(wk, withoutLabel, NO_ENV),
      `week ${wk}: label must not change the in-session result`
    );
  }
});

// --- row dates as Date objects ---------------------------------------------

test('row dates may be pg Date objects, not just strings', () => {
  const rows = [{
    period_type: 'term',
    start_date: new Date(2026, 7, 15), // 2026-08-15 local
    end_date: new Date(2026, 11, 20),  // 2026-12-20 local
  }];
  assert.strictEqual(isWeekInSession('2026-09-07', rows, NO_ENV), true);
  assert.strictEqual(isWeekInSession('2027-01-04', rows, NO_ENV), false);
});
