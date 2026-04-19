# Tier 1 Resources (Step 9) — Scoping v2

**Status:** Scoping complete. Ready for implementation planning.
**Session produced:** Session 23 follow-up (April 19, 2026); filename
convention patched April 19, 2026 (Session 24a prep).
**Supersedes:** `docs/scoping-v1.md` — superseded on specific points noted
inline. Sections not marked **CHANGED** or **NEW** are unchanged from v1 and
reproduced here so this doc stands on its own.

**Why v2 exists:** A read-only repo inspection (Session 24 prep) found that
three architectural assumptions in v1 did not match the actual repo. v2
patches those specific assumptions. Scope, role model, PII rule, and v2
roadmap are unchanged.

**Findings that drove v2 (see §13 for the full delta):**
1. The repo has no router library installed. v1 assumed `react-router-dom`
   with `/resources` and URL fragments.
2. The `view` state is declared in two places (`AppContext.jsx:15` and
   `App.jsx:195`); the App.jsx local one is what the nav actually uses.
3. Item 7.3's forward-reference parenthetical contains a second sentence
   unrelated to the Resources artifact, which breaks the naive regex plan.
4. The shipped artifact filenames are `1.2-...md`, not `item-1.2-...md` as
   v1 assumed. v2 mirrors the actual source names throughout. (Patched in
   after the first draft of v2 during Session 24a prep.)

**Related:**
- `docs/tier1-resources-inventory.md` — forward-reference audit (Session 21)
- `docs/tier1-resources/` — six shipped artifacts (Session 21)
- `docs/features/tier1-assessment/ScholarPath-IM-Tier1-Assessment-Item-Bank-Draft-v5.md`
- `docs/features/tier1-assessment/ScholarPath-IM-Tier1-Assessment-Schema-Proposal-v1.md`
- Router & nav verification report (Session 24 prep, this cycle)
- `CLAUDE.md` — session handshake; §8 ask-first triggers

---

## 1. Problem

Tier 1 assessment item recommendations contain parentheticals of the form:

> *(See the ScholarPath Resources section for a sample MTSS Team Roles template.)*

Six such forward-references exist across the 30-item bank. The Session 21
inventory identified them; the six referenced artifacts were shipped as
markdown files in `docs/tier1-resources/` later that session.

**The gap:** those parentheticals are currently plain text in the rendered UI.
There is no Resources section, no link destination, and no way for a user to
reach the artifact the recommendation points to. The artifacts exist in the
Git repo; end users cannot see them.

**Step 9 closes that gap.** v1 delivers a browsable Resources destination
with downloadable templates and functional in-app links from the assessment
recommendations.

---

## 2. Goals and non-goals

### Goals (v1)

1. A **Resources destination** in the app that displays the six existing
   artifacts in a browsable form, reachable from the top nav.
2. Per-resource download of a Word-editable template (`.docx`).
3. Role-based visibility: Admin and Staff see resources; Parent does not.
4. In-app linking from each forward-reference parenthetical in the item
   bank recommendations to a preview of the corresponding artifact —
   without losing the user's place in the Results modal.
5. Zero new external services. Zero new runtime dependencies. Zero new
   database tables.

### Non-goals (v1)

1. District-level customization via upload. Download-only in v1; upload
   loop is v2 scope (see §11).
2. Search, filter, or tag UI. Six artifacts do not justify it. Revisit
   at 15+.
3. Per-resource analytics / download tracking. Introduces logging
   considerations that are not justified by v1's scope.
4. Versioning UX. Git history is the version for v1.
5. Acceptance of filled instances (templates with real student/staff
   data). See §6 — this is a hard product rule, not merely a v1 deferral.
6. Sub-role granularity within Staff. Counselor / behavior specialist /
   teacher share the same Resources access in v1.
7. **NEW:** URL-level routing for Resources. The app has no router today;
   introducing one is out of scope for Step 9. See §3 "Destination
   mechanism" decision.
8. **NEW:** Bookmarkable / copy-paste-shareable URLs for individual
   artifacts. Consequence of non-goal 7. Revisit if demand appears.

---

## 3. Decisions (pinned)

