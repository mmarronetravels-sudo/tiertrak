# §4B GREP PATTERNS

Regex catalog for §4B PII grep checks used by the `/landing-the-plane` skill and operator-side audit rituals. Loaded on demand by reviewers and scripts; not loaded in every Claude Code session.

This file complements `CLAUDE.md` Section 4B (the rules) and `feedback_4b_per_entry_standard.md` (the per-entry-not-whole-file standard). The patterns here are what to grep for; Section 4B is why.

## Audience

- **Operators** running pre-stage or post-PR-create §4B grep manually.
- **Scripts** (pre-commit hooks, CI checks, ad-hoc one-liners) that extract regex literals from this file.
- **Reviewers** auditing whether a §4B attestation in a PR body corresponds to a defensible check.

## Scope

These patterns catch §4B violations in append-only docs (`activities.txt`, planning docs), PR bodies, commit messages, and any other text-based audit-trail surface. They are NOT designed to scan code-level PII handling (database queries, route handlers) — that is the `privacy-reviewer` subagent's responsibility and requires semantic analysis, not regex alone.

## Patterns

Each pattern has a name, the regex literal (POSIX extended for `grep -E`), what it catches, and known false-positive shapes reviewers should expect.

### Email addresses

Regex:

```
[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}
```

Catches any email-shaped string with TLD of at least two characters. Hits real student / staff / parent / operator emails and any other email reference.

Known false positives: placeholder shapes used in documentation (for example, generated tokens of the form `prefix_{id}@revoked.tiertrak.local`). Reviewers distinguish placeholders from real addresses; the regex does not.

### School-type tokens

Regex:

```
elementary|middle school|high school|isd|usd|district
```

Catches school-type substrings that often co-occur with tenant-identifying context. Case-insensitive in normal use (`grep -Ei`).

Known false positives: generic uses of "school" in product copy, feature names containing "middle school" or "high school" as legitimate descriptors. Reviewers verify the surrounding context.

### PII column-name shapes

Regex:

```
first_name|last_name|date_of_birth|dob|ssn|phone_number|address_line|grade_level
```

Catches schema-column-name shapes for fields that hold PII. Hits both real column references in code and accidental enumeration in documentation.

Known false positives: legitimate schema documentation in migration files and `PRIVACY_REVIEW.md`. Reviewers verify whether the hit is in a controlled documentation surface versus leaking into a PR body or activities entry.

### Name-field tokens

Regex:

```
student[_ ]?(first|last|full)?[_ ]?name|staff[_ ]?(first|last|full)?[_ ]?name|parent[_ ]?(first|last|full|email)
```

Catches variants like `student name`, `student_name`, `student first name`, `staff full name`, `parent email`. This pattern also catches the recursion trap — describing the category by name inherits the matching string.

Known false positives: deliberate descriptions of the patterns inside this file (the line you are reading now is itself a hit). The expected workflow: this file contains the regexes; PR bodies and activities entries do not. Audit-trail prose cites that §4B was run, never what was checked for.

## Tenant slugs — not enumerated in this file

Real tenant slugs are §4B-sensitive: enumerating them in tracked content would itself be a violation. Tenant slugs are looked up at grep-time, not stored in this file. Two supported approaches:

### 1. Live lookup from the `tenants` table

For operators with prod read access, enumerate current slugs into an OR-pattern at grep-time:

```sh
slugs=$(psql "$PG_PROD_URL" -t -A -c "SELECT slug FROM tenants WHERE archived_at IS NULL" | paste -sd'|')
git diff origin/main -- activities.txt | grep '^+' | grep -v '^+++' | grep -nEi "$slugs"
```

### 2. Gitignored local config file

For operators without live prod access, maintain a one-slug-per-line file at `.4b-tenant-slugs.local` in the repo root. The filename is in `.gitignore` so it never enters version control:

```sh
slugs=$(paste -sd'|' < .4b-tenant-slugs.local)
git diff origin/main -- activities.txt | grep '^+' | grep -v '^+++' | grep -nEi "$slugs"
```

Neither approach stores the slug enumeration in tracked content. Reviewers checking a PR's §4B attestation should verify the slug list used at grep-time was current, but the list itself stays out of the repo.

## Usage

The standard §4B audit for an `activities.txt` append is two passes, narrow and wide, both against added lines only (`^+` excluding `^+++`).

- **Narrow pass:** union of the email pattern, the name-field-tokens pattern, and the operator-supplied tenant-slug pattern.
- **Wide pass:** union of the school-type-tokens pattern, the PII-column-name-shapes pattern, and a broader `@[A-Za-z0-9.-]+` pattern for non-RFC-shaped addresses.

Both passes must return zero matches before staging.

A supplemental pair-shape pass

```
\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b
```

catches the most common leak vector — real person names embedded in prose — but produces operational-text false positives that require manual review. It is a belt-and-suspenders check, not a gating check.

For PR-body grep, run the same patterns against the body text with no `^+` filter (the body is not a diff). The body must clear the same gate as the file diff. See `/landing-the-plane` skill Step 2 for the recursion-trap discipline.

## Maintenance

This file is the source of truth for §4B regex literals. To add a pattern:

1. Verify the new shape catches a real §4B leak class that existing patterns miss.
2. Add to the appropriate section above with name, regex, what-it-catches, and known false positives.
3. Run the new pattern against `activities.txt` history to confirm zero unexpected hits, or document historical hits as pre-existing per `feedback_4b_per_entry_standard.md`.
4. Update consuming scripts and the `/landing-the-plane` skill if the new pattern changes the standard narrow / wide split.

Pattern updates are §4B-procedural changes; PRs that touch this file should be reviewed with the same care as `CLAUDE.md` Section 4B edits.
