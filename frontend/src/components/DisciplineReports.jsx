import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// DisciplineReports — admin/counselor/interventionist reports surface for
// the five SWIS-style cuts on /api/discipline-reports/<cut>/:tenantId.
//
// Two sections, two role-gate tiers:
//   Aggregate cuts (VIEW_ROLES — admin / counselor / interventionist):
//     by-location, by-incident-type, by-time-of-day
//   Per-person cuts (varies):
//     repeat-offenders  — same VIEW_ROLES; surfaces STUDENT display names
//     by-staff          — narrower STAFF_VIEW_ROLES (school_admin /
//                         district_admin ONLY) per product decision R5;
//                         surfaces STAFF display names. Counselor /
//                         interventionist are deliberately not permitted.
//
// Trust boundary: every endpoint is server-gated by routes/disciplineReports.js
// (parent → 403; per-handler role check via VIEW_ROLES or STAFF_VIEW_ROLES;
// tenant scope via requireTenantStaffAccess). The role gate around the
// App.jsx nav button (canViewDisciplineReview) AND the in-component
// canViewStaffReport check are both UX optimizations — they hide
// entries / cards for ineligible roles — and are NOT the security boundary.
// A caller forcing the request with a teacher/parent JWT gets 403 server-
// side regardless of FE state.
//
// PII discipline (§4B):
//   Wave 1 cuts (by-location, by-incident-type, by-time-of-day) return
//   aggregate counts + vocab labels only — no PII.
//   Wave 2 cuts (repeat-offenders, by-staff) return DISPLAY NAMES:
//     - repeat-offenders: student_first_name + student_last_name only —
//       no DOB, no external_id, no email, no grade
//     - by-staff:         staff_full_name only — no email, no role, no
//                         district_id
//   The four-point granter-name precedent from PR #193's privacy ruling
//   (audit-subject purpose + repo precedent + strict minimum projection
//   + gated recipient) applies to both wave-2 cuts.
//   - All GETs use cache: 'no-store' so the browser disk cache never
//     persists tenant data beyond this session.
//   - No localStorage / sessionStorage / IndexedDB writes.
//   - logError carries only a static tag + the error object — no
//     response bodies, no PII.
//
// Fetch contract: apiFetch only (credentials + CSRF). URLs have NO
// trailing slash — mirrors the DisciplineReferralQueue/Modal pattern
// and avoids the Vercel-rewrite + CSRF skip-list interaction that bit
// the disciplineReferrals POST (PR #183 fix). The :tenantId path
// segment is the last component, which structurally avoids that bug
// here, but the convention is preserved.

const STATUS_OPTIONS = [
  { value: 'all',          label: 'All' },
  { value: 'submitted',    label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'resolved',     label: 'Resolved' },
];