Rows marked **CHANGED** differ from v1. Rows without that marker are
reproduced from v1 unchanged.

| Dimension | Decision | Rationale |
|---|---|---|
| **Destination mechanism** **[CHANGED]** | New `'resources'` value on the existing top-level `view` state (the same state that currently switches between `dashboard`, `students`, `student`, `admin`). No URL-level route in v1. | v1 assumed `/resources` with React Router. Repo has no router installed; navigation is a `useState` value flipped by inline nav buttons. Extending `view` is the surgical, repo-native path and avoids a new dependency per CLAUDE.md §8. |
| **Nav entry** | Top nav entry, placed inline in the existing `<nav>` block in `App.jsx` alongside Dashboard / Students / Admin. | Matches current top-nav pattern. The nav is already fully skipped for Parent role at the view-root level (`App.jsx:6542` short-circuits to `<ParentPortalView />` before the nav renders), so no per-button role gate is needed. |
| **Nav entry role gate** **[CHANGED]** | None needed at the button level. Parents never reach the nav. | v1 specified "Hidden for Parent role" on the nav entry. That gate is already handled structurally one level up; adding a redundant gate would be noise. |
| **Access model** | Role-based. Admin + Staff see all 6 resources. Parent sees none in v1. | All 6 artifacts are internal operational/professional-development content. Item 7.3 is the blank template staff use to *produce* a summary for parents; parents should receive the filled version from staff, not the blank. |
| **Staff granularity** | Staff treated as a single role for access purposes. Sub-roles may be surfaced later as non-gating tags. | Avoids access-control complexity disproportionate to v1 value. Consistent with the existing `isAdmin` derivation in `AppContext.jsx`. |
| **v1 scope** | Static content + `.docx` download only. | Closes the forward-reference gap. Defers every FERPA-adjacent decision by one release. |
| **Storage** | Static assets committed to the repo. No new DB table. No new external service. | Six artifacts that change rarely. Git is the right storage. Keeps PII surface at zero. |
| **Primary download format** | `.docx`, pre-generated from source markdown via pandoc. | Word is what districts actually edit in. |
| **Secondary download** | Link to raw markdown source on the Resources page. | Lets technically-inclined users access the source of truth; costs a single extra `<a>` tag per artifact. |
| **Pandoc pipeline** | One-time manual generation, `.docx` committed alongside `.md`. Revisit CI-ification if artifact count grows. | 6 files that change rarely do not justify CI infrastructure. |
| **Static asset path** **[CHANGED — was open question]** | `frontend/public/resources/`. | Standard Vite default, no collisions (verification confirmed no existing `frontend/public/resources/` directory). v1 left this as an open question; v2 closes it. |
| **Deep-link-from-Results-modal mechanism** **[CHANGED]** | Parenthetical becomes a clickable element that opens a **stacked preview modal** over the Results modal. The Results modal stays mounted and in place. Closing the preview returns the user exactly where they were. | v1 chose "new tab + URL fragment" to preserve the user's place in the Results modal. Without a router, the new-tab mechanism isn't available, but the goal — keeping the user in place — still drives the decision. A stacked modal is the repo-native way to satisfy that goal. Navigating to the Resources view and offering a "back to assessment" affordance was considered and rejected: it displaces the user from the recommendation list they were scanning. |
| **Preview modal shape** **[NEW]** | Compact modal showing: artifact title, one-line description, a markdown preview of the source, a `.docx` download button, a markdown source download link, and an "Open in Resources" link that switches view if the user wants the full page. | Covers the "what is this template" question the user actually has without requiring navigation. |
| **Forward-reference detection** **[CHANGED]** | Match the **whole parenthetical** as the unit to rewrite (not the artifact-name substring inside). Pattern anchored on `*(See the ScholarPath Resources section for …)*`. Parenthetical-to-artifact-id mapping is an explicit lookup table keyed by item ID, not by parsed artifact name. | v1 proposed regex capture of the artifact name between `for a` and `.)*`. Item 7.3's parenthetical contains a second sentence about Parent Portal that would break that capture. Since the item bank rendering knows the item ID in context, mapping `item_id → resource_id` is unambiguous and robust to phrasing variation (Item 3.4 lowercases "sample"; Item 7.3 has trailing content). |
| **Parent UX for parentheticals** | Render parenthetical as plain text for Parent role, not as a link. | Avoids broken-link / access-denied experience. |
| **`view` state site of truth** **[NEW]** | Collapse the duplication as part of this feature. Delete the local `view` state in `App.jsx:195`; use the `view` from `AppContext` (exposed via `useApp()`). | The report found `view` is declared in two places. The App.jsx local one shadows the context one, which means any consumer reading `view` via `useApp()` sees a dead value. Writing the new `'resources'` route against the context version makes it work correctly; leaving the duplication alive means the feature works-by-accident and the footgun persists. Explicit small-scope expansion — flagged as such in §13. |
| **PII rule** | Templates-only. Never accept filled instances. This is a product rule, not a toggleable setting. | See §6. FERPA implications of filled-instance acceptance are significant and change the product's compliance obligations. |

