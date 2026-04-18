import { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { logError } from '../../utils/logError';

/**
 * Tier 1 Self-Assessment — Results view modal (Part 1: scaffold only).
 *
 * This file exists to:
 *   - Establish the modal shell, prop shape, and fetch/error plumbing.
 *   - Replace the dashboard's Coming-soon placeholder alert on "View Results".
 *
 * Part 2 will replace the placeholder body with the actual results UI
 * (percentage, band pill, domain bar chart, strengths/growth, recommendations
 * rendered with react-markdown, trend). Nothing in the body below is final.
 *
 * Notes are NOT displayed in Results — they're the highest-PII-risk field
 * and are deliberately excluded from v1 Results, matching the formal PDF's
 * established posture (Step 8). Do not re-introduce Notes rendering here
 * without revisiting the v5 spec's "Data handling — PII and privacy notes".
 */
const Tier1ResultsModal = ({ assessmentId, user, API_URL, onClose }) => {
  const [loading, setLoading] = useState(true);
  // null | 'not_found' | 'not_complete' | 'generic'
  const [error, setError] = useState(null);
  const [assessment, setAssessment] = useState(null);
  // responses are fetched in Part 1 so Part 2 has the full payload ready.
  // They are not rendered anywhere in Part 1.
  // eslint-disable-next-line no-unused-vars
  const [responses, setResponses] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(
          `${API_URL}/tier1-assessments/${assessmentId}`,
          { credentials: 'include' }
        );
        if (cancelled) return;

        if (res.status === 404) {
          setError('not_found');
          setLoading(false);
          return;
        }
        if (!res.ok) {
          setError('generic');
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        if (!data.assessment || data.assessment.status !== 'completed') {
          setError('not_complete');
          setLoading(false);
          return;
        }

        setAssessment(data.assessment);
        setResponses(data.responses || []);
        setLoading(false);
      } catch (err) {
        // Log technical details for debugging only (matches logError pattern
        // used by other modals — console.error). User-facing copy is kept
        // generic to avoid leaking backend internals or assessment context.
        logError(err, '[tier1 results modal]');
        if (!cancelled) {
          setError('generic');
          setLoading(false);
        }
      }
    };
    fetchData();
    return () => { cancelled = true; };
    // assessmentId is effectively a key for this modal instance; intentional
    // empty dep list so we don't re-fetch on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Loading ---------------------------------------------------------
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center">
          <p className="text-slate-600">Loading…</p>
        </div>
      </div>
    );
  }

  // --- Error -----------------------------------------------------------
  if (error) {
    const message =
      error === 'not_found'
        ? 'This assessment could not be found.'
        : error === 'not_complete'
        ? "This assessment isn't complete yet."
        : 'Something went wrong. Please try again.';
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
          <div className="flex items-center gap-2 mb-2 text-rose-700">
            <AlertCircle className="w-5 h-5" />
            <h3 className="font-semibold">Results unavailable</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">{message}</p>
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

  // --- Ready (placeholder body; Part 2 replaces) -----------------------
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">
              Tier 1 Self-Assessment — Results
            </h3>
            <p className="text-sm text-slate-500">
              Completed{' '}
              {assessment.completed_at
                ? new Date(assessment.completed_at).toLocaleDateString()
                : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-slate-600">Results view — content coming in Part 2.</p>
        </div>
      </div>
    </div>
  );
};

export default Tier1ResultsModal;
