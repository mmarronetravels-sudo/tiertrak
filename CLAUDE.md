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
- **Backend:** Express.js 5 + Node.js — hosted on **Vercel** (serverless functions or Express server)
- **Database:** PostgreSQL via **Supabase** — accessed directly using the `pg` driver (no ORM)
- **Authentication:** JWT (`jsonwebtoken`) + Google OAuth (`google-auth-library`)
- **File storage:** AWS S3 (`@aws-sdk/client-s3`) with presigned URLs (`@aws-sdk/s3-request-presigner`)
- **Email:** Resend
- **File uploads:** Multer
- **CSV import:** csv-parser
- **Password hashing:** bcrypt
- **Environment config:** dotenv

### What is NOT in the current stack
Do not introduce or assume the following without explicit approval:
- NestJS, TypeORM, Prisma, or any ORM — raw `pg` queries are used directly
- Redis or any caching layer
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

In TierTrak, a "tenant" is a school or district. Every piece of student and staff data belongs to exactly one school. Cross-tenant data leakage is not just a product bug — it is a potential FERPA violation. Treat any cross-tenant risk as a critical severity issue.

- Every database query that returns student, staff, or intervention data must be scoped to the correct school.
- Never return data from a query without a school-scoping WHERE clause.
- Never trust the frontend to enforce school scoping — always enforce it in the backend.
- JWT tokens must be validated on every protected route.
- New database tables that store school-specific data must include a school identifier column.
- New school-scoped tables must have an index on the school identifier column.
- Do not introduce cross-school reads or writes under any circumstance.
- Rate limiting should be preserved on any endpoint that accepts external input.

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
- Recommended plugin: Superpowers from the official Anthropic marketplace (`/plugin install superpowers@claude-plugins-official`) — supplies `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion`, `using-git-worktrees`, and `finishing-a-development-branch`. The project `/landing-the-plane` skill wraps `finishing-a-development-branch` and adds the `activities.txt` log.
