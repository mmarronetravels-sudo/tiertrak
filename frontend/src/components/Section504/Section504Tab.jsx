import { useState, useEffect } from 'react';
import { Shield, Plus, AlertCircle } from 'lucide-react';
import { logError } from '../../utils/logError';
import { listCyclesForStudent, createCycle } from './api';
import {
  FORM_SET_ID,
  FORM_SET_VERSION,
} from '../../data/504-form-sets/oregon-ode-2025';

// Staff-only Section 504 surface for the student profile.
//
// Auth predicates (defense in depth):
//   - App.jsx mounts this only inside StudentProfileView, which is only
//     reached when user is authenticated and on the staff side of the app.
//   - This component additionally short-circuits on user.role === 'parent'
//     before any fetch. The /api/student-504 routes also refuse parent role
//     at the route boundary (refuseParentRole middleware) — three layers.
//
// Tenant scoping: every fetch goes through ./api.js, which never includes
// tenant_id in the request. The backend derives tenant_id from the JWT.
//
// Append-only revisions (Q3 in the audit plan): each save on Forms C/I/J
// in later commits creates a new row in the cycle bundle's array, and the
// most recent row is marked "Current" in the cycle drill-in. Cycles
// themselves follow the same pattern — newest first, idx === 0 is
// "Current."
//
// Commit 1 scope: list cycles + start a new cycle. Form C/I/J modals land
// in commits 2-4; the cycle drill-in lands in commit 2.
const Section504Tab = ({ user, API_URL, student }) => {
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    if (!student?.id) return;
    if (user?.role === 'parent') return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const rows = await listCyclesForStudent(API_URL, student.id);
        if (!cancelled) setCycles(rows);
      } catch (err) {
        // err carries no PII — api.js throws a status-only Error. Safe to log.
        logError('[Section504Tab list cycles]', err);
        if (!cancelled) setLoadError('Could not load 504 cycles.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [API_URL, student?.id, user?.role]);

  const handleStartCycle = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCycle(API_URL, {
        student_id: student.id,
        form_set_id: FORM_SET_ID,
        form_set_version: FORM_SET_VERSION,
      });
      // Append-only timeline; newest first means prepend.
      setCycles((prev) => [created, ...prev]);
    } catch (err) {
      logError('[Section504Tab create cycle]', err);
      setCreateError(
        'Could not start a new 504 cycle. Make sure the tenant has an active form set configured.'
      );
    } finally {
      setCreating(false);
    }
  };

  if (!student) return null;
  if (user?.role === 'parent') return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-800">Section 504</h2>
          <span className="text-xs text-slate-400">
            Form set: {FORM_SET_ID} ({FORM_SET_VERSION})
          </span>
        </div>
        {!student.archived && (
          <button
            onClick={handleStartCycle}
            disabled={creating}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={16} />
            {creating ? 'Starting...' : 'Start 504 Cycle'}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {loadError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {createError && (
        <div className="flex items-start gap-2 p-3 mb-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{createError}</span>
        </div>
      )}

      {!loading && !loadError && cycles.length === 0 && (
        <p className="text-sm text-slate-500">
          No 504 cycles yet. Click{' '}
          <span className="font-medium">Start 504 Cycle</span> to begin.
        </p>
      )}

      {!loading && cycles.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {cycles.map((cycle, idx) => (
            <li
              key={cycle.id}
              className="py-3 flex items-center justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-800">
                    Cycle #{cycle.id}
                  </span>
                  {idx === 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                      Current
                    </span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                    {cycle.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Started {new Date(cycle.created_at).toLocaleDateString()} ·
                  Form set {cycle.form_set_id} ({cycle.form_set_version})
                </p>
              </div>
              <span className="text-xs text-slate-400">
                Forms C/I/J — next commit
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Section504Tab;
