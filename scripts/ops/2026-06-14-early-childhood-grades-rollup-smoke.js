#!/usr/bin/env node
/*
 * Pure-function smoke for the early-childhood grade addition
 * (feat/early-childhood-grades): N (Nursery) inserted at the front of
 * GRADE_SEQUENCE, ahead of Pre-K and K.
 *
 * NO DATABASE, NO IO, NO NETWORK. This exercises the pure classifier
 * constants/gradeProgression.js#classifyTransition (the SOLE grade
 * roll-up classifier — the route comment guarantees it is pure so the
 * same classification fires identically at /preview and /commit) plus
 * the GRADE_SEQUENCE shape, and asserts the FE ESM mirror is
 * element-for-element identical to the BE list (the documented
 * two-writer drift hazard for which there is no CI guard yet).
 *
 * classifyTransition(currentGrade, terminalGrade):
 *   - currentGrade === terminalGrade            -> { action: 'graduate',     newGrade: null }
 *   - currentGrade in sequence, has a next      -> { action: 'promote',      newGrade: <next> }
 *   - currentGrade not in sequence              -> { action: 'unclassified', newGrade: null }
 * The second argument is the school's TERMINAL grade (the grade that
 * graduates out of the building), confirmed from the signature at
 * constants/gradeProgression.js.
 *
 * §4B: no PII. All inputs are grade-code string literals.
 *
 * Run: node scripts/ops/2026-06-14-early-childhood-grades-rollup-smoke.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  GRADE_SEQUENCE,
  classifyTransition,
} = require('../../constants/gradeProgression');

async function main() {
  // ---- Promotion chain: the new early-childhood rungs ----
  assert.deepEqual(
    classifyTransition('N', '12th'),
    { action: 'promote', newGrade: 'Pre-K' },
    "N should promote to Pre-K"
  );
  assert.deepEqual(
    classifyTransition('Pre-K', '12th'),
    { action: 'promote', newGrade: 'K' },
    "Pre-K should promote to K"
  );
  assert.deepEqual(
    classifyTransition('K', '12th'),
    { action: 'promote', newGrade: '1st' },
    "K should promote to 1st (regression)"
  );

  // ---- Terminal-grade graduate cases for early-childhood-only buildings ----
  assert.deepEqual(
    classifyTransition('N', 'N'),
    { action: 'graduate', newGrade: null },
    "N at a Nursery-terminal building should graduate"
  );
  assert.deepEqual(
    classifyTransition('Pre-K', 'Pre-K'),
    { action: 'graduate', newGrade: null },
    "Pre-K at a Pre-K-terminal building should graduate"
  );

  // ---- Regressions: existing behavior unchanged ----
  assert.deepEqual(
    classifyTransition('12th', '12th'),
    { action: 'graduate', newGrade: null },
    "12th at a high school should graduate"
  );
  assert.deepEqual(
    classifyTransition('SomethingWeird', '12th'),
    { action: 'unclassified', newGrade: null },
    "an out-of-sequence grade should be unclassified"
  );

  // ---- Sequence shape ----
  assert.equal(GRADE_SEQUENCE[0], 'N', "GRADE_SEQUENCE must start with N");
  assert.equal(GRADE_SEQUENCE[1], 'Pre-K', "Pre-K must be second");
  assert.equal(GRADE_SEQUENCE[2], 'K', "K must be third");
  assert.equal(GRADE_SEQUENCE.length, 15, "GRADE_SEQUENCE must have 15 entries");

  // ---- FE <-> BE drift guard: element-for-element equality ----
  const feModuleUrl = pathToFileURL(
    path.resolve(__dirname, '../../frontend/src/constants/gradeProgression.js')
  ).href;
  const fe = await import(feModuleUrl);
  assert.deepEqual(
    fe.GRADE_SEQUENCE,
    GRADE_SEQUENCE,
    "FE GRADE_SEQUENCE must be element-for-element identical to BE"
  );

  console.log('PASS — early-childhood grade rollup smoke (11 assertions)');
}

main().catch((err) => {
  console.error('FAIL —', err.message);
  process.exit(1);
});
