/**
 * Tier 1 Self-Assessment — client-side PII detection for the Notes field.
 *
 * Defense-in-depth for the system-level assessment Notes input. The Tier 1
 * v5 spec explicitly states the app does not collect individual student or
 * staff names in these notes, and the backend does not run name detection
 * (that would introduce a new PII surface: detection results, logs). This
 * module reduces the rate of accidental PII capture at the input boundary
 * and lets callers surface a confirmation dialog for user override.
 *
 * Honest limitations, acknowledged in the v5 spec and here:
 *   - Regex-based detection misses first names alone (e.g., "First has
 *     been doing well").
 *   - A determined user can defeat detection by paraphrasing.
 *   - This is defense-in-depth, not a guarantee.
 *
 * Privacy contract:
 *   - Never logs the input text.
 *   - Never includes the matched substring in the return value.
 *   - Returns only a category label so callers cannot surface what tripped
 *     the detector to the user or to logs.
 *
 * Pure function. No React, no imports, no globals, no side effects.
 */

// Two consecutive capital-then-lowercase words (e.g., "First Last").
const TWO_CAP_WORDS = /\b[A-Z][a-z]{1,}\s+[A-Z][a-z]{1,}\b/;

// Title (Mr, Mrs, Ms, Mx, Dr) with optional period, then a cap word
// (e.g., "Dr. Example", "Mrs Example").
const TITLE_NAME = /\b(Mr|Mrs|Ms|Mx|Dr)\.?\s+[A-Z][a-z]+\b/;

// Possessive subject + family/guardian relation term (e.g., "Example's mom").
// The /i flag makes the relation term case-insensitive; the [A-Z][a-z]+
// subject is implicitly case-insensitive too under /i, which is a harmless
// over-detection (lowercased possessives like "example's mom" also warrant
// a review).
const POSSESSIVE_GUARDIAN =
  /\b[A-Z][a-z]+'s\s+(mom|dad|mother|father|parent|guardian|grandma|grandpa|stepmom|stepdad)\b/i;

// Runs of 5 or more consecutive digits (e.g., student IDs).
const DIGITS_5_PLUS = /\b\d{5,}\b/;

// Explicit ID phrasing (case-insensitive on "ID"). Matches sequences like
// "ID: 12345", "ID #7", "id\t42".
const ID_PREFIX = /\bID[:\s#]+\d+\b/i;

// Allow-list terms that commonly trip the name regexes in K-12 / MTSS
// context. Multi-word entries come first so longer matches win in the
// alternation (e.g., "IEP Team" before "IEP"). Case-insensitive, whole
// word. Applied with the global flag so all occurrences are stripped
// before re-checking name patterns.
const ALLOW_LIST_PATTERN = new RegExp(
  '\\b(' +
    // Multi-word program/team terms (must come first)
    'IEP Team|Tier 1|Tier 2|Tier 3|Title I|Response to Intervention|' +
    'Multi-Tiered|Child Study|' +
    // Acronyms and programs
    'IEP|504|ELL|EL|MTSS|PBIS|SEL|RTI|ADHD|ASD|ODD|BIP|FBA|IDEA|FERPA|' +
    'COPPA|ESSA|ELA|STEM|' +
    // Days of the week
    'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|' +
    // Months
    'January|February|March|April|May|June|July|August|' +
    'September|October|November|December' +
  ')\\b',
  'gi'
);

function hasAnyNamePattern(str) {
  return TWO_CAP_WORDS.test(str) || TITLE_NAME.test(str) || POSSESSIVE_GUARDIAN.test(str);
}

/**
 * Inspect a note for patterns that look like PII. Returns a category
 * label only — callers must never expose the matched substring.
 *
 * @param {string} text - raw note text as typed by the user
 * @returns {{ detected: boolean, reason: 'name' | 'id' | null }}
 */
export function detectPII(text) {
  if (typeof text !== 'string') return { detected: false, reason: null };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { detected: false, reason: null };

  // Name patterns first. If any match, try the allow-list strip-and-recheck
  // to suppress false positives where the match was fully explained by
  // known non-name terms (e.g., "IEP Team on Monday").
  if (hasAnyNamePattern(trimmed)) {
    const stripped = trimmed.replace(ALLOW_LIST_PATTERN, ' ');
    if (hasAnyNamePattern(stripped)) {
      return { detected: true, reason: 'name' };
    }
  }

  // ID patterns. The allow-list deliberately does NOT suppress these — any
  // 5+ digit run or explicit ID phrasing is reported regardless of context.
  if (DIGITS_5_PLUS.test(trimmed) || ID_PREFIX.test(trimmed)) {
    return { detected: true, reason: 'id' };
  }

  return { detected: false, reason: null };
}
