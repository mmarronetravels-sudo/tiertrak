# Tier 1 Resources (Step 9) — Scoping v1

**Status:** Scoping complete. Ready for implementation planning.
**Session produced:** Session 23 (April 19, 2026)
**Supersedes:** N/A (first scoping doc for Step 9)
**Related:**
- `docs/tier1-resources-inventory.md` — forward-reference audit (Session 21)
- `docs/tier1-resources/` — six shipped artifacts (Session 21)
- `docs/features/tier1-assessment/ScholarPath-IM-Tier1-Assessment-Item-Bank-Draft-v5.md` — item bank design doc
- `docs/features/tier1-assessment/ScholarPath-IM-Tier1-Assessment-Schema-Proposal-v1.md` — pattern reference for this doc
- `CLAUDE.md` — session handshake; §8 ask-first triggers

---

## 1. Problem

Tier 1 assessment item recommendations contain parentheticals of the form:

> *(See the ScholarPath Resources section for a sample MTSS Team Roles template.)*

Six such forward-references exist across the 30-item bank. The Session 21 inventory identified them; the six referenced artifacts were shipped as markdown files in `docs/tier1-resources/` later that session.

**The gap:** those parentheticals are currently plain text in the rendered UI. There is no Resources section, no link destination, and no way for a user to reach the artifact the recommendation points to. The artifacts exist in the Git repo; end users cannot see them.

**Step 9 closes that gap.** v1 delivers a browsable Resources destination with downloadable templates and functional deep-links from the assessment recommendations.

---

## 2. Goals and non-goals

### Goals (v1)

1. A top-level `/resources` route that displays the six existing artifacts in a browsable form.
2. Per-resource download of a Word-editable template (`.docx`).
3. Role-based visibility: Admin and Staff see resources; Parent does not.
4. Deep-linking from each forward-reference parenthetical in the item bank recommendations to the corresponding artifact on the Resources page.
5. Zero new external services. Zero new runtime dependencies. Zero new database tables.

### Non-goals (v1)

1. District-level customization via upload. Download-only in v1; upload loop is v2 scope (see §11).
2. Search, filter, or tag UI. Six artifacts do not justify it. Revisit at 15+.
3. Per-resource analytics / download tracking. Introduces logging considerations that are not justified by v1's scope.
4. Versioning UX. Git history is the version for v1.
5. Acceptance of filled instances (templates with real student/staff data). See §6 — this is a hard product rule, not merely a v1 deferral.
6. Sub-role granularity within Staff. Counselor / behavior specialist / teacher share the same Resources access in v1.

---

## 3. Decisions (pinned)

| Dimension | Decision | Rationale |
|---|---|---|
| **Route** | New top-level route at `/resources` | Matches the "Resources is a destination" framing agreed in scoping. Not a modal tab; not inline. |
| **Nav entry** | Top nav entry. Hidden for Parent role. | Matches current top-nav pattern. Empty page for parents is worse UX than no entry. |
| **Access model** | Role-based. Admin + Staff see all 6 resources. Parent sees none in v1. | All 6 artifacts are internal operational/professional-development content. Item 7.3 is the blank template staff use to *produce* a summary for parents; parents should receive the filled version from staff, not the blank. |
| **Staff granularity** | Staff treated as a single role for access purposes. Sub-roles (counselor, behavior specialist, teacher) may be surfaced later as non-gating tags. | Avoids access-control complexity disproportionate to v1 value. Consistent with existing `user?.role !== 'parent'` pattern on the dashboard card. |
| **v1 scope** | Static content + `.docx` download only. | Closes the forward-reference gap. Defers every FERPA-adjacent decision by one release. Matches Session 22 discipline of small, self-contained, zero-backend-change features. |
| **Storage** | Static assets committed to the repo. No new DB table. No new external service. | Six artifacts that change rarely. Git is the right storage. Keeps PII surface at zero. |
| **Primary download format** | `.docx`, pre-generated from source markdown via pandoc. | Word is what districts actually edit in. PDF is wrong for 4 of 6 artifacts (they are fill-in templates). Markdown is wrong delivery format for non-technical users. |
| **Secondary download** | Link to raw markdown source on the Resources page (optional, low-cost polish). | Lets technically-inclined users access the source of truth; costs a single extra `<a>` tag per artifact. Scoping doc recommends including it. Final call at implementation. |
| **Pandoc pipeline** | One-time manual generation, `.docx` committed alongside `.md`. Revisit CI-ification if artifact count grows or edits become frequent. | 6 files that change rarely do not justify CI infrastructure. Manual is defensible and transparent. |
| **Deep-link from Results modal** | Parenthetical becomes an `<a>` that opens `/resources#item-X-Y` in a new tab, preserving the modal. | Reading assessment results contiguously is the point of the Results modal. Navigate-away (Option A) loses the user's place. Inline preview (Option C) is a whole feature unto itself. New-tab + fragment is the lowest-cost path to the right UX. |
| **Parent UX for parentheticals** | Render parenthetical as plain text for Parent role, not as a link. | Avoids broken-link / access-denied experience. Parents should not see affordances for content they cannot access. |
| **PII rule** | Templates-only. Never accept filled instances. This is a product rule, not a toggleable setting. | See §6. FERPA implications of filled-instance acceptance are significant and change the product's compliance obligations. |

