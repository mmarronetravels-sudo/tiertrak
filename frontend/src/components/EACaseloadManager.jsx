// EACaseloadManager — per-staff-row admin control inside the Admin Panel
// Staff Management table. Renders only for staff members whose role is
// 'education_assistant'; for every other role returns the same em-dash
// placeholder the MTSSCoordinatorToggle uses for INELIGIBLE rows.
//
// The button opens a modal that holds two sections:
//   1. Current caseload — list of (first_name, last_name, grade,
//      granter_full_name, granted_at) with a per-row Remove button.
//   2. Add student — text search hitting the existing
//      /api/discipline-referrals/picker/:tenantId endpoint (reused per
//      operator decision; same §4B-minimized payload shape, no new
//      picker route). Each search result has an Assign button.
//
// Trust boundary: every endpoint this component touches is server-
// gated by routes/eaCaseload.js — school_admin or district_admin only,
// tenant scope checked against resolveAccessibleTenantIds for caller
// AND target, target.role === 'education_assistant' on POST. The
// role-conditional render below + the parent-component admin-only
// surface gate are UX optimizations; the security boundary is the BE.
// A FE bypass still hits the BE gates.
//
// Tenant binding: the component receives the STAFF MEMBER'S tenant_id
// (the school where their caseload lives), not the caller's tenant_id.
// This lets a district_admin viewing an EA at a different school in
// their accessible set still load and manage that EA's caseload — the
// BE validates the school is in BOTH caller-accessible and target-
// accessible sets.
//
// PII discipline (§4B):
//   - No localStorage / sessionStorage / IndexedDB writes.
//   - logError carries a static tag + the error object only — no body
//     content, no PII tokens.
//   - granter_full_name + first_name + last_name + grade are displayed
//     (operator-signed §4B caseload-view field set) but never persisted
//     client-side beyond in-memory state of the open modal.
//   - The picker payload shape is operator-signed §4B for PR-2.
//
// Fetch contract: apiFetch only (credentials + CSRF). URLs have no
// trailing slash — matches MTSSCoordinatorToggle convention.

import { useState, useEffect } from 'react';
import { UserPlus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

export default function EACaseloadManager({ staffMember, API_URL }) {
  // Hooks are declared unconditionally above the role-based render gate
  // below, per React's Rules of Hooks — hooks must be called in the same
  // order on every render regardless of which return path the component
  // takes. loadCaseload is declared above useEffect because the effect
  // body references it (closure capture; no TDZ since the effect body
  // runs after render). The button that flips isOpen is only rendered
  // in the EA branch, so for non-EA rows the effect's branch is never
  // entered (isOpen stays false) and no DB call is made.
  const tenantId = staffMember.tenant_id;
  const [isOpen, setIsOpen] = useState(false);
  const [caseload, setCaseload] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);

  const loadCaseload = async () => {
    setError(null);
    try {
      const res = await apiFetch(
        `${API_URL}/ea-caseload/by-ea/${staffMember.id}/school/${tenantId}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        setCaseload(data);
      } else {
        setError('Could not load caseload.');
      }
    } catch (err) {
      logError(err, '[EACaseloadManager:load]');
      setError('Connection error.');
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCaseload();
      setSearchTerm('');
      setSearchResults([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // UX render gate. Non-EA rows show em-dash, mirroring the
  // MTSSCoordinatorToggle ineligible-row pattern. The BE rejects non-EA
  // POST targets with 400 anyway; this is just to hide the control.
  // Placed AFTER all hooks per Rules of Hooks.
  if (staffMember.role !== 'education_assistant') {
    return <span className="text-xs text-slate-400">—</span>;
  }

  const handleSearch = async () => {
    setError(null);
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await apiFetch(
        `${API_URL}/discipline-referrals/picker/${tenantId}?search=${encodeURIComponent(searchTerm)}&limit=20`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        // Filter out students already on the caseload so the typeahead
        // doesn't offer a no-op assignment.
        const assignedIds = new Set(caseload.map((r) => r.student_id));
        setSearchResults(data.filter((s) => !assignedIds.has(s.id)));
      } else {
        setError('Search failed.');
      }
    } catch (err) {
      logError(err, '[EACaseloadManager:search]');
      setError('Connection error.');
    }
  };

  const handleAssign = async (studentId) => {
    setError(null);
    setIsPending(true);
    try {
      const res = await apiFetch(`${API_URL}/ea-caseload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ea_user_id: staffMember.id,
          student_id: studentId,
          school_tenant_id: tenantId,
        }),
      });
      // 201 = newly assigned; 409 = already assigned by a concurrent
      // caller. Both resolve to "caseload row exists" — refetch.
      if (res.ok || res.status === 409) {
        setSearchTerm('');
        setSearchResults([]);
        await loadCaseload();
      } else {
        setError('Could not assign student.');
      }
    } catch (err) {
      logError(err, '[EACaseloadManager:assign]');
      setError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  const handleRevoke = async (studentId, studentFullName) => {
    if (!confirm(`Remove ${studentFullName} from ${staffMember.full_name}'s caseload?`)) return;
    setError(null);
    setIsPending(true);
    try {
      const res = await apiFetch(
        `${API_URL}/ea-caseload/eas/${staffMember.id}/students/${studentId}`,
        { method: 'DELETE' }
      );
      // 200 = revoked; 404 = already removed (race). Both resolve to
      // "no caseload row" — refetch.
      if (res.ok || res.status === 404) {
        await loadCaseload();
      } else {
        setError('Could not remove student.');
      }
    } catch (err) {
      logError(err, '[EACaseloadManager:revoke]');
      setError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="text-xs px-2 py-1 rounded-full border border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
        title="Manage EA caseload"
      >
        Manage Caseload
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Caseload — {staffMember.full_name}
                </h3>
                <p className="text-sm text-gray-500">Education Assistant</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-6">
              <h4 className="text-sm font-medium text-slate-700 mb-2">
                Current Caseload ({caseload.length})
              </h4>
              {caseload.length === 0 ? (
                <p className="text-sm text-slate-400 italic">
                  No students assigned yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {caseload.map((row) => (
                    <li
                      key={row.student_id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          {row.first_name} {row.last_name}
                        </div>
                        <div className="text-xs text-slate-500">
                          Grade {row.grade}
                          {row.granter_full_name
                            ? ` · Assigned by ${row.granter_full_name}`
                            : ''}
                          {row.granted_at ? ` · ${formatDate(row.granted_at)}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          handleRevoke(
                            row.student_id,
                            `${row.first_name} ${row.last_name}`
                          )
                        }
                        disabled={isPending}
                        className="p-1.5 text-rose-500 hover:text-rose-700 disabled:opacity-50"
                        title="Remove from caseload"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-700 mb-2">
                Add Student
              </h4>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder="Search by first or last name..."
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <button
                  onClick={handleSearch}
                  disabled={isPending}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm disabled:opacity-50"
                >
                  Search
                </button>
              </div>
              {searchResults.length > 0 && (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-60 overflow-y-auto">
                  {searchResults.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          {s.first_name} {s.last_name}
                        </div>
                        <div className="text-xs text-slate-500">Grade {s.grade}</div>
                      </div>
                      <button
                        onClick={() => handleAssign(s.id)}
                        disabled={isPending}
                        className="text-xs px-2 py-1 rounded-full border border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-50 inline-flex items-center gap-1"
                        title="Assign to caseload"
                      >
                        <UserPlus size={12} /> Assign
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {searchTerm && searchResults.length === 0 && (
                <p className="text-xs text-slate-400 italic">
                  No matches. Try a different name.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-rose-600 mb-2">{error}</p>}

            <div className="flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
