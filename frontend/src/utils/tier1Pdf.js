import { jsPDF } from 'jspdf';
import { getBandLabel } from './tier1Bands';

/**
 * Tier 1 Self-Assessment — downloadable PDF export (Step 8).
 *
 * Client-side only. No network calls, no third-party services, no email.
 * The caller fetches assessment/responses/itemBank from the existing API
 * and hands them in. This module only draws.
 *
 * Exclusions, fixed v1 posture (CLAUDE.md §4B):
 *   - Notes are NEVER read from `responses`. This module must contain
 *     zero `.notes` reads.
 *   - No student/staff names are surfaced anywhere.
 *   - No trend chart, no evidence URLs.
 *
 * Markdown handling is scoped to what actually appears in the item bank
 * (verified by feature-scan of all 30 recommendations):
 *   - Paragraphs (blank-line separation)
 *   - Unordered lists (`- ` or `* ` at line start)
 *   - Blockquotes (`> ` at line start) with optional ordered lists inside
 *   - Inline bold (`**text**`) and italic (`*text*`)
 * Headings, links, code, HR, and tables are not used in the item bank and
 * are not handled here.
 */

// ─── Page geometry (letter, points) ─────────────────────────────────────
const PAGE_W = 8.5 * 72; // 612
const PAGE_H = 11 * 72; // 792
const MARGIN_L = 54; // 0.75"
const MARGIN_R = 54;
const MARGIN_T = 54;
const MARGIN_B_CONTENT = 72; // leave space for footer
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

// ─── Typography ─────────────────────────────────────────────────────────
const FONT = {
  title: 22,
  subtitle: 11,
  sectionHeading: 13,
  itemHeading: 11,
  body: 10,
  caption: 9,
  footer: 8,
};
const LH = {
  body: 14, // line height for 10pt body text
  caption: 12,
  itemHeading: 14,
  sectionHeading: 18,
};

// ─── Filename helpers ───────────────────────────────────────────────────

function sanitizeForFilename(s) {
  if (!s) return '';
  return s
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isoDateOf(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch (_) {
    return '';
  }
}

function makeFilename(schoolName, completedAtIso) {
  const school = sanitizeForFilename(schoolName);
  const date = isoDateOf(completedAtIso);
  const parts = ['Tier1-Assessment', school, date].filter(Boolean);
  return `${parts.join('-')}.pdf`;
}

// ─── Display helpers ────────────────────────────────────────────────────

function formatLongDate(iso) {
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
}

function formatTimestamp(date) {
  try {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (_) {
    return date.toISOString();
  }
}

// ─── Markdown parsing ───────────────────────────────────────────────────

// Parse inline ** and * into an array of style runs. Tolerates unbalanced
// markers (stops styling at end of string). Never throws on user content.
function parseInlineRuns(text) {
  const runs = [];
  let i = 0;
  let buf = '';
  let bold = false;
  let italic = false;
  const flush = () => {
    if (buf) {
      runs.push({ text: buf, bold, italic });
      buf = '';
    }
  };
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      flush();
      bold = !bold;
      i += 2;
    } else if (text[i] === '*') {
      flush();
      italic = !italic;
      i += 1;
    } else {
      buf += text[i];
      i += 1;
    }
  }
  flush();
  return runs;
}

