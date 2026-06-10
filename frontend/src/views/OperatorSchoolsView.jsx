// OperatorSchoolsView — platform-operator drill-in: the schools of one
// district. Reached by clicking a district row in OperatorConsoleView.
// Backend:
//   GET  /api/operator/districts/:districtId/schools  (#265)
//   POST /api/operator/districts/:districtId/schools  (#264)
// (routes/operatorDistricts.js), both gated by requireAuth +
// platformAdminOnly. Like the console, the FE has no authority to assert
// operator status — the env-allowlist gate on the server is the trust
// boundary; this view is only mounted when App.jsx's isOperator is true.
//
// No student/staff PII is read or written here — schools (tenants of
// type 'school') hold only org-level name + subdomain.
//
// Props:
//   district = { id, name }  — selected in the console; name is for the
//                              header only, id drives every request.
//   onBack()                 — return to the districts console.

import { useEffect, useState } from 'react';
import { Building2, School, Loader2, Plus, ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

export default function OperatorSchoolsView({ district, onBack }) {
  const { API_URL } = useApp();
  // null = loading, [] = empty (legitimate state), [...] = data
  const [schools, setSchools] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Create-form state
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // refreshToken bumps to trigger a re-fetch after a successful create.
  const [refreshToken, setRefreshToken] = useState(0);

  const districtId = district.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/operator/districts/${districtId}/schools`);
        if (!res.ok) {
          if (!cancelled) {
            // Distinguish "district no longer exists" (e.g. removed out
            // from under an open view) from a real load failure, and from
            // an existing district with zero schools (200 + [] below).
            if (res.status === 404) setLoadError('District not found.');
            else if (res.status === 400) setLoadError('Invalid district.');
            else setLoadError('Could not load schools.');
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setSchools(Array.isArray(data) ? data : []);
          setLoadError(null);
        }
      } catch (err) {
        logError(err, 'operator-schools-list');
        if (!cancelled) setLoadError('Could not load schools.');
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL, districtId, refreshToken]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      // Normalize subdomain to match the BE rule (trim + lowercase, then
      // server validates ^[a-z0-9-]+$). The server stays the authority —
      // we surface its 400 verbatim rather than duplicating the regex.
      const res = await apiFetch(`${API_URL}/operator/districts/${districtId}/schools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), subdomain: subdomain.trim().toLowerCase() }),
      });
      if (!res.ok) {
        // Surface the API's own message verbatim (name required,
        // subdomain invalid, subdomain taken, district not found). These
        // BE messages are org-level, never PII.
        let message = 'Could not create school.';
        try {
          const body = await res.json();
          if (body && body.error) message = body.error;
        } catch { /* non-JSON body; keep generic message */ }
        setFormError(message);
        return;
      }
      // Success: reset the form and re-fetch the list (not optimistic).
      setName('');
      setSubdomain('');
      setRefreshToken((t) => t + 1);
    } catch (err) {
      logError(err, 'operator-schools-create');
      setFormError('Could not create school.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to districts
        </button>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
          <Building2 className="w-7 h-7 text-indigo-600" />
          {district.name}
        </h1>
        <p className="text-slate-500 mt-1">Manage the schools in this district.</p>
      </div>

      {/* Create school */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-indigo-600" />
          Add school
        </h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="school-name" className="block text-sm font-medium text-slate-700 mb-1">
                School name
              </label>
              <input
                id="school-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lincoln Elementary"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="school-subdomain" className="block text-sm font-medium text-slate-700 mb-1">
                Subdomain
              </label>
              <input
                id="school-subdomain"
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="e.g. lincoln"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              />
              <p className="text-xs text-slate-400 mt-1">Lowercase letters, numbers, and hyphens only.</p>
            </div>
          </div>

          {formError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">
              {formError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Adding…' : 'Add school'}
          </button>
        </form>
      </div>

      {/* School list */}
      <div className="space-y-4">
        <h2 className="font-semibold text-slate-800">Schools</h2>

        {loadError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
            {loadError}
          </div>
        )}

        {!loadError && schools === null && (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading schools…</span>
          </div>
        )}

        {!loadError && Array.isArray(schools) && schools.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <School size={48} className="mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-medium text-slate-800 mb-2">No schools yet</h3>
            <p className="text-slate-500">Add the first school using the form above.</p>
          </div>
        )}

        {!loadError && Array.isArray(schools) && schools.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Name</th>
                  <th className="text-left font-medium px-5 py-3">Subdomain</th>
                  <th className="text-left font-medium px-5 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schools.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 text-slate-800 font-medium flex items-center gap-2">
                      <School className="w-4 h-4 text-indigo-600" />
                      {s.name}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{s.subdomain}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
