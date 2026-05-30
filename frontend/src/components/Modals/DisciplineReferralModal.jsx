import { useState, useEffect } from 'react';
import { X, ArrowLeft, ArrowRight, CheckCircle, AlertCircle, Search } from 'lucide-react';
import { logError } from '../../utils/logError';
import { apiFetch } from '../../utils/apiFetch';

// Mobile-first: full-screen <sm, centered modal >=sm. Tap targets ≥44px.
// Vertical picker lists beat native <select> on phones (better for thumb).

var inputClass = 'w-full px-3 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-base';
var textareaClass = inputClass + ' resize-none';
var pickerBase = 'w-full text-left px-4 py-3 rounded-lg border-2 transition active:scale-[0.99] text-base';
var pickerIdle = pickerBase + ' border-slate-200 hover:border-indigo-300 bg-white';
var pickerSelected = pickerBase + ' border-indigo-500 bg-indigo-50';
var primaryBtn = 'w-full py-3 bg-indigo-600 text-white rounded-lg font-medium text-base disabled:opacity-50 disabled:cursor-not-allowed';
var secondaryBtn = 'w-full py-3 bg-white border-2 border-indigo-600 text-indigo-700 rounded-lg font-medium text-base';

var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
var formatDateNow = function() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};
var formatTimeNow = function() {
  var d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};

