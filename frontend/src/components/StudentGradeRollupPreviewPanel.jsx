// StudentGradeRollupPreviewPanel — pure presentational. Renders the
// /api/student-grade-rollup/preview response with the safety surfaces
// the operator needs:
//
//   1. Unclassified banner — TOP, prominent, blocking. Each unclassified
//      student is one row with a "Fix in profile" deep-link. Commit is
//      gated on `unclassified.length === 0` in the parent view; this
//      component just renders the banner.
//   2. Transition counts — rendered as "from -> to (N students)" using
//      a locally-derived ADVANCE_MAP. ADVANCE_MAP is NOT exported by
//      the ESM constants mirror (drift hazard would become 3-writer);
//      we re-derive from GRADE_SEQUENCE to keep it at 2 writers.
//   3. Exit list — synthetic-name-safe (we render whatever last_name
//      the BE returned). EXIT_REASON_LABELS supplies the display
//      strings.
//   4. Totals summary.
//   5. Token expiry countdown — ticks every second; when it crosses 0
//      we show "expired" text and rely on the parent to disable Commit.
//
// All student IDs surfaced here are tenant-internal integers, not §4B
// PII (consistent with disciplineReferrals precedent + the BE /preview
// response contract that already returns id + grade as the unclassified
// shape).

import { useEffect, useState } from 'react';
import { AlertTriangle, GraduationCap, Clock } from 'lucide-react';
import {
  GRADE_SEQUENCE,
  EXIT_REASON_LABELS,
} from '../constants/gradeProgression';

// Re-derive ADVANCE_MAP from GRADE_SEQUENCE locally. Byte-identical to
// the BE construction at constants/gradeProgression.js — both share
// GRADE_SEQUENCE as the single source, so the only drift hazard is the
// sequence list itself (already documented in the ESM mirror's header).
const ADVANCE_MAP = GRADE_SEQUENCE.reduce((map, grade, idx) => {
  map[grade] = idx < GRADE_SEQUENCE.length - 1 ? GRADE_SEQUENCE[idx + 1] : null;
  return map;
}, {});

// Resolve a transition_counts key like "Pre-K_to_next" or "5th_to_graduate"
// into { fromGrade, destination, isGraduate }. We split on the LAST
// occurrence of "_to_" to be tolerant of grade names that might contain
// "_to_" themselves (none currently do — the sequence is hyphen-only —
// but defensive).
function parseTransitionKey(key) {
  const idx = key.lastIndexOf('_to_');
  if (idx === -1) return null;
  const fromGrade = key.slice(0, idx);
  const suffix = key.slice(idx + 4);
  if (suffix === 'graduate') {
    return { fromGrade, destination: 'Graduate', isGraduate: true };
  }
  // suffix === 'next' — look up via ADVANCE_MAP
  return {
    fromGrade,
    destination: ADVANCE_MAP[fromGrade] || '?',
    isGraduate: false,
  };
}

