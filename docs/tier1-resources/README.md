# Tier 1 Resources — source markdown and generated artifacts

## Authoritative source

The six `.md` files in this directory are the authoritative source for the Tier 1 Resources feature. All other copies (`.docx` files, `frontend/public/resources/`, `frontend/src/resources/markdown/`) are generated or copied from here.

## Generated / copied artifacts

When any `.md` file in this directory is edited, the following must be regenerated or resynced:

1. `frontend/public/resources/<name>.docx` — regenerate via `pandoc <name>.md -o <target>.docx`.
2. `frontend/public/resources/<name>.md` — copy the updated source (for the markdown-source download link).
3. `frontend/src/resources/markdown/<name>.md` — copy the updated source (for Vite `?raw` import into the preview modal).

## Sync is manual in v1

There is no CI check enforcing that the copies stay in sync with the authoritative source. If drift becomes a real problem, a CI check is the first thing to add. Until then, the owner of a markdown edit is responsible for running the pandoc regeneration and the two copies.

## The six artifacts

- `1.2-mtss-team-roles.md` — MTSS Team Roles Template
- `1.3-mtss-handbook.md` — MTSS Handbook Template
- `1.4-annual-mtss-calendar.md` — Annual MTSS Calendar Template
- `2.3-high-leverage-tier1-practices.md` — High-Leverage Tier 1 Practices Guide
- `3.4-sample-discipline-flowchart.md` — Sample Discipline Flowchart
- `7.3-parent-assessment-results-summary.md` — Parent Assessment Results Summary Template

See `docs/scoping-v2.md` for the feature's scope and the role-to-resource access mapping.