---

## 4. Architecture

### File layout (proposed)

```
docs/tier1-resources/                           # unchanged — source of truth
├── 1.2-mtss-team-roles.md
├── 1.3-mtss-handbook.md
├── 1.4-annual-mtss-calendar.md
├── 2.3-high-leverage-tier1-practices.md
├── 3.4-sample-discipline-flowchart.md
└── 7.3-parent-assessment-results-summary.md

frontend/public/resources/                      # new — static downloads
├── 1.2-mtss-team-roles.docx
├── 1.2-mtss-team-roles.md                      # copy for download-as-md
├── 1.3-mtss-handbook.docx
├── 1.3-mtss-handbook.md
├── 1.4-annual-mtss-calendar.docx
├── 1.4-annual-mtss-calendar.md
├── 2.3-high-leverage-tier1-practices.docx
├── 2.3-high-leverage-tier1-practices.md
├── 3.4-sample-discipline-flowchart.docx
├── 3.4-sample-discipline-flowchart.md
├── 7.3-parent-assessment-results-summary.docx
└── 7.3-parent-assessment-results-summary.md

frontend/src/resources/                         # new — frontend-imported content
├── index.js                                    # static manifest (id, title, roles, files)
└── markdown/                                   # copies of source markdown for runtime preview
    └── (six .md files, imported as raw strings via Vite ?raw)

frontend/src/views/ResourcesView.jsx            # new — the 'resources' view
frontend/src/components/Modals/
└── ResourcePreviewModal.jsx                    # new — stacked-over-Results preview
frontend/src/utils/resourceLinkMap.js           # new — item_id → resource_id lookup
```

**Filename convention:** files mirror the source names in
`docs/tier1-resources/` (no `item-` prefix). The `item-X-Y` manifest ids
(e.g., `item-1-2`) are a separate concept — they're the stable
in-memory keys the manifest and forward-reference mapping use, decoupled
from the on-disk filenames. This was a late patch after the first draft
of v2; scoping-v1 had assumed `item-` prefixed filenames based on a URL
fragment scheme that no longer exists in v2.

**Notes:**

- Matches the repo's existing `frontend/src/views/` convention (views are
  the targets of the `view` state) and `frontend/src/components/Modals/`
  convention (where `Tier1ResultsModal.jsx` already lives).
- The `frontend/src/resources/markdown/` copies are build artifacts; the
  authoritative source is `docs/tier1-resources/`. Drift mitigation: README
  in `docs/tier1-resources/` documents the sync expectation. CI check is
  deferred unless drift actually happens.
- Loading markdown as raw strings uses Vite's built-in `?raw` suffix
  (`import mtssRoles from './markdown/1.2-mtss-team-roles.md?raw'`).
  No new dependency; native Vite feature.

### Manifest shape (static JS module) **[unchanged from v1]**

```js
// frontend/src/resources/index.js
import mtssRolesMd from './markdown/1.2-mtss-team-roles.md?raw';
// ...five more imports

export const RESOURCES = [
  {
    id: 'item-1-2',
    itemRef: '1.2',
    title: 'MTSS Team Roles Template',
    description: 'Customizable template defining roles and responsibilities for your MTSS team.',
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/1.2-mtss-team-roles.docx',
      markdown: '/resources/1.2-mtss-team-roles.md',
    },
    markdownContent: mtssRolesMd,
  },
  // ... 5 more
];
```

