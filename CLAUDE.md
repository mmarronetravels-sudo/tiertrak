You are working in **TierTrak**, a MTSS (Multi-Tiered System of Supports) intervention tracking SaaS for K-12 schools. This product handles sensitive student and staff data and is subject to FERPA, COPPA (for students under 13), and applicable state student privacy laws.

## 0) Session Handshake (required)
Before making any code change:
1. Read this file completely.
2. Read the existing files in the area you plan to modify.
3. Confirm back the relevant constraints for the task.
4. If any instruction conflicts with the repository's current implementation, follow the repository and call out the conflict explicitly.
5. Confirm the current git branch is **not** `main` or `master`. If it is, follow Section 2A before editing anything.

---

## 1) GOAL
Produce **small, verifiable, production-safe changes** that improve TierTrak without destabilizing the current codebase.

Success means:
- The implementation matches the existing TierTrak stack and patterns.
- The change is minimal, testable, and easy to review.
- Multi-tenant (per-school) safety is preserved at all times.
- Student and staff PII is never logged, exposed in errors, or included in API responses beyond what the requesting tenant requires.
- All changes are evaluated against FERPA, COPPA, and applicable state student privacy laws.
- No speculative rewrites or framework substitutions are introduced.
- **Every change lands on a feature branch with a reviewable PR** — see Section 2A.

---

## 2) STACK CONSTRAINTS (non-negotiable unless explicitly told otherwise)

### Actual project stack (verified against repository)
- **Frontend:** React (Vite) — hosted on **Vercel**
- **Backend:** Express.js 5 + Node.js — hosted on **Render** (long-lived Express server)
- **Database:** PostgreSQL — hosted on **Render**, accessed directly using the `pg` driver (no ORM)
- **Authentication:** JWT (`jsonwebtoken`) + Google OAuth (`google-auth-library`)
- **File storage:** AWS S3 (`@aws-sdk/client-s3`) with presigned URLs (`@aws-sdk/s3-request-presigner`)
- **Email:** Resend
- **Caching / rate-limit store:** Render Key Value (Valkey 8.1.4)
- **File uploads:** Multer
- **CSV import:** csv-parser
- **Password hashing:** bcrypt
- **Environment config:** dotenv

### What is NOT in the current stack
Do not introduce or assume the following without explicit approval:
- NestJS, TypeORM, Prisma, or any ORM — raw `pg` queries are used directly
- Any UI component library (Material UI, Chakra, Shadcn, etc.)
- Any additional auth provider beyond JWT + Google
- Any additional file storage provider beyond AWS S3
- Any additional email provider beyond Resend
- A frontend state management library (Zustand, Redux, etc.)

### Never silently replace the stack
Do **not** substitute in new architectural choices such as:
- A different backend framework
- An ORM to replace raw pg queries
- A different hosting or deployment assumption
- A frontend build system change

If a task would genuinely benefit from a new dependency or architectural change, **propose it first and wait for approval**.

---

## 2A) BRANCHING & PR DISCIPLINE (non-negotiable)

All design, implementation, and refactor work **MUST happen on a dedicated feature branch**. Work is never committed directly to `main` or `master`. Every change lands through a reviewable pull request.

### Branch lifecycle (required for every task)

1. **Verify the starting branch.** Before touching any file, run `git status` and `git branch --show-current`. If you are on `main` or `master`, stop and create a new branch first.
2. **Create the branch with a conventional name**:
   - `feat/<short-slug>` — new user-visible features
   - `fix/<short-slug>` — bug fixes
   - `chore/<short-slug>` — refactors, dependency bumps, config, docs, tooling
   - `sec/<short-slug>` — anything touching auth, PII fields, tenant isolation, RBAC, file upload validation, or CSV sanitization
   - `migration/<short-slug>` — any SQL schema change
   The slug is lowercase kebab-case, 2–5 words, describing the task (e.g., `feat/parent-link-expiry`, `sec/csv-import-sanitize`).
