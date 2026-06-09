import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { logError } from '../../utils/logError';
import { apiFetch } from '../../utils/apiFetch';
import { canAssignRole } from '../../constants/staffRoles';

// Display-only role universe for the staff modals. Mirrors the BE
// STAFF_ROLES at routes/staffManagement.js (excludes 'parent'; parent
// users are managed via the /api/users surface). Order matches the
// rank descent so the picker reads top-down by authority. The modals
// filter this list by canAssignRole(user.role, opt.role, user.is_operator)
// — the BE remains the trust boundary and re-runs the same predicate
// server-side on every POST/PUT.
const STAFF_ROLE_OPTIONS = [
  { role: 'district_admin', label: 'District Admin — full district access' },
  { role: 'district_tech_admin', label: 'District Tech Admin — district configuration and integrations' },
  { role: 'school_admin', label: 'Admin — full access, manages everything' },
  { role: 'counselor', label: 'Counselor — full admin access' },
  { role: 'teacher', label: 'Teacher — sees assigned + all Tier 1 students' },
  { role: 'interventionist', label: 'Interventionist — sees all students, manages interventions, uploads documents' },
  { role: 'education_assistant', label: 'Education Assistant — files referrals on any student; views assigned students only' },
];

// ============================================
// ADD STAFF MODAL
// ============================================

