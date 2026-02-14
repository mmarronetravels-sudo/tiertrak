import { useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const archiveReasons = [
  'Completed Interventions',
  'End of School Year',
  'Transferred Out',
  'No Longer Needs Support',
  'Other'
];

// ============================================
// ARCHIVE MODAL (for archiving an active student)
// ============================================

export const ArchiveStudentModal = ({ onClose }) => {
  const { user, selectedStudent, API_URL, fetchStudents, fetchStudentDetails } = useApp();

  const [archiveReason, setArchiveReason] = useState('');

  const handleArchiveStudent = async () => {
    if (!archiveReason || !selectedStudent) return;
    try {
      const res = await fetch(`${API_URL}/students/${selectedStudent.id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archived_reason: archiveReason,
          archived_by: user.id
        })
      });
      if (res.ok) {
        fetchStudents(user.tenant_id);
        fetchStudentDetails(selectedStudent.id);
        onClose();
      }
    } catch (error) {
      console.error('Error archiving student:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <Archive className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Archive Student</h3>
            <p className="text-sm text-gray-500">{selectedStudent.first_name} {selectedStudent.last_name}</p>
          </div>
        </div>
        
        <p className="text-gray-600 mb-4">
          Archiving will remove this student from the active list but preserve all intervention data and notes. You can reactivate them at any time.
        </p>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Reason for archiving <span className="text-red-500">*</span>
          </label>
          <select
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select a reason...</option>
            {archiveReasons.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleArchiveStudent}
            disabled={!archiveReason}
            className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Archive Student
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// UNARCHIVE MODAL (for reactivating an archived student)
// ============================================

export const UnarchiveStudentModal = ({ onClose, onUnarchive }) => {
  const { selectedStudent } = useApp();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
            <RotateCcw className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Reactivate Student</h3>
            <p className="text-sm text-gray-500">{selectedStudent.first_name} {selectedStudent.last_name}</p>
          </div>
        </div>
        
        <p className="text-gray-600 mb-2">
          This will return the student to the active list. All previous intervention data and notes will be available.
        </p>
        
        {selectedStudent.archived_reason && (
          <p className="text-sm text-gray-500 mb-4">
            <span className="font-medium">Previously archived:</span> {selectedStudent.archived_reason}
            {selectedStudent.archived_at && ` on ${new Date(selectedStudent.archived_at).toLocaleDateString()}`}
          </p>
        )}
        
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onUnarchive}
            className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
          >
            Reactivate Student
          </button>
        </div>
      </div>
    </div>
  );
};