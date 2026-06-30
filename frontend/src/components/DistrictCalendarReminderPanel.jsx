import { useEffect, useState } from 'react';
import { School } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';
import DistrictCalendarManager from './DistrictCalendarManager';
import DistrictReminderToggle from './DistrictReminderToggle';

// DistrictCalendarReminderPanel — district_admin wrapper that owns the school
// picker and composes the two district cards (calendar manager + reminder
// toggle). The school-list source is GET /api/districts/:id/schools (the
// Model-B, all-in-district route), NOT /dashboard's grant-filtered subset —
// that is the whole reason the route exists, so a district_admin can target any
// school in their district even with no per-school grants.
//
// §5: the picker only ever offers schools the server returned for THIS district
// (the route is gated to role === 'district_admin' AND own district). The
// selected school's integer id is threaded to the child cards, which re-send it
// on every write for the server to re-validate. Nothing is invented client-side.
//
// §4B: school names render in the picker/labels for orientation but are never
// logged or placed in URLs; logError carries a static tag only.

export default function DistrictCalendarReminderPanel({ API_URL, districtId }) {
  const [schools, setSchools] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/districts/${districtId}/schools`);
        if (!res.ok) {
          if (!cancelled) { setLoadError(true); setLoaded(true); }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data.schools) ? data.schools : [];
        setSchools(list);
        // Auto-select when the district has exactly one school.
        if (list.length === 1) setSelectedSchoolId(list[0].school_tenant_id);
        setLoadError(false);
        setLoaded(true);
      } catch (err) {
        logError(err, '[DistrictCalendarReminderPanel:load]');
        if (!cancelled) { setLoadError(true); setLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL, districtId]);

  if (!loaded) return null;

  if (loadError) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm text-rose-600">
          Could not load your district's schools. Please refresh and try again.
        </p>
      </div>
    );
  }

  if (schools.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <School size={22} className="text-slate-400 mt-0.5" />
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Calendar & reminders</h2>
            <p className="text-sm text-slate-500 mt-1">
              No schools in your district yet. Once a school is added you can manage its
              academic calendar and reminder settings here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const selectedSchool = schools.find((s) => s.school_tenant_id === selectedSchoolId) || null;
  const selectedSchoolName = selectedSchool ? selectedSchool.school_name : null;
  const single = schools.length === 1;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <School size={22} className="text-indigo-600 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-slate-800">Calendar & reminders</h2>
            <p className="text-sm text-slate-500 mt-1">
              Manage each school's academic calendar, and turn the weekly overdue-logs
              reminder on or off district-wide or per school.
            </p>
            {single ? (
              <p className="text-sm text-slate-600 mt-3">School: {selectedSchoolName}</p>
            ) : (
              <label className="block text-sm text-slate-600 mt-3">
                School
                <select
                  value={selectedSchoolId ?? ''}
                  onChange={(e) =>
                    setSelectedSchoolId(e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="mt-1 block w-full max-w-sm rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Select a school…</option>
                  {schools.map((s) => (
                    <option key={s.school_tenant_id} value={s.school_tenant_id}>
                      {s.school_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>

      <DistrictReminderToggle
        API_URL={API_URL}
        districtId={districtId}
        schoolTenantId={selectedSchoolId}
        schoolName={selectedSchoolName}
      />

      <DistrictCalendarManager
        API_URL={API_URL}
        districtId={districtId}
        schoolTenantId={selectedSchoolId}
        schoolName={selectedSchoolName}
      />
    </div>
  );
}
