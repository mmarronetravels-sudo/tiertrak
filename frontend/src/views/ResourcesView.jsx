import { useState, useEffect, useRef, Component } from 'react';
import { Download, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { RESOURCES } from '../resources';
import { logError } from '../utils/logError';

/**
 * Tier 1 Resources — browseable list of downloadable templates.
 *
 * Renders one card per entry in the static RESOURCES manifest. Each card
 * has a .docx download button (for editing in Word), a markdown download
 * link (for version control / diffing), and an expandable in-app preview
 * that renders the bundled markdown content.
 *
 * `selectedResourceId` is an optional entry point: if provided, the matching
 * card expands automatically and scrolls into view on mount / prop change.
 * Phase C will drive this prop from the Tier 1 Results modal's "See the
 * related resource" affordance.
 *
 * No PII is rendered here — the resources are blank templates.
 */

// Per-card error boundary for react-markdown. Duplicated from
// Tier1ResultsModal's identically-named class. The behavior is
// intentionally the same: if react-markdown throws on malformed
// markdown in one card, fall back to the raw string for that card
// only, so the rest of the list keeps rendering.
class MarkdownBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    logError(error, '[resources markdown]');
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

const ResourcesView = ({ selectedResourceId = null }) => {
  const [expandedId, setExpandedId] = useState(selectedResourceId);
  const cardRefs = useRef({});

  useEffect(() => {
    if (!selectedResourceId) return;
    setExpandedId(selectedResourceId);
    const node = cardRefs.current[selectedResourceId];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedResourceId]);

  const toggle = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800">Tier 1 Resources</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Templates and reference documents for your building's Tier 1 implementation.
          Download the Word version to customize for your school, or expand a card to
          preview the content inline.
        </p>
      </header>

      <div className="space-y-4">
        {RESOURCES.map((resource) => {
          const isExpanded = expandedId === resource.id;
          return (
            <article
              key={resource.id}
              ref={(el) => {
                cardRefs.current[resource.id] = el;
              }}
              className="bg-white rounded-xl border border-slate-200 shadow-sm"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                      Item {resource.itemRef}
                    </span>
                    <h2 className="text-lg font-semibold text-slate-800 mt-1">
                      {resource.title}
                    </h2>
                    <p className="text-sm text-slate-600 mt-2">
                      {resource.description}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <a
                    href={resource.files.docx}
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                  >
                    <Download size={16} />
                    Download Word
                  </a>
                  <button
                    type="button"
                    onClick={() => toggle(resource.id)}
                    className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-100 transition-colors"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {isExpanded ? 'Hide preview' : 'Show preview'}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-slate-200 bg-slate-50 p-6">
                  <MarkdownBoundary fallback={resource.markdownContent}>
                    <div className="prose prose-sm max-w-none text-slate-700">
                      <ReactMarkdown>{resource.markdownContent}</ReactMarkdown>
                    </div>
                  </MarkdownBoundary>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default ResourcesView;
