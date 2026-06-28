// weeklyProgressCore — pure, dependency-free week-math + overdue-cadence
// helpers for routes/weeklyProgress.js and the scheduled overdue-logs digest.
//
// Extracted from the router so these can be unit-tested in isolation, without
// loading the router's auth/rate-limit middleware chain (mirrors
// routes/schoolAcademicCalendarCore.js). No pg, no express, no env guards.
//
// getWeekStart parses dates by string components and builds Dates at local noon
// to avoid any timezone/DST boundary shifting the Monday it returns.

// Monday of the week containing `date` (a YYYY-MM-DD string or a Date), as a
// YYYY-MM-DD string.
function getWeekStart(date) {
  let year, month, day;

  if (typeof date === 'string') {
    [year, month, day] = date.split('-').map(Number);
  } else {
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }

  // Create date at noon (avoids any daylight saving issues too)
  const d = new Date(year, month - 1, day, 12, 0, 0);

  // Calculate Monday of this week
  const dayOfWeek = d.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Sunday = go back 6, else go to Monday
  d.setDate(d.getDate() + diff);

  const resultYear = d.getFullYear();
  const resultMonth = String(d.getMonth() + 1).padStart(2, '0');
  const resultDay = String(d.getDate()).padStart(2, '0');

  return `${resultYear}-${resultMonth}-${resultDay}`;
}

// The Monday of the week BEFORE the one whose Monday is `weekOf`. Computed at
// local noon (like getWeekStart) so no daylight-saving boundary shifts the day.
function getPriorWeekStart(weekOf) {
  const [year, month, day] = weekOf.split('-').map(Number);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  d.setDate(d.getDate() - 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// The set of week_of values whose presence in weekly_progress clears "overdue"
// for a plan of the given log_frequency. Per spec §3 decision #3, only
// 'biweekly' is sub-weekly: a biweekly plan is satisfied by a log in EITHER the
// current OR the prior week, so it is overdue only when both are missing; every
// other frequency keeps the weekly cadence (satisfied only by the current
// week). This is the single source of truth for the rule; the SQL CASE in
// getMissingLogsForStaff mirrors it row-by-row.
function satisfyingWeeks(logFrequency, currentWeek, priorWeek) {
  return logFrequency === 'biweekly'
    ? [currentWeek, priorWeek]
    : [currentWeek];
}

module.exports = { getWeekStart, getPriorWeekStart, satisfyingWeeks };
