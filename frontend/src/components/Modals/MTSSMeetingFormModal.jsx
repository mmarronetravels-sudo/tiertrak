import { useState, useEffect } from 'react';
import { X, Calendar, ClipboardList, CheckCircle, Save, ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';

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
  // Live weekly_progress logs per active intervention, keyed by
  // student_intervention_id. Fed by /weekly-progress/intervention/:id (the
  // PR #14 auth-gated endpoint, NOT the unauthenticated interventions-summary
  // route). Used by the per-card sparkline and the expandable card disclosure.
  const [interventionLogs, setInterventionLogs] = useState({});
  // Set of student_intervention_id values whose log-detail disclosure is
  // currently expanded. Cards default to collapsed to keep the modal compact.
  const [expandedCards, setExpandedCards] = useState(new Set());

  const toggleCardExpansion = (interventionId) => {
    setExpandedCards(function(prev) {
      const next = new Set(prev);
      if (next.has(interventionId)) {
        next.delete(interventionId);
      } else {
        next.add(interventionId);
      }
      return next;
    });
  };

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

  // Per Q2 (b): fetch live weekly_progress logs for every active intervention
  // via /weekly-progress/intervention/:id (Session 28 PR #14 gated this with
  // requireAuth + requireInterventionReadAccess). Promise.all fan-out keeps
  // the modal-open latency proportional to the slowest single fetch, not
  // their sum. Failures fall back to [] — the sparkline and expandable
  // detail will simply render empty for that intervention.
  //
  // Source order: ORDER BY wp.week_of DESC (newest first). This matches the
  // disclosure list's "top = newest" semantic but is the WRONG order for
  // the sparkline, which must read left = oldest, right = newest. The
  // sparkline render path explicitly reverses the array before passing to
  // recharts; the disclosure list consumes array order as-is.
  const fetchInterventionLogs = async (interventions) => {
    const logsByIntervention = {};
    await Promise.all(interventions.map(async function(inv) {
      try {
        const res = await fetch(API_URL + '/weekly-progress/intervention/' + inv.id, {
          credentials: 'include'
        });
        logsByIntervention[inv.id] = res.ok ? await res.json() : [];
      } catch (err) {
        console.error('Error fetching weekly progress logs for intervention ' + inv.id + ':', err.message);
        logsByIntervention[inv.id] = [];
      }
    }));
    return logsByIntervention;
  };

  const initializeForm = async () => {
    setLoading(true);
    await fetchMTSSMeetingOptions();
    const interventions = await fetchInterventionsSummary(selectedStudent.id);
    const logs = await fetchInterventionLogs(interventions);
    setInterventionLogs(logs);

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
                  // Hoist log counts so the stats line, sparkline IIFE, toggle
                  // IIFE, and warning IIFE all read consistent values. totalCount
                  // is sourced from interventionLogs (live) per Phase 4 commit 9
                  // owner direction — keeps the displayed stats consistent with
                  // the sparkline points and disclosure list rather than relying
                  // on review.total_logs from the summary endpoint.
                  const rawLogs = interventionLogs[review.student_intervention_id] || [];
                  const totalCount = rawLogs.length;
                  const ratedCount = rawLogs.filter(function(l) { return l.rating != null; }).length;
                  return (
                    <div key={idx} className="bg-white rounded-lg p-4 border">
                      <div className="flex justify-between items-start mb-3 gap-3">
                        <div>
                          <h4 className="font-medium text-gray-800">{review.intervention_name}</h4>
                          <p className="text-sm text-gray-500">
                            Avg Rating: {review.avg_rating ? Number(review.avg_rating).toFixed(1) : 'N/A'} |{' '}
                            Logs: {totalCount}
                            {ratedCount < totalCount ? ' (' + ratedCount + ' rated)' : ''}
                          </p>
                          {(function() {
                            // Disclosure toggle: compact "Show / Hide logs (N)" button.
                            // Hidden when there are no logs to disclose; commit 7 will
                            // place the zero-data warning in this same neighborhood.
                            const rawLogs = interventionLogs[review.student_intervention_id] || [];
                            if (rawLogs.length === 0) return null;
                            const isExpanded = expandedCards.has(review.student_intervention_id);
                            return (
                              <button
                                type="button"
                                onClick={function() { toggleCardExpansion(review.student_intervention_id); }}
                                aria-expanded={isExpanded}
                                className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                              >
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                {isExpanded ? 'Hide' : 'Show'} logs ({rawLogs.length})
                              </button>
                            );
                          })()}
                        </div>
                        {(function() {
                          // Sparkline: ratings-over-time trend for this intervention.
                          // Hidden YAxis with domain={[1, 5]} constrains scale so tiny
                          // variations don't get exaggerated. Failures and zero-log
                          // interventions render nothing — commit 7 adds the warning
                          // banner for the zero-data case.
                          const rawLogs = interventionLogs[review.student_intervention_id] || [];
                          const ratedLogs = rawLogs.filter(function(l) { return l.rating != null; });
                          if (ratedLogs.length === 0) return null;
                          // Source is DESC (newest first); sparkline must render left=oldest,
                          // right=newest. Reverse a copy before mapping so the chronology
                          // reads correctly. The disclosure list (below) keeps source order.
                          const sparkData = ratedLogs.slice().reverse().map(function(l, i) { return { i: i, rating: l.rating }; });
                          return (
                            <div className="w-32 h-12 shrink-0" aria-label={'Rating trend sparkline for ' + review.intervention_name}>
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={sparkData}>
                                  <YAxis hide domain={[1, 5]} />
                                  <Line type="monotone" dataKey="rating" stroke="#6366f1" strokeWidth={2} dot isAnimationActive={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          );
                        })()}
                      </div>

                      {(function() {
                        // Zero-data warning: non-blocking banner shown when no
                        // weekly_progress logs exist for this intervention. Dropdowns
                        // below remain ACTIVE per product decision — the team may
                        // still record an evaluation, but the warning makes it
                        // explicit that no underlying log data was available to
                        // support that judgment. A soft fetch failure in
                        // fetchInterventionLogs (network/auth/server error) also
                        // surfaces []; the warning is then mildly misleading but
                        // not harmful — refresh the modal if a fetch failure is
                        // suspected.
                        const rawLogs = interventionLogs[review.student_intervention_id] || [];
                        if (rawLogs.length > 0) return null;
                        return (
                          <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2 text-amber-800">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <p className="text-xs">
                              <span className="font-medium">No weekly progress logs recorded for this intervention.</span>
                              {' '}Review may proceed, but no data is available to support evaluation.
                            </p>
                          </div>
                        );
                      })()}

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

                      {(function() {
                        // Log-detail disclosure: rendered only when the toggle above
                        // is expanded. Logs come pre-sorted DESC by week_of from
                        // /weekly-progress/intervention/:id (Session 28 PR #14), so
                        // most-recent-first ordering needs no client-side sort.
                        if (!expandedCards.has(review.student_intervention_id)) return null;
                        const rawLogs = interventionLogs[review.student_intervention_id] || [];
                        if (rawLogs.length === 0) return null;
                        return (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <p className="text-xs font-medium text-gray-700 mb-2">Weekly progress logs</p>
                            <ul className="space-y-1.5">
                              {rawLogs.map(function(log) {
                                const weekLabel = log.week_of
                                  ? new Date(log.week_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                  : 'No date';
                                const ratingColor = log.rating == null
                                  ? 'text-gray-400'
                                  : (log.rating >= 4 ? 'text-emerald-600' : (log.rating === 3 ? 'text-amber-600' : 'text-rose-600'));
                                const notesText = log.notes || '';
                                const notesExcerpt = notesText.length > 100 ? notesText.slice(0, 100) + '…' : notesText;
                                const loggerLabel = log.logged_by_name
                                  ? log.logged_by_name + (log.logged_by_role ? ' (' + log.logged_by_role + ')' : '')
                                  : 'Unknown';
                                return (
                                  <li key={log.id} className="text-xs text-gray-600 flex flex-wrap items-baseline gap-x-2">
                                    <span className="font-medium text-gray-700 shrink-0">{weekLabel}</span>
                                    <span className={'font-semibold shrink-0 ' + ratingColor}>
                                      {log.rating != null ? log.rating + '/5' : '—'}
                                    </span>
                                    {notesExcerpt && (
                                      <span className="text-gray-500 italic">"{notesExcerpt}"</span>
                                    )}
                                    <span className="text-gray-400 ml-auto shrink-0">{loggerLabel}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })()}
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