// Convert a raw markdown string to an array of blocks. Each block has a
// type and an array of runs (or a nested list of runs-arrays for list
// items).
//
// Block types:
//   { type: 'paragraph',        runs }
//   { type: 'bullet',           runs, ordered?: false, number?: null }
//   { type: 'bullet',           runs, ordered: true,   number: N }
//   { type: 'quote-paragraph',  runs }
//   { type: 'quote-bullet',     runs, ordered, number }
function flattenMarkdown(md) {
  if (!md || typeof md !== 'string') return [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let currentPara = null; // accumulate multi-line paragraphs
  let currentQuotePara = null;

  const pushPara = () => {
    if (currentPara) {
      blocks.push({ type: 'paragraph', runs: parseInlineRuns(currentPara.trim()) });
      currentPara = null;
    }
  };
  const pushQuotePara = () => {
    if (currentQuotePara) {
      blocks.push({
        type: 'quote-paragraph',
        runs: parseInlineRuns(currentQuotePara.trim()),
      });
      currentQuotePara = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    // Blank line: paragraph break.
    if (trimmed === '') {
      pushPara();
      pushQuotePara();
      continue;
    }

    // Blockquote prefix. Within a blockquote the content can still be
    // a plain line, a bullet, or an ordered item.
    if (/^\s*>\s?/.test(line)) {
      pushPara();
      const inner = line.replace(/^\s*>\s?/, '');
      const innerTrim = inner.trim();
      if (innerTrim === '') {
        pushQuotePara();
        continue;
      }
      // ordered list within quote (e.g., "1. Step one")
      const om = innerTrim.match(/^(\d+)\.\s+(.*)$/);
      if (om) {
        pushQuotePara();
        blocks.push({
          type: 'quote-bullet',
          runs: parseInlineRuns(om[2]),
          ordered: true,
          number: parseInt(om[1], 10),
        });
        continue;
      }
      // bullet within quote
      const bm = innerTrim.match(/^[-*]\s+(.*)$/);
      if (bm) {
        pushQuotePara();
        blocks.push({
          type: 'quote-bullet',
          runs: parseInlineRuns(bm[1]),
          ordered: false,
          number: null,
        });
        continue;
      }
      // plain quote paragraph (accumulate across soft line-breaks)
      currentQuotePara = currentQuotePara
        ? currentQuotePara + ' ' + innerTrim
        : innerTrim;
      continue;
    }

    // End any pending quote paragraph before leaving quote context.
    pushQuotePara();

    // Unordered list item.
    const bm = trimmed.match(/^[-*]\s+(.*)$/);
    if (bm) {
      pushPara();
      blocks.push({
        type: 'bullet',
        runs: parseInlineRuns(bm[1]),
        ordered: false,
        number: null,
      });
      continue;
    }

    // Ordered list item.
    const om = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (om) {
      pushPara();
      blocks.push({
        type: 'bullet',
        runs: parseInlineRuns(om[2]),
        ordered: true,
        number: parseInt(om[1], 10),
      });
      continue;
    }

    // Plain paragraph (accumulate across soft line-breaks).
    currentPara = currentPara ? currentPara + ' ' + trimmed : trimmed;
  }

  pushPara();
  pushQuotePara();
  return blocks;
}

// ─── Domain aggregation (mirrors the modal's logic) ─────────────────────

function computeDomainScores(itemBank, responses) {
  const items = (itemBank && itemBank.items) || [];
  const domains = (itemBank && itemBank.domains) || [];
  const responseByItemId = new Map();
  for (const r of responses || []) responseByItemId.set(r.item_id, r);
  return domains.map((d) => {
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
    };
  });
}

// ─── Layout primitives ──────────────────────────────────────────────────

// jsPDF font switch. Default built-in "helvetica" supports regular /
// bold / italic / bolditalic.
function setFontFor(doc, { bold = false, italic = false, size = FONT.body } = {}) {
  const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
}

// Measure a single run's width. setFontFor must have been called.
function runWidth(doc, run) {
  setFontFor(doc, run);
  return doc.getTextWidth(run.text);
}

// Word-by-word flow renderer. Draws `runs` starting at (x0, y) within
// width maxW, advancing y by lineHeight on each wrap. Returns the y of
// the line just after the last drawn line.
function drawFlowedRuns(doc, runs, x0, y, maxW, lineHeight, size = FONT.body) {
  let x = x0;
  let curY = y;
  for (const run of runs) {
    setFontFor(doc, { bold: run.bold, italic: run.italic, size });
    // Preserve whitespace runs so we don't collapse intra-run spaces.
    const tokens = run.text.split(/(\s+)/);
    for (const tok of tokens) {
      if (!tok) continue;
      const w = doc.getTextWidth(tok);
      const isWhitespace = /^\s+$/.test(tok);
      if (x + w > x0 + maxW && x > x0) {
        curY += lineHeight;
        x = x0;
        if (isWhitespace) continue; // don't start the new line with spaces
      }
      doc.text(tok, x, curY);
      x += w;
    }
  }
  return curY + lineHeight;
}

// Rough height estimate for a block at width maxW (used for page-break
// decisions before drawing). Slightly conservative — adds one line worth
// of slack so we don't split mid-block.
function estimateBlockHeight(doc, block, maxW) {
  const runs = block.runs || [];
  const size = FONT.body;
  setFontFor(doc, { size });
  let x = 0;
  let lines = 1;
  for (const run of runs) {
    setFontFor(doc, { bold: run.bold, italic: run.italic, size });
    const tokens = run.text.split(/(\s+)/);
    for (const tok of tokens) {
      if (!tok) continue;
      const w = doc.getTextWidth(tok);
      const isWs = /^\s+$/.test(tok);
      if (x + w > maxW && x > 0) {
        lines += 1;
        x = 0;
        if (isWs) continue;
      }
      x += w;
    }
  }
  return lines * LH.body + 4;
}

// ─── Section renderers ──────────────────────────────────────────────────

function drawHeader(doc, { schoolName, completedAt, overallPct, bandLabel, generatedAt }) {
  let y = MARGIN_T;

  setFontFor(doc, { bold: true, size: FONT.title });
  doc.setTextColor(17, 24, 39); // slate-900
  doc.text('Tier 1 Self-Assessment Report', MARGIN_L, y + FONT.title);
  y += FONT.title + 8;

  setFontFor(doc, { size: FONT.subtitle });
  doc.setTextColor(71, 85, 105); // slate-600
  const subtitleParts = [];
  if (schoolName) subtitleParts.push(schoolName);
  const completedText = formatLongDate(completedAt);
  if (completedText) subtitleParts.push(`Completed ${completedText}`);
  if (subtitleParts.length > 0) {
    doc.text(subtitleParts.join('  ·  '), MARGIN_L, y + FONT.subtitle);
    y += FONT.subtitle + 12;
  }

  // Overall score block: big number + band label.
  setFontFor(doc, { size: FONT.caption });
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text('OVERALL SCORE', MARGIN_L, y + FONT.caption);
  y += FONT.caption + 4;

  setFontFor(doc, { bold: true, size: 32 });
  doc.setTextColor(15, 23, 42); // slate-900
  const pctText = overallPct != null ? `${overallPct.toFixed(1)}%` : '—';
  doc.text(pctText, MARGIN_L, y + 32);
  const pctWidth = doc.getTextWidth(pctText);

  if (bandLabel) {
    setFontFor(doc, { size: FONT.body });
    doc.setTextColor(51, 65, 85); // slate-700
    doc.text(`— ${bandLabel}`, MARGIN_L + pctWidth + 10, y + 28);
  }
  y += 40;

  // Generation timestamp.
  setFontFor(doc, { italic: true, size: FONT.caption });
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on ${formatTimestamp(generatedAt)}`, MARGIN_L, y + FONT.caption);
  y += FONT.caption + 16;

  // Horizontal rule.
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.5);
  doc.line(MARGIN_L, y, MARGIN_L + CONTENT_W, y);
  y += 12;

  doc.setTextColor(0, 0, 0);
  return y;
}

function drawSectionHeading(doc, text, y) {
  setFontFor(doc, { bold: true, size: FONT.sectionHeading });
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text(text, MARGIN_L, y + FONT.sectionHeading);
  doc.setTextColor(0, 0, 0);
  return y + LH.sectionHeading + 4;
}

function drawDomainChart(doc, domainScores, y) {
  // Layout: [domain title | bar | percentage]
  const rowHeight = 22;
  const labelW = 230;
  const pctW = 44;
  const barX = MARGIN_L + labelW + 8;
  const barW = CONTENT_W - labelW - pctW - 8 - 8;

  for (const d of domainScores) {
    setFontFor(doc, { size: FONT.body });
    doc.setTextColor(30, 41, 59);
    // Domain title (truncate only if extremely long — none of the current
    // 8 domain titles are).
    doc.text(d.title, MARGIN_L, y + 14);

    // Background rail.
    doc.setFillColor(226, 232, 240); // slate-200
    doc.rect(barX, y + 4, barW, 12, 'F');

    // Filled portion.
    const fillW = Math.max(0, Math.min(1, d.percentage / 100)) * barW;
    doc.setFillColor(79, 70, 229); // indigo-600
    doc.rect(barX, y + 4, fillW, 12, 'F');

    // Percentage label on the right.
    setFontFor(doc, { size: FONT.body });
    doc.setTextColor(51, 65, 85);
    doc.text(
      `${d.percentage.toFixed(0)}%`,
      MARGIN_L + CONTENT_W,
      y + 14,
      { align: 'right' }
    );

    y += rowHeight;
  }
  doc.setTextColor(0, 0, 0);
  return y + 6;
}

function drawSimpleList(doc, items, y, emptyMessage, state) {
  if (!items || items.length === 0) {
    setFontFor(doc, { italic: true, size: FONT.body });
    doc.setTextColor(100, 116, 139);
    doc.text(emptyMessage, MARGIN_L, y + FONT.body);
    doc.setTextColor(0, 0, 0);
    return y + LH.body;
  }

  for (const it of items) {
    // Page break if not enough room for at least one line.
    if (y + LH.body + 8 > PAGE_H - MARGIN_B_CONTENT) {
      doc.addPage();
      state.pages += 1;
      y = MARGIN_T;
    }
    const text = `• ${it.title}  (${it.domainTitle})`;
    const runs = [{ text, bold: false, italic: false }];
    y = drawFlowedRuns(doc, runs, MARGIN_L, y + FONT.body, CONTENT_W, LH.body) - LH.body + LH.body;
    // drawFlowedRuns returns y AFTER the final line (y + lineHeight), so
    // the caller's y is already advanced. Add a small gap before the next item.
    y += 2;
  }
  return y + 6;
}

// Draw one recommendation: item heading + flattened markdown blocks.
// Handles page breaks within the block: the heading stays with at least
// the first line of content; paragraphs/bullets flow across pages.
function drawRecommendation(doc, it, y, state) {
  // Ensure heading has room for itself + at least a couple of body lines.
  if (y + LH.itemHeading + 3 * LH.body > PAGE_H - MARGIN_B_CONTENT) {
    doc.addPage();
    state.pages += 1;
    y = MARGIN_T;
  }

  // Heading: item.title with domain in smaller italic.
  setFontFor(doc, { bold: true, size: FONT.itemHeading });
  doc.setTextColor(30, 41, 59);
  doc.text(it.title, MARGIN_L, y + FONT.itemHeading);
  y += LH.itemHeading;

  setFontFor(doc, { italic: true, size: FONT.caption });
  doc.setTextColor(100, 116, 139);
  doc.text(it.domainTitle, MARGIN_L, y + FONT.caption);
  y += LH.caption + 2;

  doc.setTextColor(0, 0, 0);

  if (!it.recommendation) {
    setFontFor(doc, { italic: true, size: FONT.body });
    doc.setTextColor(100, 116, 139);
    doc.text('No recommendation text available.', MARGIN_L, y + FONT.body);
    doc.setTextColor(0, 0, 0);
    return y + LH.body + 10;
  }

  const blocks = flattenMarkdown(it.recommendation);
  for (const block of blocks) {
    let x0 = MARGIN_L;
    let maxW = CONTENT_W;
    let prefix = null;

    if (block.type === 'bullet') {
      prefix = block.ordered ? `${block.number}. ` : '• ';
      x0 = MARGIN_L + 12;
      maxW = CONTENT_W - 12;
    } else if (block.type === 'quote-paragraph') {
      x0 = MARGIN_L + 16;
      maxW = CONTENT_W - 16;
    } else if (block.type === 'quote-bullet') {
      prefix = block.ordered ? `${block.number}. ` : '• ';
      x0 = MARGIN_L + 28; // blockquote indent + bullet indent
      maxW = CONTENT_W - 28;
    }

    // Page-break check for the next block. Use a conservative estimate.
    const needed = estimateBlockHeight(doc, block, maxW);
    if (y + needed > PAGE_H - MARGIN_B_CONTENT) {
      doc.addPage();
      state.pages += 1;
      y = MARGIN_T;
    }

    // Quote left-border rule (drawn per block line range).
    const quoteBarX = MARGIN_L + 8;
    const quoteBarStartY = y;

    // Prefix (bullet marker or ordered number): draw before the runs.
    if (prefix) {
      setFontFor(doc, { size: FONT.body });
      doc.setTextColor(51, 65, 85);
      doc.text(prefix, x0 - (block.ordered ? 18 : 10), y + FONT.body);
      doc.setTextColor(0, 0, 0);
    }

    const runs = block.runs || [];
    const endY = drawFlowedRuns(doc, runs, x0, y + FONT.body, maxW, LH.body);
    const drawnBottom = endY - LH.body + 2; // bottom of last drawn line

    // Quote left border: a vertical rule from top of block to bottom.
    if (block.type === 'quote-paragraph' || block.type === 'quote-bullet') {
      doc.setDrawColor(203, 213, 225); // slate-300
      doc.setLineWidth(1.5);
      doc.line(quoteBarX, quoteBarStartY + 2, quoteBarX, drawnBottom);
    }

    y = endY + 2;
  }
  return y + 8;
}

// ─── Footer ─────────────────────────────────────────────────────────────

function drawFooter(doc, pageNum, totalPages, schoolName, generatedAt) {
  setFontFor(doc, { size: FONT.footer });
  doc.setTextColor(148, 163, 184); // slate-400
  const yFoot = PAGE_H - 36;

  // Left: school name
  if (schoolName) {
    doc.text(schoolName, MARGIN_L, yFoot);
  }
  // Center: generated timestamp
  const ts = `Generated ${formatTimestamp(generatedAt)}`;
  doc.text(ts, PAGE_W / 2, yFoot, { align: 'center' });
  // Right: page X of Y
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN_R, yFoot, {
    align: 'right',
  });

  doc.setTextColor(0, 0, 0);
}

// ─── Main export ────────────────────────────────────────────────────────

export function generateTier1AssessmentPdf({
  assessment,
  responses,
  itemBank,
  schoolName,
}) {
  if (!assessment || !itemBank) {
    throw new Error('generateTier1AssessmentPdf: assessment and itemBank required');
  }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const state = { pages: 1 };
  const generatedAt = new Date();

  const overallPct =
    assessment.overall_percentage != null
      ? parseFloat(assessment.overall_percentage)
      : null;
  const bandLabel = assessment.score_band ? getBandLabel(assessment.score_band) : null;

  // Build strengths and growth lists (same shape as the modal).
  const items = (itemBank && itemBank.items) || [];
  const domains = (itemBank && itemBank.domains) || [];
  const responseByItemId = new Map();
  for (const r of responses || []) responseByItemId.set(r.item_id, r);
  const domainTitleByNumber = new Map(domains.map((d) => [d.number, d.title]));
  const strengths = [];
  const growth = [];
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

  const domainScores = computeDomainScores(itemBank, responses);

  // ── Header ──
  let y = drawHeader(doc, {
    schoolName: schoolName || null,
    completedAt: assessment.completed_at,
    overallPct,
    bandLabel,
    generatedAt,
  });

  // ── Domain bar chart ──
  y = drawSectionHeading(doc, 'Score by Domain', y);
  y = drawDomainChart(doc, domainScores, y);

  // Page break if strengths heading would not fit.
  if (y + LH.sectionHeading + LH.body > PAGE_H - MARGIN_B_CONTENT) {
    doc.addPage();
    state.pages += 1;
    y = MARGIN_T;
  }

  // ── Strengths ──
  y = drawSectionHeading(doc, 'Strengths — Fully In Place', y);
  y = drawSimpleList(doc, strengths, y, 'No items scored as fully in place.', state);
  y += 6;

  if (y + LH.sectionHeading + LH.body > PAGE_H - MARGIN_B_CONTENT) {
    doc.addPage();
    state.pages += 1;
    y = MARGIN_T;
  }

  // ── Growth areas ──
  y = drawSectionHeading(doc, 'Growth Areas — Not In Place', y);
  y = drawSimpleList(doc, growth, y, 'No items scored as not in place.', state);
  y += 10;

  // ── Recommendations ──
  if (growth.length > 0) {
    if (y + LH.sectionHeading + LH.body * 3 > PAGE_H - MARGIN_B_CONTENT) {
      doc.addPage();
      state.pages += 1;
      y = MARGIN_T;
    }
    y = drawSectionHeading(doc, 'Prioritized Recommendations', y);
    for (const it of growth) {
      y = drawRecommendation(doc, it, y, state);
    }
  }

  // ── Footer on every page (written last so totalPages is known) ──
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    drawFooter(doc, p, totalPages, schoolName || null, generatedAt);
  }

  // ── Save ──
  const filename = makeFilename(schoolName, assessment.completed_at);
  doc.save(filename);
}