function severityClass(level) {
  if (level === 3) return 'bg-red-100 text-red-700';
  if (level === 2) return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

// 24-hour integer → "8:00 AM" style label. Server may return null for
// referrals where incident_time wasn't recorded; render those with a
// distinct caption.
function formatHour(h) {
  if (h === null || h === undefined) return 'No time recorded';
  if (h === 0) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  if (h < 12) return h + ':00 AM';
  return (h - 12) + ':00 PM';
}

// EmptyOrTable — render a small empty-state caption when there are zero
// rows, or the table body otherwise. emptyMessage defaults to a generic
// caption; per-card overrides let repeat-offenders say "No students with
// 2+ referrals in this range" etc. Keeps the per-card render call sites
// short.
function EmptyOrTable({ rows, columns, renderRow, emptyMessage }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic py-4">
        {emptyMessage || 'No referrals found for this range.'}
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
          {columns.map((c) => (
            <th key={c.key} className={'pb-2 font-medium ' + (c.className || '')}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{rows.map(renderRow)}</tbody>
    </table>
  );
}

export default function DisciplineReports(props) {
  const { user, API_URL } = props;

  // ====================================================================
  // School-picker state — mirrors DisciplineReferralQueue exactly per
  // the design pause (no hook extraction; duplicate the ~30 lines so
  // the two surfaces stay independently reviewable). Auto-correction
  // fires when the home tenant isn't in the accessible set (district
  // users whose home tenant is the district's owning tenant); schools
  // Resolved gates the initial report fetch so we don't fire a
  // throwaway 403 on mount.
  // ====================================================================
  const [schools, setSchools] = useState(null);
  const [schoolsError, setSchoolsError] = useState(null);
  const [selectedTenantId, setSelectedTenantId] = useState(user.tenant_id);
  const [schoolsResolved, setSchoolsResolved] = useState(false);

  // Shared filter state for all three reports.
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('all');

  const [byLocation, setByLocation]         = useState([]);
  const [byBehavior, setByBehavior]         = useState([]);
  const [byTimeOfDay, setByTimeOfDay]       = useState([]);
  const [repeatOffenders, setRepeatOffenders] = useState([]);
  const [byStaff, setByStaff]               = useState([]);

  // min_count for the repeat-offenders cut. Card-local control (not in
  // the shared filter strip) because it applies to only one cut. Default
  // 2 per spec; FE clamps to [1, 1000] on every change so we never hit
  // the server's REPEAT_OFFENDERS_MAX_MIN_COUNT cap.
  const [minCount, setMinCount] = useState(2);

  // Per-cut error state aggregated into a single banner. First non-null
  // wins. Allows the three fetch functions to be independent without
  // racing on a shared error setter.
  const [errorAggregates, setErrorAggregates] = useState(null);
  const [errorRepeat, setErrorRepeat]         = useState(null);
  const [errorStaff, setErrorStaff]           = useState(null);
  const loadError = errorAggregates || errorRepeat || errorStaff;

  // Loading indicator backed by an in-flight counter so overlapping
  // fetches don't race. loading = true while ANY cut is in flight.
  const [inFlight, setInFlight] = useState(0);
  const loading = inFlight > 0;

  // FE role-gate for the by-staff card. UX-only: server enforces
  // STAFF_VIEW_ROLES = ['school_admin', 'district_admin'] independently
  // on routes/disciplineReports.js. Counselor/interventionist would 403
  // server-side; we suppress the request entirely to avoid log noise.
  const canViewStaffReport = user.role === 'school_admin' || user.role === 'district_admin';

  // Load accessible schools once on mount. Mirrors DisciplineReferralQueue's
  // loadSchools shape including the auto-correction + schoolsResolved
  // settle behavior.
  useEffect(() => {
    let cancelled = false;
    const loadSchools = async () => {
      try {
        const res = await apiFetch(`${API_URL}/auth/me/schools`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error('schools status ' + res.status);
        }
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setSchools(list);
        if (list.length >= 1) {
          const hasHome = list.some((s) => s.id === user.tenant_id);
          if (!hasHome) {
            setSelectedTenantId(list[0].id);
          }
        }
      } catch (err) {
        if (cancelled) return;
        logError(err, '[disciplineReports:schools]');
        setSchoolsError('Could not load schools.');
        setSchools([]);
      } finally {
        if (!cancelled) setSchoolsResolved(true);
      }
    };
    loadSchools();
    return () => { cancelled = true; };
  }, [API_URL, user.tenant_id]);

  // Build the shared query string from current filter state. status='all'
  // omits the param entirely (server expects either no ?status= or one of
  // the three canonical values).
  const buildQuery = useCallback(() => {
    const parts = [];
    if (startDate) parts.push('start_date=' + encodeURIComponent(startDate));
    if (endDate)   parts.push('end_date=' + encodeURIComponent(endDate));
    if (status && status !== 'all') parts.push('status=' + encodeURIComponent(status));
    return parts.length > 0 ? '?' + parts.join('&') : '';
  }, [startDate, endDate, status]);

  // Three independent fetch functions so a filter that only affects one
  // cut (e.g. minCount → repeat-offenders) doesn't re-fire the others.
  // Each manages its own in-flight counter slot + error state.

  // fetchAggregates — the three wave-1 (non-PII) cuts in parallel.
  // Shared error banner across all three; if any fail, all three reset
  // to empty arrays so the tables render the friendly empty-state caption
  // instead of stale data.
  const fetchAggregates = useCallback(async (tenantId) => {
    if (!tenantId) return;
    setInFlight((n) => n + 1);
    setErrorAggregates(null);
    const qs = buildQuery();
    const base = API_URL + '/discipline-reports';
    try {
      const [locRes, behRes, todRes] = await Promise.all([
        apiFetch(base + '/by-location/' + tenantId + qs,       { cache: 'no-store' }),
        apiFetch(base + '/by-incident-type/' + tenantId + qs,  { cache: 'no-store' }),
        apiFetch(base + '/by-time-of-day/' + tenantId + qs,    { cache: 'no-store' }),
      ]);
      if (!locRes.ok || !behRes.ok || !todRes.ok) {
        throw new Error(
          'report statuses: location=' + locRes.status +
          ' behavior=' + behRes.status +
          ' timeOfDay=' + todRes.status
        );
      }
      const [locData, behData, todData] = await Promise.all([
        locRes.json(), behRes.json(), todRes.json(),
      ]);
      setByLocation(Array.isArray(locData) ? locData : []);
      setByBehavior(Array.isArray(behData) ? behData : []);
      setByTimeOfDay(Array.isArray(todData) ? todData : []);
    } catch (err) {
      logError(err, '[disciplineReports:fetchAggregates]');
      setErrorAggregates('Could not load reports.');
      setByLocation([]);
      setByBehavior([]);
      setByTimeOfDay([]);
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [API_URL, buildQuery]);

  // fetchRepeatOffenders — PII-bearing cut (student names). Has its own
  // dep on minCount so card-local min_count changes re-fetch ONLY this
  // cut, not the others.
  const fetchRepeatOffenders = useCallback(async (tenantId) => {
    if (!tenantId) return;
    setInFlight((n) => n + 1);
    setErrorRepeat(null);
    const qs = buildQuery();
    const minCountParam = (qs ? '&' : '?') + 'min_count=' + encodeURIComponent(String(minCount));
    try {
      const res = await apiFetch(
        API_URL + '/discipline-reports/repeat-offenders/' + tenantId + qs + minCountParam,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        throw new Error('repeat-offenders status ' + res.status);
      }
      const data = await res.json();
      setRepeatOffenders(Array.isArray(data) ? data : []);
    } catch (err) {
      logError(err, '[disciplineReports:fetchRepeatOffenders]');
      setErrorRepeat('Could not load repeat-offenders report.');
      setRepeatOffenders([]);
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [API_URL, buildQuery, minCount]);

  // fetchByStaff — PII-bearing cut (staff names). Admin-only.
  // Non-admin callers never fire the request — avoids predictable
  // server-side 403 log noise.
  const fetchByStaff = useCallback(async (tenantId) => {
    if (!tenantId) return;
    if (!canViewStaffReport) {
      setByStaff([]);
      return;
    }
    setInFlight((n) => n + 1);
    setErrorStaff(null);
    const qs = buildQuery();
    try {
      const res = await apiFetch(
        API_URL + '/discipline-reports/by-staff/' + tenantId + qs,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        throw new Error('by-staff status ' + res.status);
      }
      const data = await res.json();
      setByStaff(Array.isArray(data) ? data : []);
    } catch (err) {
      logError(err, '[disciplineReports:fetchByStaff]');
      setErrorStaff('Could not load by-staff report.');
      setByStaff([]);
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [API_URL, buildQuery, canViewStaffReport]);

  // Three useEffects, one per fetch function. Each fires when its
  // callback identity changes — meaning minCount changes ONLY re-fire
  // fetchRepeatOffenders, and canViewStaffReport changes ONLY re-fire
  // fetchByStaff. Shared filters (startDate/endDate/status via
  // buildQuery) and selectedTenantId re-fire all three.
  useEffect(() => {
    if (!schoolsResolved || !selectedTenantId) return;
    fetchAggregates(selectedTenantId);
  }, [schoolsResolved, selectedTenantId, fetchAggregates]);

  useEffect(() => {
    if (!schoolsResolved || !selectedTenantId) return;
    fetchRepeatOffenders(selectedTenantId);
  }, [schoolsResolved, selectedTenantId, fetchRepeatOffenders]);

  useEffect(() => {
    if (!schoolsResolved || !selectedTenantId) return;
    fetchByStaff(selectedTenantId);
  }, [schoolsResolved, selectedTenantId, fetchByStaff]);

  const handleRefresh = () => {
    fetchAggregates(selectedTenantId);
    fetchRepeatOffenders(selectedTenantId);
    fetchByStaff(selectedTenantId);
  };

  const showPicker = Array.isArray(schools) && schools.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Discipline Reports</h1>
          <p className="text-slate-500 mt-1">Totals across the school, plus reports that list specific students or staff. What you see depends on your role.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* School picker (only when >1 accessible) */}
      {showPicker && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <label className="block text-sm font-medium text-slate-700 mb-1">School</label>
          <select
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(Number(e.target.value))}
            className="w-full sm:w-80 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {schoolsError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">
          {schoolsError}
        </div>
      )}

      {/* Shared filter strip — date range + status. All three reports
          share these and re-fetch on any change. */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Status</label>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const selected = status === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    className={
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' +
                      (selected
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50')
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">
          {loadError}
        </div>
      )}

      {/* === SECTION 1: Aggregate cuts (no PII) ===
          visible to admin / counselor / interventionist. Counts and
          tenant-customizable vocab labels only — no student or staff
          names ever reach this section. */}
      <div>
        <h2 className="text-base font-semibold text-slate-700 mb-3 border-b border-slate-200 pb-2">
          Aggregate cuts
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* By location */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <h3 className="text-base font-medium text-slate-800 mb-3">By location</h3>
            <EmptyOrTable
              rows={byLocation}
              columns={[
                { key: 'location_label', label: 'Location' },
                { key: 'referral_count', label: 'Count', className: 'text-right' },
              ]}
              renderRow={(r) => (
                <tr key={r.location_id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">{r.location_label}</td>
                  <td className="py-2 text-right font-medium text-slate-800">{r.referral_count}</td>
                </tr>
              )}
            />
          </div>

          {/* By incident type */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <h3 className="text-base font-medium text-slate-800 mb-3">By incident type</h3>
            <EmptyOrTable
              rows={byBehavior}
              columns={[
                { key: 'behavior_label', label: 'Behavior' },
                { key: 'severity_level', label: 'Severity' },
                { key: 'referral_count', label: 'Count', className: 'text-right' },
              ]}
              renderRow={(r) => (
                <tr key={r.behavior_id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">{r.behavior_label}</td>
                  <td className="py-2">
                    <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + severityClass(r.severity_level)}>
                      L{r.severity_level}
                    </span>
                  </td>
                  <td className="py-2 text-right font-medium text-slate-800">{r.referral_count}</td>
                </tr>
              )}
            />
          </div>

          {/* By time of day */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <h3 className="text-base font-medium text-slate-800 mb-3">By time of day</h3>
            <EmptyOrTable
              rows={byTimeOfDay}
              columns={[
                { key: 'hour', label: 'Hour' },
                { key: 'referral_count', label: 'Count', className: 'text-right' },
              ]}
              renderRow={(r, idx) => (
                <tr key={r.hour === null ? 'null' : 'h' + r.hour + '-' + idx} className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">{formatHour(r.hour)}</td>
                  <td className="py-2 text-right font-medium text-slate-800">{r.referral_count}</td>
                </tr>
              )}
            />
          </div>
        </div>
      </div>

      {/* === SECTION 2: Per-person cuts (PII — student or staff names) ===
          repeat-offenders: same VIEW_ROLES gate as aggregate cuts
          by-staff: NARROWER STAFF_VIEW_ROLES (admin only); the card is
          hidden for counselor/interventionist via canViewStaffReport. */}
      <div>
        <h2 className="text-base font-semibold text-slate-700 mb-3 border-b border-slate-200 pb-2">
          Per-person cuts
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Repeat offenders */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h3 className="text-base font-medium text-slate-800">Students with</h3>
              <input
                type="number"
                min="1"
                max="1000"
                value={minCount}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10);
                  const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(1000, raw)) : 2;
                  setMinCount(clamped);
                }}
                className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Minimum referral count"
              />
              <h3 className="text-base font-medium text-slate-800">+ referrals</h3>
            </div>
            <EmptyOrTable
              rows={repeatOffenders}
              emptyMessage={`No students with ${minCount}+ referrals in this range.`}
              columns={[
                { key: 'student_name', label: 'Student' },
                { key: 'referral_count', label: 'Count', className: 'text-right' },
              ]}
              renderRow={(r) => (
                <tr key={r.student_id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">{r.student_first_name} {r.student_last_name}</td>
                  <td className="py-2 text-right font-medium text-slate-800">{r.referral_count}</td>
                </tr>
              )}
            />
          </div>

          {/* By staff — admin-only card (gated by canViewStaffReport;
              server is the real boundary via STAFF_VIEW_ROLES). */}
          {canViewStaffReport && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h3 className="text-base font-medium text-slate-800 mb-3">By staff (referrals submitted)</h3>
              <EmptyOrTable
                rows={byStaff}
                emptyMessage="No referrals submitted by staff in this range."
                columns={[
                  { key: 'staff_full_name', label: 'Staff' },
                  { key: 'referral_count', label: 'Count', className: 'text-right' },
                ]}
                renderRow={(r) => (
                  <tr key={r.staff_id} className="border-b border-slate-100">
                    <td className="py-2 text-slate-700">{r.staff_full_name}</td>
                    <td className="py-2 text-right font-medium text-slate-800">{r.referral_count}</td>
                  </tr>
                )}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
