import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// OverdueLogReminderToggle — school_admin settings card to turn their OWN
// school's weekly overdue-progress-logs reminder email on or off, without an
// operator. Backed by GET/PUT /api/school/overdue-log-reminders
// (routes/schoolOverdueLogOptouts.js).
//
// Visibility (two gates, both server-authoritative):
//   1. The parent (App.jsx) renders this only for role === 'school_admin'.
//   2. This component renders NOTHING until the GET returns
//      feature_enabled === true. The toggle therefore stays hidden until
//      OVERDUE_LOGS_REMINDERS_ENABLED is live in the backend. The FE never
//      asserts the flag — it only reflects what the server reports.
//
// Trust boundary: the server is the boundary. routes/schoolOverdueLogOptouts.js
// re-checks the school_admin role and resolves the target school from
// resolveAccessibleTenantIds on every request; a caller bypassing this FE hits
// 403 server-side. The role/flag checks here are UX only.
//
// PII discipline (§4B): this surface carries a single boolean (reminders_enabled)
// plus the feature flag — no student/staff names, emails, or intervention data.
// logError carries a static tag + the error object only. No localStorage.

export default function OverdueLogReminderToggle({ API_URL }) {
  const [enabled, setEnabled] = useState(null);        // null = unknown / loading
  const [featureOn, setFeatureOn] = useState(false);   // hide until server says live
  const [loaded, setLoaded] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/school/overdue-log-reminders`);
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
        logError(err, '[OverdueLogReminderToggle:load]');
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL]);

  // Hidden until the feature is live (and until the first load resolves).
  if (!loaded || !featureOn) return null;

  const handleToggle = async () => {
    const next = !enabled;
    setError(null);
    setIsPending(true);
    try {
      const res = await apiFetch(`${API_URL}/school/overdue-log-reminders`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        const data = await res.json();
        setEnabled(!!data.reminders_enabled);
      } else {
        setError('Could not update the reminder setting.');
      }
    } catch (err) {
      logError(err, '[OverdueLogReminderToggle:toggle]');
      setError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          {enabled
            ? <Bell size={22} className="text-indigo-600 mt-0.5" />
            : <BellOff size={22} className="text-slate-400 mt-0.5" />}
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Weekly overdue-logs reminder</h2>
            <p className="text-sm text-slate-500 mt-1">
              When on, staff at your school receive a weekly email listing students
              with overdue progress logs. Turn it off to stop these emails for your school.
            </p>
            {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={isPending}
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