Shape deliberately mirrors the item bank pattern (static JS module, `id`
field stable across versions, no DB).

### Navigation state contract **[CHANGED — replaces "URL / fragment scheme" in v1]**

- **Entry:** `view` state (from `AppContext` via `useApp()`) gets a new
  valid value `'resources'`. Top-nav button calls `setView('resources')`.
- **Per-artifact targeting:** a second piece of state, `selectedResourceId`
  (e.g., `'item-1-2'`), identifies which artifact to scroll to / expand on
  the Resources view. Scope: component-local to `ResourcesView` when
  arriving via the nav (defaults to null / nothing pre-selected); lifted
  to a small context or props when arriving from a forward-reference click.
- **No URL fragment.** The browser URL does not change when switching views.
  This is consistent with every other view in the current app.
- **Stability contract:** the `item-X-Y` id scheme is the stable key.
  External docs, future features, and the item-bank-to-resource mapping
  all reference artifacts by this id. It was a URL fragment in v1; in v2
  it is an in-memory key with the same stability guarantees.

### Forward-reference handling in the Results modal **[CHANGED]**

The Results modal renders item recommendations via `react-markdown`
(`Tier1ResultsModal.jsx` line 530, confirmed vanilla `<ReactMarkdown>`
with no custom `components` prop). v2 adds a custom renderer at the
parenthetical scope:

1. **Detection:** the `react-markdown` component override targets
   the `em` element (the parenthetical is wrapped in `*...*`) and
   inspects its children for the literal prefix "(See the ScholarPath
   Resources section for". Matching happens on the whole parenthetical
   as a single unit — the artifact-name substring is not parsed.
2. **Mapping:** the current item's `id` (known in the render context,
   e.g. `1.2`) is looked up in `resourceLinkMap.js` to resolve the
   corresponding resource id (`item-1-2`). This is an explicit table,
   not parsed from the parenthetical text.
3. **Role-aware rendering:**
   - **Admin / Staff:** rendered as a button-styled element with a small
     `ExternalLink` icon (from `lucide-react`, already imported in the
     app). Click handler opens `<ResourcePreviewModal resourceId={...} />`
     stacked over the Results modal.
   - **Parent:** rendered as plain italic text, no affordance. (In
     practice parents should not be seeing Tier 1 assessment results
     either, but this handles the case defensively.)
4. **Fallback:** if the mapping lookup fails (e.g., a new parenthetical
   appears without a matching entry), render as plain italic text and
   log nothing. Silent fallback is preferred over broken-link UX.

### Preview modal contract **[NEW]**

`ResourcePreviewModal` props:
- `resourceId: string` — required
- `onClose: () => void` — required

Renders:
- Artifact title (from manifest)
- One-line description (from manifest)
- Markdown preview via the same `<ReactMarkdown>` wrapper used in
  `Tier1ResultsModal` (with the same `MarkdownBoundary` error boundary)
- `.docx` download button — native `<a href download>` to the manifest's
  `files.docx` path
- Markdown source download link — native `<a href download>` to
  `files.markdown`
- "Open in Resources" link — calls `setView('resources')` with
  `selectedResourceId` set to this artifact's id, then closes the preview
  modal (the Results modal closes too as a side-effect of the view switch;
  acceptable because the user explicitly asked to leave)

Z-index management: the preview modal sits above `Tier1ResultsModal`.
Use the existing modal stacking convention in the repo (verify at
implementation — the Modals directory already has stacked patterns for
confirm dialogs).

---

## 5. Role-to-resource mapping (v1)

*Unchanged from v1.*

All six resources are visible to Admin and Staff. Parent sees none.

