import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

// Rating helpers (import from utils/constants.js if already extracted)
const getRatingLabel = (rating) => {
  const labels = {
    1: 'No Progress',
    2: 'Minimal Progress',
    3: 'Some Progress',
    4: 'Good Progress',
    5: 'Significant Progress'
  };
  return labels[rating] || '';
};

const getRatingColor = (rating) => {
  if (rating >= 4) return 'text-emerald-600';
  if (rating >= 3) return 'text-amber-600';
  return 'text-rose-600';
};

const ProgressFormModal = ({ intervention, editingLog, onClose }) => {
  const { user, token, selectedStudent, API_URL, fetchWeeklyProgress } = useApp();

  // Local state — pre-fill if editing an existing log
  const [progressFormData, setProgressFormData] = useState({
    week_of: editingLog?.week_of?.split('T')[0] || new Date().toISOString().split('T')[0],
    status: editingLog?.status || '',
    rating: editingLog?.rating || '',
    response: editingLog?.response || '',
    notes: editingLog?.notes || ''
  });

  const progressNotesRef = useRef(null);

  // ============================================
  // SUBMIT HANDLER
  // ============================================

  const submitWeeklyProgress = async (e) => {
    e.preventDefault();
    try {
      const url = editingLog
        ? `${API_URL}/weekly-progress/${editingLog.id}`
        : `${API_URL}/weekly-progress`;

      const response = await fetch(url, {
        method: editingLog ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          student_intervention_id: intervention.id,
          student_id: intervention.student_id || selectedStudent?.id,
          week_of: progressFormData.week_of,
          status: progressFormData.status,
          rating: progressFormData.rating || null,
          response: progressFormData.response || null,
          notes: progressNotesRef.current?.value || null,
          logged_by: user.id
        })
      });

      if (response.ok) {
        const studentId = intervention.student_id || selectedStudent?.id;
        if (studentId) fetchWeeklyProgress(studentId);
        onClose();
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || 'Failed to save progress log. Please try again.');
      }
    } catch (err) {
      console.error('Error submitting weekly progress:', err);
      alert('Error saving progress log. Please try again.');
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="p-4 border-b flex justify-between items-center">
          <div>
            <h3 className="font-semibold text-lg">{editingLog ? 'Edit Progress Log' : 'Log Weekly Progress'}</h3>
            <p className="text-sm text-slate-500">{intervention.intervention_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form key={intervention?.id} onSubmit={submitWeeklyProgress} className="p-4 space-y-4">
          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input
              type="date"
              value={progressFormData.week_of}
              onChange={(e) => setProgressFormData({ ...progressFormData, week_of: e.target.value })}
              className="w-full p-2 border rounded-lg"
              required
            />
          </div>

          {/* Implementation Status */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Implementation Status *</label>
            <select
              value={progressFormData.status}
              onChange={(e) => {
                const newStatus = e.target.value;
                if (newStatus === 'Student Absent') {
                  setProgressFormData({ ...progressFormData, status: newStatus, rating: null, response: '' });
                } else {
                  setProgressFormData({ ...progressFormData, status: newStatus });
                }
              }}
              className="w-full p-2 border rounded-lg"
              required
            >
              <option value="">Select status...</option>
              <option value="Implemented as Planned">Implemented as Planned</option>
              <option value="Partially Implemented">Partially Implemented</option>
              <option value="Not Implemented">Not Implemented</option>
              <option value="Student Absent">Student Absent</option>
            </select>
          </div>

          {/* Rating + Response (hidden when Student Absent) */}
          {progressFormData.status !== 'Student Absent' && (
            <>
              {/* Progress Rating */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Progress Rating (1-5)</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(rating => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => setProgressFormData({ ...progressFormData, rating })}
                      className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                        progressFormData.rating === rating
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
                {progressFormData.rating && (
                  <p className={`text-sm mt-1 ${getRatingColor(progressFormData.rating)}`}>
                    {getRatingLabel(progressFormData.rating)}
                  </p>
                )}
              </div>

              {/* Student Response */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Student Response</label>
                <div className="flex gap-2">
                  {['Engaged', 'Cooperative', 'Resistant', 'Frustrated', 'Distracted'].map(response => (
                    <button
                      key={response}
                      type="button"
                      onClick={() => setProgressFormData({ ...progressFormData, response })}
                      className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                        progressFormData.response === response
                          ? response === 'Engaged' ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : response === 'Cooperative' ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : response === 'Resistant' ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : response === 'Frustrated' ? 'border-orange-500 bg-orange-50 text-orange-700'
                            : 'border-rose-500 bg-rose-50 text-rose-700'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {response}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              ref={progressNotesRef}
              defaultValue={editingLog?.notes || ''}
              className="w-full p-2 border rounded-lg"
              rows="3"
              placeholder="Observations, adjustments made, student behavior..."
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save Progress Log
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProgressFormModal;