import { useState, useEffect, useRef } from 'react';
import { X, ArrowLeft, ArrowRight, CheckCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { logError } from '../../utils/logError';
import { detectPII } from '../../utils/piiDetection';

// The three score-radio labels come verbatim from the Tier 1 v5 spec.
const RADIO_LABELS = { 0: 'Not in place', 1: 'Partially in place', 2: 'Fully in place' };

// Minimal http(s) URL validator for the Evidence link field. Matches the
// backend PATCH check; keeps the UX consistent with what the server accepts.
const isValidUrl = (v) => {
  if (v == null || v === '') return true;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
};

// Small helper: build a map from the backend responses array so item-level
// lookups are O(1). The frontend treats this map as the source of truth
// for what's been answered; server is kept in sync via onBlur PATCHes.
const responsesToMap = (list) => {
  const m = {};
  for (const r of (list || [])) m[r.item_id] = r;
  return m;
};

const Tier1AssessmentModal = ({ user, API_URL, mode, assessmentId: initialAssessmentId, onClose }) => {
  // --- Core state ---------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(null);

  const [itemBank, setItemBank] = useState(null);        // { item_bank_version, domains, items }
  const [assessment, setAssessment] = useState(null);     // full assessment row
  const [responses, setResponses] = useState({});         // itemId -> response row

  // Which domain-step we're on (0-indexed into itemBank.domains).
  const [stepIndex, setStepIndex] = useState(0);

  // Header save-status badge: 'idle' | 'saving' | 'saved' | 'error'
  const [saveStatus, setSaveStatus] = useState('idle');
  const savedResetRef = useRef(null);
  // In-flight PATCH counter — the 'saving' badge is shown while > 0.
  const inflightRef = useRef(0);

  // Per-field save failures. Shape: { [itemId]: { score?: true, evidence_url?: true, notes?: true } }
  // The value to retry always comes from `responses` (or `drafts` if the
  // user has typed more since the failure) — we don't cache payloads.
  const [saveErrors, setSaveErrors] = useState({});

  // Draft text inputs keep local state so typing stays smooth; onBlur fires
  // the PATCH. Shape: { [itemId]: { evidence_url?: string, notes?: string } }
  const [drafts, setDrafts] = useState({});

  // Which anchor blocks are expanded. Set<itemId>.
  const [anchorsOpen, setAnchorsOpen] = useState(new Set());

  // Complete button state
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(null);

  // --- Boot ---------------------------------------------------------------
  useEffect(() => {
    const boot = async () => {
      try {
        setLoading(true);
        setBootError(null);

        // Two independent fetches in parallel: the item bank (static) and
        // either the newly-created or existing assessment.
        const itemBankPromise = fetch(`${API_URL}/tier1-assessments/item-bank`, {
          credentials: 'include'
        }).then(r => {
          if (!r.ok) throw new Error('Could not load item bank');
          return r.json();
        });

        const assessmentPromise = (async () => {
          if (mode === 'resume' && initialAssessmentId) {
            const r = await fetch(`${API_URL}/tier1-assessments/${initialAssessmentId}`, {
              credentials: 'include'
            });
            if (!r.ok) throw new Error('Could not load assessment');
            return r.json();
          }
          // 'start' mode (or fallback). POST to create. If 409, the backend
          // tells us the existing in_progress_id in the body and we GET it.
          const r = await fetch(`${API_URL}/tier1-assessments`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
          });
          if (r.status === 409) {
            const body = await r.json();
            const existingId = body && body.in_progress_id;
            if (!existingId) throw new Error('Could not load existing in-progress assessment');
            const g = await fetch(`${API_URL}/tier1-assessments/${existingId}`, {
              credentials: 'include'
            });
            if (!g.ok) throw new Error('Could not load existing in-progress assessment');
            return g.json();
          }
          if (r.status === 201) return r.json();
          throw new Error('Could not start assessment');
        })();

        const [bank, assess] = await Promise.all([itemBankPromise, assessmentPromise]);
        setItemBank(bank);
        setAssessment(assess.assessment);
        setResponses(responsesToMap(assess.responses));
      } catch (err) {
        logError('[tier1 modal boot]', err);
        setBootError(err.message || 'Failed to load the assessment');
      } finally {
        setLoading(false);
      }
    };
    boot();
    // boot only runs on mount; props are snapshotted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Save mechanics -----------------------------------------------------
  // noteSaving/noteSaved manage the header badge with a 1200ms "Saved" flash.
  const noteSaving = () => {
    inflightRef.current += 1;
    setSaveStatus('saving');
    if (savedResetRef.current) { clearTimeout(savedResetRef.current); savedResetRef.current = null; }
  };
  const noteDone = (ok) => {
    inflightRef.current = Math.max(0, inflightRef.current - 1);
    if (inflightRef.current > 0) return;
    if (ok) {
      setSaveStatus('saved');
      savedResetRef.current = setTimeout(() => setSaveStatus('idle'), 1200);
    } else {
      setSaveStatus('error');
    }
  };

  const recordError = (itemId, field) => {
    setSaveErrors(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), [field]: true }
    }));
  };

  const clearError = (itemId, field) => {
    setSaveErrors(prev => {
      const forItem = prev[itemId];
      if (!forItem || !forItem[field]) return prev;
      const rest = { ...forItem };
      delete rest[field];
      const next = { ...prev };
      if (Object.keys(rest).length === 0) delete next[itemId];
      else next[itemId] = rest;
      return next;
    });
  };

  // Core autosave: PATCH /:id/responses/:itemId with one field. Callers
  // must update the local `responses` map first (so the UI stays pinned to
  // the attempted value whether the PATCH succeeds or fails). The backend's
  // returned row then replaces that entry to stay aligned with server truth.
  const saveResponse = async (itemId, field, value) => {
    if (!assessment || assessment.status !== 'in_progress') return;
    noteSaving();
    clearError(itemId, field);
    try {
      const res = await fetch(
        `${API_URL}/tier1-assessments/${assessment.id}/responses/${itemId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value })
        }
      );
      if (!res.ok) throw new Error(`PATCH ${field} failed: ${res.status}`);
      const data = await res.json();
      setResponses(prev => ({ ...prev, [itemId]: data.response }));
      noteDone(true);
    } catch (err) {
      logError('[tier1 saveResponse]', err);
      recordError(itemId, field);
      noteDone(false);
    }
  };

  // --- Field handlers -----------------------------------------------------
  const handleScoreChange = (itemId, score) => {
    if (!assessment || assessment.status !== 'in_progress') return;
    // Optimistic: the radio reflects the attempted value immediately and
    // stays there even if the PATCH fails (retry indicator is the recovery).
    setResponses(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), item_id: itemId, score }
    }));
    saveResponse(itemId, 'score', score);
  };

  // setDraft also clears any stale save-error for this field — the user's
  // new keystroke supersedes the previous failed-save state.
  const setDraft = (itemId, field, value) => {
    setDrafts(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), [field]: value }
    }));
    clearError(itemId, field);
  };

  // Unified blur/retry core for URL + Notes. Reads the per-item draft,
  // validates (URL only), mirrors the value into the responses map
  // optimistically so the textarea keeps the user's typed text visible
  // whether the PATCH succeeds or fails, clears the draft, then fires
  // the PATCH. Returns true if a PATCH was fired.
  const saveFieldFromDraft = (itemId, field) => {
    const draftVal = (drafts[itemId] || {})[field];
    if (draftVal === undefined) return false;
    const currentResponseVal = (responses[itemId] || {})[field] ?? null;
    const sendValue = draftVal === '' ? null : draftVal;
    // No-op if the draft matches what's already in responses (an
    // unchanged value from an idle focus/blur round-trip).
    if ((currentResponseVal ?? null) === (sendValue ?? null)) {
      setDraft(itemId, field, undefined);
      return false;
    }
    // Client-side URL validation: stays in-draft (red border + inline
    // message) until the user corrects it. No PATCH, no retry indicator.
    if (field === 'evidence_url' && !isValidUrl(draftVal)) {
      return false;
    }
    // Optimistic mirror → draft clear → PATCH. The optimistic write is
    // what fixes the "text flashes to old server value" bug on slow/failed
    // PATCHes.
    setResponses(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), item_id: itemId, [field]: sendValue }
    }));
    setDraft(itemId, field, undefined);
    saveResponse(itemId, field, sendValue);
    return true;
  };

  const handleUrlBlur = (itemId) => { saveFieldFromDraft(itemId, 'evidence_url'); };

  // Client-side PII gate on Notes. Fires before any optimistic state
  // update or PATCH. Rationale, copy, and honest limitations are in the
  // Tier 1 v5 spec §"PII detection on the Notes field" and in
  // utils/piiDetection.js. The gate intentionally lives in this handler
  // (not in saveFieldFromDraft) so the retry path — which calls
  // saveFieldFromDraft directly — does not re-prompt the user.
  //
  // Privacy (CLAUDE.md §4B): we never log the note text or the detection
  // result, and the dialog never surfaces the matched substring or the
  // reason category.
  const handleNotesBlur = (itemId) => {
    const draftVal = (drafts[itemId] || {}).notes;
    const trimmed = typeof draftVal === 'string' ? draftVal.trim() : '';
    // Skip the prompt on empty/whitespace-only drafts — those either
    // clear the field or no-op, and there's nothing to inspect.
    if (trimmed.length > 0) {
      const { detected } = detectPII(draftVal);
      if (detected) {
        const proceed = window.confirm(
          'This text looks like it might contain a name or ID. Notes should describe patterns and observations, not identify individuals. Save anyway?'
        );
        if (!proceed) {
          // Cancel means "I'm not done editing," not "this failed to save."
          // Leave the draft in place so the textarea keeps what the user
          // typed. No PATCH, no optimistic mirror, no saveError mutation.
          return;
        }
      }
    }
    saveFieldFromDraft(itemId, 'notes');
  };

  // Retry sends what the user currently sees. If they typed more text
  // after the failure (draft present), retry treats that like a fresh
  // blur. Otherwise it re-PATCHes the current optimistic response value.
  const retry = (itemId, field) => {
    if (field === 'score') {
      const v = (responses[itemId] || {}).score;
      if (v === 0 || v === 1 || v === 2) saveResponse(itemId, 'score', v);
      else clearError(itemId, field);
      return;
    }
    if (saveFieldFromDraft(itemId, field)) return;
    const currentVal = (responses[itemId] || {})[field] ?? null;
    saveResponse(itemId, field, currentVal);
  };

  const toggleAnchors = (itemId) => {
    setAnchorsOpen(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  // --- Derived values -----------------------------------------------------
  const domains = itemBank ? itemBank.domains : [];
  const items = itemBank ? itemBank.items : [];
  const currentDomain = domains[stepIndex] || null;
  const currentItems = currentDomain
    ? items.filter(it => it.domain === currentDomain.number)
    : [];

  const scoredCount = items.reduce((n, it) => {
    const s = (responses[it.id] || {}).score;
    return (s === 0 || s === 1 || s === 2) ? n + 1 : n;
  }, 0);
  const totalItems = items.length;
  const missingCount = Math.max(0, totalItems - scoredCount);

  const isLastStep = stepIndex === domains.length - 1;
  const canGoPrev = stepIndex > 0;
  const canGoNext = !isLastStep;

  // --- Completion ---------------------------------------------------------
  const handleComplete = async () => {
    if (!assessment || assessment.status !== 'in_progress') return;
    if (missingCount > 0) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const res = await fetch(
        `${API_URL}/tier1-assessments/${assessment.id}/complete`,
        { method: 'POST', credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Complete failed: ${res.status}`);
      }
      onClose();
    } catch (err) {
      logError('[tier1 complete]', err);
      setCompleteError(err.message || 'Could not complete the assessment');
      setCompleting(false);
    }
  };

  // --- Guardrail: if the assessment somehow lands in a non-editable state
  // while the modal is open, don't let the user keep editing.
  const readOnly = assessment && assessment.status !== 'in_progress';

  // --- Render helpers -----------------------------------------------------
  const SaveStatusBadge = () => {
    if (saveStatus === 'saving') {
      return <span className="text-xs text-slate-500">Saving…</span>;
    }
    if (saveStatus === 'saved') {
      return <span className="text-xs text-emerald-600">Saved</span>;
    }
    if (saveStatus === 'error') {
      return <span className="text-xs text-rose-600">Save failed</span>;
    }
    return null;
  };

  const FieldRetry = ({ itemId, field }) => {
    const isErr = !!(saveErrors[itemId] && saveErrors[itemId][field]);
    if (!isErr) return null;
    return (
      <div className="flex items-center gap-2 mt-1 text-xs text-rose-600">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Save failed —</span>
        <button
          type="button"
          onClick={() => retry(itemId, field)}
          className="underline hover:text-rose-800"
        >
          retry
        </button>
      </div>
    );
  };

  // --- Modal shell --------------------------------------------------------
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center">
          <p className="text-slate-600">Loading assessment…</p>
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
          <div className="flex items-center gap-2 mb-2 text-rose-700">
            <AlertCircle className="w-5 h-5" />
            <h3 className="font-semibold">Couldn't open the assessment</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">{bootError}</p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Tier 1 Self-Assessment</h3>
            <p className="text-sm text-slate-500">
              {currentDomain
                ? `Step ${stepIndex + 1} of ${domains.length}: ${currentDomain.title}`
                : `Step ${stepIndex + 1} of ${domains.length}`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <SaveStatusBadge />
            <button onClick={onClose} className="text-slate-500 hover:text-slate-700" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-4 py-2 bg-slate-50">
          <div className="flex gap-1">
            {domains.map((_, i) => (
              <div
                key={i}
                className={'h-2 flex-1 rounded ' + (i <= stepIndex ? 'bg-indigo-500' : 'bg-slate-200')}
              />
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {scoredCount} of {totalItems} items scored
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {readOnly && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              This assessment is no longer editable (status: {assessment.status}).
            </div>
          )}

          {currentItems.map(item => {
            const response = responses[item.id] || {};
            const score = response.score;
            const draftUrl = (drafts[item.id] || {}).evidence_url;
            const draftNotes = (drafts[item.id] || {}).notes;
            const urlValue = draftUrl !== undefined ? draftUrl : (response.evidence_url || '');
            const notesValue = draftNotes !== undefined ? draftNotes : (response.notes || '');
            const urlInvalid = !isValidUrl(urlValue);
            const isAnchorOpen = anchorsOpen.has(item.id);

            return (
              <div key={item.id} className="border border-slate-200 rounded-xl p-4">
                {/* Item heading + question */}
                <div className="mb-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-mono text-slate-400 mt-1">{item.id}</span>
                    <h4 className="font-semibold text-slate-800">{item.title}</h4>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{item.question}</p>
                </div>

                {/* Score radios */}
                <div className="flex flex-wrap gap-4 mb-3">
                  {[0, 1, 2].map(n => {
                    const selected = score === n;
                    return (
                      <label
                        key={n}
                        className={
                          'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer ' +
                          (selected
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700') +
                          (readOnly ? ' opacity-60 cursor-not-allowed' : '')
                        }
                      >
                        <input
                          type="radio"
                          name={`score-${item.id}`}
                          value={n}
                          checked={selected}
                          onChange={() => handleScoreChange(item.id, n)}
                          disabled={readOnly}
                          className="accent-indigo-600"
                        />
                        <span className="font-medium">{n}</span>
                        <span>— {RADIO_LABELS[n]}</span>
                      </label>
                    );
                  })}
                </div>
                <FieldRetry itemId={item.id} field="score" />

                {/* Anchor toggle */}
                <button
                  type="button"
                  onClick={() => toggleAnchors(item.id)}
                  className="text-xs text-indigo-700 hover:underline flex items-center gap-1"
                >
                  {isAnchorOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  What do these scores mean?
                </button>
                {isAnchorOpen && (
                  <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 space-y-2">
                    {/* Anchor text rendered as a plain string in 4a; markdown
                        rendering lands in 4b alongside the PII-detection work. */}
                    {[0, 1, 2].map(n => (
                      <div key={n}>
                        <span className="font-semibold">{n} — {RADIO_LABELS[n]}:</span>{' '}
                        <span>{item.anchors[String(n)]}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Evidence URL */}
                <div className="mt-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Evidence link (optional)
                  </label>
                  <input
                    type="url"
                    value={urlValue}
                    onChange={(e) => setDraft(item.id, 'evidence_url', e.target.value)}
                    onBlur={() => handleUrlBlur(item.id)}
                    disabled={readOnly}
                    placeholder="https:// (link to handbook, matrix, or other documentation)"
                    className={
                      'w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ' +
                      (urlInvalid ? 'border-rose-300 bg-rose-50' : 'border-slate-200')
                    }
                  />
                  {urlInvalid && (
                    <p className="text-xs text-rose-600 mt-1">Must start with http:// or https://</p>
                  )}
                  <FieldRetry itemId={item.id} field="evidence_url" />
                </div>

                {/* Notes */}
                <div className="mt-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Notes about this practice (optional)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={300}
                    value={notesValue}
                    onChange={(e) => setDraft(item.id, 'notes', e.target.value)}
                    onBlur={() => handleNotesBlur(item.id)}
                    disabled={readOnly}
                    placeholder={"E.g., 'Adopted Second Step SEL in 2023, delivered weekly grades K\u20135.' Do not include student or staff names."}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                  <div className="text-xs text-slate-500 mt-1 text-right">
                    {notesValue.length} / 300
                  </div>
                  <FieldRetry itemId={item.id} field="notes" />
                </div>
              </div>
            );
          })}

          {/* Complete button (only on the last step) */}
          {isLastStep && !readOnly && (
            <div className="pt-2 border-t border-slate-200">
              {completeError && (
                <div className="mb-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
                  {completeError}
                </div>
              )}
              <button
                type="button"
                onClick={handleComplete}
                disabled={missingCount > 0 || completing}
                title={missingCount > 0 ? `${missingCount} item${missingCount === 1 ? '' : 's'} still need${missingCount === 1 ? 's' : ''} scoring` : ''}
                className={
                  'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ' +
                  ((missingCount === 0 && !completing)
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-slate-200 text-slate-500 cursor-not-allowed')
                }
              >
                <CheckCircle className="w-4 h-4" />
                {completing ? 'Completing…' : 'Complete Assessment'}
              </button>
              {missingCount > 0 && (
                <p className="text-xs text-slate-500 mt-2">
                  {missingCount} item{missingCount === 1 ? '' : 's'} still need{missingCount === 1 ? 's' : ''} scoring before you can complete.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={() => canGoPrev && setStepIndex(i => i - 1)}
            disabled={!canGoPrev}
            className={
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ' +
              (canGoPrev
                ? 'text-slate-700 hover:bg-slate-100'
                : 'text-slate-400 cursor-not-allowed')
            }
          >
            <ArrowLeft className="w-4 h-4" />
            Previous
          </button>
          <div className="text-sm text-slate-500">
            Step {stepIndex + 1} of {domains.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-100"
            >
              Save &amp; close
            </button>
            <button
              type="button"
              onClick={() => canGoNext && setStepIndex(i => i + 1)}
              disabled={!canGoNext}
              className={
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ' +
                (canGoNext
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed')
              }
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tier1AssessmentModal;
