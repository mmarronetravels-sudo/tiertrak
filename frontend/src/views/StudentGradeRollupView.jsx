// StudentGradeRollupView — district_admin-only EOY grade roll-up.
//
// Consumes three backend endpoints (all shipped + prod-validated by PR
// #255):
//   POST /api/student-grade-rollup/preview
//   POST /api/student-grade-rollup/commit
//   POST /api/student-grade-rollup/undo/:runId
//
// Plus two existing GETs for picker data:
//   GET /api/auth/me/schools
//     (same endpoint DisciplineReferralQueue + DisciplineReports
//      consume; role-gated to school_admin / district_admin / counselor /
//      interventionist and sourced from resolveAccessibleTenantIds)
//   GET /api/students/tenant/:id
//     (existing student-list endpoint; required for the exit picker)
//
// State persistence (rollupDraft in AppContext): the in-progress form
// state (school, terminal grade, exits, preview + token, post-commit
// run, post-undo result) is lifted to AppContext.rollupDraft so a
// round-trip to a student profile (e.g. to fix an unclassified
// student's grade) and back restores the form exactly. Reset on logout
// by handleLogout; otherwise persists for the SPA session. Local state
// here covers only ephemeral UI bits (loading flags, error strings,
// verb-gate inputs, search query).
//
// Role gate: the view is mounted in App.jsx behind
// `view === 'grade-rollup' && isDistrictAdmin`, AND the backend role
// gate at every endpoint is the trust boundary. The client-side gate is
// nav UX, not security.

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, RotateCcw, ShieldAlert, Trash2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';
import {
  GRADE_SEQUENCE,
  EXIT_REASONS,
  EXIT_REASON_LABELS,
} from '../constants/gradeProgression';
import StudentGradeRollupPreviewPanel from '../components/StudentGradeRollupPreviewPanel';

const INITIAL_DRAFT = {
  selectedSchoolId: null,
  terminalGrade: '',
  exits: [],
  preview: null,
  commitSuccess: null,
  undoSuccess: null,
};

