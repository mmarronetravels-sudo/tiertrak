# docs/references/

Source-of-truth reference documents for jurisdiction-specific compliance
content — Section 504 handbooks, IDEA / IEP procedural safeguards, state-
published evaluation forms, **individual sample-form templates**, and
similar artifacts. These documents drive frontend form-set definitions in
`frontend/src/data/<feature>-form-sets/`.

## Filename convention

`<state>-<authority>-<year>-<doc-shortname>.<ext>`

Examples:
- `oregon-ode-2025-section-504-handbook.pdf`
- `washington-ospi-2026-iep-handbook.pdf` (hypothetical)
- `california-cde-2025-504-procedural-safeguards.pdf` (hypothetical)

The state prefix keys the document to a single jurisdiction. The authority
slug (`ode`, `ospi`, `cde`, etc.) names the issuing agency. The year tracks
the publication or revision year so multiple revisions can coexist if a
form set spans them. The doc-shortname is descriptive but kebab-case.

## Workflow

When a new state's form set is added to TierTrak:
1. The matching handbook lands here first.
2. The form-set JS module in `frontend/src/data/<feature>-form-sets/`
   references it as the source citation in its header comment.
3. Section structures, instruction text, signature lines, and procedural
   safeguards content in the JS module are drawn directly from the
   handbook contents — never reconstructed from training memory or
   plausible inference.

## Format

PDF preferred for original-source fidelity. Markdown transcripts may
accompany a PDF if useful for grep / future automation, but the PDF is
authoritative when they disagree.