3. **Commit incrementally** with descriptive messages that complete the sentence "If applied, this commit will…". Do not squash the entire feature into one commit. Commits are the reviewer's audit trail.
4. **Push the branch** to `origin` with `git push -u origin <branch>` as soon as there is a reviewable unit of work. Never force-push to a shared branch.
5. **Open a Pull Request** via `gh pr create` using the template in the next subsection. The PR must reference the task or issue it addresses.
6. **Do not merge your own PR** on any change that touches Section 4B (PII) or Section 5 (multi-tenancy). Request human review.

### PR description template (required)

Every PR description MUST include the following sections, in this order. Claude Code must generate this pre-filled when proposing a PR:

```
## Summary
- <1–3 bullets describing what changed and why>

## Files touched
- <relative/path/file.js> — <one-line reason>

## Stack check
- [ ] No new dependencies added, OR new dependencies listed and justified below
- [ ] No framework/ORM/hosting substitutions
- [ ] Follows existing raw-pg query pattern (backend) and existing Vite/React pattern (frontend)

## Tenant isolation check  (required for any DB change)
- [ ] Every new or modified SQL query is scoped by school/tenant identifier
- [ ] No cross-tenant reads or writes introduced
- [ ] New school-scoped tables include a tenant-identifier column AND an index on it

## Privacy impact  (required for every PR)
- [ ] None — no PII fields read, written, logged, or transmitted; OR
- [ ] Describe exactly which PII fields are touched and cite the relevant rule(s) from Section 4B
- [ ] Confirm: no PII in logs, no PII in error bodies, no PII in URLs or query strings

## Verification
- Commands run and passed:
  - [ ] `npm test` (or targeted test command)
  - [ ] `npm run lint`
  - [ ] Local smoke test: <steps>
  - [ ] Migration dry-run on a non-production DB (if schema change)

## Ask-first items  (Section 8)
- <List any Section 8 triggers the task crossed, and confirm approval was granted>

## Screenshots / logs
- <paste or link, if UI or observable behavior changed>
```

### What counts as a review

For PRs touching §4B (PII) or §5 (tenant isolation), "review" means
a formal GitHub PR review submitted via the GitHub API and recorded
as an entry in the PR's `reviews` array with `state: "APPROVED"`.

The mechanical test:

    gh pr view <PR> --json reviewDecision

must return `"APPROVED"` before the PR can be merged.

The following are NOT reviews and do not satisfy §2A:

- Text in the merge commit body (e.g., "reviewed and approved") —
  that's a commit message, not a review API entry
- Verbal approval, Slack messages, email confirmation, or any
  out-of-band sign-off
- General PR comments, including ones saying "LGTM"
- Reviewer subagent reports (privacy / tenant-isolation / security)
  — these are useful pre-review signals and belong in the PR body
  for transparency, but they do not substitute for human review

The reviewer must submit approval via `gh pr review <PR> --approve`
or the GitHub UI's "Approve" button. The author cannot review their
own PR.

### Enforcement: branch protection on `main`

`main` is configured with a GitHub Ruleset:

- Pull request required before merging
- 1 approving review required
- Stale approvals dismissed on new commits
- Block force pushes; restrict deletions
- Repository admin role allowed in the bypass list "for pull
  requests" (admin-override path remains available for
  emergencies — see below)

This means the merge button is mechanically disabled until
`reviewDecision` is `APPROVED`. Self-merge of a §4B/§5 PR is no
longer possible without an explicit override.

### Emergency override

The GitHub Ruleset allows admins to bypass the review requirement
via the "for pull requests" bypass mode. This is "break glass," not
"convenience."

Acceptable use:

- Time-critical security fix where waiting for the reviewer would
  extend live exposure
- Reviewer unreachable for an extended period and the merge
  genuinely cannot wait

Required when using the override:

1. Post a comment on the PR before clicking merge stating: (a) why
   the override is being used, and (b) why waiting for normal
   review wasn't viable
2. The override is logged by GitHub in the repo audit log; the PR
   comment plus the audit log entry form the audit trail

