import { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// DisciplineReferralResolveModal — terminal action: PATCH /:id/resolve.
//
// One atomic call: replace-set on consequences + (optional) admin_notes
// overwrite, in a single transaction. Server moves the referral from
// 'under_review' to 'resolved'. reviewing_admin_id and reviewed_at are
// intentionally preserved by the server so the row carries the audit
// trail of who handled it.
//
// admin_notes contract (different from /admin-notes!):
//   - /admin-notes (the incremental save endpoint) REQUIRES the key.
//   - /resolve treats an absent key as "preserve existing" and a present
//     key as "overwrite" (server line 1049 — CASE on hasNotesField).
//   - This modal ALWAYS sends the key because the textarea is the final
//     source-of-truth at resolve time. The seed is detail.admin_notes
//     (the last persisted value), so an unedited submit overwrites
//     with the same value — idempotent in practice.
//
// Known UX trade-off: if the admin has unsaved edits in the detail-page
// inline editor when they open this modal, those edits are NOT pulled
// in — the modal seeds from detail.admin_notes (the persisted value).
// Acceptable for first cut; the modal's own textarea is the operator's
// last word at resolve time.
//
// PII discipline (§4B):
//   - apiFetch only; no bare fetch; cache: 'no-store' everywhere.
//   - No localStorage / sessionStorage / IndexedDB writes.
//   - logError carries static tag + the error object — no notes content,
//     no consequence labels, no referral identifiers beyond what the
//     calling Detail page already logs.
//
// Trust boundary: server enforces ACT_ROLES + loadReferralAndAssertTenant
// + status = 'under_review'. The modal is UI.

const ADMIN_NOTES_MAX_LENGTH = 5000;

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

export default function DisciplineReferralResolveModal(props) {
  // referral — the detail object from the parent. Used for id, tenant_id
  // (to load vocab), and admin_notes (to seed the textarea).
  // onClose — invoked when the operator cancels or the modal completes.
  // onResolved — invoked AFTER a 200 from /resolve; the parent bumps a
  //              refreshToken so the detail page refetches.
  const { API_URL, referral, onClose, onResolved } = props;

  const [vocab, setVocab] = useState(null);
  const [vocabLoading, setVocabLoading] = useState(true);
  const [vocabError, setVocabError] = useState(null);

  // selectedIds — a Set for O(1) toggle. Converted to a deduped int
  // array at submit time. Seeded empty: the operator picks one or more
  // consequences as the final assignment. If the referral already had
  // consequences pre-resolved (unusual on this flow — pre-resolution
  // is only the L1-staff-managed create-path), the operator must re-pick
  // them; this is the replace-set semantic of /resolve.
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Seed notes from the referral's last-persisted admin_notes. See header
  // comment for why we don't pull from the detail page's in-flight draft.
  const [notes, setNotes] = useState(
    typeof referral.admin_notes === 'string' ? referral.admin_notes : ''
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Load vocab once on mount, scoped to the referral's tenant.
  useEffect(() => {
    let cancelled = false;
    const loadVocab = async () => {
      try {
        const res = await apiFetch(
          `${API_URL}/discipline-referrals/vocab/${referral.tenant_id}`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          throw new Error('vocab status ' + res.status);
        }
        const data = await res.json();
        if (cancelled) return;
        setVocab(data);
      } catch (err) {
        if (cancelled) return;
        logError('[disciplineResolve:vocab]', err);
        setVocabError('Could not load consequence options.');
      } finally {
        if (!cancelled) setVocabLoading(false);
      }
    };
    loadVocab();
    return () => { cancelled = true; };
  }, [API_URL, referral.tenant_id]);

  const toggleConsequence = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const trimmedNotes = notes.trim();
  const notesTooLong = trimmedNotes.length > ADMIN_NOTES_MAX_LENGTH;
  const hasAnyConsequence = selectedIds.size > 0;
  // Pre-compute the deduped, validated int array. This is what we'll
  // submit. Excluding invalid entries (NaN, non-positive) collapses
  // toggle-state corruption into "no valid ids" → button stays disabled.
  const consequenceIdsArray = Array.from(selectedIds).filter(isPositiveInt);
  const canSubmit = hasAnyConsequence
    && consequenceIdsArray.length === selectedIds.size
    && !notesTooLong
    && !submitting
    && !vocabLoading
    && !vocabError;

  const handleSubmit = async () => {
    // Defense-in-depth: the button is already disabled, but a second
    // call path (Enter key, double-click race, etc.) shouldn't be able
    // to bypass the ≥1-consequence + length-cap guards.
    if (submitting) return;
    if (selectedIds.size === 0) {
      setSubmitError('Select at least one consequence.');
      return;
    }
    if (notesTooLong) {
      setSubmitError('Notes are too long (max ' + ADMIN_NOTES_MAX_LENGTH + ' characters).');
      return;
    }
    if (consequenceIdsArray.length === 0) {
      setSubmitError('Invalid consequence selection.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      // ALWAYS send admin_notes — see header comment. Trim-to-NULL
      // matches the server's parseAdminNotes (empty collapses to null).
      const payload = {
        consequence_ids: consequenceIdsArray,
        admin_notes: trimmedNotes.length === 0 ? null : trimmedNotes,
      };
      const res = await apiFetch(`${API_URL}/discipline-referrals/${referral.id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch (_) { /* swallow */ }
        throw new Error(body.error || 'Could not resolve the referral.');
      }
      // Success — let the parent bump refreshToken and close us.
      onResolved();
    } catch (err) {
      logError('[disciplineResolve:submit]', err);
      setSubmitError(err.message || 'Could not resolve the referral.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e) => {
    // Don't close mid-submit — the operator would think the action
    // failed when in fact a PATCH may still be in flight.
    if (submitting) return;
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:max-w-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Resolve referral</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="p-1 -mr-1 rounded hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={22} className="text-slate-700" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {vocabLoading && (
            <div className="text-center text-slate-500 py-8">Loading options…</div>
          )}
          {vocabError && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 flex gap-2">
              <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
              <span className="text-sm">{vocabError}</span>
            </div>
          )}

          {!vocabLoading && !vocabError && vocab && (
            <>
              {/* Consequences picker */}
              <section>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
                  Consequences <span className="text-red-600">*</span>
                  <span className="text-slate-400 font-normal normal-case text-xs ml-2">
                    select one or more
                  </span>
                </h3>
                {Array.isArray(vocab.consequences) && vocab.consequences.length > 0 ? (
                  <div className="space-y-2">
                    {vocab.consequences.map((c) => {
                      const selected = selectedIds.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleConsequence(c.id)}
                          className={
                            'w-full text-left px-4 py-3 rounded-lg border-2 transition active:scale-[0.99] text-base ' +
                            (selected
                              ? 'border-indigo-500 bg-indigo-50'
                              : 'border-slate-200 hover:border-indigo-300 bg-white')
                          }
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className={selected ? 'font-medium text-slate-900' : 'text-slate-800'}>
                              {c.label}
                            </span>
                            {c.is_restorative && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                                restorative
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 italic">
                    No consequence options configured for this school.
                  </p>
                )}
              </section>

              {/* Admin notes */}
              <section>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
                  Admin notes
                  <span className="text-slate-400 font-normal normal-case text-xs ml-2">
                    (optional — overwrites existing on resolve)
                  </span>
                </h3>
                <textarea
                  rows={5}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Final notes on the review and outcome."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm resize-none"
                />
                <div className="mt-1 text-xs text-slate-500 flex items-center justify-between">
                  <span>{trimmedNotes.length} / {ADMIN_NOTES_MAX_LENGTH}</span>
                  {notesTooLong && <span className="text-red-700">Too long</span>}
                </div>
              </section>
            </>
          )}
        </div>

        {/* Sticky action bar */}
        <div className="px-4 py-3 border-t border-slate-200 bg-white">
          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-3 text-sm">
              {submitError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 py-2 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
            >
              {submitting ? 'Resolving…' : 'Resolve referral'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
