import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// DisciplineReferralQueue — admin-review queue page for one school's
// discipline referrals.
//
// Trust boundary: every endpoint this component touches is server-gated
// (parent → 403; VIEW_ROLES gate on GET /queue/:tenantId via
// requireTenantStaffAccess; tenant access checked against
// resolveAccessibleTenantIds). The school picker offers exactly the
// schools the server will accept on the queue call — spoofing the picker
// hits a 403 server-side, not a silent leak.
//
// PII discipline (§4B):
//   - All GETs use cache: 'no-store' so the browser disk cache never
//     persists student names beyond this session.
//   - No localStorage / sessionStorage / IndexedDB writes anywhere.
//   - logError calls carry only a static tag + the error object — no
//     student names, no response bodies, no notes content.
//
// Fetch contract: apiFetch only (credentials + CSRF). URLs have no
// trailing slash (matches the existing DisciplineReferralModal pattern
// and the Vercel-rewrite + CSRF skip-list contract).

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'severity', label: 'Highest severity, oldest within tier' },
];

// Client-side sort (newest / oldest / severity-DESC) operates over the
// currently-loaded page, so the page needs to be big enough to hold a
// school's realistic open-queue volume — otherwise the severity sort
// silently reorders only what fit in the first page. 200 covers realistic
// per-school volume and aligns with the server's hard cap (the queue
// endpoint clamps limit to ≤200). "Load more" remains as the fallback
// when a school's volume exceeds even that.
const PAGE_SIZE = 200;

