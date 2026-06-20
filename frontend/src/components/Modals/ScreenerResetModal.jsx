import { useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';

// Scoped screener-data RESET (feat/screener-data-reset). Admin-only control to
// hard-delete the screener_results for one (schoolYear · period · subject
// [· assessment_type]) batch so it can be re-uploaded cleanly.
//
//   configure → pick scope; optional assessment_type narrowing
//   preview   → POST /reset/preview returns { count } (no names/ids, §4B)
//   done      → typed "DELETE" confirmation gates POST /reset → { deletedCount }
//
// Auth + CSRF are owned by apiFetch (credentials:'include', X-CSRF-Token).
// The backend resolves the tenant from the auth cookie; this modal sends no
// tenant id. Field names match the backend (schoolYear/screeningPeriod/subject/
// assessmentType); assessment_type is omitted when "All" so the reset spans the
// whole batch (backend stores NULL).

const SCHOOL_YEARS = ['2025-2026', '2026-2027', '2024-2025'];
const PERIODS = ['Fall', 'Winter', 'Spring'];
const SUBJECTS = ['Reading', 'Math', 'Early Literacy'];
const ASSESSMENT_TYPES = ['STAR']; // "All" is the empty default

const DANGER = '#991B1B';
const CONFIRM_WORD = 'DELETE';

export default function ScreenerResetModal({ onClose, API_URL, onResetComplete, initialScope }) {
  const [step, setStep] = useState('configure'); // configure | preview | done
  const [busy, setBusy] = useState(false);
  const [schoolYear, setSchoolYear] = useState((initialScope && initialScope.schoolYear) || '2025-2026');
  const [screeningPeriod, setScreeningPeriod] = useState((initialScope && initialScope.period) || 'Fall');
  const [subject, setSubject] = useState((initialScope && initialScope.subject) || 'Reading');
  const [assessmentType, setAssessmentType] = useState(''); // '' = all assessment types
  const [previewCount, setPreviewCount] = useState(null);
  const [deletedCount, setDeletedCount] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  // Any scope-field edit invalidates a prior preview: clear the count and the
  // typed confirmation so a stale count can never be acted on. This forces a
  // re-preview before the typed-DELETE path can reopen. Defense-in-depth on top
  // of the step separation (scope fields render only on 'configure'); keeps the
  // invariant true even if the layout later lets scope be edited post-preview.
  function changeScope(setter) {
    return (e) => {
      setter(e.target.value);
      setPreviewCount(null);
      setConfirmText('');
      setError('');
    };
  }

  function scopeBody() {
    const body = { schoolYear, screeningPeriod, subject };
    if (assessmentType) body.assessmentType = assessmentType; // omit when "All"
    return body;
  }

  async function postJson(path) {
    const res = await apiFetch(API_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scopeBody()),
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    return { res, data };
  }

  async function handlePreview() {
    setBusy(true); setError('');
    try {
      const { res, data } = await postJson('/screener-results/reset/preview');
      if (!res.ok) { setError(data.error || 'Preview failed. Please try again.'); return; }
      setPreviewCount(data.count);
      setConfirmText('');
      setStep('preview');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true); setError('');
    try {
      const { res, data } = await postJson('/screener-results/reset');
      if (!res.ok) { setError(data.error || 'Reset failed. Please try again.'); return; }
      setDeletedCount(data.deletedCount);
      setStep('done');
      if (onResetComplete) onResetComplete({ schoolYear, period: screeningPeriod, subject });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function backToConfigure() {
    setStep('configure');
    setPreviewCount(null);
    setConfirmText('');
    setError('');
  }

  const scopeLabel = `${assessmentType || 'All assessments'} · ${subject} · ${screeningPeriod} ${schoolYear}`;
  const confirmReady = confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl mx-4 max-h-screen overflow-y-auto">

        <div className="flex justify-between items-center p-6 border-b" style={{ background: DANGER }}>
          <div>
            <h2 className="text-xl font-bold text-white">Reset Screener Data</h2>
            <p className="text-sm mt-1" style={{ color: '#FECACA' }}>Permanently delete a screener batch so it can be re-uploaded</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 text-2xl">&times;</button>
        </div>

        <div className="p-6">

          {/* STEP 1 — configure scope */}
          {step === 'configure' && (
            <div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">School Year</label>
                  <select value={schoolYear} onChange={changeScope(setSchoolYear)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {SCHOOL_YEARS.map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                  <select value={screeningPeriod} onChange={changeScope(setScreeningPeriod)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {PERIODS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <select value={subject} onChange={changeScope(setSubject)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {SUBJECTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assessment (optional)</label>
                  <select value={assessmentType} onChange={changeScope(setAssessmentType)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    <option value="">All assessment types</option>
                    {ASSESSMENT_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="rounded p-3 mb-4" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p className="text-sm text-red-800">
                  This will permanently delete the screener records matching the scope above for your school.
                  Preview the count before anything is deleted.
                </p>
              </div>

              {error && <p className="mb-3 text-red-600 text-sm">{error}</p>}

              <div className="flex justify-end gap-3">
                <button onClick={onClose}
                  className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={handlePreview} disabled={busy}
                  className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-50"
                  style={{ background: DANGER }}>
                  {busy ? 'Checking…' : 'Preview count'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — preview + typed confirmation */}
          {step === 'preview' && (
            <div>
              <div className="rounded p-4 mb-4" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p className="text-sm text-gray-700">Scope: <span className="font-semibold">{scopeLabel}</span></p>
                <p className="mt-2 text-3xl font-bold" style={{ color: DANGER }}>{previewCount}</p>
                <p className="text-sm text-red-800">record(s) will be permanently deleted.</p>
              </div>

              {previewCount === 0 ? (
                <p className="text-sm text-gray-600 mb-4">
                  Nothing matches this scope — there is nothing to delete.
                </p>
              ) : (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Type <span className="font-bold">{CONFIRM_WORD}</span> to confirm
                  </label>
                  <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm" placeholder={CONFIRM_WORD} autoFocus />
                </div>
              )}

              {error && <p className="mb-3 text-red-600 text-sm">{error}</p>}

              <div className="flex justify-end gap-3">
                <button onClick={backToConfigure}
                  className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">
                  Back
                </button>
                <button onClick={handleDelete} disabled={previewCount === 0 || !confirmReady}
                  className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-50"
                  style={{ background: DANGER }}>
                  {busy ? 'Deleting…' : `Delete ${previewCount} record(s)`}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — done */}
          {step === 'done' && (
            <div>
              <div className="rounded p-4 mb-4" style={{ background: '#DCFCE7', border: '1px solid #86EFAC' }}>
                <p className="font-semibold" style={{ color: '#166534' }}>
                  ✓ Reset complete — {deletedCount} record(s) deleted
                </p>
                <p className="text-sm mt-1" style={{ color: '#166534' }}>
                  {scopeLabel} can now be re-uploaded cleanly.
                </p>
              </div>
              <div className="flex justify-end">
                <button onClick={onClose}
                  className="px-4 py-2 rounded text-white text-sm" style={{ background: '#0D4F4F' }}>
                  Done
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
