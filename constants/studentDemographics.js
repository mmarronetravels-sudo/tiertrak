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

// ----------------------------------------------------------------------
// CSV-shape sanitizers — hoisted verbatim from routes/csvImport.js
// (commit 8afb036 redaction shape preserved). Single source of truth
// for the CSV import path's three-state semantic.
// ----------------------------------------------------------------------
//
// All three return { value, error }. error===null on success; value is
// the normalized form (null for "absent" / "unknown"). Error strings
// cite the column name and the valid set — they NEVER echo the
// offending input value (§4B). Blank / whitespace-only input always
// coerces to null (unknown), NEVER to false for boolean flags — the
// M042 three-state semantic is load-bearing.

function sanitizeBooleanFlag(raw, columnName) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null };
  }
  const upper = raw.toUpperCase();
  if (BOOL_TRUE_TOKENS.includes(upper)) return { value: true, error: null };
  if (BOOL_FALSE_TOKENS.includes(upper)) return { value: false, error: null };
  return {
    value: null,
    error: `Invalid ${columnName}. Must be one of ${BOOL_TRUE_TOKENS.join('/')} or ${BOOL_FALSE_TOKENS.join('/')} (blank = unknown).`,
  };
}

function sanitizeGender(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null };
  }
  const upper = raw.toUpperCase();
  for (const code of GENDER_CODES) {
    if (code.toUpperCase() === upper) return { value: code, error: null };
  }
  return {
    value: null,
    error: `Invalid gender. Must be one of: ${GENDER_CODES.join(', ')}.`,
  };
}

function sanitizeRaceEthnicity(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: [], error: null };
  }
  const allowed = new Set(RACE_ETHNICITY_CODES);
  const parts = raw
    .split(RACE_ETHNICITY_CSV_SEPARATOR)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const seen = new Set();
  const codes = [];
  for (const part of parts) {
    if (!allowed.has(part)) {
      return {
        value: null,
        error: `Invalid race_ethnicity code. Must be one or more of: ${RACE_ETHNICITY_CODES.join(', ')} (separated by '${RACE_ETHNICITY_CSV_SEPARATOR}').`,
      };
    }
    if (!seen.has(part)) {
      seen.add(part);
      codes.push(part);
    }
  }
  return { value: codes, error: null };
}

// ----------------------------------------------------------------------
// JSON-body sanitizers — for the M042 student write routes (PR-C).
// ----------------------------------------------------------------------
//
// CSV sanitizers above expect raw cell strings ('TRUE', 'M', 'WHITE;ASIAN').
// JSON sanitizers below expect parsed JSON shapes (real booleans, code
// strings, code arrays). Strict by design: no coercion of numbers,
// nested objects, or single strings into arrays. FE PR-D matches this
// contract verbatim. Same no-echo error doctrine (§4B).
//
// Three-state semantic preserved: undefined/null/'' → null (unknown);
// the route layer's hasOwnProperty gate decides preserve-on-omit vs
// clear-on-explicit-null at the PUT path.

function sanitizeBooleanFlagJson(raw, columnName) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null };
  }
  if (raw === true) return { value: true, error: null };
  if (raw === false) return { value: false, error: null };
  return {
    value: null,
    error: `Invalid ${columnName}. Must be true, false, or null.`,
  };
}

function sanitizeGenderJson(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null };
  }
  if (typeof raw !== 'string') {
    return {
      value: null,
      error: `Invalid gender. Must be one of: ${GENDER_CODES.join(', ')}.`,
    };
  }
  const upper = raw.toUpperCase();
  for (const code of GENDER_CODES) {
    if (code.toUpperCase() === upper) return { value: code, error: null };
  }
  return {
    value: null,
    error: `Invalid gender. Must be one of: ${GENDER_CODES.join(', ')}.`,
  };
}

function sanitizeRaceEthnicityArray(raw) {
  if (raw === undefined || raw === null) {
    return { value: [], error: null };
  }
  if (!Array.isArray(raw)) {
    return {
      value: null,
      error: `Invalid race_ethnicity. Must be an array of codes from: ${RACE_ETHNICITY_CODES.join(', ')}.`,
    };
  }
  const allowed = new Set(RACE_ETHNICITY_CODES);
  const seen = new Set();
  const codes = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      return {
        value: null,
        error: `Invalid race_ethnicity. Must be an array of codes from: ${RACE_ETHNICITY_CODES.join(', ')}.`,
      };
    }
    const upper = item.trim().toUpperCase();
    if (!upper) continue;
    if (!allowed.has(upper)) {
      return {
        value: null,
        error: `Invalid race_ethnicity code. Must be one or more of: ${RACE_ETHNICITY_CODES.join(', ')}.`,
      };
    }
    if (!seen.has(upper)) {
      seen.add(upper);
      codes.push(upper);
    }
  }
  return { value: codes, error: null };
}

module.exports = {
  GENDER_CODES,
  GENDER_LABELS,
  RACE_ETHNICITY_CODES,
  RACE_ETHNICITY_LABELS,
  FLAG_FIELDS,
  BOOL_TRUE_TOKENS,
  BOOL_FALSE_TOKENS,
  RACE_ETHNICITY_CSV_SEPARATOR,
  sanitizeBooleanFlag,
  sanitizeGender,
  sanitizeRaceEthnicity,
  sanitizeBooleanFlagJson,
  sanitizeGenderJson,
  sanitizeRaceEthnicityArray,
};