| # | Resource | Admin | Staff | Parent | Notes |
|---|---|:---:|:---:|:---:|---|
| 1.2 | MTSS Team Roles Template | ✅ | ✅ | ❌ | Internal operational doc |
| 1.3 | MTSS Handbook Template | ✅ | ✅ | ❌ | Internal operational doc |
| 1.4 | Annual MTSS Calendar Template | ✅ | ✅ | ❌ | Internal operational doc |
| 2.3 | High-Leverage Tier 1 Practices Guide | ✅ | ✅ | ❌ | Professional development reference |
| 3.4 | Sample Discipline Flowchart | ✅ | ✅ | ❌ | Could arguably be parent-facing; v1 keeps it staff-internal. Revisit if demand. |
| 7.3 | Parent Assessment Results Summary Template | ✅ | ✅ | ❌ | **Blank template staff fill in.** Parents receive the *filled* version from staff, never the blank. |

"Admin" for access purposes means any role in `isAdmin`'s definition
(`district_admin`, `school_admin`, `counselor`, `behavior_specialist`).
"Staff" in the role-mapping sense covers the same roles plus
`mtss_support`. In practice, the check is "not parent and not
unauthenticated" — equivalent to the nav being visible at all.

---

## 6. FERPA, COPPA, and PII considerations

*Unchanged from v1.*

### Rule: templates-only, always

No artifact served from or accepted by the Resources feature may contain
student or staff PII. This applies to:

- Pre-shipped artifacts (already true — the six shipped in Session 21 are
  blank templates by design).
- Any future custom-upload feature (v2 scope). If v2 ships, the upload
  path must enforce this rule via a click-through ack at minimum, plus
  MIME/size limits, plus (optionally) pattern scanning.

**Why this is a product rule, not a v1 deferral:** accepting filled
instances would reclassify the product as storing education records under
FERPA. That brings retention obligations, access-log requirements,
parent-access-rights obligations, breach notification obligations, and
district DPA requirements that are out of proportion to the value of
in-app customization. Districts can customize templates offline and
distribute through their own storage (Drive, SharePoint, email) without
the product taking on that compliance burden.

### v1 PII surface: zero

v1 is read-only for resources. No user input, no file upload, no new
logging. No PII can be captured, stored, or leaked through this feature
path. The in-app linking mechanism (stacked preview modal) does not
change this — it renders the same static artifacts the browse page does.

### Cross-tenant risk: none

Resources content is global (not tenant-scoped). The manifest is the same
for every tenant; `.docx` files are the same for every tenant. There is no
per-tenant data on the Resources view in v1, so there is nothing that
could leak between tenants.

If v2 introduces per-tenant customization, `tenant_id` scoping becomes
mandatory and the cross-tenant risk analysis needs to be redone — see §11.

### Logging

Resources view loads, scroll behavior, downloads, and preview-modal opens
are **not** logged to application logs in v1. No analytics, no download
counting, no telemetry. This is deliberate:

- Removes any risk of PII in logs (there is none to begin with, but zero
  logging is a cleaner guarantee).
- Defers analytics design to a later session when demand and requirements
  are real.

If analytics become desirable in a future version, they should be
proposed via a separate scoping doc under CLAUDE.md §8 (logging changes).

---

## 7. Implementation plan (outline — not a code contract)

**This is the shape of the implementation prompt, not the prompt itself.
The actual implementation sessions will produce prompts from this.**

### Phase A — Content pipeline (one-time, manual)

1. Run pandoc locally against each of the six markdown files to generate
   `.docx`.
2. Visually inspect each `.docx` — Items 1.4 (calendar tables) and 7.3
   (scenario blocks) have complex structure that should be eyeballed.
3. Commit the six `.docx` files to `frontend/public/resources/`.
4. Copy the six source markdown files to
   `frontend/src/resources/markdown/` (for preview rendering) and also to
   `frontend/public/resources/` (for the markdown download link).
   Document the sync expectation in a README.

**Estimated effort:** ~30 min. Done as a prep step, not in the
implementation session.

### Phase B — Resources view, route, and nav **[CHANGED]**

5. Create `frontend/src/resources/index.js` — the manifest module with
   `?raw` markdown imports.
6. Create `frontend/src/views/ResourcesView.jsx` — renders the six cards
   from the manifest. Each card shows title, description, `.docx`
   download button, and markdown source download link. Supports a
   `selectedResourceId` prop/context value that scrolls the matching
   card into view and expands it (if cards have an expanded state; final
   call at implementation).