Do not normalize the override. If it's needed more than rarely,
the issue is the review process, not the override.

### Documented failure modes (per Followup J/#95)

The following are failure modes that have occurred (PR #66,
Session 54) and must not recur:

- **Owner self-merge of a §4B/§5 PR with no formal review
  record.** Branch protection now mechanically prevents this.
  Pre-PR-#66 the rule was procedural-only and the merge happened.
- **Reviewer reads diff substantively but does not submit
  `gh pr review --approve`.** The substantive review is valuable;
  the missing API entry leaves the PR with no audit trail.
  Reviewers must use the formal mechanism, not just convey
  approval.
- **Reviewer subagent reports treated as substitutes for human
  review.** They are pre-review signals, not the review itself.
- **Stacked-PR mis-merge: a feature PR merged into its stacked
  base branch (not `main`) after that base already merged to
  `main`, orphaning the feature commits from `main`.** GitHub
  marks the PR `MERGED` but its code never reaches `main`/the
  deploy. Land stacked PRs base-first and re-target the stacked PR
  to `main` before merging it; the `/landing-the-plane`
  orphaned-commit gate (`git merge-base --is-ancestor <head>
  origin/main`) catches it at session close. See
  `feedback_stacked_pr_land_base_first.md`.

### What Claude Code must do at the start of every coding task

- Run the Session Handshake (Section 0). This now includes the branch check.
- If a feature branch does not yet exist for this task, **create it before the first edit**. Never edit from `main`/`master`.
- Generate the pre-filled PR description in the task's final output, even before the PR is opened, so the human reviewer sees exactly what will be claimed.
- Never run `git push origin main`, `git push origin master`, or `git push -f` against a shared branch. These are also deny-listed in `.claude/settings.json`.

---

## 3) REPO-SPECIFIC HARD RULES
- Make **surgical changes only**.
- Read existing code before changing anything.
- Do **not** rewrite or mass-refactor files just because you would structure them differently.
- All database queries use raw SQL via the `pg` driver — maintain this pattern.
- Always use environment variables via `dotenv` for secrets and environment-specific values.
- Never hardcode credentials, tokens, API keys, secrets, school identifiers, or environment values.
- All SQL column names use **snake_case**.
- Route files follow existing Express router patterns already present in the repo.
- Never bypass authentication middleware for convenience.
- File uploads must always be validated for type and size before processing.
- CSV imports must validate and sanitize all fields before inserting into the database.

---

## 4) DATA OWNERSHIP BOUNDARIES (critical)

### TierTrak owns all intervention and tracking data
- Student intervention records, tier assignments, progress notes
- Staff assignments and caseloads
- Meeting records and outcomes
- Uploaded documents and forms
- Referral and evaluation data

### External sources (CSV imports, Google Auth)
- Student roster data imported via CSV is the school's source of truth for identity
- Google Auth provides identity verification only — do not store unnecessary Google profile data
- Do not write data back to any external system

### Data minimization
- Only store fields that TierTrak actually uses
- If a CSV import contains fields TierTrak does not need, do not persist them
- Propose explicit data minimization if a new import adds student/staff fields

---

## 4B) STUDENT & STAFF DATA PROTECTION (non-negotiable)

This product is used by K-12 schools. Student and staff data is subject to FERPA, COPPA (for students under 13), and applicable state privacy laws. For the full PII checklist, review protocol, and worked examples, see `@docs/ai-context/PRIVACY_REVIEW.md`.

### What counts as protected data
Treat the following as sensitive PII at all times:
- Student names, IDs, grade levels, enrollment status
- Staff names, roles, employment data
- Any data that could identify an individual student or staff member
- Intervention history, tier placements, meeting notes, referral data
- Attendance or behavioral data linked to a person
- Any uploaded documents containing student or staff information

### Hard rules for PII
- Never log PII to console, application logs, or error tracking tools.
- Never include PII in error messages returned to the frontend.
- Never expose one school's student/staff data to another school — ever.
- Never store PII in a field not explicitly designed to hold it.
- Do not use student/staff data for any purpose beyond the feature it was collected for.
- S3 file uploads containing student data must use presigned URLs — never expose raw S3 bucket paths publicly.
- CSV imports containing student data must be deleted from the server immediately after processing.

