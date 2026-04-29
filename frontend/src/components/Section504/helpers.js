// Section 504 frontend helpers — pure functions, no React.

// ============================================================
// Strict template interpolation for form-set rendering.
//
// Only the variables explicitly listed in ALLOWED_TEMPLATE_VARS are
// recognized; any other {{name}} pattern in source text is left
// LITERALLY in the output. This is fail-closed by design:
//
//   - A typo or future malicious form-set edit that introduces, say,
//     {{ssn}} surfaces as a visible "{{ssn}}" string to the staff
//     user — who then sees the bug — rather than silently substituting
//     from the values bag and exposing whatever is keyed under "ssn".
//   - The allowlist is intentionally hardcoded here, NOT derived from
//     the form set's templateVariables array. Adding a new variable
//     requires THREE edits in three files: form-set declaration,
//     this allowlist (capability), and the caller (passing the
//     value). All three are required — declaration alone does
//     nothing. This makes scope-widening a deliberate, reviewable
//     code change rather than a data edit.
//
// Allowed variables (must match oregon-ode-2025.js templateVariables):
//   {{studentName}}    — student's display name (first + last)
//   {{districtName}}   — district display name (not used in commit 2;
//                        added so Form J in commit 4 can interpolate
//                        it without a helpers.js change)
// ============================================================
const ALLOWED_TEMPLATE_VARS = new Set(['studentName', 'districtName']);

export function interpolateTemplate(template, values) {
  if (typeof template !== 'string') return '';
  if (!values || typeof values !== 'object') return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!ALLOWED_TEMPLATE_VARS.has(key)) return match;
    const v = values[key];
    if (v == null) return match;
    return String(v);
  });
}

// ============================================================
// YYYY-MM-DD → ISO 8601 timestamp anchored at LOCAL NOON.
//
// Backend isValidIsoTimestamp validator on /consents POSTs requires
// a full ISO timestamp (YYYY-MM-DDTHH:MM:SS[.mmm]Z). HTML <input
// type="date"> produces YYYY-MM-DD. This converts.
//
// Why local noon instead of the simpler-looking "T00:00:00Z":
// the user picked a calendar date, not a UTC instant. Storing UTC
// midnight is brittle — for any negative-offset tenant (Pacific,
// Mountain, etc.) UTC midnight 4/28 is 4/27 in local time, so any
// downstream `new Date(...).toLocaleDateString()` displays the wrong
// day. For 504 signature dates this is a legal-record concern.
//
// `new Date(year, monthIndex, day, 12, ...)` builds the timestamp at
// noon LOCAL time; `.toISOString()` serializes to UTC. Anchoring at
// 12:00 leaves a ±12-hour buffer, so the local civil date label is
// preserved for any consumer in UTC±11 (covers all of North America,
// Europe, Africa, most of Asia).
//
// Returns null for empty/invalid input so the caller can pass null
// on POST (DB columns are nullable).
// ============================================================
export function dateToIsoTimestamp(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toISOString();
}

// ============================================================
// Inverse: ISO 8601 timestamp → YYYY-MM-DD using LOCAL date components.
//
// Pairs with dateToIsoTimestamp's noon-local anchor: a viewer in the
// same general region (UTC±11) sees the date label originally picked.
// Using getFullYear/getMonth/getDate (NOT a UTC string regex) means
// the round-trip survives any future code path that converts via Date.
//
// Used when reopening an existing consent in mode='view' to hydrate
// the date inputs from the persisted timestamp columns.
// ============================================================
export function isoTimestampToDate(iso) {
  if (typeof iso !== 'string' || iso.length === 0) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
// Date-only extractor for pg DATE-column values from the bundle.
//
// pg DATE columns serialize over JSON as UTC-midnight ISO timestamps
// ('2026-04-28T00:00:00.000Z'). isoTimestampToDate() above uses LOCAL
// date components, which silently shifts a UTC-midnight timestamp back
// one day in any negative-offset zone (Pacific evening: stored 4/28
// would hydrate as 4/27). That helper is correct for the noon-local
// TIMESTAMP columns used by Form C's signature_at fields and Form I's
// determined_at, but wrong for the pure DATE columns introduced on
// student_504_plans (effective_date, review_date).
//
// This helper sidesteps timezone conversion entirely by extracting the
// YYYY-MM-DD prefix as a string. The prefix is correct in any zone
// because the backend stored it as a date-only value (no UTC<->local
// reinterpretation can change a calendar date with no time component).
//
// Accepts either a pre-sliced YYYY-MM-DD string or a full ISO
// timestamp; returns '' for empty/invalid input. Used to hydrate
// Form J's effective_date / review_date inputs in view mode.
// ============================================================
export function dateOnlyFromBundle(value) {
  if (typeof value !== 'string' || value.length < 10) return '';
  const prefix = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return '';
  return prefix;
}
