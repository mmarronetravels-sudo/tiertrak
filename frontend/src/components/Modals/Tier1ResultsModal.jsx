import { useState, useEffect, Component } from 'react';
import { X, AlertCircle, Printer, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { logError } from '../../utils/logError';
import { BAND_LABELS, getBandLabel, getBandStyle } from '../../utils/tier1Bands';
import { generateTier1AssessmentPdf } from '../../utils/tier1Pdf';

/**
 * Tier 1 Self-Assessment — Results view modal (Step 5).
 *
 * Renders the completed assessment's overall percentage + band, a
 * domain-level bar chart, strength and growth item lists, markdown-
 * rendered recommendations for growth items, and a trend line across
 * prior completed assessments in the tenant.
 *
 * Notes are NOT displayed here by design. Notes are the highest-PII-risk
 * field; the formal PDF omits them (Step 8), and Results matches that
 * posture. Do not re-introduce Notes rendering without revisiting the v5
 * spec's "Data handling — PII and privacy notes".
 *
 * Error-state copy is generic — no backend details, no assessment context
 * surfaced in user-facing messages. Logs go through logError (console
 * only) for debugging.
 */

// Verbatim score labels from the v5 spec. Duplicated from the wizard's
// identically-named constant for locality; the strings are author-stable.
const SCORE_LABELS = {
  0: 'Not in place',
  1: 'Partially in place',
  2: 'Fully in place',
};

// Error boundary for a single recommendation block. If react-markdown
// throws on malformed content (very rare under default config, but the
// recommendation strings do contain blockquotes and mixed bullets),
// falls back to plain text for that item only so the section as a
// whole doesn't crash.
class MarkdownBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    logError(error, '[tier1 results markdown]');
  }
  render() {
    if (this.state.hasError) {
      return (
        <pre className="whitespace-pre-wrap text-sm text-slate-700">
          {this.props.fallback}
        </pre>
      );
    }
    return this.props.children;
  }
}

const formatDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch (_) {
    return '';
  }
};