---

## 4. Architecture

### File layout (proposed)

```
docs/tier1-resources/                           # unchanged — source of truth
├── item-1.2-mtss-team-roles.md
├── item-1.3-mtss-handbook.md
├── item-1.4-annual-mtss-calendar.md
├── item-2.3-high-leverage-tier1-practices.md
├── item-3.4-sample-discipline-flowchart.md
└── item-7.3-parent-assessment-results-summary.md

frontend/src/resources/                         # new
├── index.js                                    # static manifest (id, title, roles, files)
├── downloads/                                  # pre-generated artifacts
│   ├── item-1.2-mtss-team-roles.docx
│   ├── item-1.3-mtss-handbook.docx
│   ├── item-1.4-annual-mtss-calendar.docx
│   ├── item-2.3-high-leverage-tier1-practices.docx
│   ├── item-3.4-sample-discipline-flowchart.docx
│   └── item-7.3-parent-assessment-results-summary.docx
└── markdown/                                   # copies of the source markdown for runtime import
    └── (six .md files, imported as raw strings)

frontend/src/pages/ResourcesPage.jsx            # new — the /resources route
frontend/src/utils/resourceDeepLink.js          # new — fragment helpers, role-aware link renderer
```

Rationale for copying markdown into `frontend/src/resources/markdown/`: Vite/React cannot import from outside the frontend tree at build time without config changes. Copying is simpler than changing the build. The authoritative source remains `docs/tier1-resources/`; the `frontend/src/resources/markdown/` copies are build artifacts. A CI check or pre-commit hook could later enforce they stay in sync; not required for v1.

**Open question for implementation:** should the `.docx` files live in `frontend/src/resources/downloads/` (imported via Vite asset handling) or in `frontend/public/resources/` (served as plain static assets)? The `public/` path is simpler and avoids any build-time asset pipeline questions. Recommend `public/` unless the implementation session finds a reason otherwise.

### Manifest shape (static JS module)

```js
// frontend/src/resources/index.js
export const RESOURCES = [
  {
    id: 'item-1-2',
    itemRef: '1.2',
    title: 'MTSS Team Roles Template',
    description: 'Customizable template defining roles and responsibilities for your MTSS team.',
    roles: ['admin', 'staff'],
    files: {
      docx: '/resources/item-1.2-mtss-team-roles.docx',
      markdown: '/resources/item-1.2-mtss-team-roles.md',
    },
    markdownContent: /* imported as raw string */,
  },
  // ... 5 more
];
```

Shape deliberately mirrors the item bank pattern (static JS module, `id` field stable across versions, no DB).

### URL / fragment scheme

- Page: `/resources`
- Per-artifact deep link: `/resources#item-1-2` (hyphen-separated to avoid URL parsing issues with dots)
- Fragment-to-id mapping lives in `resourceDeepLink.js` so the item bank doesn't have to know the URL scheme directly.
- On mount, Resources page reads `window.location.hash`, looks up the matching artifact, scrolls the artifact card into view, and (optionally) expands it.

### Role-aware markdown link renderer

The Results modal renders item recommendations via react-markdown. A custom `components.a` or `components.p` handler (TBD at implementation) detects parentheticals with forward-reference text and:

