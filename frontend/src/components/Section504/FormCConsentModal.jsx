import { useState, useEffect } from 'react';
import { X, Save, AlertCircle, AlertTriangle } from 'lucide-react';
import { logError } from '../../utils/logError';
import { createConsent } from './api';
import { interpolateTemplate, dateToIsoTimestamp, isoTimestampToDate } from './helpers';
import { oregonOde2025 } from '../../data/504-form-sets/oregon-ode-2025';

const formC = oregonOde2025.forms.formC;

// Backend column length cap on signature_text fields (routes/student504.js
// SIGNATURE_TEXT_MAX). Mirrored on the FE input so the user is stopped
// before save rather than failing the POST.
const SIGNATURE_TEXT_MAX = 300;

// Form C — Prior Notice and Consent to Evaluate (staff-side modal).
//
// Modes:
//   - 'add'  — blank form; on save POSTs /consents (creates a new revision)
//   - 'view' — read-only render of an existing consent row; persisted DB
//             fields are hydrated; render-only fields (recipient, evaluation
//             method, contact block, etc.) stay blank because they are NOT
//             round-tripped on save (no DB column for them today). See the
//             "Form-set ↔ DB column mapping" comment block below.
//
// Auth predicates: this modal is mounted only by Section504CycleView, which
// is mounted only by Section504Tab, which short-circuits on user.role ===
// 'parent'. The /api/student-504/consents POST also refuses parent role at
// the route boundary.
//
// Tenant scoping: createConsent posts to /student-504/consents with
// cycle_id only; backend rejects cross-tenant cycle references via the
// composite (cycle_id, tenant_id) FK. tenant_id is never sent from the FE.
//
// Form-set ↔ DB column mapping (commit 2 deviation, called out in the PR):
//   form-set field                      → DB column
//   ──────────────────────────────────────────────────────────────
//   parentConsent radio choice          → consent_status
//                                          ('given' → 'granted',
//                                           'denied' → 'denied')
//   parentConsent.parentSignature       → parent_signature_text
//   parentConsent.signatureDate (date)  → parent_signature_at (ISO ts)
//   headerFields.sender (From)          → staff_signature_text
//   headerFields.date                   → staff_signature_at (ISO ts)
//
//   No DB column today; render-only (live in this modal's session, print
//   on the rendered Form C, but DO NOT round-trip on save):
//     - headerFields.recipient (To)
//     - evaluationMethods choice + assessmentsList textarea
//     - parentConsent.phoneNumber
//     - contactBlock {name, title, phone, email}
//
// The render-only set is render-only because PR #24's schema doesn't
// allocate columns for them and a backend change is out of scope for this
// branch. A future migration could add a "form_c_render_payload JSONB"
// column and the FE could promote them to round-tripping fields without
// changing this modal's UX. Tracked as a followup ("feat/504-form-c-
// render-payload-persistence").
const FormCConsentModal = ({
  API_URL,
  user,
  student,
  cycleId,
  mode,
  existingConsent,
  onClose,
  onSaved,
}) => {
  const isView = mode === 'view';

  // Render-only fields (not persisted; see comment block above).
  const [headerDate, setHeaderDate] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sender, setSender] = useState('');
  const [evaluationMethod, setEvaluationMethod] = useState('');
  const [assessmentsList, setAssessmentsList] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // Persisted fields.
  const [parentConsentChoice, setParentConsentChoice] = useState('');
  const [parentSignatureText, setParentSignatureText] = useState('');
  const [signatureDate, setSignatureDate] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Hydrate persisted fields when viewing an existing consent. Render-only
  // fields stay blank (they were never persisted); this is a known UX
  // trade-off documented in the file header.
  useEffect(() => {
    if (!isView || !existingConsent) return;
    const c = existingConsent;
    if (c.consent_status === 'granted') setParentConsentChoice('given');
    else if (c.consent_status === 'denied') setParentConsentChoice('denied');
    else setParentConsentChoice('');
    setParentSignatureText(c.parent_signature_text || '');
    setSignatureDate(isoTimestampToDate(c.parent_signature_at));
    setSender(c.staff_signature_text || '');
    setHeaderDate(isoTimestampToDate(c.staff_signature_at));
  }, [isView, existingConsent]);

  // {{studentName}} interpolation. The helper allowlists ONLY studentName
  // and districtName; anything else in the template literal is left
  // intact and surfaces as visible "{{...}}" to staff.
  const studentDisplayName = `${student?.first_name || ''} ${student?.last_name || ''}`.trim();
  const interpolatedBody = interpolateTemplate(formC.bodyText, {
    studentName: studentDisplayName,
  });

  const handleSave = async () => {
    if (isView) return;
    setSaving(true);
    setSaveError(null);
    try {
      const consentStatus =
        parentConsentChoice === 'given'
          ? 'granted'
          : parentConsentChoice === 'denied'
          ? 'denied'
          : 'pending';
      await createConsent(API_URL, {
        cycle_id: cycleId,
        consent_status: consentStatus,
        parent_signature_text: parentSignatureText || null,
        parent_signature_at: dateToIsoTimestamp(signatureDate),
        staff_signature_text: sender || null,
        staff_signature_at: dateToIsoTimestamp(headerDate),
      });
      onSaved();
    } catch (err) {
      logError('[FormCConsentModal save]', err);
      setSaveError('Could not save Form C.');
    } finally {
      setSaving(false);
    }
  };

  // Defense in depth — should never render if user is parent (route-guarded)
  if (user?.role === 'parent') return null;

  const inputBase =
    'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-slate-800">
              Form C — {formC.title}
            </h2>
            {isView && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                Read-only revision
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* View-mode banner: explains why render-only fields are hidden.
              The hidden set (recipient, evaluation method, contact block,
              parent phone) are not persisted by PR #24's schema, so they
              cannot be reproduced when re-viewing a saved revision.
              Followup branch: feat/504-form-c-render-payload-persistence */}
          {isView && (
            <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Saved revisions include only the legally-binding fields (status, signatures, dates).
              To print Form C with parent contact info and evaluation methods, add a new revision.
            </div>
          )}

          {/* Header fields */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Notice header</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-700 block mb-1">Date</span>
                <input
                  type="date"
                  value={headerDate}
                  onChange={(e) => setHeaderDate(e.target.value)}
                  disabled={isView}
                  className={inputBase}
                />
              </label>
              {/* Recipient is render-only; hidden in view mode. */}
              {!isView && (
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 block mb-1">
                    To <span className="text-slate-400 font-normal">(Parent or Student when 18+)</span>
                  </span>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className={inputBase}
                  />
                </label>
              )}
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 block mb-1">
                From <span className="text-slate-400 font-normal">(Name and Title)</span>
              </span>
              <input
                type="text"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                disabled={isView}
                maxLength={SIGNATURE_TEXT_MAX}
                className={inputBase}
              />
              <div className="mt-1 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>Parent-visible at write time.</strong> The "From" line is rendered as your
                  staff signature on the printed Form C delivered to the parent. Use your professional
                  name and title only — no internal commentary, eligibility reasoning, or other staff-only
                  content.
                </span>
              </div>
            </label>
          </section>

          {/* Body — interpolates {{studentName}} */}
          <p className="text-sm text-slate-700 leading-relaxed">{interpolatedBody}</p>

          {/* Evaluation methods — render-only; entire section hidden in view mode. */}
          {!isView && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Evaluation method</h3>
              <p className="text-xs text-slate-500 italic">
                These selections appear on the printed Form C but are not stored on save (no DB column).
              </p>
              <p className="text-sm text-slate-600">{formC.proposalLeadIn}</p>
              {formC.evaluationMethods.options.map((opt) => (
                <div key={opt.key}>
                  <label className="flex items-start gap-2 mt-2">
                    <input
                      type="radio"
                      name="evaluationMethod"
                      value={opt.key}
                      checked={evaluationMethod === opt.key}
                      onChange={(e) => setEvaluationMethod(e.target.value)}
                      className="mt-1"
                    />
                    <span className="text-sm flex-1">{opt.label}</span>
                  </label>
                  {opt.followUp && evaluationMethod === opt.key && (
                    <textarea
                      rows={opt.followUp.defaultRowCount || 5}
                      value={assessmentsList}
                      onChange={(e) => setAssessmentsList(e.target.value)}
                      className={`${inputBase} mt-2 resize-none`}
                    />
                  )}
                </div>
              ))}
              <p className="text-xs text-slate-500 mt-2">{formC.fileReviewNote}</p>
            </section>
          )}

          <p className="text-sm text-slate-600">{formC.meetingNote}</p>

          {/* Parent consent */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">{formC.parentConsent.heading}</h3>
            <p className="text-sm text-slate-600">{formC.parentConsent.voluntaryStatement}</p>
            {formC.parentConsent.options.map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 mt-1">
                <input
                  type="radio"
                  name="parentConsent"
                  value={opt.key}
                  checked={parentConsentChoice === opt.key}
                  onChange={(e) => setParentConsentChoice(e.target.value)}
                  disabled={isView}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
            <div className="grid grid-cols-3 gap-3 mt-3">
              <label className="block col-span-3 sm:col-span-1">
                <span className="text-xs font-medium text-slate-700 block mb-1">Parent/Guardian Signature</span>
                <input
                  type="text"
                  value={parentSignatureText}
                  onChange={(e) => setParentSignatureText(e.target.value)}
                  disabled={isView}
                  maxLength={SIGNATURE_TEXT_MAX}
                  className={inputBase}
                />
                <span className="text-xs text-slate-400 italic block mt-1">
                  Transcribed from the parent's wet signature, or typed by the parent during the meeting.
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-700 block mb-1">Date</span>
                <input
                  type="date"
                  value={signatureDate}
                  onChange={(e) => setSignatureDate(e.target.value)}
                  disabled={isView}
                  className={inputBase}
                />
              </label>
              {/* Phone number is render-only; hidden in view mode. */}
              {!isView && (
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 block mb-1">Phone Number</span>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className={inputBase}
                  />
                </label>
              )}
            </div>
          </section>

          {/* Contact block — render-only; entire section hidden in view mode. */}
          {!isView && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">{formC.contactBlock.label}</h3>
              <p className="text-xs text-slate-500 italic">
                These appear on the printed Form C but are not stored on save (no DB column).
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 block mb-1">Name</span>
                  <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputBase} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 block mb-1">Title</span>
                  <input type="text" value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} className={inputBase} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 block mb-1">Phone</span>
                  <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputBase} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 block mb-1">Email</span>
                  <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputBase} />
                </label>
              </div>
            </section>
          )}

          <p className="text-xs text-slate-500 italic">Enclosure: {formC.enclosure}</p>

          {saveError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            {isView ? 'Close' : 'Cancel'}
          </button>
          {!isView && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Saving…' : 'Save Form C revision'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FormCConsentModal;