function severityClass(level) {
  if (level === 3) return 'bg-red-100 text-red-700';
  if (level === 2) return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

function statusLabel(s) {
  if (s === 'under_review') return 'Under review';
  if (s === 'resolved') return 'Resolved';
  return 'Submitted';
}

function statusPillClass(s) {
  if (s === 'under_review') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (s === 'resolved') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch (_) {
    return '';
  }
}

// Pure function — pulled out so sort/filter logic is testable by eye in
// review. Stable: relies on Array.prototype.sort being stable in modern
// JS engines (V8/JSC both stable since 2019).
function sortRows(rows, sortKey) {
  const copy = rows.slice();
  if (sortKey === 'newest') {
    copy.sort((a, b) => {
      const da = a.incident_date || '';
      const db = b.incident_date || '';
      if (da !== db) return da < db ? 1 : -1;
      return 0;
    });
  } else if (sortKey === 'oldest') {
    copy.sort((a, b) => {
      const da = a.incident_date || '';
      const db = b.incident_date || '';
      if (da !== db) return da < db ? -1 : 1;
      return 0;
    });
  } else if (sortKey === 'severity') {
    copy.sort((a, b) => {
      const sa = a.severity_level || 0;
      const sb = b.severity_level || 0;
      if (sa !== sb) return sb - sa;
      const da = a.incident_date || '';
      const db = b.incident_date || '';
      if (da !== db) return da < db ? -1 : 1;
      return 0;
    });
  }
  return copy;
}

export default function DisciplineReferralQueue(props) {
  const { user, API_URL, onOpenReferral } = props;

  const [schools, setSchools] = useState(null);
  const [schoolsError, setSchoolsError] = useState(null);
  const [selectedTenantId, setSelectedTenantId] = useState(user.tenant_id);
  // schoolsResolved gates the initial queue fetch so we don't fire it
  // until the school list has settled and selectedTenantId is its final
  // post-correction value. Prevents a throwaway/403 fetch on mount when
  // user.tenant_id isn't in the accessible-school set (district users
  // whose home tenant is the district's owning tenant). Flips to true
  // once in loadSchools' settle path (success OR error) and never resets.
  const [schoolsResolved, setSchoolsResolved] = useState(false);

  const [status, setStatus] = useState('submitted');
  const [sortKey, setSortKey] = useState('newest');

  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Load accessible schools once on mount. The server returns id + name
  // only; if length <= 1 we hide the picker and the queue is scoped to
  // the single accessible school (or user.tenant_id if the call failed).
  //
  // Auto-correction of selectedTenantId fires when the home tenant
  // (user.tenant_id) isn't in the accessible set — applies to both
  // length === 1 (district user whose home is the district's owning
  // tenant, with one school grant) and length > 1.
  //
  // schoolsResolved flips at the end of both success and error paths so
  // the queue-fetch effect can fire exactly once on mount, against the
  // settled selectedTenantId. On schools-fetch error we still let the
  // queue fire as a best-effort fallback — the server will 403 cleanly
  // if user.tenant_id isn't accessible.
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
        logError('[disciplineQueue:schools]', err);
        setSchoolsError('Could not load schools.');
        setSchools([]);
      } finally {
        if (!cancelled) setSchoolsResolved(true);
      }
    };
    loadSchools();
    return () => { cancelled = true; };
  }, [API_URL, user.tenant_id]);

  // Fetch one page of the queue. statusValue 'all' becomes no filter on
  // the wire (the server expects no ?status= param, or one of the three
  // canonical values).
  const fetchQueue = useCallback(async (tenantId, statusValue, pageOffset, mode) => {
    setLoading(true);
    setLoadError(null);
    try {
      let url = `${API_URL}/discipline-referrals/queue/${tenantId}?limit=${PAGE_SIZE}&offset=${pageOffset}`;
      if (statusValue && statusValue !== 'all') {
        url += `&status=${encodeURIComponent(statusValue)}`;
      }
      const res = await apiFetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('queue status ' + res.status);
      }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setHasMore(list.length === PAGE_SIZE);
      if (mode === 'append') {
        setRows((prev) => prev.concat(list));
      } else {
        setRows(list);
      }
    } catch (err) {
      logError('[disciplineQueue:fetch]', err);
      setLoadError('Could not load the queue.');
      if (mode !== 'append') setRows([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  // Initial + filter/school changes: reset offset and refetch from 0.
  // Gated on schoolsResolved so the first fetch fires after the school
  // list has settled and any selectedTenantId auto-correction is in
  // place — single fetch on mount, no throwaway against a stale value.
  useEffect(() => {
    if (!schoolsResolved) return;
    setOffset(0);
    fetchQueue(selectedTenantId, status, 0, 'replace');
  }, [selectedTenantId, status, fetchQueue, schoolsResolved]);

  const handleLoadMore = () => {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    fetchQueue(selectedTenantId, status, next, 'append');
  };

  const handleRefresh = () => {
    setOffset(0);
    fetchQueue(selectedTenantId, status, 0, 'replace');
  };

  const showPicker = Array.isArray(schools) && schools.length > 1;
  const sortedRows = sortRows(rows, sortKey);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Discipline review queue</h1>
          <p className="text-slate-500 mt-1">Behavior referrals awaiting administrator action.</p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
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

      {/* Status filter pills */}
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

      {/* Sort pills (client-side over the current page) */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-500 uppercase tracking-wide mr-1">Sort:</span>
        {SORT_OPTIONS.map((opt) => {
          const selected = sortKey === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setSortKey(opt.value)}
              className={
                'px-3 py-1 rounded-lg text-xs font-medium transition-colors ' +
                (selected
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        {loading && rows.length === 0 && (
          <div className="p-6 text-center text-slate-500">Loading…</div>
        )}
        {!loading && loadError && (
          <div className="p-6 text-center text-red-700">{loadError}</div>
        )}
        {!loading && !loadError && rows.length === 0 && (
          <div className="p-6 text-center text-slate-500 italic">No referrals match this filter.</div>
        )}
        {sortedRows.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {sortedRows.map((r) => {
              const studentName = (r.student_last_name || '') + (r.student_last_name && r.student_first_name ? ', ' : '') + (r.student_first_name || '');
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenReferral(r.id, selectedTenantId)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 focus:outline-none focus:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={'px-2 py-0.5 text-xs rounded-full ' + severityClass(r.severity_level)}>
                            Level {r.severity_level}
                          </span>
                          <span className="text-sm font-medium text-slate-800">{r.behavior_label}</span>
                          <span className={'text-xs px-2 py-0.5 rounded-full border ' + statusPillClass(r.status)}>
                            {statusLabel(r.status)}
                          </span>
                          {typeof r.consequence_count === 'number' && r.consequence_count > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                              {r.consequence_count} consequence{r.consequence_count > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-700 truncate">
                          <span className="font-medium">{studentName.trim() || '—'}</span>
                          {r.student_grade != null && (
                            <span className="text-slate-500"> · Grade {r.student_grade}</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {r.referring_staff_name && <span>Filed by {r.referring_staff_name}</span>}
                          {r.incident_date && <span>{formatDate(r.incident_date)}</span>}
                          {r.reviewing_admin_name && <span>Claimed by {r.reviewing_admin_name}</span>}
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-slate-400 shrink-0 mt-1" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            className="px-4 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 transition-colors"
          >
            Load more
          </button>
        </div>
      )}
      {loading && rows.length > 0 && (
        <div className="text-center text-sm text-slate-500">Loading…</div>
      )}
    </div>
  );
}
