# Tier 1 Self-Assessment — Forward-Reference Inventory

A read-only audit of every forward-reference in the shipped Tier 1 item bank
(`data/tier1-assessment-items.js`) to a not-yet-existing "ScholarPath
Resources section" (Step 9). This document is a prerequisite for scoping
Step 9: it lists every promise the assessment makes to the user about
companion artifacts, so Step 9 can commit to Build / Soften / Link-out
decisions item by item.

**Scope:** 30 items × (question, 3 anchors, recommendation) scanned
case-insensitively for the forward-reference vocabulary listed in the
Session 21 Priority 1 prompt, plus a cross-check against the v5 draft's
"Related resources" section.

**Audit date:** 2026-04-19.
**Branch:** `main` (tip of shipped feature, post-Session 20 merge).

---

## Summary

| Count | Category |
|---|---|
| 6 | Explicit forward-references to the ScholarPath Resources section |
| 6 | **Build** dispositions (all of the above) |
| 0 | Soften dispositions |
| 0 | Link-out dispositions |
| 3 | References to **existing** Intervention Monitoring features (not Step 9 scope) |
| 2 | Indirect cross-references within the item bank (rely on another item's Resources artifact) |

**Drift check:** The 6 explicit forward-references in the shipped JS
module match the v5 draft's "Related resources" list verbatim. No drift
between the draft and the shipped code for this content.

---

## Inventory — explicit forward-references (Build list)

All six are worded identically as `*(See the ScholarPath Resources section for a[n] ... .)*` in a trailing italic parenthetical. Promise is concrete (named artifact, not "a resource"). Recommended disposition for all six is **Build** — softening them now would require re-editing the shipped item bank and changing user-visible text, which is a bigger change than just shipping the artifacts.

| Item | Domain | Artifact | Type | Disposition | Rationale |
|---|---|---|---|---|---|
| **1.2** | 1 — Team & Infrastructure | MTSS Team Roles template | Blank fillable document template (facilitator / data lead / note-taker / time-keeper with backup assignments) | **Build** | Explicit forward-reference. Low-risk artifact — staff-role organization only, no student PII surface. |
| **1.3** | 1 — Team & Infrastructure | MTSS Handbook template | Structured document template (5–10 page framework: expectations, discipline flowchart, screening schedule, data-meeting cadence) | **Build** | Explicit forward-reference. Foundational artifact — backstops several other items that rely on a written Tier 1 plan existing. |
| **1.4** | 1 — Team & Infrastructure | Annual MTSS Calendar template | Blank calendar template laid out for a school year (screening windows, monthly meetings, data-review days, PD sessions) | **Build** | Explicit forward-reference. Structural only — users add their own dates. |
| **2.3** | 2 — Universal Academic Instruction | High-Leverage Tier 1 Practices reference guide | Informational reference document (read-only, narrative) | **Build** | Explicit forward-reference. Content exists in Tier 1 research literature; Step 9 needs to synthesize, not invent. |
| **3.4** | 3 — Universal Behavior Supports | Sample Discipline Flowchart | Sample artifact (concrete example, not a blank template) | **Build** | Explicit forward-reference. The recommendation itself already embeds an example structure in a markdown blockquote; the Resources artifact formalizes it as a downloadable/printable companion. |
| **7.3** | 7 — Family Engagement | Parent Assessment Results Summary template | Parent-facing document template (one-page summary layout) | **Build** | Explicit forward-reference. **FERPA/COPPA scrutiny required** — see §"Second-order issues" below; the template itself is blank, but the intended workflow captures student assessment data. |

---

## References to existing Intervention Monitoring features (out of Step 9 scope)

Three items reference **features that already exist** in Intervention
Monitoring rather than forward-referencing the Resources section. These
are not Build candidates — they're in-product pointers to shipped
functionality. Listed here for completeness:

| Item | Feature referenced | Status |
|---|---|---|
| 5.1 | Intervention Monitoring's Universal Screener Upload | Shipped. |
| 6.2 | Intervention Monitoring's 11-step Pre-Referral Form | Shipped. |
| 7.3 | Intervention Monitoring's Parent Portal | Shipped. |

These references appear in the same trailing parenthetical style as the Resources references, but point inward (to other parts of the app) rather than forward (to unshipped Resources content). Step 9 does not need to cover them.

---

## Indirect cross-references within the item bank

Two recommendations mention a "discipline flowchart" in prose — they lean on the artifact forward-referenced by Item 3.4 without adding their own forward-reference. No additional Build work; Item 3.4's artifact covers both.

| Item | Mentions | Resolved by |
|---|---|---|
| 1.3 | "school-wide expectations, the discipline flowchart, screening schedule, and data-meeting cadence" | Item 3.4's Sample Discipline Flowchart |
| 8.3 | "Include: the Tier 1 plan, the discipline flowchart, the school-wide expectations, the screening schedule..." | Item 3.4's Sample Discipline Flowchart |

These are prose references, not Resources-section promises. No link styling implied.

---

## Second-order issues (flagged for Step 9 scoping)

### 1. FERPA / COPPA — Item 7.3's parent summary template

Item 7.3's recommendation explicitly describes a workflow that captures:
- "the student's score"
- "what 'at benchmark' looks like for that grade"
- Whether the student's score triggers a Tier 2 conversation

The Resources *artifact* is a blank template (structure only, no PII).
**But the deployed workflow is student-specific by design.** Step 9 scoping
should:

- Keep the downloadable artifact strictly blank/structural — no example
  student names, no example percentiles tied to a specific student.
- Confirm that the artifact includes prominent FERPA-adjacent boilerplate
  reminding schools the filled-in document contains student PII and is
  subject to their own document-retention policies.
- Consider whether the artifact should be downloadable only, or also
  pre-fillable from Intervention Monitoring (latter would expand scope
  into data-export territory — probably defer past v1).

### 2. Placeholder literal `[protocol name]` in Item 6.2

Item 6.2's recommendation contains the literal string `[protocol name]`
inside an inline example: *"The team reviews these students at the
monthly data meeting using [protocol name]."*

This reads like a templating placeholder a reader might expect to
auto-fill. It's actually prose intended to convey "insert your team's
chosen protocol name here." Not a Step 9 concern directly, but worth
noting for future item-bank copy-edit passes. Not flagged as a Build.

### 3. Commercial screener examples in Item 5.1

Item 5.1 names five specific commercial academic screeners: DIBELS, STAR,
aimsweb, mCLASS, NWEA MAP Growth. These are illustrative ("for example"),
not a forward-reference to an artifact. Step 9 could optionally include
a comparison / selection guide resource, but the assessment text makes
no promise — so **omit from the Step 9 commitment list** unless there's
independent product desire to build it.

### 4. Uniform phrasing across the 6 Build items

All six forward-references use the same syntactic form:
`*(See the ScholarPath Resources section for a[n] <artifact>.)*`

Implication for Step 9: the phrasing is stable and grep-able. Whatever
linking or cross-reference UX Step 9 chooses, the six references are
mechanically uniform — no per-item bespoke wording to accommodate. The
specific UX (inline links, sidebar, separate section, etc.) is out of
scope for this inventory.

### 5. No PII mentioned in any Build artifact itself

Items 1.2, 1.3, 1.4, 2.3, and 3.4 describe organizational / process
artifacts with no individual student data. Only Item 7.3 (parent
summary) has a PII-adjacent workflow (see §1). Baseline for Step 9:
five of the six Build artifacts are low-PII-risk downloadable docs;
one needs deliberate privacy framing.

---

## Methodology and verification

**Source of truth:** `data/tier1-assessment-items.js` (the shipped
module). The v5 draft markdown (`docs/features/tier1-assessment/
ScholarPath-IM-Tier1-Assessment-Item-Bank-Draft-v5.md`) was
cross-checked; its "Related resources" list at lines 570–584 matches
the 6 Build items above exactly.

**Search terms applied** (case-insensitive, whole-word where applicable,
across `question` + `anchors[0..2]` + `recommendation`):

> `template`, `resource`, `guide`, `worksheet`, `example`, `sample`,
> `see the`, `download the`, `use the`, `checklist`, `rubric`,
> `protocol`, `toolkit`, `handbook`, `flowchart`, `calendar`

**Generic-noun hits excluded from the Build list** (appear in anchors
describing the presence/absence of the concept, or in prose as ordinary
nouns, not as forward-references to a specific artifact):

- `calendar` appears 9× as a general noun (e.g., "on the school
  calendar," "on the annual calendar") — not artifact references
  except in Item 1.4's explicit template reference.
- `handbook` appears 3× in anchors describing states ("documented in a
  team charter or handbook," "handbook mention") — not artifact
  references except in Item 1.3's explicit template reference.
- `flowchart` appears 7× (anchors + prose in Items 1.3 and 8.3) —
  only Item 3.4 contains the forward-reference to a Resources artifact.
- `protocol` appears 5× (Item 6.1 anchor + Item 6.2 recommendation) —
  all as generic noun, none promising a Resources artifact.
- `example` appears 1× ("for example") in Item 5.1 — framing word, not
  artifact reference.

**Final sanity check:** running the combined term grep against
`data/tier1-assessment-items.js` yields exactly the hits analyzed above.
No hits are unaccounted for in this inventory.

---

## Outputs for Step 9 scoping

When Step 9 is scoped, this inventory produces the following commitments:

1. **Six artifacts must ship** (the Build list in §Inventory). All are
   currently referenced as plain italic parentheticals in the Results
   view; Step 9 should both produce the artifacts and convert the
   parentheticals to links.
2. **One artifact (Item 7.3) requires FERPA framing.** The other five
   are low-risk organizational documents.
3. **No soften / link-out work** is needed — every explicit forward-
   reference is a concrete, scoped artifact that makes sense to own
   in-product rather than delegating to an external source.
4. **Three existing-feature references** (5.1, 6.2, 7.3) are already
   satisfied by shipped functionality; Step 9 does not need to address
   them.

Step 9 is ask-first per CLAUDE.md §8 (new feature, possibly new data
model for the Resources library). This inventory is preparation, not
approval.