1. If user role is Admin or Staff: renders as `<a href="/resources#item-X-Y" target="_blank" rel="noopener noreferrer">...</a>` with a small `ExternalLink` icon from lucide-react (already imported elsewhere in the app, per CLAUDE.md §3).
2. If user role is Parent: renders as plain text, link affordance removed.

**Detection approach** — two options, implementation session picks:
- **(a) Pattern match** the existing `*(See the ScholarPath Resources section for a ...)*` string and extract which item the recommendation belongs to (we know the `item_id` in context).
- **(b) Mark up** the item bank source itself with an explicit link target (e.g., custom markdown extension or a sentinel the renderer recognizes).

(a) is zero-cost but brittle to copy changes. (b) is cleaner but touches the item bank content. Recommend (a) for v1 with the pattern documented as a stability contract; if item bank copy changes, the pattern check gets updated. This avoids modifying shipped item bank content unnecessarily.

---

## 5. Role-to-resource mapping (v1)

All six resources are visible to Admin and Staff. Parent sees none.

| # | Resource | Admin | Staff | Parent | Notes |
|---|---|:---:|:---:|:---:|---|
| 1.2 | MTSS Team Roles Template | ✅ | ✅ | ❌ | Internal operational doc |
| 1.3 | MTSS Handbook Template | ✅ | ✅ | ❌ | Internal operational doc |
| 1.4 | Annual MTSS Calendar Template | ✅ | ✅ | ❌ | Internal operational doc |
| 2.3 | High-Leverage Tier 1 Practices Guide | ✅ | ✅ | ❌ | Professional development reference |
| 3.4 | Sample Discipline Flowchart | ✅ | ✅ | ❌ | Could arguably be parent-facing; v1 keeps it staff-internal. Revisit if demand. |
| 7.3 | Parent Assessment Results Summary Template | ✅ | ✅ | ❌ | **Blank template staff fill in.** Parents receive the *filled* version from staff, never the blank. |

---

## 6. FERPA, COPPA, and PII considerations

### Rule: templates-only, always

No artifact served from or accepted by the Resources feature may contain student or staff PII. This applies to:

- Pre-shipped artifacts (already true — the six shipped in Session 21 are blank templates by design).
- Any future custom-upload feature (v2 scope). If v2 ships, the upload path must enforce this rule via a click-through ack at minimum, plus MIME/size limits, plus (optionally) pattern scanning.

**Why this is a product rule, not a v1 deferral:** accepting filled instances would reclassify the product as storing education records under FERPA. That brings retention obligations, access-log requirements, parent-access-rights obligations, breach notification obligations, and district DPA requirements that are out of proportion to the value of in-app customization. Districts can customize templates offline and distribute through their own storage (Drive, SharePoint, email) without TierTrak taking on that compliance burden.

### v1 PII surface: zero

v1 is read-only for resources. No user input, no file upload, no new logging. No PII can be captured, stored, or leaked through this feature path.

### Cross-tenant risk: none

Resources content is global (not tenant-scoped). The manifest is the same for every tenant; `.docx` files are the same for every tenant; deep-link fragments are the same for every tenant. There is no per-tenant data on the Resources page in v1, so there is nothing that could leak between tenants.

This is the correct v1 shape. If v2 introduces per-tenant customization, `tenant_id` scoping becomes mandatory and the cross-tenant risk analysis needs to be redone — see §11.

### Logging

Resources page loads, scroll behavior, and downloads are **not** logged to application logs in v1. No analytics, no download counting, no telemetry. This is deliberate:

- Removes any risk of PII in logs (there is none to begin with, but zero logging is a cleaner guarantee).
- Defers analytics design to a later session when demand and requirements are real.

If analytics become desirable in a future version, they should be proposed via a separate scoping doc under CLAUDE.md §8 (logging changes).

---

## 7. Implementation plan (outline — not a code contract)

**This is the shape of the implementation prompt, not the prompt itself. The actual implementation session will produce a prompt from this.**

### Phase A — Content pipeline (one-time, manual)