export const AddStaffModal = ({ onClose, user, token, API_URL, loadStaffList, isDistrictAdmin }) => {

  // Display-only filter: canAssignRole mirrors the BE predicate.
  // BE re-runs the same check at POST /api/staff and returns 403 if
  // the actor isn't authorized — this filter just hides options the
  // user wouldn't be able to submit. Three-writer drift hazard noted
  // in frontend/src/constants/staffRoles.js header.
  const assignableOptions = STAFF_ROLE_OPTIONS.filter((opt) =>
    canAssignRole(user.role, opt.role, user.is_operator)
  );
  const initialRole = assignableOptions[0]?.role || '';
  const [newStaff, setNewStaff] = useState({ email: '', full_name: '', role: initialRole });
  const [staffError, setStaffError] = useState('');
  const [accessibleSchools, setAccessibleSchools] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState(null);
  // Initialize loading state from mount-time props so the in-effect
  // setSchoolsLoading(true) call isn't needed (avoids the
  // react-hooks/set-state-in-effect cascading-render warning).
  const [schoolsLoading, setSchoolsLoading] = useState(!!(isDistrictAdmin && user.district_id));

  // For district_admin: hydrate the accessible-schools picker from the
  // dashboard endpoint. Picker set is byte-for-byte identical to what
  // resolveAccessibleTenantIds returns on the POST binding (same helper
  // feeds both surfaces), so a picker selection can never collide with
  // the auth-gate 403 path. Fires once on modal mount; cancellation
  // guard avoids state updates after unmount.
  useEffect(() => {
    if (!isDistrictAdmin || !user.district_id) return;
    let cancelled = false;
    apiFetch(`${API_URL}/districts/${user.district_id}/dashboard`, {
      credentials: 'include'
    })
      .then((res) => {
        if (!res.ok) throw new Error('schools fetch failed');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const schools = (data.schools || []).map((s) => ({
          tenant_id: s.school_tenant_id,
          name: s.school_name
        }));
        setAccessibleSchools(schools);
        const homeMatch = schools.find((s) => s.tenant_id === user.tenant_id);
        setSelectedSchool(homeMatch ? homeMatch.tenant_id : (schools[0] ? schools[0].tenant_id : null));
        setSchoolsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSchoolsLoading(false);
        setStaffError('Unable to load schools. Please close and reopen this dialog.');
      });
    return () => { cancelled = true; };
  }, []);

  const handleAddStaff = async () => {
    setStaffError('');
    if (!newStaff.email || !newStaff.full_name) {
      setStaffError('Email and full name are required');
      return;
    }
    if (isDistrictAdmin && !selectedSchool) {
      setStaffError('Please select a school for this staff member.');
      return;
    }
    // For district_admin, send the picker selection as target_tenant_id.
    // For non-district callers, omit target_tenant_id so the backend
    // helper falls back to req.user.tenant_id (preserves legacy single-
    // tenant behavior bit-for-bit).
    const body = isDistrictAdmin
      ? { ...newStaff, target_tenant_id: selectedSchool }
      : { ...newStaff };
    const refreshTenantId = isDistrictAdmin ? selectedSchool : user.tenant_id;
    try {
      const response = await apiFetch(`${API_URL}/staff`, {
        method: 'POST',
       headers: { 'Content-Type': 'application/json' },
credentials: 'include',
        body: JSON.stringify(body)
      });
      if (response.ok) {
        if (loadStaffList) loadStaffList(refreshTenantId);
        onClose();
      } else {
        const err = await response.json();
        setStaffError(err.error || 'Failed to create staff member');
      }
    } catch (error) {
      setStaffError('Network error. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Add Staff Member</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Create an account so this person can sign in with Google SSO. No password needed.</p>
        {staffError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">{staffError}</div>
        )}
        <div className="space-y-4">
          {isDistrictAdmin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">School</label>
              {schoolsLoading ? (
                <p className="text-sm text-slate-500 px-3 py-2 bg-slate-50 rounded-lg">Loading schools…</p>
              ) : accessibleSchools.length === 0 ? (
                <p className="text-sm text-slate-500 px-3 py-2 bg-slate-50 rounded-lg">No accessible schools.</p>
              ) : (
                <select
                  value={selectedSchool || ''}
                  onChange={(e) => setSelectedSchool(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {accessibleSchools.map((s) => (
                    <option key={s.tenant_id} value={s.tenant_id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input type="text" value={newStaff.full_name} onChange={(e) => setNewStaff({...newStaff, full_name: e.target.value})} placeholder="Jane Smith" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">School Email</label>
            <input type="email" value={newStaff.email} onChange={(e) => setNewStaff({...newStaff, email: e.target.value})} placeholder="jsmith@summitlc.org" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select value={newStaff.role} onChange={(e) => setNewStaff({...newStaff, role: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" disabled={assignableOptions.length === 0}>
              {assignableOptions.length === 0 ? (
                <option value="">No assignable roles</option>
              ) : (
                assignableOptions.map((opt) => (
                  <option key={opt.role} value={opt.role}>{opt.label}</option>
                ))
              )}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleAddStaff} disabled={assignableOptions.length === 0} className={`flex-1 px-4 py-2 rounded-lg transition ${assignableOptions.length === 0 ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>Create Account</button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// EDIT STAFF MODAL
// ============================================

export const EditStaffModal = ({ staffMember, onClose, user, token, API_URL, loadStaffList }) => {

  // Display-only filter mirroring BE canAssignRole. BE PUT /api/staff/:id
  // re-runs the same predicate against the locked target row's CURRENT
  // role (outranks check) AND the new role (new-role rank check); this
  // filter just hides options the user couldn't submit.
  const assignableOptions = STAFF_ROLE_OPTIONS.filter((opt) =>
    canAssignRole(user.role, opt.role, user.is_operator)
  );
  // Self-edit guard. The BE PUT 403s id === req.user.id; the modal
  // mirrors the guard so the Save button shows-but-disabled with an
  // explanation rather than silently 403ing on submit.
  const isSelfEdit = staffMember.id === user.id;
  const saveDisabled = isSelfEdit || assignableOptions.length === 0;

  // Local copy of staff member for editing
  const [editData, setEditData] = useState({
    full_name: staffMember.full_name,
    role: staffMember.role
  });

  const handleUpdateStaff = async () => {
    try {
      const response = await apiFetch(`${API_URL}/staff/${staffMember.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
credentials: 'include',
        body: JSON.stringify({ full_name: editData.full_name, role: editData.role })
      });
      if (response.ok) {
        if (loadStaffList) loadStaffList();
        onClose();
      } else {
        const err = await response.json();
        alert('Failed to update. Please try again.');
      }
    } catch (error) {
      alert('Connection error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Edit Staff Member</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        {isSelfEdit && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            You can't edit your own staff record.
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              value={editData.full_name}
              onChange={(e) => setEditData({...editData, full_name: e.target.value})}
              disabled={isSelfEdit}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <p className="text-sm text-slate-500 px-3 py-2 bg-slate-50 rounded-lg">{staffMember.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              value={editData.role}
              onChange={(e) => setEditData({...editData, role: e.target.value})}
              disabled={saveDisabled}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
            >
              {assignableOptions.length === 0 ? (
                <option value={editData.role}>No assignable roles</option>
              ) : (
                assignableOptions.map((opt) => (
                  <option key={opt.role} value={opt.role}>{opt.label.split(' — ')[0]}</option>
                ))
              )}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleUpdateStaff}
            disabled={saveDisabled}
            className={`flex-1 px-4 py-2 rounded-lg transition ${saveDisabled ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};