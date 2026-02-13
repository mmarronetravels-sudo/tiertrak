import { useState } from 'react';
import { X, Target } from 'lucide-react';
import { useApp } from '../../context/AppContext';

// Rating label helper (import from utils/constants.js if already extracted)
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

const GoalFormModal = ({ intervention, onClose }) => {
  const { token, selectedStudent, API_URL, setSelectedStudent } = useApp();

  // Local state — pre-filled from intervention's existing goal data
  const [goalFormData, setGoalFormData] = useState({
    goal_description: intervention.goal_description || '',
    goal_target_date: intervention.goal_target_date || '',
    goal_target_rating: intervention.goal_target_rating || 3
  });

  // ============================================
  // SUBMIT HANDLER
  // ============================================

  const updateInterventionGoal = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/interventions/${intervention.id}/goal`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(goalFormData)
      });

      if (response.ok) {
        // Refresh student data to reflect the updated goal
        const studentResponse = await fetch(`${API_URL}/students/${selectedStudent.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (studentResponse.ok) {
          setSelectedStudent(await studentResponse.json());
        }
        onClose();
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || 'Failed to save goal. Please try again.');
      }
    } catch (err) {
      console.error('Error updating goal:', err);
      alert('Error saving goal. Please try again.');
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
            <h3 className="font-semibold text-lg">Set Intervention Goal</h3>
            <p className="text-sm text-slate-500">{intervention.intervention_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={updateInterventionGoal} className="p-4 space-y-4">
          {/* Goal Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Goal Description</label>
            <textarea
              value={goalFormData.goal_description}
              onChange={(e) => setGoalFormData({ ...goalFormData, goal_description: e.target.value })}
              className="w-full p-2 border rounded-lg"
              rows="3"
              placeholder="e.g., Student will complete 80% of assignments independently..."
            />
          </div>

          {/* Target Date */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Date</label>
            <input
              type="date"
              value={goalFormData.goal_target_date}
              onChange={(e) => setGoalFormData({ ...goalFormData, goal_target_date: e.target.value })}
              className="w-full p-2 border rounded-lg"
            />
          </div>

          {/* Target Rating */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Rating</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setGoalFormData({ ...goalFormData, goal_target_rating: rating })}
                  className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                    goalFormData.goal_target_rating === rating
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
            <p className="text-sm text-slate-500 mt-1">Target: {getRatingLabel(goalFormData.goal_target_rating)}</p>
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
              Save Goal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GoalFormModal;