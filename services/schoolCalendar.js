// services/schoolCalendar.js
//
// Pure, DB-free calendar logic for the calendar-aware weekly overdue-progress-
// logs digest (services/overdueLogsDigest.js). Given one school's already-loaded
// academic-calendar rows (school_academic_calendar, migration-052) and the
// Monday of a week, it answers a single question: "is this school in session
// that week?" The digest uses the answer to skip a week that falls outside the
// school's term ranges or inside a break, instead of flagging overdue forever.
//
// This module is intentionally DB-free and req-free so it can be unit-tested in
// isolation (mirrors routes/schoolAcademicCalendarCore.js). The caller (the
// digest) is responsible for loading the rows scoped to the school being
// processed; this file never queries.
//
// §4B / gate 5: the calendar `label` column is convenience UI metadata that the
// digest must never log or email. This helper NEVER reads `label` — its inputs
// are period_type, start_date, and end_date only — so label cannot leak through
// the in-session computation by construction. Inputs carry no PII regardless.
//
// In-session rule (spec §3 decision #5, and decision #4 for the no-term case):
//   - An explicit `break` row that contains the week ALWAYS makes the school
//     out of session, whether or not the school declared any `term` rows. An
//     entered break is never discarded.
//   - If the school declared at least one `term` row: in session iff the week
//     falls inside some term range (and, per the break rule above, inside no
//     break range).
//   - If the school declared NO `term` rows: it is treated as "in session
//     except the annual default break window" — in session iff the week is
//     outside the env-driven default window AND outside every explicit break
//     row the school did enter. This replaces the old flag-forever behavior for
//     schools that have not set up a calendar yet.
//
// All date comparisons are on canonical YYYY-MM-DD strings, whose lexical order
// equals chronological order. Row dates may arrive as pg Date objects or as
// strings; toYmd normalizes both using LOCAL components (matching getWeekStart's
// timezone-safe approach), so a DATE column parsed to a local-midnight Date is
// not shifted across a day boundary.

// Default break window (month-day pairs), applied every year: mid-June ->
// mid-Aug. Overridable via OVERDUE_LOGS_DEFAULT_BREAK = "MM-DD:MM-DD".
const DEFAULT_BREAK_START = '06-15';
const DEFAULT_BREAK_END = '08-15';

// Normalize a Date or string to canonical YYYY-MM-DD using local components.
function toYmd(value) {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value == null ? '' : value).slice(0, 10);
}

// Validate an "MM-DD" string: month 01-12, day 01-31 (range-bound only; this is
// a window boundary, not a stored calendar date).
function isValidMonthDay(md) {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

// Parse the env-driven default break window, falling back to the mid-June ->
// mid-Aug default on any malformed value (mirrors the digest's parseIntEnv
// fail-safe). Returns { start, end } as MM-DD strings.
function parseDefaultBreakWindow(env) {
  const raw = env && env.OVERDUE_LOGS_DEFAULT_BREAK;
  if (typeof raw === 'string') {
    const m = /^\s*(\d{2}-\d{2})\s*:\s*(\d{2}-\d{2})\s*$/.exec(raw);
    if (m && isValidMonthDay(m[1]) && isValidMonthDay(m[2])) {
      return { start: m[1], end: m[2] };
    }
  }
  return { start: DEFAULT_BREAK_START, end: DEFAULT_BREAK_END };
}

// Is the week's Monday inside the annual default break window? Compares MM-DD
// only, so it applies every year. A non-wrapping window (start <= end, e.g. the
// mid-June -> mid-Aug default) uses an inclusive between; a wrapping window
// (start > end, e.g. a winter break spanning year-end) matches md >= start OR
// md <= end.
function inDefaultBreak(weekOf, env) {
  const md = toYmd(weekOf).slice(5); // MM-DD
  const { start, end } = parseDefaultBreakWindow(env);
  if (start <= end) return md >= start && md <= end;
  return md >= start || md <= end;
}

// Does a calendar row's [start_date, end_date] inclusive range contain the week?
function rangeContains(row, weekOf) {
  return toYmd(row.start_date) <= weekOf && weekOf <= toYmd(row.end_date);
}

// is the school in session for the week whose Monday is `weekOf`?
//   weekOf - YYYY-MM-DD (or a Date); the Monday boundary from getWeekStart
//   rows   - this ONE school's calendar rows: { period_type, start_date, end_date }
//            (label is never read here)
//   env    - process.env (for the default break window)
function isWeekInSession(weekOf, rows, env) {
  const week = toYmd(weekOf);
  const safeRows = Array.isArray(rows) ? rows : [];

  // An explicit break always wins, regardless of whether terms were declared.
  const inBreak = safeRows.some(
    (r) => r.period_type === 'break' && rangeContains(r, week)
  );
  if (inBreak) return false;

  const terms = safeRows.filter((r) => r.period_type === 'term');
  if (terms.length === 0) {
    // No declared term: in session except the default window (explicit breaks
    // already excluded above).
    return !inDefaultBreak(week, env);
  }
  return terms.some((r) => rangeContains(r, week));
}

module.exports = {
  DEFAULT_BREAK_START,
  DEFAULT_BREAK_END,
  toYmd,
  parseDefaultBreakWindow,
  inDefaultBreak,
  isWeekInSession,
};
