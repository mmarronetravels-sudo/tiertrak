import { useState, useEffect } from 'react';
import { X, Calendar, ClipboardList, CheckCircle, Save } from 'lucide-react';

const MTSSMeetingFormModal = ({ meeting, onClose, user, selectedStudent, API_URL, fetchMTSSMeetings }) => {
  const [mtssMeetingForm, setMTSSMeetingForm] = useState({
    meeting_date: new Date().toISOString().split('T')[0],
    meeting_number: 1,
    meeting_type: '6-week',
    attendees: { teacher: false, counselor: false, admin: false, parent: false, specialist: false, other: '' },
    parent_attended: false,
    progress_summary: '',
    tier_decision: '',
    next_steps: '',
    next_meeting_date: '',
    intervention_reviews: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initializeForm();
  }, []);

  const fetchMTSSMeetingOptions = async () => {
    try {
      const response = await fetch(API_URL + '/mtss-meetings/options');
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Error fetching MTSS meeting options:', error);
    }
    return null;
  };

  const fetchInterventionsSummary = async (studentId) => {
    try {
      const response = await fetch(API_URL + '/mtss-meetings/student/' + studentId + '/interventions-summary');
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Error fetching interventions summary:', error);
    }
    return [];
  };

  const fetchMeetingCount = async (studentId) => {
    try {
      const response = await fetch(API_URL + '/mtss-meetings/student/' + studentId + '/count');
      if (response.ok) {
        const data = await response.json();
        return data.count || 0;
      }
    } catch (error) {
      console.error('Error fetching meeting count:', error);
    }
    return 0;
  };

  const initializeForm = async () => {
    setLoading(true);
    await fetchMTSSMeetingOptions();
    const interventions = await fetchInterventionsSummary(selectedStudent.id);

    if (meeting) {
      // Editing existing meeting
      setMTSSMeetingForm({
        meeting_date: meeting.meeting_date ? meeting.meeting_date.split('T')[0] : '',
        meeting_number: meeting.meeting_number || 1,
        meeting_type: meeting.meeting_type || '6-week',
        attendees: meeting.attendees || { teacher: false, counselor: false, admin: false, parent: false, specialist: false, other: '' },
        parent_attended: meeting.parent_attended || false,
        progress_summary: meeting.progress_summary || '',
        tier_decision: meeting.tier_decision || '',
        next_steps: meeting.next_steps || '',
        next_meeting_date: meeting.next_meeting_date ? meeting.next_meeting_date.split('T')[0] : '',
        intervention_reviews: meeting.intervention_reviews || interventions.map(function(inv) {
          return {
            student_intervention_id: inv.id,
            intervention_name: inv.intervention_name,
            implementation_fidelity: '',
            progress_toward_goal: '',
            recommendation: '',
            notes: '',
            avg_rating: inv.avg_rating,
            total_logs: inv.total_logs
          };
        })
      });
    } else {
      // New meeting
      const count = await fetchMeetingCount(selectedStudent.id);
      setMTSSMeetingForm({
        meeting_date: new Date().toISOString().split('T')[0],
        meeting_number: Math.min(count + 1, 3),
        meeting_type: '6-week',
        attendees: { teacher: false, counselor: false, admin: false, parent: false, specialist: false, other: '' },
        parent_attended: false,
        progress_summary: '',
        tier_decision: '',
        next_steps: '',
        next_meeting_date: '',
        intervention_reviews: interventions.map(function(inv) {
          return {
            student_intervention_id: inv.id,
            intervention_name: inv.intervention_name,
            implementation_fidelity: '',
            progress_toward_goal: '',
            recommendation: '',
            notes: '',
            avg_rating: inv.avg_rating,
            total_logs: inv.total_logs
          };
        })
      });
    }
    setLoading(false);
  };

  const saveMTSSMeeting = async () => {
    if (!selectedStudent) return;

    try {
      const payload = {
        student_id: selectedStudent.id,
        tenant_id: user.tenant_id,
        created_by: user.id,
        ...mtssMeetingForm
      };

      const url = meeting
        ? API_URL + '/mtss-meetings/' + meeting.id
        : API_URL + '/mtss-meetings';

      const response = await fetch(url, {
        method: meeting ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        onClose();
        fetchMTSSMeetings(selectedStudent.id);
        alert(meeting ? 'Meeting updated!' : 'Meeting saved!');
      } else {
        const error = await response.json();
        alert('Error saving meeting: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving MTSS meeting:', error);
      alert('Error saving meeting');
    }
  };

  const updateInterventionReview = (interventionId, field, value) => {
    setMTSSMeetingForm(function(prev) {
      return {
        ...prev,
        intervention_reviews: prev.intervention_reviews.map(function(rev) {
          if (rev.student_intervention_id === interventionId) {
            return { ...rev, [field]: value };
          }
          return rev;
        })
      };
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center">
          <p className="text-gray-600">Loading meeting form...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">
            {meeting ? 'Edit' : 'New'} MTSS Progress Review Meeting
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Meeting Info Section */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Calendar size={18} />
              Meeting Information
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border rounded-lg"
                  defaultValue={mtssMeetingForm.meeting_date}
                  onBlur={function(e) { setMTSSMeetingForm(function(prev) { return { ...prev, meeting_date: e.target.value }; }); }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meeting #</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg"
                  defaultValue={mtssMeetingForm.meeting_number}
                  onBlur={function(e) { setMTSSMeetingForm(function(prev) { return { ...prev, meeting_number: parseInt(e.target.value) }; }); }}
                >
                  <option value={1}>1st Meeting</option>
                  <option value={2}>2nd Meeting</option>
                  <option value={3}>3rd Meeting</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Type</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg"
                  defaultValue={mtssMeetingForm.meeting_type}
                  onBlur={function(e) { setMTSSMeetingForm(function(prev) { return { ...prev, meeting_type: e.target.value }; }); }}
                >
                  <option value="4-week">4-Week Review</option>
                  <option value="6-week">6-Week Review</option>
                  <option value="final-review">Final Review</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {/* Attendees */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Attendees</label>
              <div className="flex flex-wrap gap-4">
                {['teacher', 'counselor', 'admin', 'parent', 'specialist'].map(function(role) {
                  return (
                    <label key={role} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mtssMeetingForm.attendees[role] || false}
                        onChange={function(e) {
                          setMTSSMeetingForm(function(prev) {
                            return {
                              ...prev,
                              attendees: { ...prev.attendees, [role]: e.target.checked },
                              parent_attended: role === 'parent' ? e.target.checked : prev.parent_attended
                            };
                          });
                        }}
                      />
                      <span className="capitalize">{role}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Intervention Reviews Section */}
          <div className="bg-blue-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <ClipboardList size={18} />
              Intervention Progress Review
            </h3>

            {mtssMeetingForm.intervention_reviews.length === 0 ? (
              <p className="text-gray-500 italic">No active interventions to review.</p>
            ) : (
              <div className="space-y-4">
                {mtssMeetingForm.intervention_reviews.map(function(review, idx) {
                  return (
                    <div key={idx} className="bg-white rounded-lg p-4 border">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-medium text-gray-800">{review.intervention_name}</h4>
                          <p className="text-sm text-gray-500">
                            Avg Rating: {review.avg_rating ? Number(review.avg_rating).toFixed(1) : 'N/A'} |{' '}
                            Logs: {review.total_logs || 0}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Implementation Fidelity</label>
                          <select
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                            value={review.implementation_fidelity || ''}
                            onChange={function(e) { updateInterventionReview(review.student_intervention_id, 'implementation_fidelity', e.target.value); }}
                          >
                            <option value="">Select...</option>
                            <option value="yes">Yes - Implemented as planned</option>
                            <option value="partial">Partial - Some modifications</option>
                            <option value="no">No - Not implemented consistently</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Progress Toward Goal</label>
                          <select
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                            value={review.progress_toward_goal || ''}
                            onChange={function(e) { updateInterventionReview(review.student_intervention_id, 'progress_toward_goal', e.target.value); }}
                          >
                            <option value="">Select...</option>
                            <option value="met">Goal Met</option>
                            <option value="progressing">Progressing</option>
                            <option value="minimal">Minimal Progress</option>
                            <option value="no_progress">No Progress</option>
                            <option value="regression">Regression</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Recommendation</label>
                          <select
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                            value={review.recommendation || ''}
                            onChange={function(e) { updateInterventionReview(review.student_intervention_id, 'recommendation', e.target.value); }}
                          >
                            <option value="">Select...</option>
                            <option value="continue">Continue as-is</option>
                            <option value="modify">Modify intervention</option>
                            <option value="discontinue_met">Discontinue - Goal met</option>
                            <option value="discontinue_ineffective">Discontinue - Ineffective</option>
                            <option value="add_support">Add additional support</option>
                          </select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          rows={2}
                          placeholder="Notes about this intervention..."
                          defaultValue={review.notes || ''}
                          onBlur={function(e) { updateInterventionReview(review.student_intervention_id, 'notes', e.target.value); }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Overall Decision Section */}
          <div className="bg-green-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <CheckCircle size={18} />
              Team Decision
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Progress Summary</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={3}
                  placeholder="Summarize the student's overall progress..."
                  defaultValue={mtssMeetingForm.progress_summary}
                  onBlur={function(e) { setMTSSMeetingForm(function(prev) { return { ...prev, progress_summary: e.target.value }; }); }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tier Decision</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg"
                  defaultValue={mtssMeetingForm.tier_decision}
                  onBlur={function(e) { setMTSSMeetingForm(function(prev) { return { ...prev, tier_decision: e.target.value }; }); }}
                >
                  <option value="">Select decision...</option>
                  <option value="stay_tier2_continue">Stay at Tier 2 - Continue interventions</option>
                  <option value="stay_tier2_modify">Stay at Tier 2 - Modify interventions</option>
                  <option value="move_tier1">Move to Tier 1 - Goals met</option>
                  <option value="move_tier3">Move to Tier 3 - Needs intensive support</option>
                  <option value="refer_sped">Refer for Special Education evaluation</option>
                  <option value="refer_504">Refer for 504 Plan</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Next Steps</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={3}
                  placeholder="Action items and next steps..."
                  defaultValue={mtssMeetingForm.next_steps}
                  onBlur={function(e) { setMTSSMeetingForm(function(prev) { return { ...prev, next_steps: e.target.value }; }); }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Next Meeting Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border rounded-lg"
                  defaultValue={mtssMeetingForm.next_meeting_date}
                  onBlur={function(e) { setMTSSMeetingForm(function(prev) { return { ...prev, next_meeting_date: e.target.value }; }); }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={saveMTSSMeeting}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2"
          >
            <Save size={18} />
            {meeting ? 'Update Meeting' : 'Save Meeting'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MTSSMeetingFormModal;