### Breach and exposure risks — always call out
If a change could plausibly expose PII across schools or externally, flag it explicitly before implementing. This is an ask-first trigger (see Section 8).

---

## 5) MULTI-TENANCY & SECURITY CONSTRAINTS

In ScholarPath Intervention Monitoring, the tenant model is **layered**:

- A **school** is a `tenants` row (`type = 'school'`). It owns the student/staff/intervention data.
- A **district** is a `districts` row. It is a parent of one or more school-tenants via `tenants.district_id`.
- **Single-school customers** are standalone tenant rows with `district_id = NULL`. They are still tenants in the strict sense — no district layer above them.
- **Cross-district data leakage is treated as a critical FERPA risk**, identical in severity to cross-school leakage in the pre-district model. There is no scenario in which one district's data may be read or written by another district's session.

Every staff user belongs to exactly one district (or none, for legacy single-tenant users). The set of school-tenants a user can access is recorded in `user_school_access(user_id, school_tenant_id, district_id)`. Role alone never determines school access — the access table is the source of truth.

Dual-path access contract: scope resolution branches on `users.district_id`. For legacy single-tenant users (`users.district_id IS NULL`), scope is `users.tenant_id` equality. For district users (`users.district_id IS NOT NULL`), scope is the membership of `user_school_access` for that user. A centralized helper (`resolveAccessibleTenantIds`, at `middleware/resolveAccessibleTenantIds.js`) enforces this branch; call sites must not inline the check.

Hard rules:

- Every database query that returns student, staff, or intervention data must be scoped to the requesting user's **accessible school-tenant set**, not to a single hard-coded `tenant_id`.
- Never return data from a query without that scoping clause.
- Never trust the frontend to enforce school or district scoping — always enforce it in the backend.
- JWT tokens must be validated on every protected route. The token payload identifies the user; the user's accessible-school set is the authoritative scope.
- New tables that store school-scoped data must include a school-tenant identifier column AND an index on it. (Storing only a `district_id` is not sufficient — the school identity is what scopes the data.)
- District-scoped data (e.g., district-level reports, district-wide audit logs) must include a `district_id` column AND an index on it, and must be scoped by the user's district.
- The composite-FK cross-scope rejection pattern from Migration 021 (`UNIQUE(id, scope_id)` on the parent + `(child_id, scope_id) REFERENCES parent(id, scope_id)`) must be used for any new child table whose rows must live within a single school or single district.
- Do not introduce cross-school reads/writes that bypass `user_school_access`. Do not introduce cross-district reads/writes under any circumstance.
- Rate limiting must be preserved on any endpoint that accepts external input.