const Tier1ResultsModal = ({ assessmentId, user, API_URL, onClose }) => {
  // Main fetch state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // 'not_found' | 'not_complete' | 'generic' | null
  const [assessment, setAssessment] = useState(null);
  const [responses, setResponses] = useState([]);
  const [itemBank, setItemBank] = useState(null);

  // Trend fetch is independent — doesn't block main content.
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState(false);
  const [trend, setTrend] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadMain = async () => {
      try {
        const [assessRes, bankRes] = await Promise.all([
          fetch(`${API_URL}/tier1-assessments/${assessmentId}`, {
            credentials: 'include',
          }),
          fetch(`${API_URL}/tier1-assessments/item-bank`, {
            credentials: 'include',
          }),
        ]);
        if (cancelled) return;

        if (assessRes.status === 404) {
          setError('not_found');
          setLoading(false);
          return;
        }
        if (!assessRes.ok || !bankRes.ok) {
          setError('generic');
          setLoading(false);
          return;
        }

        const assessData = await assessRes.json();
        const bankData = await bankRes.json();
        if (cancelled) return;

        if (!assessData.assessment || assessData.assessment.status !== 'completed') {
          setError('not_complete');
          setLoading(false);
          return;
        }

        setAssessment(assessData.assessment);
        setResponses(assessData.responses || []);
        setItemBank(bankData);
        setLoading(false);
      } catch (err) {
        logError(err, '[tier1 results modal]');
        if (!cancelled) {
          setError('generic');
          setLoading(false);
        }
      }
    };

    const loadTrend = async () => {
      try {
        // Default filters: non-archived. Server sorts completed_at DESC;
        // we'll reverse client-side for chronological display.
        const res = await fetch(`${API_URL}/tier1-assessments`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (!res.ok) {
          setTrendError(true);
          setTrendLoading(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const completed = (data.assessments || [])
          .filter((a) => a.status === 'completed')
          .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
        setTrend(completed);
        setTrendLoading(false);
      } catch (err) {
        logError(err, '[tier1 results trend]');
        if (!cancelled) {
          setTrendError(true);
          setTrendLoading(false);
        }
      }
    };

    loadMain();
    loadTrend();
    return () => {
      cancelled = true;
    };
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

  // --- Derived data ---------------------------------------------------
  const pct =
    assessment.overall_percentage != null
      ? parseFloat(assessment.overall_percentage)
      : null;
  const band = assessment.score_band;
  const bandLabel = getBandLabel(band);
  const bandStyle = getBandStyle(band);
  const hasKnownBand = !!BAND_LABELS[band];

  const items = (itemBank && itemBank.items) || [];
  const domains = (itemBank && itemBank.domains) || [];

  // responseByItemId: item_id -> response row. Used for every lookup.
  const responseByItemId = new Map();
  for (const r of responses) responseByItemId.set(r.item_id, r);

  // Per-domain percentages for the bar chart. Computed client-side; the
  // backend returns raw responses, not aggregates.
  const domainScores = domains.map((d) => {
    const domainItems = items.filter((it) => it.domain === d.number);
    const max = domainItems.length * 2;
    let score = 0;
    for (const it of domainItems) {
      const r = responseByItemId.get(it.id);
      if (r && (r.score === 0 || r.score === 1 || r.score === 2)) {
        score += r.score;
      }
    }
    const percentage = max > 0 ? (score / max) * 100 : 0;
    return {
      number: d.number,
      title: d.title,
      score,
      max,
      percentage,
      // Short y-axis label so the chart doesn't need enormous left margin.
      short: `D${d.number}`,
    };
  });

  // Strengths (score === 2) and growth (score === 0). Iterate items so
  // the order matches the item bank (1.1, 1.2, 1.3, … 8.3) rather than
  // response-insert order.
  const strengths = [];
  const growth = [];
  const domainTitleByNumber = new Map(domains.map((d) => [d.number, d.title]));
  for (const it of items) {
    const r = responseByItemId.get(it.id);
    if (!r) continue;
    const row = {
      id: it.id,
      title: it.title,
      recommendation: it.recommendation,
      domainTitle: domainTitleByNumber.get(it.domain) || '',
    };
    if (r.score === 2) strengths.push(row);
    else if (r.score === 0) growth.push(row);
  }

  // Trend: show whenever there are ≥ 2 completed non-archived assessments
  // (including the one currently being viewed). Fewer than 2 → section
  // omitted entirely.
  const showTrend = !trendError && trend.length >= 2;
  const trendData = showTrend
    ? trend.map((a) => ({
        dateIso: a.completed_at,
        dateLabel: new Date(a.completed_at).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        percentage: parseFloat(a.overall_percentage),
        band: a.score_band,
      }))
    : [];

  // Custom trend tooltip — date + % + band label, no backend fields
  // surfaced, no PII path.
  const TrendTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const pt = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs">
        <div className="font-medium text-slate-800">
          {new Date(pt.dateIso).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </div>
        <div className="text-slate-600">
          {pt.percentage.toFixed(1)}% — {getBandLabel(pt.band)}
        </div>
      </div>
    );
  };

  // --- Render ---------------------------------------------------------
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:bg-white print:block print:relative print:p-0"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:overflow-visible"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — title + completion date are preserved in print as the
            printed header. Action buttons (Print, Close) are hidden in
            print via the wrapper below. */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">
              Tier 1 Self-Assessment — Results
            </h3>
            <p className="text-sm text-slate-500">
              Completed {formatDate(assessment.completed_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() =>
                generateTier1AssessmentPdf({
                  assessment,
                  responses,
                  itemBank,
                  schoolName: (user && user.tenant_name) || null,
                })
              }
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              <Download size={18} />
              Download PDF
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              <Printer size={18} />
              Print
            </button>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 print:overflow-visible print:p-0">
          {/* Overall score + band */}
          <section>
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                  Overall score
                </div>
                <div className="text-5xl font-semibold text-slate-800 leading-none">
                  {pct != null ? `${pct.toFixed(1)}%` : '—'}
                </div>
                {assessment.total_score != null && assessment.max_score != null && (
                  <div className="text-sm text-slate-500 mt-1">
                    {assessment.total_score} of {assessment.max_score} points
                  </div>
                )}
              </div>
              {hasKnownBand && (
                // print:border gives the pill a visible outline even when
                // browsers drop background tints (most "simplified" print
                // settings). The colored text from bandStyle.text still
                // renders, so the band stays legible.
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${bandStyle.bg} ${bandStyle.text} print:border print:border-slate-300`}
                >
                  {bandLabel}
                </span>
              )}
            </div>
          </section>

          {/* Domain bar chart */}
          <section className="print:break-inside-avoid">
            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Score by domain
            </h4>
            <div className="w-full" style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={domainScores}
                  layout="vertical"
                  margin={{ top: 5, right: 48, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="title"
                    width={220}
                    tick={{ fontSize: 12, fill: '#475569' }}
                    interval={0}
                  />
                  <Tooltip
                    formatter={(v, _name, entry) => [
                      `${v.toFixed(1)}% (${entry.payload.score}/${entry.payload.max})`,
                      'Score',
                    ]}
                  />
                  <Bar dataKey="percentage" fill={bandStyle.barFill} radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="percentage"
                      position="right"
                      formatter={(v) => `${v.toFixed(0)}%`}
                      style={{ fontSize: 11, fill: '#475569' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Strengths */}
          {strengths.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                Strengths
              </h4>
              <p className="text-xs text-slate-500 mb-2">
                Items scored {SCORE_LABELS[2]}.
              </p>
              <ul className="space-y-2">
                {strengths.map((it) => (
                  <li
                    key={it.id}
                    className="p-3 rounded-lg border border-slate-200 bg-emerald-50/30 print:break-inside-avoid"
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-mono text-slate-400">{it.id}</span>
                      <span className="text-sm font-medium text-slate-800">
                        {it.title}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{it.domainTitle}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Growth items (list) */}
          {growth.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                Growth areas
              </h4>
              <p className="text-xs text-slate-500 mb-2">
                Items scored {SCORE_LABELS[0]}.
              </p>
              <ul className="space-y-2">
                {growth.map((it) => (
                  <li
                    key={it.id}
                    className="p-3 rounded-lg border border-slate-200 bg-rose-50/30 print:break-inside-avoid"
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-mono text-slate-400">{it.id}</span>
                      <span className="text-sm font-medium text-slate-800">
                        {it.title}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{it.domainTitle}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Prioritized recommendations */}
          <section>
            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Prioritized recommendations
            </h4>
            {growth.length === 0 ? (
              <p className="text-sm text-slate-600">
                No immediate growth areas identified at this time.
              </p>
            ) : (
              <div className="space-y-5">
                {growth.map((it) => (
                  <div key={it.id} className="border border-slate-200 rounded-lg p-4 print:break-inside-avoid">
                    <div className="flex items-baseline gap-2 flex-wrap mb-2">
                      <span className="text-xs font-mono text-slate-400">{it.id}</span>
                      <span className="text-sm font-semibold text-slate-800">
                        {it.title}
                      </span>
                      <span className="text-xs text-slate-500">— {it.domainTitle}</span>
                    </div>
                    {it.recommendation ? (
                      <MarkdownBoundary fallback={it.recommendation}>
                        <div className="prose prose-sm max-w-none text-slate-700">
                          <ReactMarkdown>{it.recommendation}</ReactMarkdown>
                        </div>
                      </MarkdownBoundary>
                    ) : (
                      <p className="text-sm text-slate-500 italic">
                        No recommendation text available.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Trend across prior completed assessments */}
          <section className="print:break-inside-avoid">
            {trendLoading && (
              <p className="text-xs text-slate-500">Loading trend…</p>
            )}
            {trendError && !trendLoading && (
              <p className="text-xs text-slate-500">Trend data unavailable.</p>
            )}
            {showTrend && (
              <>
                <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                  Trend across assessments
                </h4>
                <div className="w-full" style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={trendData}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 12, fill: '#475569' }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 12, fill: '#475569' }}
                      />
                      <Tooltip content={<TrendTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="percentage"
                        stroke="#4f46e5"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Tier1ResultsModal;