7. Collapse the `view` state duplication: delete
   `const [view, setView] = useState('dashboard')` from `App.jsx:195`;
   use `const { view, setView } = useApp()` instead. Verify nav buttons
   still function (Dashboard, Students, Admin).
8. Add `'resources'` to the set of valid `view` values. Add the
   conditional render at `App.jsx:~6617`:
   `{view === 'resources' && <ResourcesView />}`.
9. Add the Resources nav button in the existing `<nav>` block,
   positioned between Students and Admin (`App.jsx:~6574`). Match the
   existing button shape exactly — same `<button>`, same active-state
   classes (`bg-indigo-100 text-indigo-700` when active).

### Phase C — In-Results-modal preview **[CHANGED]**

10. Create `frontend/src/utils/resourceLinkMap.js` — explicit
    `{ [itemId]: resourceId }` table for the six mappings.
11. Create `frontend/src/components/Modals/ResourcePreviewModal.jsx` —
    renders the artifact preview + download buttons + "Open in
    Resources" link. Reuses the `MarkdownBoundary` pattern from
    `Tier1ResultsModal`.
12. In `Tier1ResultsModal.jsx`, add a `components` prop to the existing
    `<ReactMarkdown>` at line ~530 that handles the `em` element: detect
    the forward-reference parenthetical, look up the resource via
    `resourceLinkMap`, and for Admin/Staff render a clickable element
    that opens `ResourcePreviewModal`. For Parent, render unchanged.
13. Verify z-index / stacking: preview modal renders above the Results
    modal.

### Phase D — Verification

14. Manual smoke test on both seed tenants, both Admin and Staff roles.
    Parent-role verification deferred (per v1) if no parent seed account
    exists.
15. Confirm downloads work on Chrome, Safari, Firefox.
16. Confirm clicking a forward-reference in Results opens the preview
    modal, does not close the Results modal, and returns cleanly on
    close.
17. Confirm "Open in Resources" in the preview modal switches to the
    Resources view and scrolls to the right card.
18. Confirm direct nav to Resources shows all six cards for Admin/Staff.

### Rough size estimate **[CHANGED]**

Per CLAUDE.md §8, anything > ~3 files or > ~100 lines is ask-first.
This feature will touch:

- `frontend/src/resources/index.js` (new, ~80 lines)
- `frontend/src/views/ResourcesView.jsx` (new, ~150 lines)
- `frontend/src/App.jsx` (remove local `view` state; add nav entry and
  conditional; ~15 lines changed)
- `frontend/src/utils/resourceLinkMap.js` (new, ~20 lines)
- `frontend/src/components/Modals/ResourcePreviewModal.jsx`
  (new, ~120 lines)
- `frontend/src/components/Modals/Tier1ResultsModal.jsx` (add
  `components` prop with em handler; ~30 lines)
- README in `docs/tier1-resources/` (new; carryover from Priority 2)

Total: ~6 files changed/created, ~415 lines of new code. **Exceeds the
§8 threshold and chunks as follows:**

- **Session 24a:** Phase A prep (done out-of-session) + Phase B.
  Visible progress, no assessment-side changes. ~4 files touched
  (index.js, ResourcesView.jsx, App.jsx, README), ~265 lines.
- **Session 24b:** Phase C. ~3 files touched (resourceLinkMap.js,
  ResourcePreviewModal.jsx, Tier1ResultsModal.jsx), ~170 lines.
  Smaller surface but higher modal-regression risk — deserves its own
  session.
- **Session 24c (optional):** README polish / organizational docs for
  `docs/tier1-resources/` per Priority 2. Docs-only; direct-to-main
  acceptable.

Each chunk is independently shippable and reviewable. 24a produces a
usable Resources destination on its own; 24b adds the deep-link UX.

---

## 8. Open questions resolved in v2

Items marked ✅ are closed; items marked 🔹 are new or still open.

- ✅ **Static asset location** — `frontend/public/resources/`. Closed.
- ✅ **Router pattern** — no router exists; use extended `view` state.
  Closed.
- ✅ **Markdown detection approach** — match the whole parenthetical,
  map by item id via explicit lookup table. Closed.
