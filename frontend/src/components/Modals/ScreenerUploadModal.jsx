import { useState, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';

// Slice D (H-11): file-based two-step screener upload.
//   configure  → pick a CSV + set assessment_type/subject/period/year
//   review     → POST /upload/validate (dry-run): counts + ROW-NUMBER lists
//                (no student names, §4B), Confirm gated on validationErrors
//   done       → POST /upload/commit: matched-only persistence summary
// Auth + CSRF + multipart are owned by apiFetch (credentials:'include',
// X-CSRF-Token from the csrf_token cookie, Content-Type stripped for FormData).

const SCHOOL_YEARS = ['2025-2026', '2026-2027', '2024-2025'];
const PERIODS = ['Fall', 'Winter', 'Spring'];
const SUBJECTS = ['Reading', 'Math', 'Early Literacy'];

const TEAL = '#0D4F4F';

function Stat({ label, value, tone }) {
  const tones = {
    good: { bg: '#DCFCE7', text: '#166534', border: '#86EFAC' },
    warn: { bg: '#FEF9C3', text: '#854D0E', border: '#FDE047' },
    bad: { bg: '#FEE2E2', text: '#991B1B', border: '#FECACA' },
    info: { bg: '#E8F4F4', text: TEAL, border: '#AADDDD' },
  };
  const c = tones[tone] || tones.info;
  return (
    <div className="rounded p-3 flex flex-col" style={{ background: c.bg, border: '1px solid ' + c.border }}>
      <span className="text-2xl font-bold" style={{ color: c.text }}>{value}</span>
      <span className="text-xs font-medium" style={{ color: c.text }}>{label}</span>
    </div>
  );
}

// App.jsx still passes user / tenantId props (call site unchanged); they are
// not needed here — the backend derives tenant from the auth cookie — so they
// are intentionally not destructured.
export default function ScreenerUploadModal({ onClose, API_URL, onUploadComplete }) {
  const [step, setStep] = useState('configure'); // configure | review | done
  const [busy, setBusy] = useState(false);
  const [assessmentType, setAssessmentType] = useState('STAR');
  const [schoolYear, setSchoolYear] = useState('2025-2026');
  const [screeningPeriod, setScreeningPeriod] = useState('Fall');
  const [subject, setSubject] = useState('Reading');
  const [file, setFile] = useState(null);
  const [validateResult, setValidateResult] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const buildFormData = () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('assessmentType', assessmentType);
    fd.append('subject', subject);
    fd.append('screeningPeriod', screeningPeriod);
    fd.append('schoolYear', schoolYear);
    return fd;
  };

  async function postStep(path) {
    const res = await apiFetch(API_URL + path, { method: 'POST', body: buildFormData() });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    return { res, data };
  }

  async function handleValidate() {
    if (!file) { setError('Choose a CSV file first.'); return; }
    setBusy(true); setError('');
    try {
      const { res, data } = await postStep('/screener-results/upload/validate');
      // Static backend strings: 413 too big, 415 non-CSV, 400 header/cap,
      // 401/403 auth. None carry PII.
      if (!res.ok) { setError(data.error || 'Validation failed. Please try again.'); return; }
      setValidateResult(data);
      setStep('review');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setBusy(true); setError('');
    try {
      const { res, data } = await postStep('/screener-results/upload/commit');
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(data.errors)) {
          // Row-level errors — surface them back on review and block Confirm.
          setValidateResult((prev) => ({
            ...(prev || {}),
            errors: data.errors,
            summary: { ...((prev && prev.summary) || {}), validationErrors: data.errors.length },
          }));
          setError(data.error || 'Import rejected — fix the flagged rows and re-validate.');
          setStep('review');
        } else {
          setError(data.error || 'Import failed. Please try again.');
        }
        return;
      }
      setCommitResult(data);
      setStep('done');
      if (onUploadComplete) onUploadComplete(screeningPeriod, schoolYear, subject);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function resetToConfigure() {
    setStep('configure');
    setValidateResult(null);
    setError('');
  }

  const summary = (validateResult && validateResult.summary) || {};
  const validationErrors = summary.validationErrors || 0;
  const rowErrors = (validateResult && validateResult.errors) || [];
  const unmatchedRows = (validateResult && validateResult.unmatchedRows) || [];
  const ambiguousRows = (validateResult && validateResult.ambiguousRows) || [];
  const confirmBlocked = busy || validationErrors > 0;

  const cSummary = (commitResult && commitResult.summary) || {};
  const cUnmatched = (commitResult && commitResult.unmatchedRows) || [];
  const cAmbiguous = (commitResult && commitResult.ambiguousRows) || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-screen overflow-y-auto">

        <div className="flex justify-between items-center p-6 border-b" style={{ background: TEAL }}>
          <div>
            <h2 className="text-xl font-bold text-white">Upload Screener Data</h2>
            <p className="text-sm mt-1" style={{ color: '#AADDDD' }}>
              {assessmentType === 'MAP' ? 'MAP (NWEA) CSV Import' : 'STAR Assessment CSV Import'}
            </p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 text-2xl">&times;</button>
        </div>

        <div className="p-6">

          {/* STEP 1 — configure */}
          {step === 'configure' && (
            <div>
              <div className="grid grid-cols-4 gap-3 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Screener</label>
                  <select value={assessmentType} onChange={e => setAssessmentType(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    <option value="STAR">STAR</option>
                    <option value="MAP">MAP (NWEA)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">School Year</label>
                  <select value={schoolYear} onChange={e => setSchoolYear(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {SCHOOL_YEARS.map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                  <select value={screeningPeriod} onChange={e => setScreeningPeriod(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {PERIODS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <select value={subject} onChange={e => setSubject(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {SUBJECTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-2">
                  {assessmentType === 'MAP'
                    ? 'Export from MAP Growth (Class Profile → Download .CSV), then upload here'
                    : 'Export from Renaissance STAR, then upload here'}
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  {assessmentType === 'MAP'
                    ? 'Accepts the MAP Growth Class Profile CSV export (max 5 MB)'
                    : 'Accepts standard STAR CSV export format (max 5 MB)'}
                </p>
                <input ref={fileRef} type="file" accept=".csv"
                  onChange={e => { setFile(e.target.files[0] || null); setError(''); }}
                  className="hidden" />
                <button onClick={() => fileRef.current.click()}
                  className="px-4 py-2 rounded text-white text-sm font-medium" style={{ background: '#0E7C7B' }}>
                  Choose CSV File
                </button>
                {file && <p className="mt-3 text-sm text-gray-700">Selected: {file.name}</p>}
              </div>

              {error && <p className="mt-3 text-red-600 text-sm">{error}</p>}

              <div className="flex justify-end mt-4">
                <button onClick={handleValidate} disabled={!file || busy}
                  className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-50"
                  style={{ background: TEAL }}>
                  {busy ? 'Validating…' : 'Validate'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — review (dry-run summary: counts + row numbers, NO names) */}
          {step === 'review' && (
            <div>
              <div className="rounded p-4 mb-4" style={{ background: '#E8F4F4' }}>
                <p className="font-semibold text-sm" style={{ color: TEAL }}>
                  Dry run — review before importing. {assessmentType} · {subject} · {screeningPeriod} {schoolYear}
                </p>
                <p className="text-xs text-gray-600 mt-1">Nothing has been saved yet.</p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <Stat label="Total rows" value={summary.totalRows ?? 0} tone="info" />
                <Stat label="Will be saved (matched)" value={summary.matched ?? 0} tone="good" />
                <Stat label="Already on file (will update)" value={summary.alreadyExists ?? 0} tone="info" />
                <Stat label="Unmatched" value={summary.unmatched ?? 0} tone="warn" />
                <Stat label="Ambiguous name" value={summary.ambiguous ?? 0} tone="warn" />
                <Stat label="Validation errors" value={validationErrors} tone={validationErrors ? 'bad' : 'good'} />
              </div>

              {validationErrors > 0 && (
                <div className="rounded p-4 mb-3" style={{ background: '#FEE2E2', border: '1px solid #FECACA' }}>
                  <p className="font-semibold text-sm text-red-800 mb-1">
                    Fix these rows in your file, then re-validate:
                  </p>
                  <ul className="text-sm text-red-700 list-disc ml-5">
                    {rowErrors.slice(0, 20).map((e, i) => (
                      <li key={i}>Row {e.row}: {e.error}</li>
                    ))}
                    {rowErrors.length > 20 && <li>…and {rowErrors.length - 20} more</li>}
                  </ul>
                </div>
              )}

              {unmatchedRows.length > 0 && (
                <div className="rounded p-3 mb-3" style={{ background: '#FEF9C3', border: '1px solid #FDE047' }}>
                  <p className="text-sm text-yellow-800">
                    <span className="font-semibold">{unmatchedRows.length} row(s) won’t be saved</span> — no matching
                    student. Rows: {unmatchedRows.join(', ')}. Add the student (or a SIS ID) and re-upload.
                  </p>
                </div>
              )}

              {ambiguousRows.length > 0 && (
                <div className="rounded p-3 mb-3" style={{ background: '#FEF9C3', border: '1px solid #FDE047' }}>
                  <p className="text-sm text-yellow-800">
                    <span className="font-semibold">{ambiguousRows.length} row(s) won’t be saved</span> — the name
                    matches more than one student. Rows: {ambiguousRows.join(', ')}. Add a SIS ID to disambiguate and re-upload.
                  </p>
                </div>
              )}

              {error && <p className="mb-3 text-red-600 text-sm">{error}</p>}

              <div className="flex justify-end gap-3">
                <button onClick={resetToConfigure}
                  className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">
                  Back
                </button>
                <button onClick={handleCommit} disabled={confirmBlocked}
                  className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-50"
                  style={{ background: TEAL }}>
                  {busy ? 'Importing…' : `Confirm Import (${summary.matched ?? 0})`}
                </button>
              </div>
              {validationErrors > 0 && (
                <p className="text-xs text-gray-500 mt-2 text-right">
                  Confirm is disabled until every row error is fixed.
                </p>
              )}
            </div>
          )}

          {/* STEP 3 — done (commit summary) */}
          {step === 'done' && commitResult && (
            <div>
              <div className="rounded p-4 mb-4" style={{ background: '#DCFCE7', border: '1px solid #86EFAC' }}>
                <p className="font-semibold" style={{ color: '#166534' }}>
                  ✓ Import complete — {cSummary.saved ?? 0} records saved
                </p>
                <p className="text-sm mt-1" style={{ color: '#166534' }}>
                  {cSummary.matched ?? 0} students matched and linked.
                </p>
              </div>

              {(cUnmatched.length > 0 || cAmbiguous.length > 0) && (
                <div className="rounded p-4 mb-4" style={{ background: '#FEF9C3', border: '1px solid #FDE047' }}>
                  <p className="font-semibold text-sm text-yellow-800">
                    {cUnmatched.length + cAmbiguous.length} row(s) were not linked and were not saved:
                  </p>
                  {cUnmatched.length > 0 && (
                    <p className="text-sm text-yellow-700 mt-1">Unmatched rows: {cUnmatched.join(', ')}</p>
                  )}
                  {cAmbiguous.length > 0 && (
                    <p className="text-sm text-yellow-700 mt-1">Ambiguous-name rows: {cAmbiguous.join(', ')}</p>
                  )}
                  <p className="text-xs text-yellow-600 mt-1">
                    Add these students (or a SIS ID) in ScholarPath, then re-upload to link their screener records.
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={onClose}
                  className="px-4 py-2 rounded text-white text-sm" style={{ background: TEAL }}>
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
