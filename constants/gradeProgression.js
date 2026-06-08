// Canonical grade-progression code list for the EOY student grade
// roll-up (feat/student-grade-rollup-api, PR 254).
//
// GRADE_SEQUENCE is the ordered list of values that may appear in
// students.grade (schema.sql:34, VARCHAR(20) NOT NULL). The CSV
// importer and FE forms write into this same column, so the list here
// is the app-layer source of truth. There is no DB CHECK constraint on
// students.grade — the column is open by design (some districts use
// transitional / split-grade strings during onboarding) — so the
// classifier below treats anything outside GRADE_SEQUENCE as
// 'unclassified' rather than rejecting it. The roll-up endpoint refuses
// to commit while unclassified rows are present.
//
// ADVANCE_MAP[grade] is the next-year grade for promotion. The terminal
// grade (12th) maps to null because students at that grade graduate
// rather than promote — the run-time classifier branches on
// (current === terminal) to choose 'graduate' vs 'promote' anyway, so
// the ADVANCE_MAP entry for 12th is informational only.
//
// EXIT_REASONS is the route-layer allowlist for exit_reason
// (students.exit_reason VARCHAR(50), M044). Mirrors the inline-array
// pattern at routes/students.js:943-953 (archived_reason) but is
// extracted to this module so /preview, /commit, and a future
// POST /api/students/:id/exit route share one allowlist. The values
// are lowercase snake_case because they are codes, not display labels;
// the FE renders human-readable strings from EXIT_REASON_LABELS in the
// ESM mirror at frontend/src/constants/gradeProgression.js.
//
// classifyTransition is the only function exported. It is intentionally
// pure (no DB, no IO) so the same classification fires identically at
// /preview and at /commit-time re-classification.

const GRADE_SEQUENCE = [
  'Pre-K',
  'K',
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
  '6th',
  '7th',
  '8th',
  '9th',
  '10th',
  '11th',
  '12th',
];

const ADVANCE_MAP = Object.freeze(
  GRADE_SEQUENCE.reduce((map, grade, idx) => {
    map[grade] = idx < GRADE_SEQUENCE.length - 1 ? GRADE_SEQUENCE[idx + 1] : null;
    return map;
  }, {})
);

const EXIT_REASONS = ['transferred', 'withdrew', 'moved', 'other'];

/**
 * Classify a single student's roll-up transition.
 *
 * @param {string} currentGrade - The student's current students.grade value.
 * @param {string} terminalGrade - The roll-up run's terminal_grade (the grade
 *   that graduates out of this school — e.g., '5th' for a K-5 building,
 *   '12th' for a high school).
 * @returns {{ action: 'promote'|'graduate'|'unclassified', newGrade: string|null }}
 *   - 'promote': newGrade is the next grade in GRADE_SEQUENCE.
 *   - 'graduate': newGrade is null (caller sets enrollment_status='graduated').
 *   - 'unclassified': newGrade is null and the roll-up commit will refuse
 *     while any unclassified row remains.
 */
function classifyTransition(currentGrade, terminalGrade) {
  if (!GRADE_SEQUENCE.includes(currentGrade)) {
    return { action: 'unclassified', newGrade: null };
  }
  if (currentGrade === terminalGrade) {
    return { action: 'graduate', newGrade: null };
  }
  const next = ADVANCE_MAP[currentGrade];
  if (next === null || next === undefined) {
    return { action: 'unclassified', newGrade: null };
  }
  return { action: 'promote', newGrade: next };
}

module.exports = {
  GRADE_SEQUENCE,
  ADVANCE_MAP,
  EXIT_REASONS,
  classifyTransition,
};