export default function StudentGradeRollupView() {
  const {
    user,
    API_URL,
    rollupDraft,
    setRollupDraft,
    openStudentProfile,
  } = useApp();

  const draft = rollupDraft || INITIAL_DRAFT;
  const updateDraft = (patch) => setRollupDraft({ ...draft, ...patch });

  // ----- Schools -----
  const [schools, setSchools] = useState(null);
  const [schoolsError, setSchoolsError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const loadSchools = async () => {
      try {
        const res = await apiFetch(`${API_URL}/auth/me/schools`, { cache: 'no-store' });
        if (!res.ok) throw new Error('schools status ' + res.status);
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setSchools(list);
        // Auto-select on first load only — if draft already has a school
        // selected from a prior round-trip, preserve it.
        if (!draft.selectedSchoolId && list.length >= 1) {
          const home = list.find((s) => s.id === user?.tenant_id);
          updateDraft({ selectedSchoolId: home ? home.id : list[0].id });
        }
      } catch (err) {
        if (cancelled) return;
        logError('[gradeRollup:schools]', err);
        setSchoolsError('Could not load your schools.');
        setSchools([]);
      }
    };
    loadSchools();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL, user?.tenant_id]);

  // ----- Students for the picker-selected school -----
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState(null);

  useEffect(() => {
    if (!draft.selectedSchoolId) {
      setStudents([]);
      return undefined;
    }
    let cancelled = false;
    setStudentsLoading(true);
    setStudentsError(null);
    (async () => {
      try {
        const res = await apiFetch(
          `${API_URL}/students/tenant/${draft.selectedSchoolId}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error('students status ' + res.status);
        const data = await res.json();
        if (cancelled) return;
        setStudents(Array.isArray(data) ? data : []);
      } catch (err) {
        if (cancelled) return;
        logError('[gradeRollup:students]', err);
        setStudentsError('Could not load students for the selected school.');
        setStudents([]);
      } finally {
        if (!cancelled) setStudentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL, draft.selectedSchoolId]);

  // Lookup map by id for the unclassified "Open profile to fix" deep-link
  // and the exit-row rendering.
  const studentsById = useMemo(() => {
    const m = new Map();
    for (const s of students) m.set(s.id, s);
    return m;
  }, [students]);

  // ----- Handlers that clear preview state (school / terminal changes
  // invalidate any in-flight preview; exit changes invalidate the
  // preview's snapshot hash so the backend would 409 anyway) -----
  const handleSchoolChange = (id) => {
    if (id === draft.selectedSchoolId) return;
    setRollupDraft({
      ...INITIAL_DRAFT,
      selectedSchoolId: id,
    });
  };

  const handleTerminalChange = (g) => {
    updateDraft({ terminalGrade: g, preview: null });
  };

  // ----- Exits -----
  const [exitSearch, setExitSearch] = useState('');
  const [exitReason, setExitReason] = useState('');

  const handleAddExit = (studentId, reason) => {
    if (!studentId || !reason) return;
    if (draft.exits.some((e) => e.student_id === studentId)) return;
    updateDraft({
      exits: [...draft.exits, { student_id: studentId, exit_reason: reason }],
      preview: null,
    });
    setExitSearch('');
    setExitReason('');
  };

  const handleRemoveExit = (studentId) => {
    updateDraft({
      exits: draft.exits.filter((e) => e.student_id !== studentId),
      preview: null,
    });
  };

  // ----- /preview -----
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const handlePreview = async () => {
    if (!draft.selectedSchoolId || !draft.terminalGrade) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await apiFetch(`${API_URL}/student-grade-rollup/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_tenant_id: draft.selectedSchoolId,
          terminal_grade: draft.terminalGrade,
          exits: draft.exits,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = previewErrorMessage(res.status, body);
        setPreviewError(msg);
        return;
      }
      updateDraft({ preview: body, commitSuccess: null, undoSuccess: null });
    } catch (err) {
      logError('[gradeRollup:preview]', err);
      setPreviewError('Network error while loading the preview. Please try again.');
    } finally {
      setPreviewLoading(false);
    }
  };

  // ----- Commit verb gate + handler -----
  const [showCommitGate, setShowCommitGate] = useState(false);
  const [commitVerb, setCommitVerb] = useState('');
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState(null);

  const canCommit =
    !!draft.preview &&
    !!draft.preview.preview_token &&
    (draft.preview.unclassified || []).length === 0 &&
    !commitLoading;

  const handleCommitConfirm = async () => {
    if (!draft.preview?.preview_token) return;
    setCommitLoading(true);
    setCommitError(null);
    try {
      const res = await apiFetch(`${API_URL}/student-grade-rollup/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview_token: draft.preview.preview_token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommitError(commitErrorMessage(res.status, body));
        // Clear the preview (and its dead token) on every status that
        // means "re-preview required": 409 (stale snapshot), 410 (token
        // expired), 422 (unclassified remains), AND 401 carrying
        // 'Invalid preview token' (token tampered or signed with a
        // rotated secret). All four leave the operator with a dead
        // token; clearing forces them through /preview again rather
        // than letting them re-click Commit on the same dead token.
        const invalidToken401 =
          res.status === 401 && body?.error === 'Invalid preview token';
        if ([409, 410, 422].includes(res.status) || invalidToken401) {
          updateDraft({ preview: null });
        }
        return;
      }
      updateDraft({ preview: null, commitSuccess: body, undoSuccess: null });
      setShowCommitGate(false);
      setCommitVerb('');
    } catch (err) {
      logError('[gradeRollup:commit]', err);
      setCommitError('Network error while committing. Please try again.');
    } finally {
      setCommitLoading(false);
    }
  };

  // ----- Undo verb gate + handler -----
  const [showUndoGate, setShowUndoGate] = useState(false);
  const [undoVerb, setUndoVerb] = useState('');
  const [undoLoading, setUndoLoading] = useState(false);
  const [undoError, setUndoError] = useState(null);

  const handleUndoConfirm = async () => {
    const runId = draft.commitSuccess?.run_id;
    if (!runId) return;
    setUndoLoading(true);
    setUndoError(null);
    try {
      const res = await apiFetch(`${API_URL}/student-grade-rollup/undo/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUndoError(undoErrorMessage(res.status, body));
        return;
      }
      updateDraft({ undoSuccess: body });
      setShowUndoGate(false);
      setUndoVerb('');
    } catch (err) {
      logError('[gradeRollup:undo]', err);
      setUndoError('Network error while undoing. Please try again.');
    } finally {
      setUndoLoading(false);
    }
  };

  // ----- Start over -----
  const handleStartOver = () => {
    setRollupDraft(null);
    setExitSearch('');
    setExitReason('');
    setPreviewError(null);
    setCommitError(null);
    setUndoError(null);
  };

  // ----- Fix unclassified deep-link -----
  // Clears the preview because the operator's grade edit will
  // invalidate the snapshot hash anyway — backend would 409 on the
  // stale token. Operator re-previews on return.
  const handleFixUnclassified = (studentId) => {
    const student = studentsById.get(studentId);
    if (!student) return;
    updateDraft({ preview: null });
    openStudentProfile(student);
  };

  // ----- Filtered search results for the exit picker -----
  const exitCandidates = useMemo(() => {
    const q = exitSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    const alreadyExiting = new Set(draft.exits.map((e) => e.student_id));
    return students
      .filter((s) => !alreadyExiting.has(s.id))
      .filter((s) => {
        const name = `${s.first_name || ''} ${s.last_name || ''}`.toLowerCase();
        return name.includes(q);
      })
      .slice(0, 8);
  }, [students, exitSearch, draft.exits]);

  const selectedSchoolName = useMemo(() => {
    if (!schools || !draft.selectedSchoolId) return '';
    const s = schools.find((x) => x.id === draft.selectedSchoolId);
    return s ? s.name : '';
  }, [schools, draft.selectedSchoolId]);

  // ----- Render -----
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">End-of-Year Grade Roll-up</h2>
          <p className="text-sm text-slate-600 mt-1">
            Preview the roll-up first. Commit writes real changes to student grades and enrollment. Undo is available immediately after commit.
          </p>
        </div>
        {(draft.selectedSchoolId || draft.preview || draft.commitSuccess) && (
          <button
            type="button"
            onClick={handleStartOver}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800"
          >
            <RotateCcw size={14} /> Start over
          </button>
        )}
      </header>

      {/* School picker */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">School</label>
        {schools === null ? (
          <div className="text-sm text-slate-500">Loading schools...</div>
        ) : schoolsError ? (
          <div className="text-sm text-rose-700">{schoolsError}</div>
        ) : schools.length === 0 ? (
          <div className="text-sm text-slate-500">No schools accessible.</div>
        ) : schools.length === 1 ? (
          <div className="text-sm text-slate-800">{schools[0].name}</div>
        ) : (
          <select
            value={draft.selectedSchoolId || ''}
            onChange={(e) => handleSchoolChange(Number(e.target.value))}
            className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </section>

      {/* Terminal-grade selector */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Terminal grade (students at this grade graduate; everyone else advances)
        </label>
        <select
          value={draft.terminalGrade}
          onChange={(e) => handleTerminalChange(e.target.value)}
          disabled={!draft.selectedSchoolId}
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
        >
          <option value="">Choose a terminal grade...</option>
          {GRADE_SEQUENCE.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </section>

      {/* Exits designation */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-800 mb-1">Designate students leaving</h3>
        <p className="text-sm text-slate-500 mb-3">
          Optional. Add any student who is leaving the school (not graduating). Most EOY runs have none.
        </p>

        {draft.exits.length > 0 && (
          <div className="mb-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 border-b border-slate-200">
                  <th className="py-1 pr-4">Student</th>
                  <th className="py-1 pr-4">Reason</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {draft.exits.map((e) => {
                  const s = studentsById.get(e.student_id);
                  const label = s
                    ? `${s.first_name || ''} ${s.last_name || ''}`.trim()
                    : `Student #${e.student_id}`;
                  return (
                    <tr key={e.student_id} className="border-b border-slate-100 last:border-0">
                      <td className="py-1 pr-4 text-slate-700">{label}</td>
                      <td className="py-1 pr-4 text-slate-700">
                        {EXIT_REASON_LABELS[e.exit_reason] || e.exit_reason}
                      </td>
                      <td className="py-1">
                        <button
                          type="button"
                          onClick={() => handleRemoveExit(e.student_id)}
                          className="text-rose-600 hover:text-rose-800"
                          aria-label="Remove exit"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[12rem]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Search student</label>
            <input
              type="text"
              value={exitSearch}
              onChange={(e) => setExitSearch(e.target.value)}
              disabled={!draft.selectedSchoolId || studentsLoading}
              placeholder="Type a name..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
            <select
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Choose reason...</option>
              {EXIT_REASONS.map((r) => (
                <option key={r} value={r}>{EXIT_REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>
        </div>

        {studentsError && (
          <div className="mt-2 text-sm text-rose-700">{studentsError}</div>
        )}

        {exitCandidates.length > 0 && (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50">
            {exitCandidates.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleAddExit(s.id, exitReason)}
                disabled={!exitReason}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-transparent"
              >
                <span className="font-medium">
                  {`${s.first_name || ''} ${s.last_name || ''}`.trim() || `Student #${s.id}`}
                </span>{' '}
                <span className="text-slate-500">— grade {s.grade}</span>
                {!exitReason && (
                  <span className="ml-2 text-xs text-slate-400">(choose a reason first)</span>
                )}
                {exitReason && <Plus size={12} className="inline ml-1 text-indigo-600" />}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Preview action */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!draft.selectedSchoolId || !draft.terminalGrade || previewLoading}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          <ArrowLeftRight size={16} />
          {previewLoading ? 'Loading preview...' : draft.preview ? 'Re-preview' : 'Preview roll-up'}
        </button>
        {previewError && (
          <div className="text-sm text-rose-700">{previewError}</div>
        )}
      </div>

      {/* Preview panel */}
      {draft.preview && (
        <StudentGradeRollupPreviewPanel
          preview={draft.preview}
          onFixUnclassified={handleFixUnclassified}
        />
      )}

      {/* Commit action */}
      {draft.preview && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {(draft.preview.unclassified || []).length > 0 ? (
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <ShieldAlert size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                Commit is disabled while unclassified students remain. Fix each one in their profile, then re-preview.
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setShowCommitGate(true); setCommitVerb(''); setCommitError(null); }}
              disabled={!canCommit}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-slate-300"
            >
              Commit roll-up
            </button>
          )}
          {commitError && (
            <div className="mt-2 text-sm text-rose-700">{commitError}</div>
          )}
        </div>
      )}

      {/* Post-commit success card */}
      {draft.commitSuccess && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <h3 className="font-semibold text-emerald-900">Roll-up committed</h3>
          <div className="mt-2 text-sm text-emerald-800">
            Run <span className="font-mono">#{String(draft.commitSuccess.run_id)}</span> for{' '}
            <span className="font-medium">{selectedSchoolName}</span>. Promoted{' '}
            {draft.commitSuccess.total_promoted}, graduated{' '}
            {draft.commitSuccess.total_graduated}, exited{' '}
            {draft.commitSuccess.total_exited}.
          </div>
          {!draft.undoSuccess && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => { setShowUndoGate(true); setUndoVerb(''); setUndoError(null); }}
                disabled={undoLoading}
                className="rounded-md border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                Undo this run
              </button>
              {undoError && (
                <div className="mt-2 text-sm text-rose-700">{undoError}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Post-undo result */}
      {draft.undoSuccess && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-800">Roll-up undone</h3>
          <div className="mt-2 text-sm text-slate-700">
            Reverted {draft.undoSuccess.reversed_count} students.
            {Array.isArray(draft.undoSuccess.skipped) && draft.undoSuccess.skipped.length > 0 && (
              <span>
                {' '}
                Skipped {draft.undoSuccess.skipped.length} students whose state had changed since the commit (see list below).
              </span>
            )}
          </div>
          {Array.isArray(draft.undoSuccess.skipped) && draft.undoSuccess.skipped.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    <th className="py-1 pr-4">Student ID</th>
                    <th className="py-1">Why not reverted</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.undoSuccess.skipped.map((s) => (
                    <tr key={s.student_id} className="border-b border-slate-100 last:border-0">
                      <td className="py-1 pr-4 font-mono text-slate-700">{s.student_id}</td>
                      <td className="py-1 text-slate-700">{skippedReasonLabel(s.reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Commit verb gate */}
      {showCommitGate && draft.preview && (
        <VerbGateDialog
          title="Commit grade roll-up"
          body={
            <>
              You are about to commit the End-of-Year roll-up for{' '}
              <span className="font-semibold">{selectedSchoolName}</span>.{' '}
              This writes real records: promoting students, graduating the terminal cohort, and exiting any designated students.
              <div className="mt-3 text-sm">
                Type <span className="font-mono font-semibold">COMMIT</span> below to confirm.
              </div>
            </>
          }
          verb="COMMIT"
          inputValue={commitVerb}
          onInputChange={setCommitVerb}
          loading={commitLoading}
          onCancel={() => { setShowCommitGate(false); setCommitVerb(''); }}
          onConfirm={handleCommitConfirm}
          confirmLabel="Confirm commit"
          confirmClassName="bg-rose-600 hover:bg-rose-700"
        />
      )}

      {/* Undo verb gate */}
      {showUndoGate && draft.commitSuccess && (
        <VerbGateDialog
          title="Undo grade roll-up"
          body={
            <>
              You are about to undo run{' '}
              <span className="font-mono">#{String(draft.commitSuccess.run_id)}</span>{' '}
              for <span className="font-semibold">{selectedSchoolName}</span>. Any students whose grade or enrollment was edited after the commit will be reported as skipped (not reverted).
              <div className="mt-3 text-sm">
                Type <span className="font-mono font-semibold">UNDO</span> below to confirm.
              </div>
            </>
          }
          verb="UNDO"
          inputValue={undoVerb}
          onInputChange={setUndoVerb}
          loading={undoLoading}
          onCancel={() => { setShowUndoGate(false); setUndoVerb(''); }}
          onConfirm={handleUndoConfirm}
          confirmLabel="Confirm undo"
          confirmClassName="bg-rose-600 hover:bg-rose-700"
        />
      )}
    </div>
  );
}

// ============================================
// Inline verb-gate dialog (not extracted to a separate component because
// it's used in exactly two sites in this file; extracting would be
// premature abstraction).
// ============================================
function VerbGateDialog({
  title, body, verb, inputValue, onInputChange,
  loading, onCancel, onConfirm, confirmLabel, confirmClassName,
}) {
  const enabled = inputValue === verb && !loading;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold text-lg text-slate-800">{title}</h3>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-slate-500 hover:text-slate-700 disabled:opacity-50"
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 text-sm text-slate-700">{body}</div>
        <div className="px-4 pb-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={`Type ${verb}`}
            disabled={loading}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
          />
        </div>
        <div className="px-4 pb-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!enabled}
            className={`rounded-md px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300 ${confirmClassName}`}
          >
            {loading ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Error-message resolvers — keep all the status-code-to-copy mapping in
// one place so the renderer stays readable. None of these echo
// student-identifying data; they're generic operator-facing copy keyed
// only by the backend's status code + generic body.error string.
// ============================================
function previewErrorMessage(status, body) {
  if (status === 403) return 'You are not authorized to preview a roll-up for this school.';
  if (status === 400) {
    if (body?.error === 'Invalid exit_reason') return 'One of the exit reasons is not allowed.';
    if (body?.error === 'Invalid terminal_grade') return 'The selected terminal grade is not recognized.';
    if (body?.error === 'Exit refers to unknown student') {
      return 'One of the exit candidates is no longer in this school. Remove them and re-preview.';
    }
    return 'The preview request was invalid. Check your selections and try again.';
  }
  if (status === 401) return 'Your session has expired. Please log in again.';
  return 'Something went wrong while loading the preview. Please try again.';
}

function commitErrorMessage(status, body) {
  if (status === 403) return 'You are not authorized to commit this roll-up.';
  if (status === 401) {
    if (body?.error === 'Invalid preview token') {
      return 'The preview is invalid. Please re-preview.';
    }
    return 'Your session has expired. Please log in again.';
  }
  if (status === 410) return 'The preview expired (15-minute limit). Please re-preview.';
  if (status === 409) return 'Student records changed since your preview. Please re-preview.';
  if (status === 422) return 'Some students still have unrecognized grades. Fix them and re-preview.';
  if (status === 429) return 'Too many roll-up actions recently. Please wait a moment and try again.';
  return 'Something went wrong while committing. Please try again.';
}

function undoErrorMessage(status /* , body */) {
  if (status === 403) return 'You are not authorized to undo this run.';
  if (status === 404) return 'Run not found.';
  if (status === 409) return 'This run has already been undone.';
  if (status === 429) return 'Too many roll-up actions recently. Please wait a moment and try again.';
  return 'Something went wrong while undoing. Please try again.';
}

function skippedReasonLabel(reason) {
  switch (reason) {
    case 'state_diverged':
      return 'Student grade or enrollment was edited after the commit. Not reverted.';
    case 'unexpected_state':
      return 'Could not revert (unexpected state). Not reverted.';
    case 'student_missing':
      return 'Student record no longer exists. Not reverted.';
    case 'unknown_action':
      return 'Original action could not be reversed. Not reverted.';
    default:
      return 'Not reverted.';
  }
}
