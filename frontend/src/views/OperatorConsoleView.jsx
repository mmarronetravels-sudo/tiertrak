// OperatorConsoleView — platform-operator console (v1: districts only).
//
// Lists every district and lets an operator create a new one. Backend:
// GET /api/operator/districts and POST /api/operator/districts
// (routes/operatorDistricts.js), both gated by requireAuth +
// platformAdminOnly. The FE isOperator flag (App.jsx) only controls
// nav visibility + view mount; the env-allowlist gate on the server is
// the trust boundary — this view has no authority to assert operator
// status. Clicking a district row drills into its schools
// (OperatorSchoolsView); first-admin onboarding arrives in a later PR.
//
// No student/staff PII is read or written here — districts hold only
// org-level name + auth_mode.

import { useEffect, useState } from 'react';
import { Building2, Loader2, Plus, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// Must match the BE allowlist in routes/operatorDistricts.js
// (ALLOWED_AUTH_MODES). Kept byte-identical so the select can never
// submit a value the server will 400.
const AUTH_MODES = ['sso', 'password', 'disabled'];

// onSelectDistrict({ id, name }) drills into a district's schools view
// (App.jsx routing). Optional so the console still renders standalone.
export default function OperatorConsoleView({ onSelectDistrict }) {
  const { API_URL } = useApp();
  // null = loading, [] = empty (legitimate state), [...] = data
  const [districts, setDistricts] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Create-form state
  const [name, setName] = useState('');
  const [authMode, setAuthMode] = useState('sso');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // refreshToken bumps to trigger a re-fetch after a successful create.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/operator/districts`);
        if (!res.ok) {
          if (!cancelled) setLoadError('Could not load districts.');
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setDistricts(Array.isArray(data) ? data : []);
          setLoadError(null);
        }
      } catch (err) {
        logError(err, 'operator-console-list');
        if (!cancelled) setLoadError('Could not load districts.');
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL, refreshToken]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch(`${API_URL}/operator/districts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), auth_mode: authMode }),
      });
      if (!res.ok) {
        // Surface the API's own message verbatim (name required,
        // auth_mode invalid, duplicate name, etc.). These BE messages
        // are org-level, never PII.
        let message = 'Could not create district.';
        try {
          const body = await res.json();
          if (body && body.error) message = body.error;
        } catch { /* non-JSON body; keep generic message */ }
        setFormError(message);
        return;
      }
      // Success: reset the form and re-fetch the list (not optimistic).
      setName('');
      setAuthMode('sso');
      setRefreshToken((t) => t + 1);
    } catch (err) {
      logError(err, 'operator-console-create');
      setFormError('Could not create district.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Operator Console</h1>
        <p className="text-slate-500 mt-1">Manage districts across all tenants.</p>
      </div>

      {/* Create district */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-indigo-600" />
          Create district
        </h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="district-name" className="block text-sm font-medium text-slate-700 mb-1">
                District name
              </label>
              <input
                id="district-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Springfield Unified"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="district-auth-mode" className="block text-sm font-medium text-slate-700 mb-1">
                Auth mode
              </label>
              <select
                id="district-auth-mode"
                value={authMode}
                onChange={(e) => setAuthMode(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              >
                {AUTH_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
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
            {submitting ? 'Creating…' : 'Create district'}
          </button>
        </form>
      </div>

      {/* District list */}
      <div className="space-y-4">
        <h2 className="font-semibold text-slate-800">Districts</h2>

        {loadError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
            {loadError}
          </div>
        )}

        {!loadError && districts === null && (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading districts…</span>
          </div>
        )}

        {!loadError && Array.isArray(districts) && districts.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <Building2 size={48} className="mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-medium text-slate-800 mb-2">No districts yet</h3>
            <p className="text-slate-500">Create the first district using the form above.</p>
          </div>
        )}

        {!loadError && Array.isArray(districts) && districts.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Name</th>
                  <th className="text-left font-medium px-5 py-3">Auth mode</th>
                  <th className="text-left font-medium px-5 py-3">Created</th>
                  <th className="px-5 py-3" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {districts.map((d) => {
                  const clickable = typeof onSelectDistrict === 'function';
                  return (
                    <tr
                      key={d.id}
                      onClick={clickable ? () => onSelectDistrict({ id: d.id, name: d.name }) : undefined}
                      className={clickable ? 'cursor-pointer hover:bg-slate-50 transition-colors' : undefined}
                    >
                      <td className="px-5 py-3 text-slate-800 font-medium flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-indigo-600" />
                        {d.name}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{d.auth_mode}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-400">
                        {clickable && <ChevronRight className="w-4 h-4 inline-block" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-500 italic text-center pt-2">
        Select a district to manage its schools. First-admin onboarding arrives in the next update.
      </p>
    </div>
  );
}
