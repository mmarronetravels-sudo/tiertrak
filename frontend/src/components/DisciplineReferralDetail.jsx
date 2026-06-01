import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// DisciplineReferralDetail — one referral, full info, with state-machine
// action buttons.
//
// Trust boundary: GET /:id and every PATCH below go through requireAuth +
// ACT_ROLES/VIEW_ROLES role gate + loadReferralAndAssertTenant. The FE
// only adapts UI affordances (read-only vs editor, hide vs show action
// bar) based on user.role; the server is still the authoritative gate.
// A VIEW_ROLES-only viewer (counselor / interventionist) sees the same
// detail but no action bar and no editor.
//
// D6 note-gating is enforced server-side in the SELECT CASE expressions:
// staff_notes / admin_notes arrive as NULL for viewers not authorized to
// see them. The FE renders whatever the API returns and never re-gates.
//
// PII discipline (§4B):
//   - cache: 'no-store' on every GET (detail payload carries student
//     name + notes — must not persist to disk cache beyond the session).
//   - No localStorage / sessionStorage / IndexedDB writes.
//   - logError carries only a static tag + the error object — never
//     student names, never notes content, never response bodies.
//
// Fetch contract: apiFetch only (credentials + CSRF). No trailing slash.

const ACT_ROLES = new Set(['school_admin', 'district_admin']);
const ADMIN_NOTES_MAX_LENGTH = 5000;