- ✅ **Secondary markdown download link** — include on each resource
  card and in the preview modal. Closed (recommended include in v1;
  affirmed in v2).
- 🔹 **Resources landing view content** — when a user enters the view
  with no `selectedResourceId`, what do they see? Proposed: brief intro
  paragraph + the six cards. Final copy at implementation.
- 🔹 **Card expanded state** — do cards expand in-place to show a
  preview, or do they link out to something? Proposed: expanded state
  shows the first few hundred characters of the markdown + download
  buttons; "Open preview" opens the full `ResourcePreviewModal` for
  consistency with the Results-modal entry point. Final call at
  implementation.

---

## 9. Ask-first items resolved in this scoping

Per CLAUDE.md §8:

- ✅ **New dependency** — none. Vite's native `?raw` import handles
  markdown-as-string; `react-markdown` and `lucide-react` are already
  installed.
- ✅ **Database schema change** — none in v1.
- ✅ **Breaking API change** — none.
- ⚠️ **Large refactor** — implementation is chunked to stay within
  §8 thresholds per session. One sub-item flagged: collapsing the
  `view` state duplication is a small-scope expansion from pure
  feature work. Called out in §3 and §13 for explicit approval.
- ✅ **New deployment/service assumption** — none. Static assets in
  the existing frontend build.
- ✅ **Replacing existing patterns** — no. Extending `view` state
  matches the current navigation pattern; manifest module matches
  the item bank pattern; modal matches existing modal patterns.
- ✅ **Sync ownership semantics** — N/A; feature is frontend-only.
- ✅ **Student/staff PII** — explicitly handled. v1 has zero PII
  surface. See §6.
- ✅ **New external service or webhook** — none.
- ✅ **Logging/error handling changes that could capture PII** —
  none. Feature does not log.
- ✅ **New PII field** — none.

---

## 10. Risks

Carried forward from v1 with v2-specific additions.

1. **Pandoc output quality.** For 4 of 6 artifacts the output should
   be clean; Items 1.4 and 7.3 have complex structure that may need
   manual touch-up. Mitigation: visual inspection step in Phase A.
2. **Markdown / docx drift.** Source markdown in
   `docs/tier1-resources/` is authoritative; copies in `frontend/`
   are generated. Mitigation: README-documented sync expectation;
   formalize with a CI check if drift actually happens.
3. **Parenthetical-detection brittleness.** v2's approach (match the
   whole parenthetical as a unit, map by item id) is more robust than
   v1's artifact-name parsing. Residual risk: if the item bank stops
   using the "(See the ScholarPath Resources section for …)" phrasing
   entirely on some item, the detection won't fire. Mitigation: the
   phrase is a stability contract documented in the item bank file
   header and mirrored in `resourceLinkMap.js` comments.
4. **`view` state duplication fix scope.** Collapsing the duplication
   is a small behavioral change — any code path that today reads the
   App.jsx local `view` and expects it to diverge from the context
   one would break. Mitigation: the report confirms all current
   consumers read one or the other; none depend on them being
   different. Verify at implementation; if a hidden dependency
   surfaces, back out the collapse and document.
5. **Stacked-modal z-index regressions.** Adding a modal that stacks
   over another modal can interact unexpectedly with existing focus
   management or overlay patterns. Mitigation: verify against the
   existing modal patterns in `frontend/src/components/Modals/` at
   implementation; keep the preview modal's implementation consistent
   with existing confirm-dialog patterns.
6. **Parent role preview-link access.** If a parent somehow reaches a
   forward-reference (shouldn't happen — parents don't see the Results
   modal), it renders as plain italic text with no affordance. No PII
   exposure. Not a security issue.

---

## 11. v2 preview (not scoped here)

*Unchanged from v1.*

Kept brief so v1 decisions don't paint v2 into a corner.

### Upload loop

If demand materializes, a future version adds district-level
customization via upload:
- New table: `tenant_resource_customizations` (tenant_id, resource_id,
  file_path, uploaded_by, uploaded_at, acknowledged_no_pii_at).
- New object storage: Supabase Storage (already in-stack).
- Upload path includes: MIME + size validation, click-through ack
  ("I confirm this file contains no student PII"), explicit
  templates-only product copy.
