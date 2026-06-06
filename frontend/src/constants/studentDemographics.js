// ESM mirror of constants/studentDemographics.js (backend, CommonJS).
// FE bundle scope: code lists + display label maps ONLY. The sanitizers
// from the BE module are intentionally NOT mirrored — input validation
// is the BE's trust boundary, not the FE's.
//
// DRIFT WARNING — two-writer hazard.
// The codes below MUST stay byte-for-byte aligned with:
//   1. constants/studentDemographics.js (BE, authoritative app-layer mirror)
//   2. migration-042-student-demographics.sql CHECK allowlists
//      (students.gender, student_race_ethnicity.category — the DB is the
//       ultimate authority)
// There is no automated CI check yet that diffs the FE list against the
// BE list against the M042 CHECKs. If you change one, change all three.
// A CI drift-check follow-up is banked alongside this PR.
//
// Race/ethnicity is included for completeness but PR-D does NOT consume
// it from the FE — the create + edit forms render only the four scalar
// demographic fields (iep_flag, sec_504_flag, ell_flag, gender). Race/
// ethnicity ships in PR-E, after the GET /students payload is widened
// to include the codes array (separate triad).

export const GENDER_CODES = ['M', 'F', 'X', 'prefer_not_to_say'];

export const GENDER_LABELS = {
  M: 'Male',
  F: 'Female',
  X: 'Non-binary / X',
  prefer_not_to_say: 'Prefer not to say',
};

export const RACE_ETHNICITY_CODES = ['AIAN', 'ASIAN', 'BLACK', 'HISP', 'MENA', 'NHPI', 'WHITE'];

export const RACE_ETHNICITY_LABELS = {
  AIAN: 'American Indian or Alaska Native',
  ASIAN: 'Asian',
  BLACK: 'Black or African American',
  HISP: 'Hispanic or Latino',
  MENA: 'Middle Eastern or North African',
  NHPI: 'Native Hawaiian or Pacific Islander',
  WHITE: 'White',
};

// Scalar three-state boolean demographic columns on the students table.
// State semantic: true = Yes, false = No, null = Unknown / not recorded.
// Blank/empty/undefined in any form input MUST coerce to null, NEVER to
// false — M042 three-state semantic is load-bearing.
export const FLAG_FIELDS = ['iep_flag', 'sec_504_flag', 'ell_flag'];

// FE-owned display labels for the flag fields. Not in the BE module
// (which is consumed by CSV import + JSON write paths that don't need
// human-readable strings). Single source for the FE forms' header text.
export const FLAG_LABELS = {
  iep_flag: 'IEP',
  sec_504_flag: 'Section 504 Plan',
  ell_flag: 'English Learner (EL/ELL)',
};