Resolved product decisions (#122 cross-school parent-student links, #123 per-school tier1-assessment in-progress scoping) are codified in `docs/ai-context/DISTRICT_STRUCTURE.md`.

---

## 6) OUTPUT FORMAT REQUIREMENTS FOR CODE TASKS
When implementing a change, provide output in this order unless asked for something else:
1. **Plan** — brief, task-specific, grounded in the actual repo
2. **Files to change** — exact paths relative to project root
3. **Implementation** — code changes only in the files that need modification
4. **Verification** — what to test and how to verify
5. **PR description** — pre-filled using the template in Section 2A
6. **Risks / assumptions** — only if relevant

When writing code:
- Preserve the current style of the surrounding code.
- Prefer small helper extraction over large rewrites.
- Keep functions focused.
- Use explicit and consistent error handling patterns already present in the repo.
- Reuse existing route/middleware/query patterns where available.
- Avoid introducing "temporary" code that becomes permanent tech debt.

---

## 7) FAILURE CONDITIONS (output is unacceptable if any occur)

### Branch / PR failures
- Commits or edits made directly to `main` or `master`
- Force-pushes to shared branches
- A PR without the Tenant isolation check or Privacy impact section filled in
- Merging a PII- or tenant-touching PR without human review

### Architecture / stack failures
- Introduces a different framework or major library without approval
- Replaces raw `pg` queries with an ORM without approval
- Adds dependencies without first asking
- Changes hosting or deployment assumptions without approval

### Data safety failures
- Breaks school-level tenant isolation
- Creates unscoped database reads/writes where school scoping is required
- Changes schema without clearly describing migration impact
- Introduces destructive migration risk without calling it out

### Privacy & compliance failures
- Logs or surfaces PII in any error, response, or debug output
- Allows one school's data to be read or written by another school's session
- Persists PII fields that the application does not use
- Leaves uploaded CSV files on the server after processing
- Exposes raw S3 paths for files containing student data
- Introduces a new data collection point without documenting what is stored and why
- Adds external API calls or third-party services that could receive student/staff data without explicit approval

### Code quality failures
- Makes broad refactors unrelated to the task
- Duplicates logic that already exists in the repo
- Ignores existing file/route/query patterns
- Hardcodes env values, secrets, or school identifiers

### Security failures
- Skips JWT validation on a protected route
- Adds an endpoint that accepts data without input validation or sanitization
- Processes a file upload without validating type and size
- Inserts CSV data into the database without sanitizing fields first
- Bypasses authentication or rate limiting for convenience

---

## 8) ASK-FIRST TRIGGERS
Stop and ask before proceeding if the task requires:
- A new dependency
- A database schema change or new table
- A breaking API change
- A large refactor (more than ~3 files or ~100 lines)
- A new external service, webhook, or third-party integration
- Replacing existing patterns with a different pattern
- Any change that touches student or staff PII fields
- Any change to logging, error handling, or monitoring that could capture PII
- Any new data field that stores personally identifiable information
- Any change to authentication or authorization logic
- Any merge into `main`/`master` on a PII- or tenant-touching PR

---

## 9) DEFAULT WORKING STYLE
- Prefer the smallest safe change that solves the problem.
- Be explicit about assumptions.
- When uncertain, read more of the repo before writing code.
- Optimize for maintainability and correctness, not novelty.
- Respect the existing architecture even when it is not your preferred architecture.
- When in doubt about whether something touches student/staff data, assume it does and flag it before proceeding.
- Privacy-preserving approaches are always preferred over convenient ones.
- At the end of a task, invoke the `/landing-the-plane` skill to verify tests, finalize the branch (merge/PR/keep/discard), and append a session entry to `activities.txt`.

---

## 10) COMPANION DOCS
These files provide additional context for specific tasks. Claude Code loads them on demand via `@`-import, not every session.
- `@docs/ai-context/STACK_ARCHITECTURE.md` — detailed architecture reference
- `@docs/ai-context/CODING_PREFERENCES.md` — code style and conventions
- `@docs/ai-context/SECURITY_REVIEW.md` — security review protocol
- `@docs/ai-context/PRIVACY_REVIEW.md` — student/staff data handling checklist (FERPA fields, PII scope, cross-school risk, data minimization review)

## 11) CLAUDE CODE CONFIGURATION
- Permissions and deny-lists: `.claude/settings.json`
- Custom project skill for session close: `.claude/skills/landing-the-plane/`
- Project subagents for review:
  - `.claude/agents/privacy-reviewer.md`
  - `.claude/agents/security-reviewer.md`
  - `.claude/agents/tenant-isolation-auditor.md`
  - Invoke these subagents directly via the Task tool with `subagent_type=privacy-reviewer`, `subagent_type=security-reviewer`, or `subagent_type=tenant-isolation-auditor`. Do not dispatch reviewer work via `subagent_type=general-purpose`.
- Recommended plugin: Superpowers from the official Anthropic marketplace (`/plugin install superpowers@claude-plugins-official`) — supplies `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion`, `using-git-worktrees`, and `finishing-a-development-branch`. The project `/landing-the-plane` skill wraps `finishing-a-development-branch` and adds the `activities.txt` log.
