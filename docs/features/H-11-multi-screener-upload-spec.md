# H-11 — Multi-Screener Bulk Upload — Spec (Draft)

**Spec date:** 2026-06-19
**Product:** ScholarPath Intervention Monitoring
**Status:** DRAFT for review. Audit complete (read-only, 2026-06-19). No code written yet.
**Branch when building:** `feat/multi-screener-upload` — **cut off `main`**, not off the current activities-log branch.
**Scope:** Phase 1 = one screener type per file; schema/format designed so multiple types per file follow later without a format change.

---

## 1. Goal

Add a bulk upload for screener/assessment results that mirrors the operator student-importer's **validate → commit** lifecycle: dry-run with a counts-only summary, fix flagged rows, real commit in a single transaction, direct-count verification, and immediate file cleanup. Phase 1 ingests one screener type per file (a row per student). The schema is already multi-type-ready (`assessment_type` is in the upsert key; `screener_types.expected_columns` defines a per-type column contract), so a later phase can accept mixed-type files without changing the file format.

## 2. What already exists (from the audit)

- **`screener_results`** is the data table. Tenant anchor is `tenant_id NOT NULL` (FK → `tenants`, `ON DELETE CASCADE`); it leads both the upsert key and the dashboard index.
- **Upsert key:** `UNIQUE NULLS NOT DISTINCT (tenant_id, student_id, assessment_type, subject, screening_period, school_year)`. Because `assessment_type` is in the key, two screener types for the same student/period/subject already coexist — multi-type is schema-ready. `NULLS NOT DISTINCT` lets unmatched rows (`student_id IS NULL`) upsert without duplicating.
- **`screener_types`** lookup table has `name` (UNIQUE), `display_name`, and `expected_columns` (JSONB) — a natural per-type column contract to validate against. Seeded with STAR.
- **Only insert path today:** `POST /api/screener-results/upload` in `routes/screener.js` — JSON body, not a file upload; takes `rows[]` + per-row `assessmentType` (defaults to `STAR`). No multer, no dry-run, no rate limiter. Tenant binding is correct via `resolveAndBindTargetTenant` → `resolveAccessibleTenantIds` (403s before any write). Student match is **name-only** today.
- **Gold-standard template:** `routes/operatorStudentImport.js` — true dry-run `/validate` (no DB writes, counts-only summary, no PII echoed), all-or-nothing `/commit` in one transaction with an audit row per record, multer (5 MB, CSV-only), `cleanup()` on every exit path, rate limiter (5/min/user), 1000-row cap.
- Highest migration is 048; a new one would be **049**.

## 3. Design decisions (settled)

**Endpoints (Q1).** Add `POST .../validate` and `POST .../commit` mirroring the operator importer — multer upload, true dry-run, counts-only summary, rate limiter, `cleanup()` in a `finally`. Extract the row-processing from today's JSON `/upload` into a **shared helper** so both the legacy path and the new file path use one code path. Do not bolt a dry-run onto the JSON path.

**Student matching (Q2) — hard rule.** Match precedence:
1. If the row carries an `external_id`, match on `external_id` within the caller's tenant.
2. If no `external_id`, fall back to name match within the tenant.
3. **Any ambiguous match (more than one student hit) lands `student_id = NULL`** and is reported **by row number, never by name** in the dry-run summary. Never guess. Never surface student names in the summary, logs, error bodies, or URLs (§4B).

This directly closes the silent mis-attribution hole created by name-only matching plus null `external_id`s. There is no existing student-dedup tooling to lean on — this logic is new.

**Legacy endpoint inherits this matching.** Because both paths share one helper, the existing JSON `POST /api/screener-results/upload` will switch from name-only to external_id-first + ambiguous=NULL matching too. Its **sole caller is the frontend `ScreenerUploadModal`** (verified repo-wide — no backend scripts or external integrations post to it). The behavior change is flagged in **line 1 of the build PR's diff summary** and in the PR's Privacy-impact section so the §2A reviewer sees it explicitly.

**Surface (Q4).** **Both** — school-admin self-serve **and** the operator console. Both paths share the row-processing helper. The school-admin path needs especially careful tenant scoping (school staff must not be able to aim a file at another tenant); both paths reuse `resolveAndBindTargetTenant` → `resolveAccessibleTenantIds` and derive `tenant_id` server-side.

**File format / screener type (Q3) — resolved in §3A.** `assessment_type` (plus `subject`, `screening_period`, `school_year`) is a **form field**, not a file column. Each screener type is a per-type TierTrak template with its own column contract. See §3A.

## 3A. Per-type column contracts (Phase 1: STAR only) — resolved at build

**Type is chosen via a form field, with per-type column contracts.** Each screener vendor (STAR, MAP, DIBELS, …) has its own column layout, so an upload is **one screener type per file**: the uploader selects `assessment_type` (a multipart form field) and the backend parses the file against that type's contract. `subject`, `screening_period`, `school_year` are also form fields. This **supersedes the earlier draft's "every row carries an `assessment_type` column" rationale** — vendor exports don't carry it, and a per-type contract selected by form field matches how the exports actually look.

**Phase 1 ships STAR only; MAP (and other vendors) are deferred to their own slice.** The contract structure (`SCREENER_TYPE_CONTRACTS` in `screenerImportCore.js`) is per-type and ready for more, but only **STAR** is populated now. MAP was built and then cut from this slice so it can be done against a **real MAP export with cut scores confirmed by the school** (MAP has no benchmark column — its percentile bands need product/school sign-off). The full MAP work (contract, percentile ordinal parsing, percentile→benchmark derivation) is **preserved on branch `feat/multi-screener-map`** and is the starting point for the MAP slice.

**Where the contract lives (no migration, no DB seed).** The authoritative Phase-1 contract lives in **code**; `assessment_type` is validated route-layer against `SCREENER_TYPE_CONTRACTS` (400 on an unknown/unsupported type — so `MAP` is rejected until its slice ships). No `screener_types` DB change. A DB-driven types list is a banked data follow-up.

**STAR contract** (locked from the existing FE export mapping):

| file column | required | → field | notes |
|---|---|---|---|
| `Student` | yes | first/last | "Last, First" split on comma |
| `Benchmark Category Level` | yes | benchmark_category | normalized (Intervention→Below Benchmark, On Watch→Near Benchmark) |
| `Student ID` | no | external_student_id | optional SIS id; enables external_id-first match |
| `Grade` | no | grade | |
| `Test Date` | no | test_date | |
| `SS (Star Unified)` | no | scaled_score | |
| `PR` | no | percentile_rank | |

All types map into the shared `screener_results` columns; `screener_name` is derived (`<assessment_type> <subject>`). Header matching is tolerant (trim + lowercase, alias lists).

**Matching (`resolveStudentMatch`).** external_id-first when the row carries a non-empty `external_student_id` (matched within tenant on `students.external_id`; partial unique index ⇒ ≤1 hit → matched, else **unmatched** — no name fallback, a present SIS id is authoritative). No external_id → name fallback (`LOWER(first/last)` within tenant); 1 → matched, **>1 → ambiguous (`student_id` would be NULL)**, 0 → unmatched.

**Unlinked rows are NOT persisted — resolves the NULL-collapse, no migration.** `/commit` writes **only matched rows**. Unmatched and ambiguous rows are never written, so no `student_id = NULL` row is ever created and the `UNIQUE NULLS NOT DISTINCT` collapse cannot occur. Both `/validate` and `/commit` return the skipped rows **by row number** (`unmatchedRows` / `ambiguousRows`, never names) so the uploader adds the student / SIS id (or disambiguates the name) and re-uploads. This replaces the earlier "persist null-student rows" behavior and eliminates the data loss the collapse caused.

**Status / non-scored rows.** A row missing a required field (e.g. benchmark for STAR) is a **validation error reported by row number** — under all-or-nothing it blocks commit (fix the file, re-run validate).

## 4. Validate → commit lifecycle (mirror the operator importer)

- **`/validate`** — parse the file, no DB writes. Return counts only: total rows, valid, validation errors (with row numbers + error reason, **no PII**), matched / unmatched / ambiguous student counts (ambiguous and unmatched listed **by row number, never by name**), rows that already exist (upsert-conflict preview), and the single `assessment_type` detected. Read-only existence checks only.
- **`/commit`** — re-parse; **all-or-nothing**: any row error → 422 reject before writing. Single transaction; upsert each row with provenance via `uploaded_by` / `uploaded_at` (set server-side from the JWT caller, refreshed on conflict); ROLLBACK on any DB error; 409 on a 23505 race. **No separate audit table in Phase 1** (see §4A).
- **File cleanup (§4B):** `cleanup()` called on **every** exit path via `finally` — validation error, not-found, row-cap, success, and catch. Mirror the operator importer, **not** the looser `csvImport.js`.
- **Limits:** reuse the 5/min/user rate limiter and a **1000-row cap on both `/validate` and `/commit`, rejected before any parsing or DB work** (mirrors the operator importer's pre-parse cap; final number confirmable at build).

## 4A. Audit & provenance (Phase 1 decision)

Unlike the student importer (which writes a `student_import_audit` row per record under an `import_batch_id` and sets the `app.actor_user_id` GUC), **screener import does not create a `screener_import_audit` table in Phase 1.** `screener_results` already carries `uploaded_by` (FK → `users`, set from the JWT caller) and `uploaded_at` (refreshed on `ON CONFLICT DO UPDATE`), which is sufficient provenance for who-last-touched-each-row. This keeps **migration 049 optional / route-layer-only** rather than mandatory. The `app.actor_user_id` GUC plumbing is **not** carried over — it exists in the student importer only to feed that audit table's trigger, and there is no screener equivalent.

**Limitations (banked as a near-term follow-up):**
- No `import_batch_id` — individual upserts cannot be grouped back to the upload event that produced them.
- Upserts **overwrite** `uploaded_by` / `uploaded_at`; there is **no history** of prior uploads for a row.

If batch-level traceability or overwrite history is later required, that is a deliberate `screener_import_audit` table → **migration 049 becomes non-optional and is a §8 ask-first item.** Not in Phase 1.

## 5. Rule obligations (carry into the build PR)

- **§4B (PII):** screener rows are student PII (names, external IDs, scores, benchmark). No PII in logs, error bodies, URLs, or query strings. Uploaded files deleted immediately after processing. Cross-tenant exposure is ask-first.
- **§5 (tenant isolation):** every screener read/write scoped to the caller's accessible school-tenant set via `resolveAccessibleTenantIds` — never inline the district branch. `screener_results.tenant_id` is the scope anchor, derived server-side.
- **§8 (ask-first, before coding):** new file-upload endpoint(s), a likely schema/migration change (049), touches student PII, refactor likely > 3 files / > 100 lines. **Confirm approval before implementation.**
- **§2A (review):** PII + tenant ⇒ **no self-merge.** Kelsey (non-author) reviews the build PR.
- **Reviewers at PR:** privacy-reviewer (§4B), tenant-isolation-auditor (§5), security-reviewer (file upload + SQL + new endpoints). Both surfaces get reviewed.

## 6. Open items to confirm at build time

- Exact `expected_columns` contract per screener type (STAR is seeded; others as needed).
- Migration 049 is **optional** (route-layer validation is the default per §4A — no audit table). Only candidates if needed: a supporting index for the name-fallback lookup, or an FK `assessment_type` → `screener_types.name`. Confirm at build; if added, lands on its own `migration/` branch.
- Final row cap (default **1000**) and file-size limit (default **5 MB**, mirroring the operator importer).
- Whether the operator and school-admin paths share one route module with a guard, or two thin routes over the shared helper.

## 7. First build-session prompt (when ready — NOT yet)

_Intentionally left as a placeholder — to be authored at build kickoff, per the sequencing in §3–§5. Not yet._
