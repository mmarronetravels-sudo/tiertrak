// Canonical code lists for the M042 student-demographic fields.
//
// The codes here must match the M042 CHECK allowlists in
// migration-042-student-demographics.sql BYTE-FOR-BYTE. The DB CHECKs
// are authoritative; this module is the app-layer mirror used by CSV
// import, future write surfaces, and FE display lookups so we never
// rely on inline literals at the call sites.
//
// Labels (the display strings) intentionally live here, not in the DB
// per M042 commentary (lines 73-75). The DB owns the code set via the
// CHECK; the app owns the human-facing label set.

// gender — students.gender CHECK allowlist (M042 line 58-60).
// 'prefer_not_to_say' is lower_snake_case verbatim — match the DB.
const GENDER_CODES = ['M', 'F', 'X', 'prefer_not_to_say'];

const GENDER_LABELS = {
  M: 'Male',
  F: 'Female',
  X: 'Non-binary / X',
  prefer_not_to_say: 'Prefer not to say',
};

// race/ethnicity — student_race_ethnicity.category CHECK (M042 line 84-85).
// 2024 OMB SPD 15 seven minima.
const RACE_ETHNICITY_CODES = ['AIAN', 'ASIAN', 'BLACK', 'HISP', 'MENA', 'NHPI', 'WHITE'];

const RACE_ETHNICITY_LABELS = {
  AIAN: 'American Indian or Alaska Native',
  ASIAN: 'Asian',
  BLACK: 'Black or African American',
  HISP: 'Hispanic or Latino',
  MENA: 'Middle Eastern or North African',
  NHPI: 'Native Hawaiian or Pacific Islander',
  WHITE: 'White',
};

// Scalar boolean demographic columns on students. Three-state: TRUE,
// FALSE, NULL (unknown). Useful as a single source of truth for code
// paths that need to iterate over the flag columns symmetrically (e.g.,
// future audit-row aggregators).
const FLAG_FIELDS = ['iep_flag', 'sec_504_flag', 'ell_flag'];

// CSV-import boolean coercion tokens. Case-insensitive match. Blank /
// whitespace coerces to NULL (unknown), NEVER to FALSE — that distinction
// is load-bearing for the M042 three-state semantic.
const BOOL_TRUE_TOKENS = ['TRUE', 'T', '1', 'YES', 'Y'];
const BOOL_FALSE_TOKENS = ['FALSE', 'F', '0', 'NO', 'N'];

// Multi-value separator for the race_ethnicity CSV column. Semicolon
// chosen over comma because CSVs already use commas as field separators
// and quoting just for one column is operator-hostile.
const RACE_ETHNICITY_CSV_SEPARATOR = ';';

module.exports = {
  GENDER_CODES,
  GENDER_LABELS,
  RACE_ETHNICITY_CODES,
  RACE_ETHNICITY_LABELS,
  FLAG_FIELDS,
  BOOL_TRUE_TOKENS,
  BOOL_FALSE_TOKENS,
  RACE_ETHNICITY_CSV_SEPARATOR,
};