1. Run pandoc locally against each of the six markdown files to generate `.docx`.
2. Visually inspect each `.docx` — pandoc's default table/heading handling is generally good but a few artifacts have complex structure (Item 1.4 has calendar tables, Item 7.3 has scenario blocks) that should be eyeballed.
3. Commit the six `.docx` files to `frontend/public/resources/` (or equivalent static-serving path).
4. Copy the six source markdown files to `frontend/src/resources/markdown/` for runtime import. Document the sync expectation in a README.

**Estimated effort:** ~30 min. Can be done in the implementation session or as a prep step.

### Phase B — Resources page and route

5. Create `frontend/src/pages/ResourcesPage.jsx` with the manifest-driven render.
6. Wire the route into whatever router pattern exists in `App.jsx` (verify pattern during implementation; do not assume React Router version).
7. Add top-nav entry; hide for `user.role === 'parent'`. Reuse existing top-nav styling patterns — no new component library.
8. Implement URL fragment handling on mount (scroll/expand).

### Phase C — Item recommendation deep-linking

9. Add a custom markdown renderer (or render-time post-processor) to the Results modal that detects forward-reference parentheticals and:
   - For Admin/Staff: wraps in `<a target="_blank" rel="noopener noreferrer">` with `ExternalLink` icon.
   - For Parent: leaves as plain text.
10. Match the parenthetical-to-item-id mapping in `resourceDeepLink.js`.

### Phase D — Verification

11. Manual smoke test on both seed tenants (Lincoln + Parkview), both roles (admin + staff; parent role if a seed parent exists — otherwise defer parent verification to when one does).
12. Confirm downloads work on Chrome, Safari, Firefox (no auth gate on static assets, so this should be trivial).
13. Confirm deep-link from Results modal opens new tab and scrolls to the right artifact.
14. Confirm parent role (if available) sees no nav entry and sees parentheticals as plain text.

### Rough size estimate

Per CLAUDE.md §8, anything > ~3 files or > ~100 lines is ask-first. This feature will touch:

- `frontend/src/pages/ResourcesPage.jsx` (new, ~150 lines)
- `frontend/src/resources/index.js` (new, ~80 lines including manifest)
- `frontend/src/utils/resourceDeepLink.js` (new, ~40 lines)
- `frontend/src/App.jsx` (route wiring, nav entry — ~20 lines)
- Results modal file (custom renderer — ~30 lines)
- README in `docs/tier1-resources/` (new, per Priority 2 carryover)
- Plus `.docx` binaries and copied `.md` files (not counted as "lines")

Total: ~5 files, ~320 lines of new code. **This exceeds the §8 threshold and will need to be chunked.** Recommended split:

- **Session 24a:** Phases A + B (content pipeline + Resources page + route + nav). Visible progress, no assessment-side changes yet. ~3 files, ~250 lines.
- **Session 24b:** Phase C (deep-linking from Results modal). ~2 files, ~70 lines. Smaller surface, higher modal-regression risk, deserves its own session.
- **Session 24c (optional):** README / organizational docs for `docs/tier1-resources/` per Priority 2. Docs-only; can be direct-to-main like Session 21's pattern.

Each chunk is independently shippable and reviewable.

---

## 8. Open questions (deferred to implementation sessions)

1. **Static asset location** — `frontend/public/resources/` (simpler) vs. `frontend/src/resources/downloads/` (Vite asset pipeline). Recommend `public/`, final call at implementation.
2. **Markdown detection approach** — regex match on parenthetical text vs. explicit markup in item bank. Recommend regex for v1; document as stability contract.
3. **Router pattern** — confirm what `App.jsx` uses before wiring. Do not assume React Router version.
4. **Secondary markdown download link** — include or omit on each resource card? Recommend include.
5. **Resources landing page content** — when a user hits `/resources` with no fragment, what do they see? Proposed: brief intro paragraph explaining what Resources are + the six cards. Final copy at implementation.
6. **Empty-state for parents if they ever reach `/resources` directly** — nav hides it, but deep-URL access is still possible. Proposed: 403-style polite redirect or a neutral "Resources are not available for your account" message. Favor the latter; 403 is hostile.

---

## 9. Ask-first items resolved in this scoping

Per CLAUDE.md §8:

