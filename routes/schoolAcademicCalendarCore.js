// schoolAcademicCalendarCore — pure, DB-free helpers for the school_academic
// _calendar CRUD surfaces (routes/schoolAcademicCalendar.js for school_admin,
// routes/operatorAcademicCalendar.js for operators).
//
// Extracted from the routers so the authorization branch and the input
// validators can be unit-tested without a database (mirrors
// routes/schoolOverdueLogOptoutsCore.js and routes/screenerResetCore.js).
//
// §5 (gate 1, spec §6.1): the school_admin write/read path resolves the target
// school ONLY from the caller's accessible set. That contract already lives in
// schoolOverdueLogOptoutsCore.resolveOwnSchoolId (the #339 helper named in the
// PR-1 carry-forward gate), so it is IMPORTED here verbatim rather than
// re-implemented — there is exactly one place where the role gate + membership
// check are defined, and both surfaces consume it.
//
// This module adds only the NEW, calendar-shaped value validators (period_type,
// dates, optional label) plus a composite validateCalendarBody. All validators
// return a canonical value or null on invalid; validateCalendarBody returns the
// resolved fields or a { error: { status, message } } so the routers stay thin.
//
// §4B: nothing here is PII. period_type is an enum, the dates are calendar
// dates, and label is non-PII UI metadata held to the no-leak posture (it is
// never logged or emailed — confirmed at the route layer, gate 5).

const {
  SELF_SERVICE_ROLES,
  validateIntParam,
  resolveOwnSchoolId,
} = require('./schoolOverdueLogOptoutsCore');

// period_type mirrors the DB CHECK (chk_school_academic_calendar_period_type).
// Validating here turns an out-of-enum value into a clean 400 instead of a 500
// surfaced from the CHECK constraint.
const PERIOD_TYPES = ['term', 'break'];

const LABEL_MAX = 60; // matches school_academic_calendar.label VARCHAR(60)

function validatePeriodType(value) {
  return PERIOD_TYPES.includes(value) ? value : null;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Strict YYYY-MM-DD validation by string components — deliberately NOT
// new Date(value), which would shift a date-only string by the server's
// timezone offset (see the FE date-render TZ footgun). Rejects malformed
// shapes and impossible calendar dates (e.g. 2026-13-01, 2026-02-30). Returns
// the canonical YYYY-MM-DD string on success, or null.
function validateDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = [
    31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ][month - 1];
  if (day < 1 || day > daysInMonth) return null;
  return value;
}

// Resolve and validate the mutable fields of one calendar row from a request
// body. Returns { periodType, startDate, endDate, label } on success, or
// { error: { status, message } } on the first invalid field.
//
// end_date < start_date is rejected here (clean 400) ahead of the DB
// chk_date_order CHECK, so a non-inverted range never reaches a 500. The
// string comparison is valid because YYYY-MM-DD lexical order equals
// chronological order. label is optional, non-PII, and capped at LABEL_MAX so
// an over-length value is a clean 400 rather than a DB error echoing input.
function validateCalendarBody(body) {
  const b = body || {};

  const periodType = validatePeriodType(b.period_type);
  if (periodType === null) {
    return { error: { status: 400, message: "period_type must be 'term' or 'break'" } };
  }

  const startDate = validateDate(b.start_date);
  if (startDate === null) {
    return { error: { status: 400, message: 'start_date must be a valid YYYY-MM-DD date' } };
  }

  const endDate = validateDate(b.end_date);
  if (endDate === null) {
    return { error: { status: 400, message: 'end_date must be a valid YYYY-MM-DD date' } };
  }

  if (endDate < startDate) {
    return { error: { status: 400, message: 'end_date must be on or after start_date' } };
  }

  let label = null;
  if (b.label !== undefined && b.label !== null) {
    if (typeof b.label !== 'string') {
      return { error: { status: 400, message: 'label must be a string' } };
    }
    const trimmed = b.label.trim();
    if (trimmed.length > LABEL_MAX) {
      return { error: { status: 400, message: `label must be ${LABEL_MAX} characters or fewer` } };
    }
    label = trimmed.length === 0 ? null : trimmed;
  }

  return { periodType, startDate, endDate, label };
}

module.exports = {
  // Re-exported from schoolOverdueLogOptoutsCore so both calendar routers can
  // import the §5 contract from one place (gate 1: the resolved school id is
  // what gets written, never the raw body/param).
  SELF_SERVICE_ROLES,
  validateIntParam,
  resolveOwnSchoolId,
  // New calendar validators.
  PERIOD_TYPES,
  LABEL_MAX,
  validatePeriodType,
  validateDate,
  validateCalendarBody,
};
