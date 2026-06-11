// OperatorSchoolsView — platform-operator drill-in: the schools AND admins
// of one district. Reached by clicking a district row in
// OperatorConsoleView. Backend (routes/operatorDistricts.js), all gated by
// requireAuth + platformAdminOnly:
//   GET  /api/operator/districts/:districtId/schools                  (#265)
//   POST /api/operator/districts/:districtId/schools                  (#264)
//   GET  /api/operator/districts/:districtId/admins                   (this PR)
//   POST /api/operator/districts/:districtId/admins                   (#270)
//   GET  /api/operator/districts/:districtId/admins/:userId/access    (#271)
//   POST /api/operator/districts/:districtId/admins/:userId/access    (#271)
// Like the console, the FE has no authority to assert operator status —
// the env-allowlist gate on the server is the trust boundary; this view is
// only mounted when App.jsx's isOperator is true.
//
// §4B: the Admins section reads staff PII (admin email + full_name) and
// renders it to the DOM for the authorized operator. That PII is NEVER
// passed to logError/console (only tag + raw error objects are logged) and
// never placed in an error body or URL. Schools (tenants of type 'school')
// hold only org-level name + subdomain.
//
// Props:
//   district = { id, name }  — selected in the console; name is for the
//                              header only, id drives every request.
//   onBack()                 — return to the districts console.