- ✅ **New dependency** — `pandoc` for `.docx` generation is a local/manual tool, not a runtime dependency. No new runtime deps.
- ✅ **Database schema change** — none in v1.
- ✅ **Breaking API change** — none.
- ✅ **Large refactor** — implementation is chunked to stay within §8 thresholds per session.
- ✅ **New deployment/service assumption** — none. Static assets in the existing frontend build.
- ✅ **Replacing existing patterns** — no. Static JS module matches the item bank pattern; nav entry matches existing nav.
- ✅ **Sync ownership semantics** — N/A; feature is frontend-only.
- ✅ **Student/staff PII** — explicitly handled. v1 has zero PII surface. See §6.
- ✅ **New external service or webhook** — none.
- ✅ **Logging/error handling changes that could capture PII** — none. Feature does not log.
- ✅ **New PII field** — none.

---

## 10. Risks

1. **Pandoc output quality.** For 4 of 6 artifacts the output should be clean; Items 1.4 and 7.3 have complex structure that may need manual touch-up in the `.docx` after generation. Mitigation: visual inspection step in Phase A. Not a blocker — worst case we ship slightly-less-polished `.docx` files and iterate.

2. **Markdown/docx drift.** Source markdown in `docs/tier1-resources/` is the authoritative copy. `frontend/src/resources/markdown/` and `frontend/public/resources/*.docx` are generated artifacts. Without a CI sync check, they can drift. Mitigation for v1: document the sync expectation in a README; owner regenerates on any artifact edit. Formalize with a CI check if drift actually happens.

3. **Regex-based parenthetical detection brittleness.** If item bank copy changes the parenthetical phrasing, deep-links break silently. Mitigation: document the expected pattern in `resourceDeepLink.js`; a lightweight unit test (if test infrastructure exists — unknown from repo context) would catch regressions.

4. **New-tab UX on mobile.** On mobile browsers, `target="_blank"` can feel awkward. Mitigation: acceptable v1 tradeoff; mobile use of TierTrak is secondary to desktop admin/staff use. Revisit if mobile usage increases.

5. **Parent role deep-link access.** If a parent somehow obtains a `/resources#item-X-Y` URL (e.g., copy-paste from a staff member), they will see the polite empty-state message. This is acceptable — no PII is exposed; the experience is merely a dead end. Not a security issue because no artifact contains PII.

---

## 11. v2 preview (not scoped here)

Kept brief so v1 decisions don't paint v2 into a corner.

### Upload loop

If demand materializes, v2 adds district-level customization via upload:
- New table: `tenant_resource_customizations` (tenant_id, resource_id, file_path, uploaded_by, uploaded_at, acknowledged_no_pii_at).
- New object storage: Supabase Storage (already in-stack) as the obvious fit.
- Upload path includes: MIME + size validation, click-through ack ("I confirm this file contains no student PII"), explicit templates-only product copy.
- Download flow: if a tenant has a customization for a resource, serve that; otherwise serve the generic.
- Staff UI: upload, replace, revert-to-generic actions. Admin-only or all-staff TBD.
- **Ask-first triggers for v2:** new DB table (§8), new external service integration (§8), new PII-adjacent surface (§4B). v2 will need its own scoping doc.

### What v1 must preserve for v2

- The manifest shape (`RESOURCES` array) must support an optional per-tenant override slot cleanly. Recommend not designing that into v1 explicitly — add it when v2 arrives — but avoid baking assumptions that make it hard (e.g., don't hardcode file paths in the page; always go through the manifest).
- The `/resources#item-X-Y` URL scheme must remain stable so existing deep-links in future assessment results don't break when v2 ships.

### Other v2 candidates

- Search / filter once artifact count > 15.
- Analytics (download counts, most-viewed). Requires a separate privacy review per CLAUDE.md §8.
- Per-resource "last updated" display pulled from Git history or frontmatter.

---

## 12. Sign-off checklist

Before implementation begins, the following should be confirmed:

- [ ] Product owner approves v1 scope and defers v2 explicitly
- [ ] Pandoc approach (manual vs. CI) decided
- [ ] Router pattern in `App.jsx` verified (informs Phase B)
- [ ] Chunking plan (24a / 24b / 24c) approved or revised
- [ ] Parent seed account available for verification, OR parent-role verification explicitly deferred with a date-check condition

---

*End scoping v1.*
