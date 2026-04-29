import { useState, useEffect } from 'react';
import {
  X,
  Save,
  AlertCircle,
  Lock,
  ChevronDown,
  ChevronRight,
  Printer,
} from 'lucide-react';
import { logError } from '../../utils/logError';
import { createDetermination } from './api';
import { dateToIsoTimestamp, isoTimestampToDate } from './helpers';
import { oregonOde2025 } from '../../data/504-form-sets/oregon-ode-2025';

const formI = oregonOde2025.forms.formI;

// Form I — Section 504 Eligibility Determination (staff-side modal).
//
// Modes (same convention as Form C):
//   - 'add'  — blank form; on save POSTs /eligibility-determinations.
//   - 'view' — read-only render; persisted DB fields are hydrated;
//             render-only fields stay hidden behind a banner.
//
// Form-set ↔ DB column mapping (commit 3 deviation, called out in the PR):
//   form-set field                    → DB column
//   ─────────────────────────────────────────────────────────────
//   studentInformationFields.meetingDate (date)  → determined_at (ISO ts)
//   sectionB.q3_eligibility radio choice         → eligibility_status
//                                                   ('eligibleWithPlan' →
//                                                    'eligible',
//                                                    'technicallyEligibleNoPlan' →
//                                                    'eligible',
//                                                    'notEligible' →
//                                                    'not_eligible')
//   (NEW staff-only field in the modal,         → determination_notes
//    NOT in the form-set rendering schema)
//
//   No DB column today; render-only (visible in mode='add' for printing,
//   HIDDEN in mode='view'):
//     - studentInformationFields except meetingDate (8 fields)
//     - teamTable (5 rows × 3 cols)
//     - sectionA (4 textareas)
//     - sectionB.q1_impairment + q2_majorLifeActivities + q3 followUp
//       explain textareas
//     - meetingParticipants (5 rows × 4 cols)
//
// Q3 round-trip caveat: the form-set has 3 q3 options
// ('eligibleWithPlan', 'technicallyEligibleNoPlan', 'notEligible') but
// the DB enum is 2 truthy values ('eligible' / 'not_eligible'). On save,
// the first two collapse to 'eligible' and cannot be distinguished on
// reload. View mode shows a status LABEL (not the radio) to be honest
// about what's persisted.
//
// Print-scope structure (looking ahead to commit 5):
//   <div data-print-section="form-i">      ← will gain .print-form
//     all form-set content
//   </div>
//   <div data-print-section="staff-only">  ← will gain .no-print
//     determination_notes panel
//   </div>
// The staff-only panel is a SIBLING of the printable wrapper, never a
// descendant. Commit 5's print CSS toggle therefore cannot accidentally
// reveal determination_notes on the printed Form I.
//
// Auth: parent role short-circuit at the top of render; parent role also
// refused at the route boundary. determination_notes is STAFF-ONLY per
// PRIVACY_REVIEW.md and the parent route family (routes/parent504.js)
// has no handler for this resource at all.
const FormIDeterminationModal = ({
  API_URL,
  user,
  cycleId,
  mode,
  existingDetermination,
  onClose,
  onSaved,
}) => {
  const isView = mode === 'view';

  // Persisted fields (round-trip on save):
  const [meetingDate, setMeetingDate] = useState('');
  const [q3Choice, setQ3Choice] = useState('');
  const [determinationNotes, setDeterminationNotes] = useState('');

  // Render-only fields — student information (8 of 9; meetingDate is
  // persisted above).
  const [studentInfoValues, setStudentInfoValues] = useState({});

  // Render-only — team table (5 rows × 3 cols).
  const [teamRows, setTeamRows] = useState(
    Array.from({ length: formI.teamTable.defaultRowCount || 5 }, () => ({
      name: '',
      title: '',
      knowledgeableOf: '',
    }))
  );

  // Render-only — Section A. presentPerformance is a group of 3 sub-fields.
  const [sectionA, setSectionA] = useState({
    educationalHistory: '',
    sourcesOfEvaluation: '',
    resultsOfAssessment: '',
    currentClassesAndGrades: '',
    schoolAttendance: '',
    otherRelevantInformation: '',
  });

  // Render-only — Section B q1 (impairment).
  const [q1Choice, setQ1Choice] = useState('');
  const [q1YesDescription, setQ1YesDescription] = useState('');
  const [q1NoDescription, setQ1NoDescription] = useState('');

  // Render-only — Section B q2 (major life activities).
  // Using a Set keyed by the activity label string. The form-set
  // enumerates 22 string entries + 1 object entry { key: 'other' }.
  const [activitiesChecked, setActivitiesChecked] = useState(new Set());
  const [otherActivity, setOtherActivity] = useState('');
  const [substantialLimitDescription, setSubstantialLimitDescription] = useState('');

  // Render-only — Section B q3 followUp explain textareas.
  // Note: q3Choice itself is "kind of persisted" via the eligibility_status
  // mapping; these explain fields are pure render-only.
  const [technicallyEligibleExplain, setTechnicallyEligibleExplain] = useState('');
  const [notEligibleExplain, setNotEligibleExplain] = useState('');

  // Render-only — meeting participants (5 rows × 4 cols).
  const [participantRows, setParticipantRows] = useState(
    Array.from({ length: formI.meetingParticipants.defaultRowCount || 5 }, () => ({
      name: '',
      signature: '',
      agree: false,
      disagree: false,
    }))
  );

  // UI state. Default-closed in view mode keeps the formal record
  // (status + date) above the fold; staff who want to read the notes
  // still have the chevron. Default-open in add mode advertises the
  // panel's existence on first render so it isn't missed.
  // mode is a prop and stable for the modal's lifetime (the parent
  // unmounts/remounts to switch modes), so the initial state captures
  // the right value once.
  const [staffPanelOpen, setStaffPanelOpen] = useState(!isView);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Hydrate persisted fields when viewing an existing determination.
  // Render-only fields stay default-empty (never persisted).
  useEffect(() => {
    if (!isView || !existingDetermination) return;
    const d = existingDetermination;
    setMeetingDate(isoTimestampToDate(d.determined_at));
    setDeterminationNotes(d.determination_notes || '');
    // Note: we DO NOT hydrate q3Choice from eligibility_status; the q3
    // radio is hidden in view mode, replaced by a status label. See the
    // round-trip caveat in the file header.
  }, [isView, existingDetermination]);

  const handleSave = async () => {
    if (isView) return;
    setSaving(true);
    setSaveError(null);
    try {
      const eligibilityStatus =
        q3Choice === 'eligibleWithPlan' || q3Choice === 'technicallyEligibleNoPlan'
          ? 'eligible'
          : q3Choice === 'notEligible'
          ? 'not_eligible'
          : 'pending';
      await createDetermination(API_URL, {
        cycle_id: cycleId,
        eligibility_status: eligibilityStatus,
        determination_notes: determinationNotes || null,
        determined_at: dateToIsoTimestamp(meetingDate),
      });
      onSaved();
    } catch (err) {
      logError('[FormIDeterminationModal save]', err);
      setSaveError('Could not save Form I.');
    } finally {
      setSaving(false);
    }
  };

  if (user?.role === 'parent') return null;

  const inputBase =
    'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500';
  const textareaBase = `${inputBase} resize-none`;

  // ----- helpers for student info / team / participants render-only inputs -----

  const setStudentInfoField = (key, value) =>
    setStudentInfoValues((prev) => ({ ...prev, [key]: value }));

  const setTeamRowField = (idx, field, value) =>
    setTeamRows((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });

  const setParticipantRowField = (idx, field, value) =>
    setParticipantRows((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });

  const toggleActivity = (label) =>
    setActivitiesChecked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const eligibilityLabelMap = {
    eligible: 'Eligible (with or without a 504 plan)',
    not_eligible: 'Not eligible',
    pending: 'Pending',
  };
  const persistedEligibilityLabel = isView
    ? eligibilityLabelMap[existingDetermination?.eligibility_status] || 'Pending'
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-slate-800">
              Form I — {formI.title}
            </h2>
            {isView && (
              <span className="no-print text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                Read-only revision
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="no-print p-1 text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isView && (
            <div className="no-print text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Saved revisions include only the legally-binding fields (eligibility
              status, determination date) plus the staff-only determination notes.
              To print Form I with the full evaluation summary, team table, and
              eligibility reasoning, add a new revision.
            </div>
          )}

          {/* ============================================================ */}
          {/* PRINT SCOPE — form-set content. Commit 5 added .print-form    */}
          {/* to this wrapper. determination_notes panel is OUTSIDE this    */}
          {/* div by construction (it's a sibling, not a descendant) AND     */}
          {/* carries .no-print on its wrapper for double exclusion. See     */}
          {/* file header for the structural rule.                           */}
          {/* ============================================================ */}
          <div data-print-section="form-i" className="print-form space-y-6">
            {/* Student information */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Student Information
              </h3>
              {!isView && (
                <p className="no-print text-xs text-slate-500 italic">
                  Eight of these fields appear on the printed Form I but are not
                  stored on save (no DB column). The Date field is persisted as
                  the determination date.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {formI.studentInformationFields.map((f) => {
                  if (f.key === 'meetingDate') {
                    return (
                      <label key={f.key} className="block">
                        <span className="text-xs font-medium text-slate-700 block mb-1">
                          {f.label}
                        </span>
                        <input
                          type="date"
                          value={meetingDate}
                          onChange={(e) => setMeetingDate(e.target.value)}
                          disabled={isView}
                          className={inputBase}
                        />
                      </label>
                    );
                  }
                  if (isView) return null;
                  return (
                    <label key={f.key} className="block">
                      <span className="text-xs font-medium text-slate-700 block mb-1">
                        {f.label}
                      </span>
                      <input
                        type={f.type === 'date' ? 'date' : 'text'}
                        value={studentInfoValues[f.key] || ''}
                        onChange={(e) => setStudentInfoField(f.key, e.target.value)}
                        className={inputBase}
                      />
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Team table — render-only, hidden in view mode */}
            {!isView && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  {formI.teamTable.heading}
                </h3>
                <p className="no-print text-xs text-slate-500 italic">
                  Render-only — appears on the printed Form I but is not stored
                  on save.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500">
                        {formI.teamTable.columns.map((c) => (
                          <th key={c.key} className="py-1 pr-2 font-medium">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamRows.map((row, idx) => (
                        <tr key={idx} className="align-top">
                          <td className="py-1 pr-2">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) =>
                                setTeamRowField(idx, 'name', e.target.value)
                              }
                              className={inputBase}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              type="text"
                              value={row.title}
                              onChange={(e) =>
                                setTeamRowField(idx, 'title', e.target.value)
                              }
                              className={inputBase}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <select
                              value={row.knowledgeableOf}
                              onChange={(e) =>
                                setTeamRowField(idx, 'knowledgeableOf', e.target.value)
                              }
                              className={inputBase}
                            >
                              <option value="">—</option>
                              {formI.teamTable.columns
                                .find((c) => c.key === 'knowledgeableOf')
                                .options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Section A — render-only */}
            {!isView && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">
                  {formI.sectionA.heading}
                </h3>
                <p className="no-print text-xs text-slate-500 italic">
                  Render-only — appears on the printed Form I but is not stored
                  on save.
                </p>
                {formI.sectionA.fields.map((field) => {
                  if (field.type === 'textarea') {
                    return (
                      <label key={field.key} className="block">
                        <span className="text-xs font-medium text-slate-700 block mb-1">
                          {field.label}
                        </span>
                        <textarea
                          rows={field.defaultRowCount || 5}
                          value={sectionA[field.key] || ''}
                          onChange={(e) =>
                            setSectionA((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          className={textareaBase}
                        />
                      </label>
                    );
                  }
                  if (field.type === 'group') {
                    return (
                      <fieldset
                        key={field.key}
                        className="border border-slate-200 rounded-lg p-3 space-y-3"
                      >
                        <legend className="text-xs font-medium text-slate-700 px-1">
                          {field.label}
                        </legend>
                        {field.fields.map((sub) => (
                          <label key={sub.key} className="block">
                            <span className="text-xs font-medium text-slate-700 block mb-1">
                              {sub.label}
                            </span>
                            <textarea
                              rows={sub.defaultRowCount || 5}
                              value={sectionA[sub.key] || ''}
                              onChange={(e) =>
                                setSectionA((prev) => ({
                                  ...prev,
                                  [sub.key]: e.target.value,
                                }))
                              }
                              className={textareaBase}
                            />
                          </label>
                        ))}
                      </fieldset>
                    );
                  }
                  return null;
                })}
              </section>
            )}

            {/* Section B */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                {formI.sectionB.heading}
              </h3>

              {/* In view mode, the only persisted piece is the eligibility
                  status label. q1, q2, and the q3 radio + explanations are
                  all render-only. */}
              {isView ? (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <span className="text-xs font-medium text-slate-700 block mb-1">
                    Eligibility status (persisted)
                  </span>
                  <span className="text-sm text-slate-800 font-medium">
                    {persistedEligibilityLabel}
                  </span>
                </div>
              ) : (
                <>
                  {/* q1 */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">
                      {formI.sectionB.questions[0].label}
                    </p>
                    {formI.sectionB.questions[0].options.map((opt) => (
                      <div key={opt.key}>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="q1"
                            value={opt.key}
                            checked={q1Choice === opt.key}
                            onChange={(e) => setQ1Choice(e.target.value)}
                          />
                          <span className="text-sm">{opt.label}</span>
                        </label>
                        {q1Choice === opt.key && opt.followUp && (
                          <textarea
                            rows={3}
                            placeholder={opt.followUp.label}
                            value={
                              opt.key === 'yes'
                                ? q1YesDescription
                                : q1NoDescription
                            }
                            onChange={(e) =>
                              opt.key === 'yes'
                                ? setQ1YesDescription(e.target.value)
                                : setQ1NoDescription(e.target.value)
                            }
                            className={`${textareaBase} mt-1 ml-6`}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* q2 */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">
                      {formI.sectionB.questions[1].label}
                    </p>
                    <p className="text-xs text-slate-500 italic">
                      {formI.sectionB.questions[1].instruction}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                      {formI.sectionB.questions[1].options.map((opt, idx) => {
                        if (typeof opt === 'string') {
                          return (
                            <label
                              key={idx}
                              className="flex items-start gap-1 text-xs text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={activitiesChecked.has(opt)}
                                onChange={() => toggleActivity(opt)}
                                className="mt-0.5"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        }
                        // The "Other" entry: { key, label, type: 'textInput' }
                        return (
                          <label
                            key={opt.key}
                            className="flex items-start gap-1 text-xs text-slate-700 col-span-2"
                          >
                            <input
                              type="checkbox"
                              checked={activitiesChecked.has(opt.label)}
                              onChange={() => toggleActivity(opt.label)}
                              className="mt-0.5"
                            />
                            <span>{opt.label}</span>
                            <input
                              type="text"
                              value={otherActivity}
                              onChange={(e) => setOtherActivity(e.target.value)}
                              className="ml-1 px-2 py-0.5 border border-slate-200 rounded text-xs flex-1"
                            />
                          </label>
                        );
                      })}
                    </div>
                    <textarea
                      rows={
                        formI.sectionB.questions[1].followUpDescription
                          .defaultRowCount || 5
                      }
                      placeholder={
                        formI.sectionB.questions[1].followUpDescription.label
                      }
                      value={substantialLimitDescription}
                      onChange={(e) =>
                        setSubstantialLimitDescription(e.target.value)
                      }
                      className={textareaBase}
                    />
                    <p className="text-xs text-slate-500 italic">
                      {formI.sectionB.questions[1].definitionsBlock}
                    </p>
                  </div>

                  {/* q3 */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">
                      {formI.sectionB.questions[2].label}
                    </p>
                    {formI.sectionB.questions[2].options.map((opt) => (
                      <div key={opt.key}>
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name="q3"
                            value={opt.key}
                            checked={q3Choice === opt.key}
                            onChange={(e) => setQ3Choice(e.target.value)}
                            className="mt-1"
                          />
                          <span className="text-sm flex-1">{opt.label}</span>
                        </label>
                        {q3Choice === opt.key && opt.followUp && (
                          <textarea
                            rows={3}
                            placeholder={opt.followUp.label}
                            value={
                              opt.key === 'technicallyEligibleNoPlan'
                                ? technicallyEligibleExplain
                                : notEligibleExplain
                            }
                            onChange={(e) =>
                              opt.key === 'technicallyEligibleNoPlan'
                                ? setTechnicallyEligibleExplain(e.target.value)
                                : setNotEligibleExplain(e.target.value)
                            }
                            className={`${textareaBase} mt-1 ml-6`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* Meeting participants — render-only */}
            {!isView && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  {formI.meetingParticipants.heading}
                </h3>
                <p className="no-print text-xs text-slate-500 italic">
                  Render-only — appears on the printed Form I but is not stored
                  on save.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500">
                        {formI.meetingParticipants.columns.map((c) => (
                          <th key={c.key} className="py-1 pr-2 font-medium">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {participantRows.map((row, idx) => (
                        <tr key={idx} className="align-top">
                          <td className="py-1 pr-2">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) =>
                                setParticipantRowField(idx, 'name', e.target.value)
                              }
                              className={inputBase}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              type="text"
                              value={row.signature}
                              onChange={(e) =>
                                setParticipantRowField(
                                  idx,
                                  'signature',
                                  e.target.value
                                )
                              }
                              className={inputBase}
                            />
                          </td>
                          <td className="py-1 pr-2 text-center">
                            <input
                              type="checkbox"
                              checked={row.agree}
                              onChange={(e) =>
                                setParticipantRowField(
                                  idx,
                                  'agree',
                                  e.target.checked
                                )
                              }
                            />
                          </td>
                          <td className="py-1 pr-2 text-center">
                            <input
                              type="checkbox"
                              checked={row.disagree}
                              onChange={(e) =>
                                setParticipantRowField(
                                  idx,
                                  'disagree',
                                  e.target.checked
                                )
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Notice statement — static, parent-facing */}
            <p className="text-sm text-slate-600 italic">{formI.noticeStatement}</p>
          </div>
          {/* ============================================================ */}
          {/* END PRINT SCOPE                                                */}
          {/* ============================================================ */}

          {/* ============================================================ */}
          {/* STAFF-ONLY PANEL — sibling of the print scope above.          */}
          {/* Commit 5 added .no-print to this wrapper. determination_     */}
          {/* notes is staff-only per PRIVACY_REVIEW.md and the parent     */}
          {/* route family has no handler for this resource at all.        */}
          {/* The .no-print rule (display: none !important in @media       */}
          {/* print) removes this entire subtree from print layout —       */}
          {/* badge, lock icon, italic helper, AND the textarea contents. */}
          {/* ============================================================ */}
          <div data-print-section="staff-only" className="no-print">
            <div className="rounded-lg border border-slate-300 bg-slate-50">
              <button
                type="button"
                onClick={() => setStaffPanelOpen((p) => !p)}
                className="w-full flex items-center gap-2 px-4 py-2 text-left"
              >
                {staffPanelOpen ? (
                  <ChevronDown size={16} className="text-slate-600" />
                ) : (
                  <ChevronRight size={16} className="text-slate-600" />
                )}
                <Lock size={14} className="text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">
                  Determination notes
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-medium">
                  Staff only — not printed
                </span>
              </button>
              {staffPanelOpen && (
                <div className="px-4 pb-4 space-y-2">
                  <p className="text-xs text-slate-600 italic">
                    Internal eligibility reasoning, evaluator interpretations,
                    and clinical observations. This panel is for staff use only —
                    it does NOT appear on the printed Form I delivered to the
                    parent. The formal eligibility-determination notice
                    (status + date above) is the parent-facing record.
                  </p>
                  <textarea
                    rows={6}
                    value={determinationNotes}
                    onChange={(e) => setDeterminationNotes(e.target.value)}
                    disabled={isView}
                    placeholder="Eligibility reasoning, evaluator interpretations, clinical observations..."
                    className={textareaBase}
                  />
                </div>
              )}
            </div>
          </div>

          {saveError && (
            <div className="no-print flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        <div className="no-print flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            {isView ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
          >
            <Printer size={16} />
            Print
          </button>
          {!isView && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Saving…' : 'Save Form I revision'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FormIDeterminationModal;
