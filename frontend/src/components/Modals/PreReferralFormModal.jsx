import { useState, useEffect } from 'react';
import { X, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';

var formatWeekOf = function(dateStr) {
  if (!dateStr) return 'No date';
  var date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

var inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';
var textareaClass = inputClass + ' resize-none';

var PreReferralFormModal = function(props) {
  var onClose = props.onClose;
  var user = props.user;
  var selectedStudent = props.selectedStudent;
  var API_URL = props.API_URL;

  var _formState = useState(null);
  var preReferralForm = _formState[0];
  var setPreReferralForm = _formState[1];

  var _stepState = useState(1);
  var preReferralStep = _stepState[0];
  var setPreReferralStep = _stepState[1];

  var _loadingState = useState(true);
  var loading = _loadingState[0];
  var setLoading = _loadingState[1];

  useEffect(function() {
    initializeForm();
  }, []);

  var fetchPreReferralOptions = async function() {
    try {
      var res = await fetch(API_URL + '/prereferral-forms/options');
      if (res.ok) {
        return await res.json();
      }
    } catch (error) {
      console.error('Error fetching pre-referral options:', error);
    }
    return null;
  };

  var fetchPreReferralForm = async function(studentId) {
    try {
      var res = await fetch(API_URL + '/prereferral-forms/student/' + studentId);
      if (res.ok) {
        var data = await res.json();
        var activeForm = data.find(function(f) { return f.status !== 'archived'; });
        return activeForm || null;
      }
    } catch (error) {
      console.error('Error fetching pre-referral form:', error);
    }
    return null;
  };

  var createPreReferralForm = async function(studentId) {
    try {
      var res = await fetch(API_URL + '/prereferral-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          tenant_id: user.tenant_id,
          referred_by: user.id,
          initiated_by: 'staff'
        })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (error) {
      console.error('Error creating pre-referral form:', error);
    }
    return null;
  };

  var savePreReferralField = async function(formId, updates) {
    try {
      var res = await fetch(API_URL + '/prereferral-forms/' + formId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        var data = await res.json();
        setPreReferralForm(data);
        return data;
      }
    } catch (error) {
      console.error('Error saving pre-referral form:', error);
    }
    return null;
  };

  var submitPreReferralForm = async function(formId, staffName) {
    try {
      var res = await fetch(API_URL + '/prereferral-forms/' + formId + '/submit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referring_staff_name: staffName })
      });
      if (res.ok) {
        var data = await res.json();
        setPreReferralForm(data);
        return data;
      }
    } catch (error) {
      console.error('Error submitting pre-referral form:', error);
    }
    return null;
  };

  var initializeForm = async function() {
    setLoading(true);
    await fetchPreReferralOptions();

    var existingForm = await fetchPreReferralForm(selectedStudent.id);

    if (existingForm) {
      setPreReferralForm(existingForm);
    } else {
      var newForm = await createPreReferralForm(selectedStudent.id);
      setPreReferralForm(newForm);
    }

    setPreReferralStep(1);
    setLoading(false);
  };

  var save = function(field, value) {
    if (preReferralForm) {
      var updates = {};
      updates[field] = value;
      savePreReferralField(preReferralForm.id, updates);
    }
  };

  if (loading || !preReferralForm) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center">
          <p className="text-gray-600">Loading pre-referral form...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Pre-Referral Form</h3>
            <p className="text-sm text-slate-500">
              {selectedStudent.first_name} {selectedStudent.last_name} - Step {preReferralStep} of 11
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-4 py-2 bg-slate-50">
          <div className="flex gap-1">
            {[1,2,3,4,5,6,7,8,9,10,11].map(function(step) {
              return (
                <div
                  key={step}
                  className={'h-2 flex-1 rounded ' + (step <= preReferralStep ? 'bg-indigo-500' : 'bg-slate-200')}
                />
              );
            })}
          </div>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Step 1: Referral Information */}
          {preReferralStep === 1 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 1: Referral Information</h4>

              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
                <div>
                  <span className="text-sm text-slate-500">Student Name</span>
                  <p className="font-medium">{selectedStudent.first_name} {selectedStudent.last_name}</p>
                </div>
                <div>
                  <span className="text-sm text-slate-500">Grade</span>
                  <p className="font-medium">{selectedStudent.grade || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-sm text-slate-500">Current Tier</span>
                  <p className="font-medium">Tier {selectedStudent.tier}</p>
                </div>
                <div>
                  <span className="text-sm text-slate-500">Area</span>
                  <p className="font-medium">{selectedStudent.area || 'N/A'}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Referral Initiated By</label>
                <select
                  defaultValue={preReferralForm.initiated_by || 'staff'}
                  onBlur={function(e) { save('initiated_by', e.target.value); }}
                  className={inputClass}
                >
                  <option value="staff">School Staff</option>
                  <option value="parent">Parent/Guardian</option>
                  <option value="student">Student Self-Referral</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Referral Date</label>
                <input
                  type="date"
                  defaultValue={preReferralForm.referral_date ? preReferralForm.referral_date.split('T')[0] : new Date().toISOString().split('T')[0]}
                  onBlur={function(e) { save('referral_date', e.target.value); }}
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {/* Step 2: Area of Concern */}
          {preReferralStep === 2 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 2: Area of Concern</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Primary Area(s) of Concern</label>
                <div className="space-y-2">
                  {['Academic', 'Behavior', 'Social-Emotional'].map(function(area) {
                    return (
                      <label key={area} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          defaultChecked={preReferralForm.concern_areas ? preReferralForm.concern_areas.includes(area) : false}
                          onChange={function(e) {
                            var current = preReferralForm.concern_areas || [];
                            var updated = e.target.checked
                              ? [].concat(current, [area])
                              : current.filter(function(a) { return a !== area; });
                            savePreReferralField(preReferralForm.id, { concern_areas: updated });
                          }}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span>{area}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Specific Concerns</label>
                <textarea
                  defaultValue={preReferralForm.specific_concerns || ''}
                  onBlur={function(e) { save('specific_concerns', e.target.value); }}
                  placeholder="Describe specific concerns..."
                  className={textareaClass}
                  rows={4}
                />
              </div>
            </div>
          )}

          {/* Step 3: Detailed Description */}
          {preReferralStep === 3 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 3: Detailed Description</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Describe the concern in detail</label>
                <textarea
                  defaultValue={preReferralForm.concern_description || ''}
                  onBlur={function(e) { save('concern_description', e.target.value); }}
                  placeholder="Provide a detailed description of the concern..."
                  className={textareaClass}
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">When did you first notice?</label>
                  <select
                    defaultValue={preReferralForm.concern_first_noticed || ''}
                    onBlur={function(e) { save('concern_first_noticed', e.target.value); }}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    <option value="less_than_1_month">Less than 1 month ago</option>
                    <option value="1_to_3_months">1-3 months ago</option>
                    <option value="3_to_6_months">3-6 months ago</option>
                    <option value="6_to_12_months">6-12 months ago</option>
                    <option value="more_than_1_year">More than 1 year ago</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">How often does it occur?</label>
                  <select
                    defaultValue={preReferralForm.concern_frequency || ''}
                    onBlur={function(e) { save('concern_frequency', e.target.value); }}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    <option value="daily">Daily</option>
                    <option value="several_times_week">Several times per week</option>
                    <option value="weekly">Weekly</option>
                    <option value="occasionally">Occasionally</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Medical & Background */}
          {preReferralStep === 4 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 4: Medical &amp; Background Information</h4>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hearing tested in last 2 years?</label>
                  <select
                    defaultValue={preReferralForm.hearing_tested || ''}
                    onBlur={function(e) { save('hearing_tested', e.target.value); }}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Vision tested in last 2 years?</label>
                  <select
                    defaultValue={preReferralForm.vision_tested || ''}
                    onBlur={function(e) { save('vision_tested', e.target.value); }}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Known Medical Diagnoses</label>
                <textarea
                  defaultValue={preReferralForm.medical_diagnoses || ''}
                  onBlur={function(e) { save('medical_diagnoses', e.target.value); }}
                  placeholder="List any known medical diagnoses..."
                  className={textareaClass}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Medications Affecting Learning</label>
                <textarea
                  defaultValue={preReferralForm.medications || ''}
                  onBlur={function(e) { save('medications', e.target.value); }}
                  placeholder="List any medications that may affect learning..."
                  className={textareaClass}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Step 5: Academic Performance */}
          {preReferralStep === 5 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 5: Current Academic Performance</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Grades/Progress</label>
                <textarea
                  defaultValue={preReferralForm.current_grades || ''}
                  onBlur={function(e) { save('current_grades', e.target.value); }}
                  placeholder="Describe current academic performance..."
                  className={textareaClass}
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Recent Assessment Scores</label>
                <textarea
                  defaultValue={preReferralForm.assessment_scores || ''}
                  onBlur={function(e) { save('assessment_scores', e.target.value); }}
                  placeholder="List any recent assessment scores..."
                  className={textareaClass}
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Support Classes</label>
                <textarea
                  defaultValue={preReferralForm.support_classes || ''}
                  onBlur={function(e) { save('support_classes', e.target.value); }}
                  placeholder="List any current support classes or services..."
                  className={textareaClass}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Step 6: Existing Plans */}
          {preReferralStep === 6 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 6: Existing Plans &amp; Supports</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Current Plans</label>
                <div className="space-y-2">
                  {['504 Plan', 'IEP', 'Safety Plan', 'Behavior Plan', 'None'].map(function(plan) {
                    return (
                      <label key={plan} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          defaultChecked={preReferralForm.current_plans ? preReferralForm.current_plans.includes(plan) : false}
                          onChange={function(e) {
                            var current = preReferralForm.current_plans || [];
                            var updated = e.target.checked
                              ? [].concat(current, [plan])
                              : current.filter(function(p) { return p !== plan; });
                            savePreReferralField(preReferralForm.id, { current_plans: updated });
                          }}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span>{plan}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan Details</label>
                <textarea
                  defaultValue={preReferralForm.plan_details || ''}
                  onBlur={function(e) { save('plan_details', e.target.value); }}
                  placeholder="Provide details about existing plans..."
                  className={textareaClass}
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">External Supports</label>
                <textarea
                  defaultValue={preReferralForm.external_supports || ''}
                  onBlur={function(e) { save('external_supports', e.target.value); }}
                  placeholder="List any external supports (counseling, tutoring, community services)..."
                  className={textareaClass}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Step 7: Prior Interventions */}
          {preReferralStep === 7 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 7: Prior Interventions Attempted</h4>

              {preReferralForm.prior_interventions && preReferralForm.prior_interventions.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">The following interventions were found in TierTrak:</p>
                  {preReferralForm.prior_interventions.map(function(intervention, index) {
                    return (
                      <div key={index} className="p-3 bg-slate-50 rounded-lg">
                        <p className="font-medium">{intervention.name}</p>
                        <p className="text-sm text-slate-500">Started: {intervention.start_date ? formatWeekOf(intervention.start_date) : 'Unknown'}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            placeholder="Duration used"
                            defaultValue={intervention.duration || ''}
                            onBlur={function(e) {
                              var updated = [].concat(preReferralForm.prior_interventions);
                              updated[index].duration = e.target.value;
                              savePreReferralField(preReferralForm.id, { prior_interventions: updated });
                            }}
                            className="px-2 py-1 text-sm border border-slate-200 rounded"
                          />
                          <input
                            type="text"
                            placeholder="Outcome/response"
                            defaultValue={intervention.outcome || ''}
                            onBlur={function(e) {
                              var updated = [].concat(preReferralForm.prior_interventions);
                              updated[index].outcome = e.target.value;
                              savePreReferralField(preReferralForm.id, { prior_interventions: updated });
                            }}
                            className="px-2 py-1 text-sm border border-slate-200 rounded"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 italic">No interventions found in TierTrak for this student.</p>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Other Interventions Not Listed Above</label>
                <textarea
                  defaultValue={preReferralForm.other_interventions || ''}
                  onBlur={function(e) { save('other_interventions', e.target.value); }}
                  placeholder="List any other interventions that were tried..."
                  className={textareaClass}
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Step 8: Student Strengths */}
          {preReferralStep === 8 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 8: Student Strengths</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Academic Strengths</label>
                <textarea
                  defaultValue={preReferralForm.academic_strengths || ''}
                  onBlur={function(e) { save('academic_strengths', e.target.value); }}
                  placeholder="What are the student's academic strengths?"
                  className={textareaClass}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Social Strengths</label>
                <textarea
                  defaultValue={preReferralForm.social_strengths || ''}
                  onBlur={function(e) { save('social_strengths', e.target.value); }}
                  placeholder="What are the student's social strengths?"
                  className={textareaClass}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Interests/Preferred Activities</label>
                <textarea
                  defaultValue={preReferralForm.interests || ''}
                  onBlur={function(e) { save('interests', e.target.value); }}
                  placeholder="What does the student enjoy?"
                  className={textareaClass}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">What Motivates This Student?</label>
                <textarea
                  defaultValue={preReferralForm.motivators || ''}
                  onBlur={function(e) { save('motivators', e.target.value); }}
                  placeholder="What motivates the student?"
                  className={textareaClass}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Step 9: Parent Contact */}
          {preReferralStep === 9 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 9: Parent/Guardian Contact</h4>
              <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">{'\u26A0\uFE0F'} Parent contact is required before submitting this form.</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Parent/Guardian Name *</label>
                  <input
                    type="text"
                    defaultValue={preReferralForm.parent_name || ''}
                    onBlur={function(e) { save('parent_name', e.target.value); }}
                    placeholder="Enter name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Relationship</label>
                  <select
                    defaultValue={preReferralForm.parent_relationship || ''}
                    onBlur={function(e) { save('parent_relationship', e.target.value); }}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    <option value="mother">Mother</option>
                    <option value="father">Father</option>
                    <option value="guardian">Guardian</option>
                    <option value="grandparent">Grandparent</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    defaultValue={preReferralForm.parent_phone || ''}
                    onBlur={function(e) { save('parent_phone', e.target.value); }}
                    placeholder="(555) 555-5555"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    defaultValue={preReferralForm.parent_email || ''}
                    onBlur={function(e) { save('parent_email', e.target.value); }}
                    placeholder="email@example.com"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date of Contact *</label>
                  <input
                    type="date"
                    defaultValue={preReferralForm.contact_date ? preReferralForm.contact_date.split('T')[0] : ''}
                    onBlur={function(e) { save('contact_date', e.target.value); }}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contact Method *</label>
                  <select
                    defaultValue={preReferralForm.contact_method || ''}
                    onBlur={function(e) { save('contact_method', e.target.value); }}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    <option value="phone">Phone Call</option>
                    <option value="email">Email</option>
                    <option value="in_person">In Person</option>
                    <option value="text">Text Message</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Parent Input/Concerns Shared *</label>
                <textarea
                  defaultValue={preReferralForm.parent_input || ''}
                  onBlur={function(e) { save('parent_input', e.target.value); }}
                  placeholder="What did the parent share during the conversation?"
                  className={textareaClass}
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Supports Used at Home</label>
                <textarea
                  defaultValue={preReferralForm.home_supports || ''}
                  onBlur={function(e) { save('home_supports', e.target.value); }}
                  placeholder="What strategies are working at home?"
                  className={textareaClass}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Parent Supports This Referral?</label>
                <select
                  defaultValue={preReferralForm.parent_supports_referral || ''}
                  onBlur={function(e) { save('parent_supports_referral', e.target.value); }}
                  className={inputClass}
                >
                  <option value="">Select...</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="partial">Partially</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 10: Reason for Referral */}
          {preReferralStep === 10 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 10: Reason for Referral</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Why are Tier 1 supports insufficient? *</label>
                <textarea
                  defaultValue={preReferralForm.why_tier1_insufficient || ''}
                  onBlur={function(e) { save('why_tier1_insufficient', e.target.value); }}
                  placeholder="Explain why current Tier 1 supports are not meeting this student's needs..."
                  className={textareaClass}
                  rows={4}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">What data supports this referral?</label>
                <textarea
                  defaultValue={preReferralForm.supporting_data || ''}
                  onBlur={function(e) { save('supporting_data', e.target.value); }}
                  placeholder="List data points that support this referral (grades, behavior incidents, assessments, etc.)..."
                  className={textareaClass}
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Specific Event(s) Prompting Referral</label>
                <textarea
                  defaultValue={preReferralForm.triggering_events || ''}
                  onBlur={function(e) { save('triggering_events', e.target.value); }}
                  placeholder="Were there specific events that prompted this referral?"
                  className={textareaClass}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Step 11: Recommendations */}
          {preReferralStep === 11 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-lg">Step 11: Recommendations</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Tier *</label>
                <select
                  defaultValue={preReferralForm.recommended_tier || ''}
                  onBlur={function(e) { save('recommended_tier', parseInt(e.target.value) || null); }}
                  className={inputClass}
                >
                  <option value="">Select recommended tier...</option>
                  <option value="2">Tier 2 - Targeted Support</option>
                  <option value="3">Tier 3 - Intensive Support</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Interventions</label>
                <textarea
                  defaultValue={preReferralForm.recommended_interventions || ''}
                  onBlur={function(e) { save('recommended_interventions', e.target.value); }}
                  placeholder="What interventions do you recommend?"
                  className={textareaClass}
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Assessments</label>
                <textarea
                  defaultValue={preReferralForm.recommended_assessments || ''}
                  onBlur={function(e) { save('recommended_assessments', e.target.value); }}
                  placeholder="What assessments should be conducted?"
                  className={textareaClass}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Additional Recommendations</label>
                <textarea
                  defaultValue={preReferralForm.additional_recommendations || ''}
                  onBlur={function(e) { save('additional_recommendations', e.target.value); }}
                  placeholder="Any other recommendations..."
                  className={textareaClass}
                  rows={2}
                />
              </div>

              {preReferralForm.status === 'draft' && (
                <div className="mt-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-sm text-amber-800 mb-2">
                    <strong>Ready to submit?</strong> Make sure you have contacted the parent (Step 9) before submitting.
                  </p>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer with Navigation */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between">
          <div>
            {preReferralStep > 1 && (
              <button
                onClick={function() { setPreReferralStep(preReferralStep - 1); }}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 flex items-center gap-1"
              >
                <ArrowLeft className="w-4 h-4" /> Previous
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-800"
            >
              Save &amp; Close
            </button>

            {preReferralStep < 11 ? (
              <button
                onClick={function() { setPreReferralStep(preReferralStep + 1); }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              preReferralForm.status === 'draft' && (
                <button
                  onClick={async function() {
                    if (!preReferralForm.parent_name || !preReferralForm.contact_date || !preReferralForm.parent_input) {
                      alert('Please complete the Parent Contact section (Step 9) before submitting.');
                      setPreReferralStep(9);
                      return;
                    }
                    if (!preReferralForm.recommended_tier) {
                      alert('Please select a recommended tier before submitting.');
                      return;
                    }
                    var staffName = prompt('Type your name to sign and submit this form:');
                    if (staffName) {
                      await submitPreReferralForm(preReferralForm.id, staffName);
                      alert('Form submitted for counselor approval!');
                      onClose();
                    }
                  }}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1"
                >
                  <CheckCircle className="w-4 h-4" /> Submit for Approval
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreReferralFormModal;