You are working in **D2** (pronounced "D-Two", not "D-squared"), a manufacturing scheduling SaaS add-on for OrderTime MRP users. This product is used by K-12 schools. Student and staff data is subject to FERPA, COPPA (for students under 13), and applicable state privacy laws.

## 0) Session Handshake (required)
Before making any code change:
1. Read this file completely.
2. Read the existing files in the area you plan to modify.
3. Confirm back the relevant constraints for the task.
4. If any instruction conflicts with the repository's current implementation, follow the repository and call out the conflict explicitly.

See `docs/ai-context/SESSION_HANDSHAKE.md` for the exact first-message template.

---

## 1) GOAL
Produce **small, verifiable, production-safe changes** that improve D2 without destabilizing the current codebase.

Success means:
- The implementation matches the existing D2 stack and patterns.
- The change is minimal, testable, and easy to review.
- Multi-tenant safety is preserved.
- OrderTime planning data and D2 execution data boundaries are preserved.
- No speculative rewrites or framework substitutions are introduced.
- Student and staff PII is never logged, exposed in errors, or included in API responses beyond what the requesting tenant requires.
- All changes are evaluated against FERPA, COPPA, and applicable state student privacy laws.

---

## 2) STACK CONSTRAINTS (non-negotiable unless explicitly told otherwise)

### Actual project stack (verified against repository)
- **Backend:** NestJS 10 + TypeScript + TypeORM 0.3 — hosted on **Render** (`dwight-7v4h.onrender.com`)
- **Database:** PostgreSQL on **Supabase** — tenant-aware data model, TypeORM migrations
- **Frontend:** Single-file React 18 app in `frontend/index.html` (CDN-loaded React + Babel + TailwindCSS) — hosted on **Netlify**
- **Automation / integration:** N8N Cloud workflows → OrderTime ERP API (unidirectional sync: OrderTime → D2)
- **API documentation:** Swagger decorators in NestJS controllers (available at `/api/docs` in non-production)
- **Rate limiting:** `@nestjs/throttler` — 60 requests per 60 seconds per IP
- **Security headers:** Helmet.js
- **Real-time:** Socket.io via `@nestjs/websockets` (dashboard gateway)

### What is NOT in the current stack (despite references in some docs)
The following are described in architecture docs but **not implemented**:
- Redis — not present in code or dependencies
- AWS ECS/ECR — not used; hosting is Render + Netlify
- Zustand — not installed; frontend uses `useState` only
- JWT authentication — `@nestjs/jwt` is installed but auth is **not implemented** (guards return `true`)
- Supabase RLS — no policies are active; tenant isolation is application-layer only
- `railway.json` — inert config file from a previous hosting consideration; not in use

### Never silently replace the stack
Do **not** substitute in new architectural choices such as:
- Next.js, Vite build system, or SPA framework rewrite
- Convex, Prisma, or any ORM replacement
- Clerk, NextAuth, or Firebase Auth
- Material UI, Chakra UI, or any UI component library
- A frontend build system rewrite or component extraction
- A new state management framework
- Direct "best practice" rewrites that ignore the existing repo

If a task would genuinely benefit from a new dependency or architectural change, **propose it first and wait for approval**.

---

## 3) REPO-SPECIFIC HARD RULES
- Make **surgical changes only**.
- Read existing code before changing anything.
- Do **not** rewrite or mass-refactor files just because you would structure them differently.
- Frontend changes must follow the current single-file `frontend/index.html` pattern unless explicitly asked to extract or restructure.
- NestJS backend changes must follow existing module/service/controller/entity conventions already present in the repo.
- All database columns use **snake_case**.
- Entity files in `backend/src/entities/` use **PascalCase singular** names (e.g., `WorkCenter.ts`, `AuditLog.ts`).
- Entity files co-located in modules use **kebab-case singular** with `.entity.ts` suffix (e.g., `work-order.entity.ts`).
- Module/controller/service folders use **kebab-case plural** names (e.g., `work-orders/`, `closed-work-orders/`).
- Always use `ConfigService` / env-based configuration for secrets and environment-specific values.
- Never hardcode credentials, tokens, API keys, secrets, tenant identifiers, or environment values.
- All API changes should preserve or extend Swagger documentation via `@ApiOperation`, `@ApiResponse`, `@ApiTags`, etc.
- The default tenant ID `908f6d55-342d-49e3-a448-ad069285a1b9` in the frontend is a development convenience — treat it as configuration, not a constant.

---

## 4) DATA OWNERSHIP BOUNDARIES (critical)

Data flows **one direction**: OrderTime → N8N → D2 backend → D2 frontend. D2 does not write back to OrderTime.

### OrderTime owns planning/master-source data
These arrive via N8N sync endpoints (`POST /{entity}/sync`). Examples:
- Work order source fields (doc_no, item_name, quantity_ordered, due_date, sales_order, customer)
- Item master data, BOM components, inventory levels
- Vendor and customer records
- Sales orders, purchase orders, and their line items

### D2 owns execution/runtime data
Do **not** overwrite D2-owned execution data during sync. Protect fields such as:
- Execution status changes made within D2
- Scheduling results (planned start/end from the scheduling engine)
- Operator assignments performed in D2
- Work center assignments and capacity allocations
- Quantities produced / scrapped / execution results
- User-entered notes, priority overrides, expedite flags set in D2
- `needs_review` and `change_summary` (change-detection fields)

### Mixed-ownership models
If a sync task touches a model with both upstream and D2-owned fields, explicitly separate:
- Fields that may be refreshed from OrderTime
- Fields that must remain D2-controlled
- Derived or merged fields that require careful merge logic

---

## 4B) STUDENT & STAFF DATA PROTECTION (non-negotiable)

This product is used by K-12 schools. Student and staff data is subject to FERPA,
COPPA (for students under 13), and applicable state privacy laws.

### What counts as protected data
Treat the following as sensitive PII at all times:
- Student names, IDs, grade levels, enrollment status
- Staff names, roles, employment data
- Any data that could identify an individual student or staff member
- Scheduling or attendance data linked to a person

### Hard rules for PII
- Never log PII to console, application logs, or error tracking tools.
- Never include PII in error messages returned to the frontend.
- Never expose one school's student/staff data to another tenant — ever.
- Never store PII in a field not explicitly designed to hold it.
- Do not use student/staff data for any purpose beyond the feature it was collected for.
- If a sync payload contains PII, confirm it is scoped to the correct tenant before persisting.

### Data minimization
- Only request and store fields that the application actually uses.
- If a sync payload contains PII fields D2 does not need, do not persist them.
- Propose explicit data minimization if a new sync adds student/staff fields.

### Breach and exposure risks — always call out
If a change could plausibly expose PII across tenants or externally, flag it
explicitly before implementing. This is an ask-first trigger (see Section 8).

---

## 5) MULTI-TENANCY & SECURITY CONSTRAINTS
- Assume tenant isolation is mandatory.
- Every controller currently resolves the tenant via `tenantsService.getOrCreateDefault()` — follow this pattern until real auth is implemented.
- Do not introduce cross-tenant reads or writes.
- Preserve `tenant_id` handling and tenant scoping patterns.
- New database tables must include `tenant_id` if they are tenant-scoped.
- New tenant-scoped tables must have an index on `tenant_id`.
- New backend modules should import `TenantsModule` and follow the existing tenant resolution pattern.
- Never bypass guards, validation, or throttling for convenience.
- The `TenantGuard` and `RolesGuard` in `backend/src/guards/` currently return `true` (stubs). Do not remove them — they are placeholders for future auth.
- In a school context, a "tenant" maps to a school or district. Cross-tenant data leakage is not just a product bug — it is a potential FERPA violation. Treat any cross-tenant risk as a critical severity issue, not a code quality issue.

---

## 6) OUTPUT FORMAT REQUIREMENTS FOR CODE TASKS
When implementing a change, provide output in this order unless the user asked for something else:
1. **Plan** — brief, task-specific, grounded in the actual repo
2. **Files to change** — exact paths relative to project root
3. **Implementation** — code changes only in the files that need modification
4. **Verification** — what to test and how to verify
5. **Risks / assumptions** — only if relevant

When writing code:
- Preserve the current style of the surrounding code.
- Prefer small helper extraction over large rewrites.
- Keep functions focused.
- Use explicit types in TypeScript (minimize `any`).
- Reuse existing DTO/entity/service patterns where available.
- Avoid introducing "temporary" code that becomes permanent tech debt.

---

## 7) FAILURE CONDITIONS (output is unacceptable if any occur)

### Architecture / stack failures
- Introduces a different framework or major library without approval
- Rewrites single-file frontend into a new architecture without approval
- Replaces TypeORM patterns with a different data layer without approval
- Adds dependencies without first asking

### Data safety failures
- Overwrites D2 execution data during sync
- Breaks tenant isolation
- Creates tenant-unscoped reads/writes where tenant scoping is required
- Changes schema without clearly describing migration impact
- Introduces destructive migration risk without calling it out

### Privacy & compliance failures
- Logs or surfaces PII in any error, response, or debug output
- Allows one school's data to be read or written by another school's session
- Persists PII fields that the application does not use
- Introduces a new data collection point without documenting what is stored and why
- Adds external API calls or third-party services that could receive student/staff data without explicit approval

### Code quality failures
- Makes broad refactors unrelated to the task
- Duplicates logic that already exists in the repo
- Ignores existing file/module patterns
- Uses `any` where a clear type is practical
- Hardcodes env values or secrets

### Frontend failures
- Introduces a UI library not already approved for the repo
- Adds a bundler/build assumption to the single-file frontend without approval
- Breaks current UI behavior while trying to "clean up" structure

### Backend failures
- Adds endpoints without tenant consideration
- Skips validation for new input paths
- Bypasses service-layer patterns and puts too much logic in controllers
- Omits Swagger operation metadata on public endpoints

### Integration failures
- Changes OrderTime/N8N payload assumptions without documenting them
- Writes sync logic that is not idempotent when idempotency is needed
- Fails to distinguish inbound source-of-truth fields from D2-managed fields

---

## 8) ASK-FIRST TRIGGERS
Stop and ask before proceeding if the task requires:
- A new dependency
- A database schema change or migration
- A breaking API change
- A large refactor (more than ~3 files or ~100 lines)
- A new deployment/service assumption
- Replacing existing patterns with a preferred pattern
- Changing sync ownership semantics
- Any change that touches student or staff PII fields
- Any new external service, webhook, or third-party integration that could receive school data
- Any change to logging, error handling, or monitoring that could capture PII
- Any new data field that stores personally identifiable information

---

## 9) DEFAULT WORKING STYLE
- Prefer the smallest safe change that solves the problem.
- Be explicit about assumptions.
- When uncertain, inspect more of the repo before coding.
- Optimize for maintainability and correctness, not novelty.
- Respect the existing architecture even when it is not your preferred architecture.
- When in doubt about whether something touches student/staff data, assume it does and flag it before proceeding.
- Privacy-preserving approaches are always preferred over convenient ones.

---

## 10) COMPANION DOCS
These files provide additional context for specific tasks:
- `docs/ai-context/STACK_ARCHITECTURE.md` — detailed architecture reference
- `docs/ai-context/CODING_PREFERENCES.md` — code style and conventions
- `docs/ai-context/PROMPT_CONTRACT_TEMPLATE.md` — reusable prompt structure
- `docs/ai-context/FAILURE_CONDITIONS_CHECKLIST.md` — pre-flight review checklist
- `docs/ai-context/SECURITY_REVIEW.md` — security review protocol
- `docs/ai-context/SESSION_HANDSHAKE.md` — first-message template
- `docs/ai-context/FEATURE_PROMPT_TEMPLATE.md` — feature implementation contract
- `docs/ai-context/BUGFIX_PROMPT_TEMPLATE.md` — bugfix contract
- `docs/ai-context/MIGRATION_PROMPT_TEMPLATE.md` — schema/migration contract
- `docs/ai-context/PRIVACY_REVIEW.md` — student/staff data handling checklist (FERPA fields, PII scope, cross-tenant risk, data minimization review)
