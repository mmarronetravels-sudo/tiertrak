import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// DisciplineReports — admin/counselor/interventionist reports surface for
// the three SWIS-style cuts on /api/discipline-reports/<cut>/:tenantId.
//
// Trust boundary: every endpoint this component touches is server-gated
// (parent → 403; VIEW_ROLES = ['school_admin','district_admin','counselor',
// 'interventionist'] on each handler via requireTenantStaffAccess +
// in-handler role check). The role gate around the App.jsx nav button
// (canViewDisciplineReview) is a UX optimization — it hides the entry
// for ineligible roles — and is NOT the security boundary. A caller
// reaching these endpoints with a teacher/parent JWT gets 403 server-side
// regardless of FE state.
//
// PII discipline (§4B):
//   - All GETs use cache: 'no-store' so the browser disk cache never
//     persists tenant data beyond this session.
//   - No localStorage / sessionStorage / IndexedDB writes.
//   - logError carries only a static tag + the error object — no
//     response bodies, no PII.
//   - Response projections from the server are aggregate counts +
//     vocab labels only; no student or staff names ever reach this
//     component.
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
// rows, or the table body otherwise. Keeps the per-card render call sites
// short.
function EmptyOrTable({ rows, columns, renderRow }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic py-4">
        No referrals found for this range.
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

  const [byLocation, setByLocation]     = useState([]);
  const [byBehavior, setByBehavior]     = useState([]);
  const [byTimeOfDay, setByTimeOfDay]   = useState([]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

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

  // Fetch all three reports in parallel. Failure of any one surfaces a
  // single shared error banner — the empty arrays remain in place so the
  // tables render their empty-state captions instead of stale data.
  const fetchAll = useCallback(async (tenantId) => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(null);
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
      logError(err, '[disciplineReports:fetchAll]');
      setLoadError('Could not load reports.');
      setByLocation([]);
      setByBehavior([]);
      setByTimeOfDay([]);
    } finally {
      setLoading(false);
    }
  }, [API_URL, buildQuery]);

  // Fire reports load when schools settle + on any filter change.
  useEffect(() => {
    if (!schoolsResolved || !selectedTenantId) return;
    fetchAll(selectedTenantId);
  }, [schoolsResolved, selectedTenantId, fetchAll]);

  const handleRefresh = () => fetchAll(selectedTenantId);

  const showPicker = Array.isArray(schools) && schools.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Discipline Reports</h1>
          <p className="text-slate-500 mt-1">SWIS-style aggregate cuts for this school. Counts only — no student or staff names.</p>
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

      {/* Three report cards. Stacked at narrow widths, side-by-side on
          large screens — tailwind responsive grid. Each card uses
          EmptyOrTable so a zero-row report renders a friendly caption
          instead of a blank table. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* By location */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-3">By location</h2>
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
          <h2 className="text-lg font-semibold text-slate-800 mb-3">By incident type</h2>
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
          <h2 className="text-lg font-semibold text-slate-800 mb-3">By time of day</h2>
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
  );
}