- Download flow: if a tenant has a customization for a resource, serve
  that; otherwise serve the generic.
- Staff UI: upload, replace, revert-to-generic actions.
- **Ask-first triggers:** new DB table, new external service
  integration, new PII-adjacent surface. Its own scoping doc required.

### What v1 must preserve for that future

- The manifest shape (`RESOURCES` array) must support an optional
  per-tenant override slot cleanly. Recommend not designing that in
  explicitly for v1 — but avoid baking assumptions that make it hard
  (e.g., don't hardcode file paths in the page; always go through
  the manifest).
- The `item-X-Y` id scheme must remain stable so existing links
  continue to work when overrides ship.

### Other candidates

- Search / filter once artifact count > 15.
- Analytics. Requires a separate privacy review.
- Per-resource "last updated" display pulled from Git history or
  frontmatter.
- URL-level routing, if demand for bookmarkable / shareable resource
  links appears. Would be its own scoping effort (new dependency,
  navigation-pattern change).

---

## 12. Sign-off checklist

Before implementation begins, the following should be confirmed:

- [ ] Product owner approves v2 scope and defers v3 (upload loop)
      explicitly
- [ ] Pandoc approach (manual, committed alongside `.md`) confirmed
- [ ] Approval for the small-scope expansion to collapse the `view`
      state duplication (see §3, §13)
- [ ] Chunking plan (24a / 24b / 24c) approved or revised
- [ ] Parent seed account available for verification, OR parent-role
      verification explicitly deferred

Items from v1's sign-off checklist that are now closed by repo
inspection (no longer require sign-off):

- ~~Router pattern verified~~ — confirmed: no router installed.
- ~~Static asset location decided~~ — `frontend/public/resources/`.

---

## 13. Delta from v1

For reviewers who want to see only what changed:

### Decisions changed
- **Route → view-state value.** v1: top-level `/resources` route with
  URL fragments. v2: new `'resources'` value on the existing `view`
  state. Driver: no router in the repo.
- **Nav entry role gate removed.** v1: hide nav entry for parents.
  v2: no per-button gate needed; parents never reach the nav.
- **Deep-link mechanism rewritten.** v1: new tab + URL fragment.
  v2: stacked preview modal over the Results modal. Driver: no URL
  without a router; goal of preserving user's place stands.
- **Detection approach rewritten.** v1: regex-extract the artifact
  name from the parenthetical. v2: match the whole parenthetical;
  map `item_id → resource_id` by explicit lookup table. Driver:
  Item 7.3's parenthetical has a second sentence that breaks name
  extraction.
- **Static asset path closed.** v1 left it open; v2 commits to
  `frontend/public/resources/`.
- **Filename convention aligned to source.** v1 and v2's first draft
  used `item-1.2-...md` etc. The actual shipped source filenames are
  `1.2-...md`; v2 (patched) mirrors those throughout. Manifest ids
  remain `item-X-Y` (they're a separate concept).

### Decisions added
- **Preview modal shape** — contract for the new
  `ResourcePreviewModal` component.
- **`view` state site of truth** — collapse the duplication between
  `AppContext.jsx` and `App.jsx`; use the context one.
- **URL-level routing is explicitly out of scope** — recorded as
  non-goal to prevent drift.

### Decisions unchanged
- Access model (Admin + Staff see all 6; Parent sees none)
- Staff granularity (single role for access purposes)
- v1 scope (static content + `.docx` download only)
- Storage (Git; no DB table; no external service)
- Primary / secondary download formats (`.docx` + markdown source)
- Pandoc pipeline (manual, committed)
- Parent UX for parentheticals (plain italic text, no affordance)
- PII rule (templates-only, product rule not a toggle)

### Scope delta
- **+1 small-scope item:** collapse `view` state duplication. ~5 lines
  in `App.jsx`. Flagged for explicit approval.
- **Net file count:** v1 estimated ~5 files / ~320 lines. v2 estimates
  ~6 files / ~415 lines. Difference is the new
  `ResourcePreviewModal.jsx` (~120 lines) partially offset by dropping
  URL-fragment handling code.

---

*End scoping v2.*
