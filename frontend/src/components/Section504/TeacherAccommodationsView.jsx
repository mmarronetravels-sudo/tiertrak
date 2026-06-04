import { useState, useEffect } from 'react';
import { Shield, AlertCircle } from 'lucide-react';
import { logError } from '../../utils/logError';
import { listActiveAccommodationsForStudent } from './api';

// R4-B: teacher-readable finalized accommodations view for the student
// profile. Mounted instead of Section504Tab when user.role === 'teacher'.
// Process surfaces (cycles, consents, eligibility-determinations, draft
// plans) stay special-ed-team-only via Section504Tab + R4-A's backend
// role narrowing on the process handlers.
//
// Auth predicates (defense in depth):
//   - App.jsx conditionally mounts this only for user.role === 'teacher';
//     elevated roles render Section504Tab as before.
//   - The /api/student-504/plans/student/:studentId backend route is
//     gated by requireStudentReadAccess — a teacher reaches a 200 only
//     for students on their caseload (via canStaffAccessStudent's
//     caseload predicate).
//
// Tenant scoping is server-side: the request path carries :studentId
// only; tenant binding is enforced by the requireStudentReadAccess
// middleware via students.tenant_id and applyStudentAccessGate. No
// tenant_id in the URL, query, or body.
const TeacherAccommodationsView = ({ user, API_URL, student }) => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!student?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const rows = await listActiveAccommodationsForStudent(API_URL, student.id);
        if (!cancelled) setPlans(rows);
      } catch (err) {
        // err carries no PII — api.js throws a status-only Error. Safe to log.
        logError('[TeacherAccommodationsView list active plans]', err);
        if (!cancelled) setLoadError('Could not load 504 accommodations.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [API_URL, student?.id]);

  if (!student?.id) return null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={20} className="text-indigo-600" />
        <h3 className="text-lg font-semibold text-slate-800">504 Accommodations</h3>
      </div>

      {loading && <p className="text-slate-500 text-sm">Loading accommodations…</p>}

      {!loading && loadError && (
        <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 text-sm">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {!loading && !loadError && plans.length === 0 && (
        <p className="text-slate-500 text-sm">No active 504 accommodation plan on file for this student.</p>
      )}

      {!loading && !loadError && plans.length > 0 && (
        <div className="space-y-4">
          {plans.map((plan) => (
            <div key={plan.id} className="border border-slate-200 rounded p-4 bg-slate-50">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 mb-3">
                <span><strong>Status:</strong> {plan.plan_status}</span>
                {plan.effective_date && (
                  <span><strong>Effective:</strong> {plan.effective_date}</span>
                )}
                {plan.review_date && (
                  <span><strong>Review:</strong> {plan.review_date}</span>
                )}
              </div>
              {plan.accommodations && typeof plan.accommodations === 'object' && (
                <div className="space-y-3 text-sm text-slate-800">
                  {plan.accommodations.educational && (
                    <div>
                      <p className="font-medium text-slate-700 mb-1">Educational</p>
                      <p className="whitespace-pre-wrap">{plan.accommodations.educational}</p>
                    </div>
                  )}
                  {plan.accommodations.extracurricular && (
                    <div>
                      <p className="font-medium text-slate-700 mb-1">Extracurricular</p>
                      <p className="whitespace-pre-wrap">{plan.accommodations.extracurricular}</p>
                    </div>
                  )}
                  {plan.accommodations.assessments && (
                    <div>
                      <p className="font-medium text-slate-700 mb-1">Assessments</p>
                      <p className="whitespace-pre-wrap">{plan.accommodations.assessments}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TeacherAccommodationsView;
