import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// DistrictReminderToggle — district_admin control of the weekly overdue-logs
// reminder email, the district sibling of OverdueLogReminderToggle. Backed by
// GET/PUT /api/districts/:id/overdue-log-reminders.
//
// Scope switch (the district-only capability): the reminder state can be set
// DISTRICT-WIDE (omit school_tenant_id — the server's district-level row) or for
// the ONE picked school (send school_tenant_id). Both paths already exist on the
// PUT; this UI exposes them. School scope is only selectable once a school is
// picked in the parent panel.
//
// Visibility (mirrors the school toggle, both server-authoritative):
//   1. The parent renders this only for an isDistrictAdmin caller.
//   2. This component renders NOTHING until the GET returns
//      feature_enabled === true, so it stays hidden until
//      OVERDUE_LOGS_REMINDERS_ENABLED is live. The FE never asserts the flag —
//      it only reflects what the server reports.
//
// §5: the server is the boundary. The district + role gate and the in-district
// school check run on every request; a caller bypassing this FE hits 403/404.
// school_tenant_id is sent ONLY in school scope and is the picker's integer id,
// never invented client-side.
//
// §4B: this surface carries a boolean (reminders_enabled) + the feature flag +
// integer ids. The school NAME is shown in the scope control for orientation but
// is NEVER logged or placed in a URL — only the integer school_tenant_id rides
// the query string. logError carries a static tag + the error object only.

export default function DistrictReminderToggle({ API_URL, districtId, schoolTenantId, schoolName }) {
  const [scope, setScope] = useState('district');   // 'district' | 'school'
  const [enabled, setEnabled] = useState(null);     // null = unknown / loading
  const [featureOn, setFeatureOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);

  const base = `${API_URL}/districts/${districtId}/overdue-log-reminders`;

  // The school_tenant_id in effect for the current scope (null in district
  // scope). A guard against school scope with nothing picked.
  const effectiveSchoolId = scope === 'school' ? schoolTenantId : null;
  const schoolScopeWithoutPick = scope === 'school' && schoolTenantId == null;

  // Load the reminder state for the current scope. Re-runs when the scope or the
  // picked school changes so the toggle always reflects the right row.
  useEffect(() => {
    let cancelled = false;
    if (schoolScopeWithoutPick) {
      // Nothing to read until a school is picked; keep prior featureOn/loaded.
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const url = effectiveSchoolId != null
          ? `${base}?school_tenant_id=${effectiveSchoolId}`
          : base;
        const res = await apiFetch(url);
        if (!res.ok) {
          if (!cancelled) setLoaded(true); // stay hidden on any non-ok
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setFeatureOn(!!data.feature_enabled);
        setEnabled(!!data.reminders_enabled);
        setLoaded(true);
      } catch (err) {
        logError(err, '[DistrictReminderToggle:load]');
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL, districtId, scope, schoolTenantId]);

  // Hidden until the feature is live (and until the first load resolves).
  if (!loaded || !featureOn) return null;

  const handleToggle = async () => {
    if (schoolScopeWithoutPick) return;
    const next = !enabled;
    setError(null);
    setIsPending(true);
    try {
      const res = await apiFetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: next,
          // §5: school scope sends the explicit id; district scope omits it.
          ...(effectiveSchoolId != null ? { school_tenant_id: effectiveSchoolId } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setEnabled(!!data.reminders_enabled);
      } else {
        setError('Could not update the reminder setting.');
      }
    } catch (err) {
      logError(err, '[DistrictReminderToggle:toggle]');
      setError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  const scopeBtn = (value, text) => {
    const active = scope === value;
    const disabled = value === 'school' && schoolTenantId == null;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setScope(value); setError(null); }}
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          active
            ? 'bg-indigo-600 text-white'
            : 'text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'
        }`}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-4 rounded-lg border border-slate-200 p-1 w-fit">
        {scopeBtn('district', 'District-wide')}
        {scopeBtn('school', schoolName ? `Just ${schoolName}` : 'Selected school')}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          {enabled
            ? <Bell size={22} className="text-indigo-600 mt-0.5" />
            : <BellOff size={22} className="text-slate-400 mt-0.5" />}
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Weekly overdue-logs reminder</h2>
            <p className="text-sm text-slate-500 mt-1">
              {scope === 'district'
                ? 'When on, staff across the district receive a weekly email listing students with overdue progress logs.'
                : 'When on, staff at the selected school receive a weekly email listing students with overdue progress logs.'}
            </p>
            {schoolScopeWithoutPick && (
              <p className="text-sm text-amber-600 mt-2">Select a school above to set its reminder.</p>
            )}
            {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={isPending || schoolScopeWithoutPick}
          role="switch"
          aria-checked={enabled}
          title={enabled ? 'Turn reminders off' : 'Turn reminders on'}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? 'bg-indigo-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
