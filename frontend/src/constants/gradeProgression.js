// ESM mirror of constants/gradeProgression.js (backend, CommonJS).
// FE bundle scope: code lists + display label maps ONLY. The classifier
// function from the BE module is intentionally NOT mirrored —
// classification is a backend decision (the /preview endpoint returns
// pre-classified buckets; the FE renders them).
//
// DRIFT WARNING — two-writer hazard.
// The codes below MUST stay byte-for-byte aligned with:
//   1. constants/gradeProgression.js (BE, authoritative app-layer mirror)
// There is no DB CHECK on students.grade or students.exit_reason — the
// app-layer is authoritative for both. There is also no automated CI
// check yet that diffs the FE list against the BE list. If you change
// one, change both. A CI drift-check follow-up is banked alongside
// this PR (sibling of the PR-D ESM↔CJS drift follow-up).
//
// Sequence order is K-12 conventional progression. The FE may render
// the grade dropdown in this order; the roll-up preview UI reads
// transition_counts keyed by from-grade and renders them in this order.

export const GRADE_SEQUENCE = [
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

export const EXIT_REASONS = ['transferred', 'withdrew', 'moved', 'other'];

// FE-owned display labels for exit_reason codes. Not in the BE module
// (which only writes codes into students.exit_reason). Single source for
// the FE preview UI's exit-reason dropdown and the post-commit summary.
export const EXIT_REASON_LABELS = {
  transferred: 'Transferred to another school',
  withdrew: 'Withdrew from school',
  moved: 'Moved out of district',
  other: 'Other',
};
