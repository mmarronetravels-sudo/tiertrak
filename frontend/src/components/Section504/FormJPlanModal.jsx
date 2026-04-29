import { useState, useEffect } from 'react';
import { X, Save, AlertCircle, AlertTriangle, Printer } from 'lucide-react';
import { logError } from '../../utils/logError';
import { createPlan } from './api';
import { dateOnlyFromBundle } from './helpers';
import { oregonOde2025 } from '../../data/504-form-sets/oregon-ode-2025';

const formJ = oregonOde2025.forms.formJ;

// Form J — Section 504 Student Accommodation Plan (staff-side modal).
//
// Modes (same convention as Form C / Form I):
//   - 'add'  — blank form; on save POSTs /plans (creates a new revision).
//   - 'view' — read-only render; persisted DB fields are hydrated;
//             render-only fields stay hidden behind a banner.
//
// Form-set ↔ DB column mapping (commit 4 deviation, called out in the PR):
//   form-set field key                                 → DB column
//   ──────────────────────────────────────────────────────────────────────
//   accommodations.domains[0] 'educational'    (textarea) → accommodations.educational     (JSONB key)
//   accommodations.domains[1] 'extracurricular'(textarea) → accommodations.extracurricular (JSONB key)
//   accommodations.domains[2] 'assessments'    (textarea) → accommodations.assessments     (JSONB key)
//   planDates.fields[2] 'dateOfInitialPlan'    (date)     → effective_date                 (DATE)
//   planDates.fields[3] 'annualPlanReviewDueDate'(date)   → review_date                    (DATE)
//
// plan_status: NOT in the form-set rendering schema; NO UI control in this
// modal. Backend (routes/student504.js POST /plans) defaults to 'draft' on
// insert via COALESCE. The parent route (routes/parent504.js GET
// /accommodations/student/:studentId) only projects plans where
// plan_status='active', so a Form J revision saved here is INVISIBLE to
// parents until a separate "activate plan" action ships in a followup
// branch (tracked Cowork-side as the "Form J plan-status workflow"
// task). This is the v1 minimum-viable choice — staff can iterate on
// accommodations without exposing draft text to parents.
//
// No DB column today; render-only (visible in mode='add' for printing,
// HIDDEN in mode='view'):
//   - studentInformationFields (all 9; Form J has its own planDates
//     section, so the studentInformationFields.meetingDate key is purely
//     decorative here and is NOT persisted as Form I's determined_at is).
//   - planDates fields[0,1,4,5] — eligibilityDeterminationDate,
//     threeYrReevaluationDueDate, currentAnnualReviewDate,
//     nextPlanReviewDueDate.
//   - medicalServices (radio + textarea). Per the inline comment in
//     frontend/src/data/504-form-sets/oregon-ode-2025.js Form J declaration:
//     "Declared in UI rendering schema only. Persistence column not added
//     in Migration 021 or Migration 022; a future migration will add it
//     when the workflow needs to store medical-services details."
//   - educationalPlacement (description + select-with-explain).
//   - teamTable (5 rows × 3 cols). 504 team membership is persisted via
//     student_504_team_members (Migration 021), but PR #24 has no POST
//     handler — this table is render-only here for printing. The
//     followup branch feat/504-team-members-add-ui covers the gap.
//   - parentConsent (signature/agree/disagree, signature fields).
//     Render-only for v1; tracked Cowork-side as a separate followup
//     ("Form J parent consent DB persistence") because the legal
//     question — whether the printed signature alone suffices or
//     whether digital persistence is required — deserves separate
//     review before committing to a column.
//
// Print-scope structure (looking ahead to commit 5):
//   <div data-print-section="form-j">      ← will gain .print-form
//     all form-set content + persisted inputs
//   </div>
// NO staff-only sibling for Form J. Every persisted column on
// student_504_plans is parent-visible per routes/parent504.js GET
// /accommodations/student/:studentId (projects accommodations,
// plan_status, effective_date, review_date for any active plan linked
// to a parent's student). Staff must NOT include staff-only commentary
// (eligibility reasoning, evaluator interpretations, other §4B-tier-
// restricted content) in any of the three accommodations textareas —
// the amber banner above the section states this rule explicitly.
// Eligibility reasoning has its own staff-only home on Form I
// (determination_notes), which is structurally isolated from any
// print scope.
//
// conditionalNotice handling: the form-set's prescriptive note ("Section
// 504 Plan complete only if eligibility determination is 'Yes, eligible
// with a 504 plan'") is rendered as a visible advisory banner in
// mode='add'. NOT enforced as a cross-form gate — staff judgment, not
// a hard FE validation. Cross-form gating (checking the cycle's latest
// eligibility_determination before allowing Form J save) is a separate
// product decision and out of scope for v1.
//
// Auth: parent role short-circuit at the top of render; parent role also
// refused at the route boundary (routes/student504.js refuseParentRole).
const FormJPlanModal = ({
  API_URL,
  user,
  cycleId,
  mode,
  existingPlan,
  onClose,
  onSaved,
}) => {
  const isView = mode === 'view';

  // Persisted fields (round-trip on save).
  const [educational, setEducational] = useState('');
  const [extracurricular, setExtracurricular] = useState('');
  const [assessments, setAssessments] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reviewDate, setReviewDate] = useState('');

  // Render-only — student information (all 9; none persisted today).
  const [studentInfoValues, setStudentInfoValues] = useState({});

  // Render-only — planDates fields[0,1,4,5] (the 4 dates that don't map
  // to effective_date or review_date). Keyed by form-set field key.
  const [planDateValues, setPlanDateValues] = useState({});

  // Render-only — medicalServices.
  const [medicalServicesChoice, setMedicalServicesChoice] = useState('');
  const [medicalServicesFollowUp, setMedicalServicesFollowUp] = useState('');

  // Render-only — educationalPlacement.
  const [placementDescription, setPlacementDescription] = useState('');
  const [placementChoice, setPlacementChoice] = useState('');
  const [placementOtherDescription, setPlacementOtherDescription] = useState('');

  // Render-only — team table (5 rows × 3 cols, same as Form I).
  const [teamRows, setTeamRows] = useState(
    Array.from({ length: formJ.teamTable.defaultRowCount || 5 }, () => ({
      name: '',
      title: '',
      knowledgeableOf: '',
    }))
  );

  // Render-only — parent consent.
  const [parentConsentChoice, setParentConsentChoice] = useState('');
  const [parentSignatureText, setParentSignatureText] = useState('');
  const [signatureDate, setSignatureDate] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Hydrate persisted fields when viewing an existing plan. Render-only
  // fields stay default-empty (never persisted).
  //
  // Date hydration uses dateOnlyFromBundle (NOT isoTimestampToDate) because
  // student_504_plans.effective_date and review_date are pg DATE columns,
  // not TIMESTAMPs. The pg driver serializes DATE as a UTC-midnight ISO
  // string; isoTimestampToDate's local-component extraction would shift
  // the calendar date back one day in any negative-offset timezone. See
  // helpers.js header for the full reasoning.
  useEffect(() => {
    if (!isView || !existingPlan) return;
    const p = existingPlan;
    const a = p.accommodations || {};
    setEducational(a.educational || '');
    setExtracurricular(a.extracurricular || '');
    setAssessments(a.assessments || '');
    setEffectiveDate(dateOnlyFromBundle(p.effective_date));
    setReviewDate(dateOnlyFromBundle(p.review_date));
  }, [isView, existingPlan]);

  const handleSave = async () => {
    if (isView) return;
    setSaving(true);
    setSaveError(null);
    try {
      // accommodations: send only the 3 domain keys that the form-set
      // declares. Backend validates object-ness only; we own the internal
      // shape contract here. Empty strings are intentional — they let a
      // parent reading via /accommodations distinguish a domain that was
      // saved blank from a domain that was never authored.
      const accommodations = {
        educational: educational || '',
        extracurricular: extracurricular || '',
        assessments: assessments || '',
      };
      await createPlan(API_URL, {
        cycle_id: cycleId,
        // plan_status omitted intentionally — backend defaults to 'draft'.
        // See file header for the v1 minimum-viable rationale.
        effective_date: effectiveDate || null,
        review_date: reviewDate || null,
        accommodations,
      });
      onSaved();
    } catch (err) {
      logError('[FormJPlanModal save]', err);
      setSaveError('Could not save Form J.');
    } finally {
      setSaving(false);
    }
  };

  if (user?.role === 'parent') return null;

  const inputBase =
    'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500';
  const textareaBase = `${inputBase} resize-none`;

  // ----- helpers for render-only field state setters -----
  const setStudentInfoField = (key, value) =>
    setStudentInfoValues((prev) => ({ ...prev, [key]: value }));
  const setPlanDateField = (key, value) =>
    setPlanDateValues((prev) => ({ ...prev, [key]: value }));
  const setTeamRowField = (idx, field, value) =>
    setTeamRows((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });

  // planDates field-key partition. Persisted keys are the two that map
  // to effective_date and review_date; everything else is render-only.
  const PERSISTED_PLAN_DATE_KEYS = new Set([
    'dateOfInitialPlan',
    'annualPlanReviewDueDate',
  ]);

  // Resolve the form-set's knowledgeableOf options once for the team
  // table dropdown. This is identical to FormIDeterminationModal — both
  // reference the same TEAM_TABLE_COLUMNS const in the form-set module.
  const knowledgeableOfOptions =
    formJ.teamTable.columns.find((c) => c.key === 'knowledgeableOf')?.options || [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-slate-800">
              Form J — {formJ.title}
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
              Saved revisions include only the legally-binding fields
              (accommodations text, plan effective date, next review date).
              To print Form J with the full student information, plan
              dates, team table, and parent consent block, add a new revision.
            </div>
          )}

          {!isView && (
            <div className="no-print text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <strong>Note:</strong> {formJ.conditionalNotice}
            </div>
          )}

          {/* ============================================================ */}
          {/* PRINT SCOPE — single sibling. Form J has no staff-only       */}
          {/* content; every persisted column on student_504_plans is      */}
          {/* parent-visible via routes/parent504.js GET                    */}
          {/* /accommodations/student/:studentId. Commit 5 added            */}
          {/* .print-form to this wrapper.                                  */}
          {/* ============================================================ */}
          <div data-print-section="form-j" className="print-form space-y-6">
            {/* Student information — all render-only on Form J */}
            {!isView && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">
                  Student Information
                </h3>
                <p className="no-print text-xs text-slate-500 italic">
                  These fields appear on the printed Form J but are not
                  stored on save (no DB column). Plan effective date and
                  next review date are persisted in the Plan Dates section
                  below.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {formJ.studentInformationFields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="text-xs font-medium text-slate-700 block mb-1">
                        {f.label}
                      </span>
                      <input
                        type={f.type === 'date' ? 'date' : 'text'}
                        value={studentInfoValues[f.key] || ''}
                        onChange={(e) =>
                          setStudentInfoField(f.key, e.target.value)
                        }
                        className={inputBase}
                      />
                    </label>
                  ))}
                </div>
              </section>
            )}

            {/* Plan dates — 6 form-set fields; 2 persisted, 4 render-only */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                {formJ.planDates.heading}
              </h3>
              {!isView && (
                <p className="no-print text-xs text-slate-500 italic">
                  Date of Initial Plan and Annual Plan Review Due Date are
                  persisted on save (effective_date and review_date columns
                  on student_504_plans). The other four dates appear on the
                  printed Form J but are not stored.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {formJ.planDates.fields.map((f) => {
                  const isPersisted = PERSISTED_PLAN_DATE_KEYS.has(f.key);
                  // Render-only fields are hidden in view mode (banner above
                  // explains the omission). Persisted fields show in both
                  // modes with the value bound to the appropriate state.
                  if (!isPersisted && isView) return null;
                  if (f.key === 'dateOfInitialPlan') {
                    return (
                      <label key={f.key} className="block">
                        <span className="text-xs font-medium text-slate-700 block mb-1">
                          {f.label}
                        </span>
                        <input
                          type="date"
                          value={effectiveDate}
                          onChange={(e) => setEffectiveDate(e.target.value)}
                          disabled={isView}
                          className={inputBase}
                        />
                      </label>
                    );
                  }
                  if (f.key === 'annualPlanReviewDueDate') {
                    return (
                      <label key={f.key} className="block">
                        <span className="text-xs font-medium text-slate-700 block mb-1">
                          {f.label}
                        </span>
                        <input
                          type="date"
                          value={reviewDate}
                          onChange={(e) => setReviewDate(e.target.value)}
                          disabled={isView}
                          className={inputBase}
                        />
                      </label>
                    );
                  }
                  return (
                    <label key={f.key} className="block">
                      <span className="text-xs font-medium text-slate-700 block mb-1">
                        {f.label}
                      </span>
                      <input
                        type="date"
                        value={planDateValues[f.key] || ''}
                        onChange={(e) =>
                          setPlanDateField(f.key, e.target.value)
                        }
                        className={inputBase}
                      />
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Accommodations — 3 textareas, persisted as JSONB */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                {formJ.accommodations.heading}
              </h3>
              <p className="text-sm text-slate-600">
                {formJ.accommodations.instruction}
              </p>
              {!isView && (
                <div className="no-print flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>Parent-visible at write time.</strong> The
                    accommodations text below is rendered for parents via
                    the parent portal once this plan is activated. Use
                    accommodations language only — no internal commentary,
                    eligibility reasoning, or other staff-only content.
                  </span>
                </div>
              )}
              {formJ.accommodations.domains.map((d) => {
                const value =
                  d.key === 'educational' ? educational :
                  d.key === 'extracurricular' ? extracurricular :
                  assessments;
                const setter =
                  d.key === 'educational' ? setEducational :
                  d.key === 'extracurricular' ? setExtracurricular :
                  setAssessments;
                return (
                  <label key={d.key} className="block">
                    <span className="text-xs font-medium text-slate-700 block mb-1">
                      {d.label}
                    </span>
                    <textarea
                      rows={d.defaultRowCount || 5}
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      disabled={isView}
                      className={textareaBase}
                    />
                  </label>
                );
              })}
            </section>

            {/* Medical services — render-only.
                Per oregon-ode-2025.js formJ.medicalServices inline note:
                "Declared in UI rendering schema only. Persistence column
                not added in Migration 021 or Migration 022; a future
                migration will add it when the workflow needs to store
                medical-services details." */}
            {!isView && (
              <section className="space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  {formJ.medicalServices.label}
                </p>
                <p className="no-print text-xs text-slate-500 italic">
                  Render-only — appears on the printed Form J but is not
                  stored on save (no DB column).
                </p>
                {formJ.medicalServices.options.map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="medicalServices"
                      value={opt.key}
                      checked={medicalServicesChoice === opt.key}
                      onChange={(e) =>
                        setMedicalServicesChoice(e.target.value)
                      }
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
                {medicalServicesChoice === 'yes' && (
                  <label className="block mt-2">
                    <span className="text-xs font-medium text-slate-700 block mb-1">
                      {formJ.medicalServices.followUp.label}
                    </span>
                    <textarea
                      rows={
                        formJ.medicalServices.followUp.defaultRowCount || 5
                      }
                      value={medicalServicesFollowUp}
                      onChange={(e) =>
                        setMedicalServicesFollowUp(e.target.value)
                      }
                      className={textareaBase}
                    />
                  </label>
                )}
              </section>
            )}

            {/* Educational placement — render-only.
                Per the same form-set rationale as medicalServices: declared
                in the rendering schema for printing, no DB column allocated
                in Migration 021 or Migration 022. */}
            {!isView && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">
                  {formJ.educationalPlacement.heading}
                </h3>
                <p className="no-print text-xs text-slate-500 italic">
                  Render-only — appears on the printed Form J but is not
                  stored on save.
                </p>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 block mb-1">
                    {formJ.educationalPlacement.description.label}
                  </span>
                  <textarea
                    rows={
                      formJ.educationalPlacement.description.defaultRowCount || 5
                    }
                    value={placementDescription}
                    onChange={(e) => setPlacementDescription(e.target.value)}
                    className={textareaBase}
                  />
                </label>
                {formJ.educationalPlacement.options.choices.map((c) => (
                  <div key={c.key}>
                    <label className="flex items-start gap-2 mt-1">
                      <input
                        type="radio"
                        name="placement"
                        value={c.key}
                        checked={placementChoice === c.key}
                        onChange={(e) => setPlacementChoice(e.target.value)}
                        className="mt-1"
                      />
                      <span className="text-sm flex-1">{c.label}</span>
                    </label>
                    {placementChoice === c.key && c.followUp && (
                      <textarea
                        rows={3}
                        value={placementOtherDescription}
                        onChange={(e) =>
                          setPlacementOtherDescription(e.target.value)
                        }
                        className={`${textareaBase} mt-1 ml-6`}
                      />
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* Team table — render-only. 504 team membership has its own
                schema (student_504_team_members from Migration 021), but
                PR #24 has no POST handler and the cycle-bundle response's
                team_members array is read-only here. */}
            {!isView && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  {formJ.teamTable.heading}
                </h3>
                <p className="no-print text-xs text-slate-500 italic">
                  Render-only — appears on the printed Form J but is not
                  stored on save (504 team membership has its own
                  student_504_team_members table; no POST handler in PR #24).
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500">
                        {formJ.teamTable.columns.map((c) => (
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
                                setTeamRowField(
                                  idx,
                                  'knowledgeableOf',
                                  e.target.value
                                )
                              }
                              className={inputBase}
                            >
                              <option value="">—</option>
                              {knowledgeableOfOptions.map((opt) => (
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

            {/* Parent consent — render-only.
                Form J's parent consent is intentionally NOT persisted in v1.
                Tracked Cowork-side as "Form J parent consent DB persistence" —
                the legal question (whether the printed signature alone is
                sufficient or whether digital persistence is required for
                FERPA/§504 audit trails) deserves separate review before a
                column is added. */}
            {!isView && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  {formJ.parentConsent.heading}
                </h3>
                <p className="no-print text-xs text-slate-500 italic">
                  {formJ.parentConsent.helpText} · Render-only — appears
                  on the printed Form J but is not stored on save (no DB
                  column).
                </p>
                {formJ.parentConsent.options.map((opt) => (
                  <label key={opt.key} className="flex items-start gap-2 mt-1">
                    <input
                      type="radio"
                      name="parentConsentJ"
                      value={opt.key}
                      checked={parentConsentChoice === opt.key}
                      onChange={(e) => setParentConsentChoice(e.target.value)}
                      className="mt-1"
                    />
                    <span className="text-sm flex-1">{opt.label}</span>
                  </label>
                ))}
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700 block mb-1">
                      Parent/Guardian Signature
                    </span>
                    <input
                      type="text"
                      value={parentSignatureText}
                      onChange={(e) =>
                        setParentSignatureText(e.target.value)
                      }
                      className={inputBase}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700 block mb-1">
                      Date
                    </span>
                    <input
                      type="date"
                      value={signatureDate}
                      onChange={(e) => setSignatureDate(e.target.value)}
                      className={inputBase}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700 block mb-1">
                      Phone Number
                    </span>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className={inputBase}
                    />
                  </label>
                </div>
              </section>
            )}
          </div>
          {/* ============================================================ */}
          {/* END PRINT SCOPE                                                */}
          {/* ============================================================ */}

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
              {saving ? 'Saving…' : 'Save Form J revision'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FormJPlanModal;
