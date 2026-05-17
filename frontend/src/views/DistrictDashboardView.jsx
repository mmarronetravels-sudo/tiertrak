// DistrictDashboardView — read-only landing page for district admins.
//
// Lists every school the caller has user_school_access to within
// their district, with active-student / staff / active-intervention
// counts per school. Backend: GET /api/districts/:id/dashboard
// (routes/districtDashboard.js). Tenant isolation is enforced
// server-side; this view is render-only.
//
// Empty-state copy intentionally does not reference "your district
// admin" — a district admin cannot ask above themselves.

import { useEffect, useState } from 'react';
import { Building2, Users, ClipboardList, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

export default function DistrictDashboardView() {
  const { user, API_URL } = useApp();
  // null = loading, [] = empty (legitimate state), [...] = data
  const [schools, setSchools] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.district_id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/districts/${user.district_id}/dashboard`);
        if (!res.ok) {
          if (!cancelled) setError('Could not load district overview.');
          return;
        }
        const data = await res.json();
        if (!cancelled) setSchools(Array.isArray(data.schools) ? data.schools : []);
      } catch (err) {
        logError(err, 'district-dashboard');
        if (!cancelled) setError('Could not load district overview.');
      }
    })();
    return () => { cancelled = true; };
  }, [user?.district_id, API_URL]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">My District</h1>
          <p className="text-slate-500 mt-1">{user?.district_name || 'District overview'}</p>
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
          <span>Loading schools…</span>
        </div>
      )}

      {!error && Array.isArray(schools) && schools.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Building2 size={48} className="mx-auto mb-4 text-slate-300" />
          <h3 className="text-lg font-medium text-slate-800 mb-2">No schools yet</h3>
          <p className="text-slate-500">Contact your system administrator.</p>
        </div>
      )}

      {!error && Array.isArray(schools) && schools.length > 0 && (
        <div className="space-y-4">
          {schools.map((s) => (
            <div
              key={s.school_tenant_id}
              className="bg-white rounded-xl border border-slate-200 p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <Building2 className="w-5 h-5 text-indigo-600" />
                <h2 className="font-semibold text-slate-800">{s.school_name}</h2>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-4 border border-indigo-200">
                  <Users size={20} className="text-indigo-600 mb-2" />
                  <p className="text-2xl font-bold text-indigo-900">{s.student_count}</p>
                  <p className="text-sm text-indigo-600">Active Students</p>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 border border-emerald-200">
                  <Users size={20} className="text-emerald-600 mb-2" />
                  <p className="text-2xl font-bold text-emerald-900">{s.staff_count}</p>
                  <p className="text-sm text-emerald-600">Staff</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
                  <ClipboardList size={20} className="text-purple-600 mb-2" />
                  <p className="text-2xl font-bold text-purple-900">{s.active_intervention_count}</p>
                  <p className="text-sm text-purple-600">Active Interventions</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!error && (
        <p className="text-sm text-slate-500 italic text-center pt-2">
          Staff and student management arrives in the next update.
        </p>
      )}
    </div>
  );
}
