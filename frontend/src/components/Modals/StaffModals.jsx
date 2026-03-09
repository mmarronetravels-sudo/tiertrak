import { useState } from 'react';
import { X } from 'lucide-react';


// ============================================
// ADD STAFF MODAL
// ============================================

export const AddStaffModal = ({ onClose, user, token, API_URL, loadStaffList }) => {

  const [newStaff, setNewStaff] = useState({ email: '', full_name: '', role: 'teacher' });
  const [staffError, setStaffError] = useState('');

  const handleAddStaff = async () => {
    setStaffError('');
    if (!newStaff.email || !newStaff.full_name) {
      setStaffError('Email and full name are required');
      return;
    }
    try {
      const response = await fetch(`${API_URL}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...newStaff, tenant_id: user.tenant_id })
      });
      if (response.ok) {
        // Refresh staff list
        const listRes = await fetch(`${API_URL}/staff/${user.tenant_id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (listRes.ok) {
          const listData = await listRes.json();
          if (loadStaffList) loadStaffList();
        }
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
            <select value={newStaff.role} onChange={(e) => setNewStaff({...newStaff, role: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
              <option value="teacher">Teacher — sees assigned + all Tier 1 students</option>
              <option value="counselor">Counselor — full admin access</option>
              <option value="school_admin">Admin — full access, manages everything</option>
              <option value="behavior_specialist">Behavior Specialist — full admin access</option>
              <option value="student_support_specialist">Student Support Specialist — sees all students, manages referrals</option>
              <option value="mtss_support">MTSS Support — sees all students, adds students, uploads documents</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleAddStaff} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">Create Account</button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// EDIT STAFF MODAL
// ============================================

export const EditStaffModal = ({ staffMember, onClose, user, token, API_URL, loadStaffList }) => {

  // Local copy of staff member for editing
  const [editData, setEditData] = useState({
    full_name: staffMember.full_name,
    role: staffMember.role
  });

  const handleUpdateStaff = async () => {
    try {
      const response = await fetch(`${API_URL}/staff/${staffMember.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ full_name: editData.full_name, role: editData.role })
      });
      if (response.ok) {
        // Refresh staff list
        const listRes = await fetch(`${API_URL}/staff/${user.tenant_id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (listRes.ok) {
          const listData = await listRes.json();
          if (loadStaffList) loadStaffList();
        }
        onClose();
      } else {
        const err = await response.json();
        alert(err.error || 'Failed to update');
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
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              value={editData.full_name}
              onChange={(e) => setEditData({...editData, full_name: e.target.value})}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="teacher">Teacher</option>
              <option value="counselor">Counselor</option>
              <option value="school_admin">Admin</option>
              <option value="behavior_specialist">Behavior Specialist</option>
              <option value="student_support_specialist">Student Support Specialist</option>
              <option value="mtss_support">MTSS Support</option>
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
            className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};