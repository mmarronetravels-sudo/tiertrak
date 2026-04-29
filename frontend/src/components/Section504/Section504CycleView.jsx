import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, Eye, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { logError } from '../../utils/logError';
import { getCycleBundle } from './api';
import FormCConsentModal from './FormCConsentModal';
import FormIDeterminationModal from './FormIDeterminationModal';

// Single-cycle drill-in. Renders the cycle bundle (cycle row + consents
// + eligibility_determinations + plans + team_members) and exposes the
// "Add Form C" action via FormCConsentModal in commit 2. Forms I and J
// land in commits 3 and 4 — their sections render existing rows
// read-only with disabled "Add" buttons in this commit.
//
// Append-only revision UX (Q3 in the audit plan):
//   - Backend orders consents/determinations/plans ASC by created_at,
//     so the LAST element of each array is the most recent. This file
//     reverses each array for display and treats index 0 of the
//     reversed list as "Current."
//   - "Add Form X" → opens the form modal blank → on save the bundle
//     is refetched → the new revision appears at the top with a
//     "Current" badge. Older revisions move into the "History" disclosure.
//   - "View" on the current revision → opens the modal in read-only
//     mode for inspection (no edit, since the backend has no PUT).
//
// Auth: parent role short-circuits on mount; the bundle endpoint also
// refuses parent role at the route boundary.
const Section504CycleView = ({ user, API_URL, student, cycleId, onBack }) => {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [formCModal, setFormCModal] = useState(null); // null | { mode, consent? }
  const [formIModal, setFormIModal] = useState(null); // null | { mode, determination? }
  const [historyOpen, setHistoryOpen] = useState({}); // { c: bool, i: bool, j: bool }

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getCycleBundle(API_URL, cycleId);
      setBundle(data);
    } catch (err) {
      logError('[Section504CycleView load bundle]', err);
      setLoadError('Could not load cycle.');
    } finally {
      setLoading(false);
    }
  }, [API_URL, cycleId]);

  useEffect(() => {
    if (!cycleId || user?.role === 'parent') return;
    reload();
  }, [cycleId, user?.role, reload]);

  if (user?.role === 'parent') return null;

  // Server returns ASC by created_at; reverse for newest-first display.
  const consents = (bundle?.consents || []).slice().reverse();
  const determinations = (bundle?.eligibility_determinations || []).slice().reverse();
  const plans = (bundle?.plans || []).slice().reverse();
  const teamMembers = bundle?.team_members || [];

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
      >
        <ArrowLeft size={16} /> Back to cycles
      </button>

      {loading && <p className="text-sm text-slate-500">Loading cycle…</p>}

      {loadError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {bundle && (
        <>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-slate-800">
                Cycle #{bundle.id}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                {bundle.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Started {new Date(bundle.created_at).toLocaleDateString()} · Form
              set {bundle.form_set_id} ({bundle.form_set_version})
            </p>
          </div>

          <FormRevisionSection
            title="Form C — Prior Notice and Consent to Evaluate"
            revisions={consents}
            describe={(c) => `${c.consent_status} · saved ${new Date(c.created_at).toLocaleString()}`}
            onAdd={() => setFormCModal({ mode: 'add' })}
            onViewCurrent={(c) => setFormCModal({ mode: 'view', consent: c })}
            onViewHistorical={(c) => setFormCModal({ mode: 'view', consent: c })}
            historyOpen={!!historyOpen.c}
            onToggleHistory={() => setHistoryOpen((p) => ({ ...p, c: !p.c }))}
          />

          <FormRevisionSection
            title="Form I — Eligibility Determination"
            revisions={determinations}
            describe={(d) => `${d.eligibility_status} · saved ${new Date(d.created_at).toLocaleString()}`}
            onAdd={() => setFormIModal({ mode: 'add' })}
            onViewCurrent={(d) => setFormIModal({ mode: 'view', determination: d })}
            onViewHistorical={(d) => setFormIModal({ mode: 'view', determination: d })}
            historyOpen={!!historyOpen.i}
            onToggleHistory={() => setHistoryOpen((p) => ({ ...p, i: !p.i }))}
          />

          <FormRevisionSection
            title="Form J — Accommodation Plan"
            revisions={plans}
            describe={(p) => `${p.plan_status} · saved ${new Date(p.created_at).toLocaleString()}`}
            onAdd={null}
            disabledReason="Form J editor lands in commit 4"
            historyOpen={!!historyOpen.j}
            onToggleHistory={() => setHistoryOpen((p) => ({ ...p, j: !p.j }))}
          />

          <TeamMembersSection members={teamMembers} />
        </>
      )}

      {formCModal && (
        <FormCConsentModal
          API_URL={API_URL}
          user={user}
          student={student}
          cycleId={cycleId}
          mode={formCModal.mode}
          existingConsent={formCModal.consent || null}
          onClose={() => setFormCModal(null)}
          onSaved={() => {
            setFormCModal(null);
            reload();
          }}
        />
      )}

      {formIModal && (
        <FormIDeterminationModal
          API_URL={API_URL}
          user={user}
          cycleId={cycleId}
          mode={formIModal.mode}
          existingDetermination={formIModal.determination || null}
          onClose={() => setFormIModal(null)}
          onSaved={() => {
            setFormIModal(null);
            reload();
          }}
        />
      )}
    </div>
  );
};

