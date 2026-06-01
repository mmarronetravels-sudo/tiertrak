import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// MTSSCoordinatorToggle — per-staff control inside the Admin Panel
// Staff Management table. One staff row = one instance of this
// component. Calls POST /api/mtss-coordinators to designate and
// DELETE /api/mtss-coordinators/users/:userId/schools/:schoolTenantId
// to revoke.
//
// Trust boundary: every endpoint this component touches is server-
// gated by routes/mtssCoordinators.js — school_admin or district_admin
// only, tenant scope checked against resolveAccessibleTenantIds,
// INELIGIBLE_TARGET_ROLES enforced on POST. The role-eligibility
// check below is a UX optimization (hide the control for users who
// can't be coordinators); it is NOT a security boundary. A caller
// bypassing the FE hits a 400 server-side.
//
// PII discipline (§4B):
//   - No GET in this component. The read path happens at the parent
//     (App.jsx) via apiFetch alongside the staff list load.
//   - No localStorage / sessionStorage / IndexedDB writes.
//   - logError carries a static tag + the error object only — no body
//     content, no PII.
//   - granter_full_name is displayed (the "Designated by ..." caption
//     IS the audit-subject signal the toggle exists to surface) but
//     never persisted client-side beyond the in-memory parent state.
//
// Fetch contract: apiFetch only (credentials + CSRF). URLs have no
// trailing slash — matches the DisciplineReferralQueue + Vercel-
// rewrite contract.

// Mirrors the BE constant in routes/mtssCoordinators.js INELIGIBLE_TARGET_ROLES.
// Duplicated deliberately — the FE check is a UX optimization, the BE
// check is the security boundary. Both must be kept in sync if widened.
const INELIGIBLE_TARGET_ROLES = ['district_admin', 'school_admin', 'district_tech_admin', 'parent'];

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch (_) {
    return '';
  }
}

export default function MTSSCoordinatorToggle({ staffMember, coordinatorRow, tenantId, API_URL, onChange }) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);

  if (INELIGIBLE_TARGET_ROLES.includes(staffMember.role)) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  const handleDesignate = async () => {
    setError(null);
    setIsPending(true);
    try {
      const res = await apiFetch(`${API_URL}/mtss-coordinators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: staffMember.id, school_tenant_id: tenantId }),
      });
      // 201 = newly designated; 409 = already designated by a concurrent
      // caller. Both resolve to "coordinator row exists" — refetch.
      if (res.ok || res.status === 409) {
        onChange();
      } else {
        setError('Could not designate coordinator.');
      }
    } catch (err) {
      logError(err, '[MTSSCoordinatorToggle:designate]');
      setError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  const handleRevoke = async () => {
    if (!confirm(`Remove ${staffMember.full_name} as MTSS Coordinator?`)) return;
    setError(null);
    setIsPending(true);
    try {
      const res = await apiFetch(
        `${API_URL}/mtss-coordinators/users/${staffMember.id}/schools/${tenantId}`,
        { method: 'DELETE' }
      );
      // 200 = revoked; 404 = already removed (race). Both resolve to
      // "no coordinator row" — refetch.
      if (res.ok || res.status === 404) {
        onChange();
      } else {
        setError('Could not revoke coordinator.');
      }
    } catch (err) {
      logError(err, '[MTSSCoordinatorToggle:revoke]');
      setError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  if (coordinatorRow) {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full font-medium bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 size={12} /> Coordinator
          </span>
          <button
            onClick={handleRevoke}
            disabled={isPending}
            className="text-xs text-rose-500 hover:text-rose-700 disabled:opacity-50"
            title="Revoke MTSS Coordinator"
          >
            Revoke
          </button>
        </div>
        <span className="text-xs text-slate-500">
          Designated{coordinatorRow.granter_full_name ? ` by ${coordinatorRow.granter_full_name}` : ''} on {formatDate(coordinatorRow.granted_at)}
        </span>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleDesignate}
        disabled={isPending}
        className="text-xs px-2 py-1 rounded-full border border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-50"
        title="Designate as MTSS Coordinator"
      >
        Designate
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
