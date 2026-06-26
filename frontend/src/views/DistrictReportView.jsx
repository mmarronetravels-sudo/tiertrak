// DistrictReportView — read-only district-wide screener rollup for district
// admins. The "District Report" surface.
//
// Backend: GET /api/districts/:id/screener-report?schoolYear=YYYY-YYYY
// (routes/districtReport.js). Returns AGGREGATE COUNTS ONLY — per-school
// totals, distinct students assessed, and a by_benchmark category map. No
// student-level rows ever cross the district boundary, so this view renders
// no student PII (data minimization, §4 / §4B).
//
// Tenant isolation is enforced entirely server-side: the endpoint resolves
// the caller's accessible school-tenant set from the JWT-verified user and
// double-binds every aggregate to that set AND the district. This view
// therefore calls with the user's OWN district_id (user.district_id) and
// never a client-supplied scope. It is render-only.
//
// Small-cell suppression is NOT applied (v1): the audience is district_admin,
// already authorized to view its own district's student-level data. Counts
// are raw. Product owns revisiting if a lower-trust audience is added.
//
// On fetch failure only a generic string is shown/logged — no response body
// or PII is surfaced.

import { useEffect, useState } from 'react';
import { BarChart3, Building2, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

const SCHOOL_YEARS = ['2025-2026', '2024-2025', '2023-2024'];
const PERIODS = ['Fall', 'Winter', 'Spring'];
const SUBJECTS = ['Reading', 'Math'];

// Canonical benchmark categories all contain the word "benchmark", so test
// the risk/near cases before the at/above case. Mirrors the per-student
// Screener History coloring on the Student Profile.
function benchColor(category) {
  const bench = (category || '').toLowerCase();
  if (bench.includes('below') || bench.includes('risk') || bench.includes('intervention')) {
    return 'bg-red-100 text-red-700';
  }
  if (bench.includes('near') || bench.includes('watch') || bench.includes('approaching')) {
    return 'bg-amber-100 text-amber-700';
  }
  if (bench.includes('above') || bench.includes('on track')) {
    return 'bg-emerald-100 text-emerald-700';
  }
  return 'bg-slate-100 text-slate-600';
}

export default function DistrictReportView() {
  const { user, API_URL } = useApp();
  const [schoolYear, setSchoolYear] = useState(SCHOOL_YEARS[0]);
  const [period, setPeriod] = useState('');   // '' = All periods (unconstrained)
  const [subject, setSubject] = useState(''); // '' = All subjects (unconstrained)
  // null = loading, [] = empty (legitimate state), [...] = data
  const [schools, setSchools] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.district_id) return;
    let cancelled = false;
    (async () => {
      try {
        // Reset to the loading state on (re)fetch — e.g. when a filter
        // changes. Kept inside the async body (not the effect body) so the
        // render-only view never calls setState synchronously in the effect.
        setSchools(null);
        setError(null);
        // Always scope to the caller's OWN district. The server re-derives
        // the accessible school set from the JWT — this id is an equality
        // guard only, never a trusted scope.
        const params = new URLSearchParams({ schoolYear });
        if (period) params.set('period', period);
        if (subject) params.set('subject', subject);
        const res = await apiFetch(
          `${API_URL}/districts/${user.district_id}/screener-report?${params.toString()}`
        );
        if (!res.ok) {
          if (!cancelled) setError('Could not load district report.');
          return;
        }
        const data = await res.json();
        if (!cancelled) setSchools(Array.isArray(data.schools) ? data.schools : []);
      } catch (err) {
        logError(err, 'district-report');
        if (!cancelled) setError('Could not load district report.');
      }
    })();
    return () => { cancelled = true; };
  }, [user?.district_id, API_URL, schoolYear, period, subject]);

  const selectClass =
    'border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">District Report</h1>
          <p className="text-slate-500 mt-1">
            {user?.district_name || 'District'} · screener results by school
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            aria-label="School year"
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            className={selectClass}
          >
            {SCHOOL_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            aria-label="Screening period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={selectClass}
          >
            <option value="">All periods</option>
            {PERIODS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            aria-label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={selectClass}
          >
            <option value="">All subjects</option>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {!error && schools === null && (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading report…</span>
        </div>
      )}

      {!error && Array.isArray(schools) && schools.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <BarChart3 size={48} className="mx-auto mb-4 text-slate-300" />
          <h3 className="text-lg font-medium text-slate-800 mb-2">No screener results</h3>
          <p className="text-slate-500">
            No schools or results for the selected filters.
          </p>
        </div>
      )}

      {!error && Array.isArray(schools) && schools.length > 0 && (
        <div className="space-y-4">
          {schools.map((s) => {
            const categories = Object.entries(s.by_benchmark || {});
            return (
              <div
                key={s.school_tenant_id}
                className="bg-white rounded-xl border border-slate-200 p-5"
              >
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-indigo-600" />
                    <h2 className="font-semibold text-slate-800">{s.school_name}</h2>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-slate-600">
                      Students assessed:{' '}
                      <span className="font-semibold text-slate-800">{s.students_assessed}</span>
                    </span>
                    <span className="text-slate-600">
                      Total results:{' '}
                      <span className="font-semibold text-slate-800">{s.total_results}</span>
                    </span>
                  </div>
                </div>

                {categories.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">
                    No results for the selected filters.
                  </p>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {categories.map(([category, count]) => (
                      <span
                        key={category}
                        className={`px-3 py-1 text-xs rounded-full font-medium ${benchColor(category)}`}
                      >
                        {category}: {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