// Reusable section for any revision-bearing form (C, I, J). Latest-wins
// display + collapsible history. Pure render; owns no fetch state.
const FormRevisionSection = ({
  title,
  revisions,
  describe,
  onAdd,
  onViewCurrent,
  onViewHistorical,
  disabledReason,
  historyOpen,
  onToggleHistory,
}) => {
  const current = revisions[0] || null;
  const history = revisions.slice(1);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {onAdd ? (
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700"
          >
            <Plus size={14} />
            Add revision
          </button>
        ) : (
          <span className="text-xs text-slate-400 italic">{disabledReason}</span>
        )}
      </div>

      {current ? (
        <div className="mt-3 flex items-center justify-between gap-3 p-2 rounded-lg bg-emerald-50 border border-emerald-200">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              Current
            </span>
            <span className="text-xs text-slate-700">{describe(current)}</span>
          </div>
          {onViewCurrent && (
            <button
              onClick={() => onViewCurrent(current)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 rounded"
            >
              <Eye size={14} />
              View
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500 mt-3">No revisions yet.</p>
      )}

      {history.length > 0 && (
        <div className="mt-2">
          <button
            onClick={onToggleHistory}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            {historyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {history.length} earlier {history.length === 1 ? 'revision' : 'revisions'}
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-1 pl-4 border-l border-slate-200">
              {history.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs text-slate-600">{describe(r)}</span>
                  {onViewHistorical && (
                    <button
                      onClick={() => onViewHistorical(r)}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
                    >
                      <Eye size={12} />
                      View
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// Read-only team members display. The /api/student-504 surface in PR #24
// has no POST handler for team members, so "Add" is intentionally absent.
// Tracked as a followup branch (feat/504-team-members-add-ui) which
// depends on a backend POST handler.
const TeamMembersSection = ({ members }) => (
  <div className="bg-white rounded-lg border border-slate-200 p-4">
    <h3 className="text-sm font-semibold text-slate-800">504 Team Members</h3>
    {members.length === 0 ? (
      <p className="text-xs text-slate-500 mt-2">
        No team members recorded for this cycle. Add UI lands in a follow-up
        branch once the backend POST handler is available.
      </p>
    ) : (
      <ul className="mt-2 space-y-1">
        {members.map((m) => (
          <li key={m.id} className="text-xs text-slate-700 flex items-center gap-2">
            <span className="font-medium">{m.member_name}</span>
            <span className="text-slate-500">— {m.member_role}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

export default Section504CycleView;
