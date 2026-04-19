/**
 * Tier 1 Self-Assessment — canonical band enum → display label + style mapping.
 *
 * The backend stores one of three lowercase band enums on
 * tier1_assessments.score_band: 'implementing', 'partial', 'installing'
 * (Migration 019 CHECK constraint). The UI needs display labels and
 * consistent color treatment.
 *
 * This module is the single source of truth for both. The dashboard card
 * and the Results view import from here; don't redefine labels or styles
 * inline.
 *
 * Color choice rationale: red/amber/emerald matches the v5 spec's Green /
 * Yellow / Red band taxonomy and the existing dashboard-card colors.
 */

export const BAND_LABELS = {
  implementing: 'Implementing with Fidelity',
  partial: 'Partial Implementation',
  installing: 'Installing / Exploration',
};

// Tailwind classes for pill backgrounds/text and the 4px left-border
// accent used by the dashboard card. `barFill` is a CSS color usable by
// Recharts (which needs a hex/named color, not a Tailwind class).
export const BAND_STYLES = {
  implementing: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    border: 'border-l-emerald-500',
    barFill: '#10b981',
  },
  partial: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-l-amber-500',
    barFill: '#f59e0b',
  },
  installing: {
    bg: 'bg-rose-100',
    text: 'text-rose-800',
    border: 'border-l-rose-500',
    barFill: '#f43f5e',
  },
};

const FALLBACK_STYLE = {
  bg: 'bg-slate-100',
  text: 'text-slate-800',
  border: 'border-l-slate-400',
  barFill: '#94a3b8',
};

export function getBandLabel(band) {
  return BAND_LABELS[band] || 'Unknown';
}

export function getBandStyle(band) {
  return BAND_STYLES[band] || FALLBACK_STYLE;
}