function severityClass(level) {
  if (level === 3) return 'bg-red-100 text-red-700';
  if (level === 2) return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

function statusLabel(s) {
  if (s === 'under_review') return 'Under review';
  if (s === 'resolved') return 'Resolved';
  return 'Submitted';
}

function statusPillClass(s) {
  if (s === 'under_review') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (s === 'resolved') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch (_) {
    return '';
  }
}

function formatTime(t) {
  if (!t) return '';
  // incident_time is HH:MM:SS or HH:MM from the server; we only show HH:MM
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (_) {
    return '';
  }
}

export default function DisciplineReferralDetail(props) {
  // refreshToken — incremented by the parent after a resolve modal
  // success so Detail refetches and picks up the terminal state +
  // consequence list. Defaults to 0; any change in value triggers refetch.
  const { user, API_URL, referralId, refreshToken, onBack, onOpenResolve } = props;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Admin-notes editor state — independent of the loaded detail so the
  // editor preserves in-progress drafts across detail-refetch cycles
  // (e.g., after PATCH /:id/claim refreshes the row).
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesError, setNotesError] = useState(null);
  const [notesSavedAt, setNotesSavedAt] = useState(null);

  // Action-bar busy flags
  const [claimBusy, setClaimBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const isActRole = user && ACT_ROLES.has(user.role);

  const fetchDetail = useCallback(async (preserveNotesDraft) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`${API_URL}/discipline-referrals/${referralId}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('detail status ' + res.status);
      }
      const data = await res.json();
      setDetail(data);
      if (!preserveNotesDraft) {
        setNotesDraft(typeof data.admin_notes === 'string' ? data.admin_notes : '');
        setNotesDirty(false);
        setNotesSavedAt(null);
      }
    } catch (err) {
      logError('[disciplineDetail:fetch]', err);
      setLoadError('Could not load the referral.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [API_URL, referralId]);

  useEffect(() => {
    fetchDetail(false);
  }, [fetchDetail, refreshToken]);

  const handleClaim = async () => {
    if (claimBusy) return;
    // Defense-in-depth: only fire on a referral currently in 'submitted'
    // state. If a parallel admin already claimed it the render would be
    // stale; the no-op here prevents a wasted PATCH against a server
    // that would return 400 ("not in a claimable state") anyway.
    if (!detail || detail.status !== 'submitted') return;
    setClaimBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(`${API_URL}/discipline-referrals/${referralId}/claim`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch (_) { /* swallow */ }
        throw new Error(body.error || 'Could not claim the referral.');
      }
      // Refetch detail to pick up reviewing_admin_name + reviewed_at.
      // Preserve the notes draft in case the admin had started typing
      // before clicking claim (claim doesn't touch admin_notes).
      await fetchDetail(true);
    } catch (err) {
      logError('[disciplineDetail:claim]', err);
      setActionError(err.message || 'Could not claim the referral.');
    } finally {
      setClaimBusy(false);
    }
  };

  const handleRelease = async () => {
    if (releaseBusy) return;
    // Defense-in-depth: server gates /release on status = 'under_review'.
    if (!detail || detail.status !== 'under_review') return;
    // Release clears reviewing_admin_id + reviewed_at — confirm because
    // it's reversible state but the admin loses the "I claimed this" mark.
    if (typeof window !== 'undefined' && !window.confirm(
      'Release this referral back to the queue? Your admin notes will be kept; another admin can claim it.'
    )) {
      return;
    }
    setReleaseBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(`${API_URL}/discipline-referrals/${referralId}/release`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch (_) { /* swallow */ }
        throw new Error(body.error || 'Could not release the referral.');
      }
      await fetchDetail(true);
    } catch (err) {
      logError('[disciplineDetail:release]', err);
      setActionError(err.message || 'Could not release the referral.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const handleSaveNotes = async () => {
    if (notesSaving) return;
    // Defense-in-depth: server gates /admin-notes on status = 'under_review'.
    if (!detail || detail.status !== 'under_review') return;
    const trimmed = notesDraft.trim();
    if (trimmed.length > ADMIN_NOTES_MAX_LENGTH) {
      setNotesError('Notes are too long (max ' + ADMIN_NOTES_MAX_LENGTH + ' characters).');
      return;
    }
    setNotesSaving(true);
    setNotesError(null);
    try {
      // Send the trimmed value, or null if empty-after-trim (matches the
      // server's parseAdminNotes — empty collapses to NULL deliberately).
      const payload = { admin_notes: trimmed.length === 0 ? null : trimmed };
      const res = await apiFetch(`${API_URL}/discipline-referrals/${referralId}/admin-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch (_) { /* swallow */ }
        throw new Error(body.error || 'Could not save notes.');
      }
      setNotesDirty(false);
      setNotesSavedAt(new Date());
    } catch (err) {
      logError('[disciplineDetail:adminNotes]', err);
      setNotesError(err.message || 'Could not save notes.');
    } finally {
      setNotesSaving(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="space-y-6">
        <BackButton onBack={onBack} />
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-500 shadow-sm">
          Loading…
        </div>
      </div>
    );
  }

  if (loadError && !detail) {
    return (
      <div className="space-y-6">
        <BackButton onBack={onBack} />
        <div className="bg-white rounded-2xl border border-red-200 p-6 text-center text-red-700 shadow-sm">
          {loadError}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const studentName = (detail.student_last_name || '') +
    (detail.student_last_name && detail.student_first_name ? ', ' : '') +
    (detail.student_first_name || '');

  const showActionBar = isActRole && detail.status !== 'resolved';
  const showNotesEditor = isActRole && detail.status === 'under_review';
  const draftTooLong = notesDraft.trim().length > ADMIN_NOTES_MAX_LENGTH;

  return (
    <div className="space-y-6">
      <BackButton onBack={onBack} />

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-800">
              {studentName.trim() || '—'}
              {detail.student_grade != null && (
                <span className="text-slate-500 text-base font-normal"> · Grade {detail.student_grade}</span>
              )}
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className={'px-2 py-0.5 text-xs rounded-full ' + severityClass(detail.severity_level)}>
                Level {detail.severity_level}
              </span>
              <span className={'text-xs px-2 py-0.5 rounded-full border ' + statusPillClass(detail.status)}>
                {statusLabel(detail.status)}
              </span>
              {detail.managed_by && (
                <span className={
                  'text-xs px-2 py-0.5 rounded-full ' +
                  (detail.managed_by === 'staff'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800')
                }>
                  {detail.managed_by === 'staff' ? 'staff-managed' : 'admin-managed'}
                </span>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500 space-y-0.5">
            {detail.referring_staff_name && (
              <div>Filed by {detail.referring_staff_name}</div>
            )}
            {detail.created_at && (
              <div>Filed {formatDateTime(detail.created_at)}</div>
            )}
            {detail.reviewing_admin_name && (
              <div>Claimed by {detail.reviewing_admin_name}</div>
            )}
            {detail.reviewed_at && detail.status !== 'resolved' && (
              <div>Claimed {formatDateTime(detail.reviewed_at)}</div>
            )}
            {detail.reviewed_at && detail.status === 'resolved' && (
              <div>Resolved {formatDateTime(detail.reviewed_at)}</div>
            )}
          </div>
        </div>
      </div>

      {/* Incident facts */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Incident</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="Behavior" value={detail.behavior_label} />
          <Field label="Location" value={detail.location_label} />
          <Field
            label="When"
            value={
              (detail.incident_date ? formatDate(detail.incident_date) : '') +
              (detail.incident_time ? ' · ' + formatTime(detail.incident_time) : '')
            }
          />
          {detail.motivation_label && (
            <Field label="Perceived motivation" value={detail.motivation_label} />
          )}
          {detail.others_involved_label && (
            <Field label="Others involved" value={detail.others_involved_label} />
          )}
          {detail.harassment_subtype_label && (
            <Field label="Harassment subtype" value={detail.harassment_subtype_label} />
          )}
          {detail.weapon_subtype_label && (
            <Field label="Weapon subtype" value={detail.weapon_subtype_label} />
          )}
        </dl>
      </section>

      {/* Staff notes — render only when present (server already gates) */}
      {detail.staff_notes && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Staff notes</h2>
          <p className="text-sm text-slate-800 whitespace-pre-line">{detail.staff_notes}</p>
        </section>
      )}

      {/* Admin notes — editor when ACT_ROLE + under_review; read-only otherwise */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Admin notes</h2>
        {showNotesEditor ? (
          <div className="space-y-2">
            <textarea
              rows={5}
              value={notesDraft}
              onChange={(e) => { setNotesDraft(e.target.value); setNotesDirty(true); setNotesSavedAt(null); }}
              placeholder="Document the review, decisions, and any follow-up."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm resize-none"
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs text-slate-500">
                {notesDraft.trim().length} / {ADMIN_NOTES_MAX_LENGTH}
                {draftTooLong && <span className="text-red-700 ml-2">Too long</span>}
              </div>
              <div className="flex items-center gap-3">
                {notesError && <span className="text-xs text-red-700">{notesError}</span>}
                {!notesError && notesSavedAt && !notesDirty && (
                  <span className="text-xs text-emerald-700">Saved</span>
                )}
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  disabled={notesSaving || draftTooLong || !notesDirty}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
                >
                  {notesSaving ? 'Saving…' : 'Save notes'}
                </button>
              </div>
            </div>
          </div>
        ) : detail.admin_notes ? (
          <p className="text-sm text-slate-800 whitespace-pre-line">{detail.admin_notes}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">No admin notes yet.</p>
        )}
      </section>

      {/* Consequences */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Consequences</h2>
        {Array.isArray(detail.consequences) && detail.consequences.length > 0 ? (
          <ul className="space-y-2">
            {detail.consequences.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm text-slate-800">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                <span>{c.label}</span>
                {c.is_restorative && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">restorative</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400 italic">
            {detail.status === 'resolved'
              ? 'No consequences recorded.'
              : 'No consequences assigned yet.'}
          </p>
        )}
      </section>

      {/* Action bar (ACT_ROLES only, status-driven) */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}
      {showActionBar && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          {detail.status === 'submitted' && (
            <button
              type="button"
              onClick={handleClaim}
              disabled={claimBusy}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
            >
              {claimBusy ? 'Claiming…' : 'Claim for review'}
            </button>
          )}
          {detail.status === 'under_review' && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onOpenResolve(detail)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Resolve…
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={releaseBusy}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                {releaseBusy ? 'Releasing…' : 'Release back to queue'}
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

function BackButton({ onBack }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
    >
      <ArrowLeft size={16} />
      Back to queue
    </button>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800">{value || '—'}</dd>
    </div>
  );
}