function useTimeRemaining(expiresAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return undefined;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return { expired: true, mm: 0, ss: 0 };
  const totalSec = Math.floor(remainingMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return { expired: false, mm, ss };
}

export default function StudentGradeRollupPreviewPanel({
  preview,
  onFixUnclassified,
}) {
  const remaining = useTimeRemaining(preview?.expires_at);

  if (!preview) return null;

  const unclassified = Array.isArray(preview.unclassified) ? preview.unclassified : [];
  const exits = Array.isArray(preview.exits) ? preview.exits : [];
  const transitionCounts = preview.transition_counts || {};
  const toGraduateCount = preview.to_graduate_count || 0;

  // Build rendered transition rows in GRADE_SEQUENCE order. Skip rows
  // with zero count so the table only shows what's actually moving.
  const transitionRows = [];
  for (const fromGrade of GRADE_SEQUENCE) {
    for (const suffix of ['next', 'graduate']) {
      const key = `${fromGrade}_to_${suffix}`;
      const count = transitionCounts[key];
      if (typeof count === 'number' && count > 0) {
        const parsed = parseTransitionKey(key);
        if (parsed) {
          transitionRows.push({ ...parsed, count, key });
        }
      }
    }
  }

  const promotedTotal = transitionRows
    .filter((r) => !r.isGraduate)
    .reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="mt-6 space-y-6">
      {unclassified.length > 0 && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={22} />
            <div className="flex-1">
              <div className="font-semibold text-amber-900">
                {unclassified.length} student{unclassified.length === 1 ? '' : 's'} have grades the roll-up does not recognize.
              </div>
              <div className="text-sm text-amber-800 mt-1">
                Fix each student's grade in their profile before committing. Commit is disabled until every unclassified student is resolved.
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-amber-900 border-b border-amber-300">
                      <th className="py-1 pr-4">Student ID</th>
                      <th className="py-1 pr-4">Current grade</th>
                      <th className="py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unclassified.map((u) => (
                      <tr key={u.id} className="border-b border-amber-200 last:border-0">
                        <td className="py-1 pr-4 font-mono text-amber-900">{u.id}</td>
                        <td className="py-1 pr-4 text-amber-900">
                          <code className="bg-amber-100 px-1.5 py-0.5 rounded">{u.grade}</code>
                        </td>
                        <td className="py-1">
                          <button
                            type="button"
                            onClick={() => onFixUnclassified && onFixUnclassified(u.id)}
                            className="text-amber-900 underline hover:text-amber-700"
                          >
                            Open profile to fix
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="font-semibold text-slate-800 mb-3">Transitions</h4>
        {transitionRows.length === 0 ? (
          <div className="text-sm text-slate-500">No students would change grade.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 border-b border-slate-200">
                <th className="py-1 pr-4">From</th>
                <th className="py-1 pr-4">To</th>
                <th className="py-1">Students</th>
              </tr>
            </thead>
            <tbody>
              {transitionRows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-4 text-slate-700">{row.fromGrade}</td>
                  <td className="py-1 pr-4">
                    {row.isGraduate ? (
                      <span className="inline-flex items-center gap-1 italic text-indigo-700">
                        <GraduationCap size={14} /> Graduate
                      </span>
                    ) : (
                      <span className="text-slate-700">{row.destination}</span>
                    )}
                  </td>
                  <td className="py-1 text-slate-700">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {exits.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="font-semibold text-slate-800 mb-3">Students leaving the school</h4>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 border-b border-slate-200">
                <th className="py-1 pr-4">Student ID</th>
                <th className="py-1">Reason</th>
              </tr>
            </thead>
            <tbody>
              {exits.map((e) => (
                <tr key={e.student_id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-4 font-mono text-slate-700">{e.student_id}</td>
                  <td className="py-1 text-slate-700">
                    {EXIT_REASON_LABELS[e.exit_reason] || e.exit_reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <span className="text-slate-500">Promoted:</span>{' '}
          <span className="font-semibold text-slate-800">{promotedTotal}</span>
        </div>
        <div>
          <span className="text-slate-500">Graduated:</span>{' '}
          <span className="font-semibold text-slate-800">{toGraduateCount}</span>
        </div>
        <div>
          <span className="text-slate-500">Exited:</span>{' '}
          <span className="font-semibold text-slate-800">{exits.length}</span>
        </div>
        <div>
          <span className="text-slate-500">Unclassified:</span>{' '}
          <span className={`font-semibold ${unclassified.length > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
            {unclassified.length}
          </span>
        </div>
        {remaining && (
          <div className="ml-auto flex items-center gap-1.5 text-slate-600">
            <Clock size={14} />
            {remaining.expired ? (
              <span className="text-rose-700 font-semibold">Token expired — re-preview</span>
            ) : (
              <span>
                Token expires in{' '}
                <span className="font-mono">
                  {remaining.mm}:{String(remaining.ss).padStart(2, '0')}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
