// calendarFormShared — DB-free helpers for the academic-calendar management
// UIs. Extracted so the district surface (DistrictCalendarManager) validates
// term/break rows with the SAME logic the school surface intends, rather than a
// silently drifting copy. Logic only — constants + a pure validator; no JSX, no
// fetch, no PII.
//
// SchoolCalendarManager keeps its own inline copy (frozen byte-for-byte by
// instruction); this module is the single home for the district side and the
// natural adoption point if the school surface is ever unfrozen. Markup stays
// inline per-component (structural duplication is acceptable; logic is not).
//
// The server re-validates every request — this is fast client-side feedback
// only, never the trust boundary.

export const PERIOD_TYPES = ['term', 'break'];
export const LABEL_MAX = 60; // matches school_academic_calendar.label VARCHAR(60)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const EMPTY_FORM = {
  id: null,
  period_type: 'term',
  start_date: '',
  end_date: '',
  label: '',
};

// Client-side echo of the server's validateCalendarBody. Returns an error
// string or null. String comparison of YYYY-MM-DD is chronological, same as
// the server.
export function validateForm(form) {
  if (!PERIOD_TYPES.includes(form.period_type)) {
    return "Type must be 'term' or 'break'.";
  }
  if (!DATE_RE.test(form.start_date)) {
    return 'Start date must be a valid date (YYYY-MM-DD).';
  }
  if (!DATE_RE.test(form.end_date)) {
    return 'End date must be a valid date (YYYY-MM-DD).';
  }
  if (form.end_date < form.start_date) {
    return 'End date must be on or after start date.';
  }
  if (form.label && form.label.trim().length > LABEL_MAX) {
    return `Label must be ${LABEL_MAX} characters or fewer.`;
  }
  return null;
}