import { useEffect, useState } from 'react';
import { Building2, School, Loader2, Plus, ArrowLeft, Users, UserPlus } from 'lucide-react';
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

  // Admins section state — null = loading, [] = empty, [...] = data.
  const [admins, setAdmins] = useState(null);
  const [adminsLoadError, setAdminsLoadError] = useState(null);
  const [adminsRefreshToken, setAdminsRefreshToken] = useState(0);

  // Create-admin form state. full_name + email are staff PII (§4B): held in
  // component state and rendered to the DOM only, never logged.
  const [adminFullName, setAdminFullName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const [adminFormError, setAdminFormError] = useState(null);

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

  // Load the district's district_admin users (id + email + full_name).
  // Scoped server-side to this district_id; re-runs after a create.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/operator/districts/${districtId}/admins`);
        if (!res.ok) {
          if (!cancelled) {
            if (res.status === 404) setAdminsLoadError('District not found.');
            else if (res.status === 400) setAdminsLoadError('Invalid district.');
            else setAdminsLoadError('Could not load admins.');
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setAdmins(Array.isArray(data) ? data : []);
          setAdminsLoadError(null);
        }
      } catch (err) {
        // Tag-only: never log the admin list (PII) — only the raw error.
        logError(err, 'operator-admins-list');
        if (!cancelled) setAdminsLoadError('Could not load admins.');
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL, districtId, adminsRefreshToken]);

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    if (adminSubmitting) return;
    setAdminFormError(null);
    setAdminSubmitting(true);
    try {
      const res = await apiFetch(`${API_URL}/operator/districts/${districtId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: adminFullName.trim(),
          email: adminEmail.trim().toLowerCase(),
        }),
      });
      if (!res.ok) {
        // Surface the API's own message verbatim (email/full_name required,
        // district not found, duplicate email). These BE messages are
        // org-level — they never echo the submitted name/email back.
        let message = 'Could not create admin.';
        try {
          const body = await res.json();
          if (body && body.error) message = body.error;
        } catch { /* non-JSON body; keep generic message */ }
        setAdminFormError(message);
        return;
      }
      // Success: reset the form and re-fetch the list (not optimistic).
      setAdminFullName('');
      setAdminEmail('');
      setAdminsRefreshToken((t) => t + 1);
    } catch (err) {
      logError(err, 'operator-admins-create');
      setAdminFormError('Could not create admin.');
    } finally {
      setAdminSubmitting(false);
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

      {/* Admins: create a district_admin + grant them schools */}
      <div className="space-y-4">
        <h2 className="font-semibold text-slate-800">Admins</h2>

        {/* Create admin */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-indigo-600" />
            Add district admin
          </h3>
          <form onSubmit={handleCreateAdmin} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="admin-full-name" className="block text-sm font-medium text-slate-700 mb-1">
                  Full name
                </label>
                <input
                  id="admin-full-name"
                  type="text"
                  value={adminFullName}
                  onChange={(e) => setAdminFullName(e.target.value)}
                  placeholder="e.g. Jordan Rivera"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="admin-email" className="block text-sm font-medium text-slate-700 mb-1">
                  Email
                </label>
                <input
                  id="admin-email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="e.g. jordan.rivera@district.org"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
                <p className="text-xs text-slate-400 mt-1">Signs in with Google SSO. No school access until granted below.</p>
              </div>
            </div>

            {adminFormError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">
                {adminFormError}
              </div>
            )}

            <button
              type="submit"
              disabled={adminSubmitting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adminSubmitting ? 'Adding…' : 'Add admin'}
            </button>
          </form>
        </div>

        {/* Admin list */}
        {adminsLoadError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
            {adminsLoadError}
          </div>
        )}

        {!adminsLoadError && admins === null && (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading admins…</span>
          </div>
        )}

        {!adminsLoadError && Array.isArray(admins) && admins.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <Users size={48} className="mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-medium text-slate-800 mb-2">No admins yet</h3>
            <p className="text-slate-500">Add the district's first admin using the form above.</p>
          </div>
        )}

        {!adminsLoadError && Array.isArray(admins) && admins.length > 0 && (
          <div className="space-y-4">
            {admins.map((a) => (
              <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-slate-800 font-medium truncate">{a.full_name}</p>
                    <p className="text-slate-500 text-sm truncate">{a.email}</p>
                  </div>
                </div>
                <AdminGrants
                  API_URL={API_URL}
                  districtId={districtId}
                  userId={a.id}
                  schools={Array.isArray(schools) ? schools : []}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// AdminGrants — per-admin school-access control: lists the admin's existing
// user_school_access grants and lets the operator grant another school.
// Backend (operator-only):
//   GET  /api/operator/districts/:districtId/admins/:userId/access
//   POST /api/operator/districts/:districtId/admins/:userId/access
// Grants return IDs only (school_tenant_id + created_at) — no PII. School
// names shown here are resolved from `schools` (org-level names already
// loaded by the parent view), never from the grant payload.
function AdminGrants({ API_URL, districtId, userId, schools }) {
  // null = loading, [] = none, [...] = data.
  const [grants, setGrants] = useState(null);
  const [grantsError, setGrantsError] = useState(null);
  const [grantsRefreshToken, setGrantsRefreshToken] = useState(0);

  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/operator/districts/${districtId}/admins/${userId}/access`);
        if (!res.ok) {
          if (!cancelled) setGrantsError('Could not load grants.');
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setGrants(Array.isArray(data && data.grants) ? data.grants : []);
          setGrantsError(null);
        }
      } catch (err) {
        logError(err, 'operator-admin-grants-list');
        if (!cancelled) setGrantsError('Could not load grants.');
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL, districtId, userId, grantsRefreshToken]);

  const grantedIds = new Set(Array.isArray(grants) ? grants.map((g) => g.school_tenant_id) : []);
  const ungrantedSchools = schools.filter((s) => !grantedIds.has(s.id));

  const schoolName = (id) => {
    const match = schools.find((s) => s.id === id);
    return match ? match.name : `School #${id}`;
  };

  const handleGrant = async (e) => {
    e.preventDefault();
    if (granting) return;
    const schoolTenantId = Number(selectedSchoolId);
    if (!Number.isInteger(schoolTenantId) || schoolTenantId <= 0) {
      setGrantError('Select a school to grant.');
      return;
    }
    setGrantError(null);
    setGranting(true);
    try {
      const res = await apiFetch(`${API_URL}/operator/districts/${districtId}/admins/${userId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_tenant_id: schoolTenantId }),
      });
      if (!res.ok) {
        // Surface the API's own message verbatim (already granted, not
        // found, invalid id). These BE messages are ID/org-level, never PII.
        let message = 'Could not grant school access.';
        try {
          const body = await res.json();
          if (body && body.error) message = body.error;
        } catch { /* non-JSON body; keep generic message */ }
        setGrantError(message);
        return;
      }
      setSelectedSchoolId('');
      setGrantsRefreshToken((t) => t + 1);
    } catch (err) {
      logError(err, 'operator-admin-grant-create');
      setGrantError('Could not grant school access.');
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">School access</p>

      {grantsError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-2.5 text-sm">
          {grantsError}
        </div>
      )}

      {!grantsError && grants === null && (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading grants…</span>
        </div>
      )}

      {!grantsError && Array.isArray(grants) && grants.length === 0 && (
        <p className="text-sm text-slate-400">No schools granted yet.</p>
      )}

      {!grantsError && Array.isArray(grants) && grants.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {grants.map((g) => (
            <span
              key={g.school_tenant_id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium"
            >
              <School className="w-3 h-3 text-indigo-600" />
              {schoolName(g.school_tenant_id)}
            </span>
          ))}
        </div>
      )}

      {/* Grant control — only meaningful once grants have loaded. */}
      {!grantsError && Array.isArray(grants) && (
        schools.length === 0 ? (
          <p className="text-sm text-slate-400">Add a school to this district before granting access.</p>
        ) : ungrantedSchools.length === 0 ? (
          <p className="text-sm text-slate-400">All schools in this district are granted.</p>
        ) : (
          <form onSubmit={handleGrant} className="flex flex-wrap items-start gap-2">
            <select
              value={selectedSchoolId}
              onChange={(e) => setSelectedSchoolId(e.target.value)}
              aria-label="School to grant"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
            >
              <option value="">Select a school…</option>
              {ungrantedSchools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={granting}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {granting ? 'Granting…' : 'Grant school'}
            </button>
            {grantError && (
              <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-2.5 text-sm">
                {grantError}
              </div>
            )}
          </form>
        )
      )}
    </div>
  );
}