var DisciplineReferralModal = function(props) {
  var onClose = props.onClose;
  var user = props.user;
  var preselectedStudent = props.selectedStudent || null;
  var API_URL = props.API_URL;

  // Step 1 = Identify (student + behavior), 2 = Details, 3 = Confirmation.
  var [step, setStep] = useState(1);

  // Vocab loaded once. discipline-referrals/vocab/:tenantId returns
  // behaviors (with severity_level, managed_by, requires_subtype M037),
  // locations, motivations, others_involved, consequences (with is_restorative),
  // harassment_subtypes, weapon_subtypes.
  var [vocab, setVocab] = useState(null);
  var [vocabError, setVocabError] = useState(null);
  var [loadingVocab, setLoadingVocab] = useState(true);

  // Identify state
  var [student, setStudent] = useState(preselectedStudent);
  var [studentQuery, setStudentQuery] = useState('');
  var [studentResults, setStudentResults] = useState([]);
  var [searching, setSearching] = useState(false);
  var [behavior, setBehavior] = useState(null);

  // Details state
  var [locationId, setLocationId] = useState(null);
  var [incidentDate, setIncidentDate] = useState(formatDateNow());
  var [incidentTime, setIncidentTime] = useState(formatTimeNow());
  var [motivationId, setMotivationId] = useState(null);
  var [othersInvolvedId, setOthersInvolvedId] = useState(null);
  var [harassmentSubtypeId, setHarassmentSubtypeId] = useState(null);
  var [weaponSubtypeId, setWeaponSubtypeId] = useState(null);
  var [consequenceId, setConsequenceId] = useState(null);
  var [staffNotes, setStaffNotes] = useState('');

  // Submit + confirmation state
  var [submitting, setSubmitting] = useState(false);
  var [submitError, setSubmitError] = useState(null);
  var [confirmation, setConfirmation] = useState(null);

  // Load vocab on mount.
  useEffect(function() {
    var loadVocab = async function() {
      try {
        var res = await apiFetch(API_URL + '/discipline-referrals/vocab/' + user.tenant_id);
        if (!res.ok) {
          throw new Error('vocab status ' + res.status);
        }
        var data = await res.json();
        setVocab(data);
      } catch (err) {
        logError('[disciplineReferral:vocab]', err);
        setVocabError('Could not load form options. Close and try again.');
      } finally {
        setLoadingVocab(false);
      }
    };
    loadVocab();
  }, []);

  // Debounced student search. Skipped when student preselected.
  useEffect(function() {
    if (preselectedStudent) return;
    var q = (studentQuery || '').trim();
    if (q.length < 2) {
      setStudentResults([]);
      return;
    }
    var timer = setTimeout(async function() {
      setSearching(true);
      try {
        var res = await apiFetch(
          API_URL + '/students/tenant/' + user.tenant_id + '?search=' + encodeURIComponent(q)
        );
        if (res.ok) {
          var data = await res.json();
          var list = Array.isArray(data) ? data : (data.students || data.rows || []);
          setStudentResults(list.slice(0, 20));
        }
      } catch (err) {
        logError('[disciplineReferral:studentSearch]', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return function() { clearTimeout(timer); };
  }, [studentQuery, preselectedStudent]);

  // Derived state for the path fork.
  var requiresSubtype = behavior && behavior.requires_subtype;
  var isStaffPath = behavior && behavior.managed_by === 'staff';
  var isAdminPath = behavior && behavior.managed_by === 'admin';
  var canAdvanceToStep2 = !!student && !!behavior;
  var notesRequired = isAdminPath;
  var canSubmit = canAdvanceToStep2
    && !!locationId
    && !!incidentDate
    && (notesRequired ? staffNotes.trim().length > 0 : true)
    && (requiresSubtype === 'harassment' ? !!harassmentSubtypeId : true)
    && (requiresSubtype === 'weapon' ? !!weaponSubtypeId : true);

  // "File another for this same incident" — per design §1, preserve shared
  // incident details (behavior, location, date/time, staff_notes) and clear
  // per-student fields (student, motivation, others_involved, subtype,
  // consequence). Behavior preserves severity_level / managed_by /
  // requires_subtype implicitly so the next student's form keeps the same
  // path and conditional pickers.
  var resetForNextStudentSameIncident = function() {
    setStudent(null);
    setStudentQuery('');
    setStudentResults([]);
    setMotivationId(null);
    setOthersInvolvedId(null);
    setHarassmentSubtypeId(null);
    setWeaponSubtypeId(null);
    setConsequenceId(null);
    setSubmitError(null);
    setConfirmation(null);
    setStep(1);
  };

  var handleSubmit = async function() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      var body = {
        student_id: student.id,
        behavior_id: behavior.id,
        location_id: locationId,
        incident_date: incidentDate,
      };
      if (incidentTime) body.incident_time = incidentTime;
      if (isStaffPath) {
        if (consequenceId) body.consequence_id = consequenceId;
      } else {
        if (motivationId) body.motivation_id = motivationId;
        if (othersInvolvedId) body.others_involved_id = othersInvolvedId;
      }
      if (requiresSubtype === 'harassment') body.harassment_subtype_id = harassmentSubtypeId;
      if (requiresSubtype === 'weapon') body.weapon_subtype_id = weaponSubtypeId;
      var trimmed = staffNotes.trim();
      if (trimmed.length > 0) body.staff_notes = trimmed;

      var res = await apiFetch(API_URL + '/discipline-referrals/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        var errData = {};
        try { errData = await res.json(); } catch (_) { /* swallow */ }
        throw new Error(errData.error || ('Submission failed (' + res.status + ')'));
      }
      var resultData = await res.json();
      setConfirmation(resultData);
      setStep(3);
    } catch (err) {
      logError('[disciplineReferral:submit]', err);
      setSubmitError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  var renderStudentBadge = function(s) {
    if (!s) return null;
    var fields = [];
    if (s.grade != null) fields.push('Grade ' + s.grade);
    if (s.tier != null) fields.push('Tier ' + s.tier);
    if (s.area) fields.push(s.area);
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-slate-900">{s.first_name} {s.last_name}</span>
        <span className="text-sm text-slate-600">{fields.join(' · ')}</span>
      </div>
    );
  };

  // ---- Step 1: Identify ----
  var renderStep1 = function() {
    return (
      <div className="space-y-5">
        {/* Student */}
        <section>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Student</h3>
          {student ? (
            <div className="border-2 border-indigo-500 bg-indigo-50 rounded-lg p-3 flex items-center justify-between">
              <div className="flex-1">{renderStudentBadge(student)}</div>
              <button
                type="button"
                onClick={function() { setStudent(null); setStudentQuery(''); }}
                className="ml-3 text-sm text-indigo-700 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div>
              <div className="relative">
                <Search size={18} className="absolute left-3 top-3.5 text-slate-400" />
                <input
                  type="text"
                  value={studentQuery}
                  onChange={function(e) { setStudentQuery(e.target.value); }}
                  placeholder="Search by name…"
                  autoFocus
                  className={inputClass + ' pl-10'}
                />
              </div>
              {searching && <div className="text-sm text-slate-500 mt-2">Searching…</div>}
              {!searching && studentQuery.trim().length >= 2 && studentResults.length === 0 && (
                <div className="text-sm text-slate-500 mt-2">No students found.</div>
              )}
              {studentResults.length > 0 && (
                <div className="mt-2 space-y-2 max-h-72 overflow-y-auto">
                  {studentResults.map(function(s) {
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={function() { setStudent(s); setStudentQuery(''); setStudentResults([]); }}
                        className={pickerIdle}
                      >
                        {renderStudentBadge(s)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Behavior */}
        {student && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Behavior</h3>
            <div className="space-y-2">
              {vocab.behaviors.map(function(b) {
                var selected = behavior && behavior.id === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={function() {
                      setBehavior(b);
                      // Clear subtype + consequence + L2+ optional fields
                      // when behavior changes — the path may have flipped.
                      setHarassmentSubtypeId(null);
                      setWeaponSubtypeId(null);
                      setConsequenceId(null);
                      setMotivationId(null);
                      setOthersInvolvedId(null);
                    }}
                    className={selected ? pickerSelected : pickerIdle}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-slate-900">{b.label}</span>
                      <span className={
                        'text-xs px-2 py-0.5 rounded-full ' +
                        (b.managed_by === 'staff'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800')
                      }>
                        L{b.severity_level} · {b.managed_by === 'staff' ? 'staff-managed' : 'admin-managed'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  };

  // ---- Step 2: Details ----
  var renderStep2 = function() {
    return (
      <div className="space-y-5">
        {/* Summary */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm">
          {renderStudentBadge(student)}
          <div className="mt-1 text-slate-700">
            <span className="font-medium">{behavior.label}</span>
            <span className="text-slate-500"> · L{behavior.severity_level} · {behavior.managed_by === 'staff' ? 'staff-managed' : 'admin-managed'}</span>
          </div>
        </div>

        {/* Location (required) */}
        <section>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
            Where it happened <span className="text-red-600">*</span>
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {vocab.locations.map(function(l) {
              var selected = locationId === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={function() { setLocationId(l.id); }}
                  className={selected ? pickerSelected : pickerIdle}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Date / time */}
        <section>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
            When <span className="text-red-600">*</span>
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">Date</label>
              <input
                type="date"
                value={incidentDate}
                max={formatDateNow()}
                onChange={function(e) { setIncidentDate(e.target.value); }}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Time</label>
              <input
                type="time"
                value={incidentTime}
                onChange={function(e) { setIncidentTime(e.target.value); }}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Conditional: harassment subtype */}
        {requiresSubtype === 'harassment' && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
              Harassment subtype <span className="text-red-600">*</span>
            </h3>
            <div className="space-y-2">
              {vocab.harassment_subtypes.map(function(h) {
                var selected = harassmentSubtypeId === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={function() { setHarassmentSubtypeId(h.id); }}
                    className={selected ? pickerSelected : pickerIdle}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Conditional: weapon subtype */}
        {requiresSubtype === 'weapon' && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
              Weapon subtype <span className="text-red-600">*</span>
            </h3>
            <div className="space-y-2">
              {vocab.weapon_subtypes.map(function(w) {
                var selected = weaponSubtypeId === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={function() { setWeaponSubtypeId(w.id); }}
                    className={selected ? pickerSelected : pickerIdle}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* L2+ only: motivation (optional) */}
        {isAdminPath && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
              Perceived motivation <span className="text-slate-400 normal-case font-normal text-xs">(optional)</span>
            </h3>
            <div className="space-y-2">
              {vocab.motivations.map(function(m) {
                var selected = motivationId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={function() { setMotivationId(selected ? null : m.id); }}
                    className={selected ? pickerSelected : pickerIdle}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* L2+ only: others involved (optional) */}
        {isAdminPath && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
              Others involved <span className="text-slate-400 normal-case font-normal text-xs">(optional)</span>
            </h3>
            <div className="space-y-2">
              {vocab.others_involved.map(function(o) {
                var selected = othersInvolvedId === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={function() { setOthersInvolvedId(selected ? null : o.id); }}
                    className={selected ? pickerSelected : pickerIdle}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* L1 only: consequence (optional, single) */}
        {isStaffPath && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
              Consequence <span className="text-slate-400 normal-case font-normal text-xs">(optional)</span>
            </h3>
            <div className="space-y-2">
              {vocab.consequences.map(function(c) {
                var selected = consequenceId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={function() { setConsequenceId(selected ? null : c.id); }}
                    className={selected ? pickerSelected : pickerIdle}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span>{c.label}</span>
                      {c.is_restorative && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">restorative</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Staff notes — required on L2+, optional on L1 */}
        <section>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
            {isAdminPath
              ? <>What happened <span className="text-red-600">*</span></>
              : <>Response notes <span className="text-slate-400 normal-case font-normal text-xs">(optional)</span></>}
          </h3>
          <textarea
            value={staffNotes}
            onChange={function(e) { setStaffNotes(e.target.value); }}
            rows={4}
            placeholder={isAdminPath
              ? 'Describe the incident so the administrator can review it.'
              : 'Optional: what you did, what you said, anything worth noting.'}
            className={textareaClass}
          />
        </section>
      </div>
    );
  };

  // ---- Step 3: Confirmation ----
  var renderStep3 = function() {
    var loggedAdminPath = confirmation && confirmation.managed_by === 'admin';
    return (
      <div className="space-y-5 py-6">
        <div className="flex flex-col items-center text-center">
          <CheckCircle size={48} className="text-emerald-600 mb-3" />
          <h3 className="text-xl font-semibold text-slate-900">
            {loggedAdminPath ? 'Submitted to admin for review' : 'Logged'}
          </h3>
          <p className="text-slate-600 mt-2 text-sm">
            {loggedAdminPath
              ? 'An administrator will follow up and assign the consequence.'
              : 'Referral recorded. No further action needed.'}
          </p>
        </div>
        <div className="space-y-2 pt-2">
          <button type="button" onClick={resetForNextStudentSameIncident} className={primaryBtn}>
            File another for this same incident
          </button>
          <button type="button" onClick={onClose} className={secondaryBtn}>
            Close
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4">
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:max-w-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            {step === 2 && (
              <button
                type="button"
                onClick={function() { setStep(1); }}
                aria-label="Back"
                className="p-1 -ml-1 rounded hover:bg-slate-100"
              >
                <ArrowLeft size={22} className="text-slate-700" />
              </button>
            )}
            <h2 className="text-lg font-semibold truncate">
              {step === 3 ? 'Referral submitted' : 'New discipline referral'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 -mr-1 rounded hover:bg-slate-100"
          >
            <X size={22} className="text-slate-700" />
          </button>
        </div>

        {/* Body (scrolls) */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loadingVocab && (
            <div className="text-center text-slate-500 py-8">Loading…</div>
          )}
          {vocabError && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 flex gap-2">
              <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
              <span className="text-sm">{vocabError}</span>
            </div>
          )}
          {!loadingVocab && vocab && step === 1 && renderStep1()}
          {!loadingVocab && vocab && step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
        </div>

        {/* Sticky action bar (steps 1 + 2 only) */}
        {!loadingVocab && vocab && step !== 3 && (
          <div className="px-4 py-3 border-t border-slate-200 bg-white">
            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-3 text-sm">
                {submitError}
              </div>
            )}
            {step === 1 && (
              <button
                type="button"
                disabled={!canAdvanceToStep2}
                onClick={function() { setStep(2); }}
                className={primaryBtn}
              >
                Continue <ArrowRight size={18} className="inline -mt-0.5 ml-1" />
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                disabled={!canSubmit || submitting}
                onClick={handleSubmit}
                className={primaryBtn}
              >
                {submitting ? 'Submitting…' : 'Submit referral'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DisciplineReferralModal;
