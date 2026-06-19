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
3. **Any ambiguous match (more than one student hit) lands `student_id = NULL`** and is reported as a *count* in the dry-run summary. Never guess. Never surface student names in the summary, logs, error bodies, or URLs (§4B).

This directly closes the silent mis-attribution hole created by name-only matching plus null `external_id`s. There is no existing student-dedup tooling to lean on — this logic is new.

**Surface (Q4).** **Both** — school-admin self-serve **and** the operator console. Both paths share the row-processing helper. The school-admin path needs especially careful tenant scoping (school staff must not be able to aim a file at another tenant); both paths reuse `resolveAndBindTargetTenant` → `resolveAccessibleTenantIds` and derive `tenant_id` server-side.

**File format / screener type (Q3).** The file carries an **`assessment_type` column** on every row. Phase 1 validation requires a **single distinct value** across the file; the later multi-type phase relaxes this to allow several values — no file-format change. Validate the column set for the type against `screener_types.expected_columns`.

## 4. Validate → commit lifecycle (mirror the operator importer)

- **`/validate`** — parse the file, no DB writes. Return counts only: total rows, valid, validation errors (with row numbers + error reason, **no PII**), matched / unmatched / ambiguous student counts, rows that already exist (upsert-conflict preview), and the single `assessment_type` detected. Read-only existence checks only.
- **`/commit`** — re-parse; **all-or-nothing**: any row error → 422 reject before writing. Single transaction; set the audit actor (`app.actor_user_id`); upsert each row; write an audit record per row; ROLLBACK on any DB error; 409 on a 23505 race.
- **File cleanup (§4B):** `cleanup()` called on **every** exit path via `finally` — validation error, not-found, row-cap, success, and catch. Mirror the operator importer, **not** the looser `csvImport.js`.
- **Limits:** reuse the 5/min/user rate limiter and a row cap (start at 1000, confirm at build).

## 5. Rule obligations (carry into the build PR)

- **§4B (PII):** screener rows are student PII (names, external IDs, scores, benchmark). No PII in logs, error bodies, URLs, or query strings. Uploaded files deleted immediately after processing. Cross-tenant exposure is ask-first.
- **§5 (tenant isolation):** every screener read/write scoped to the caller's accessible school-tenant set via `resolveAccessibleTenantIds` — never inline the district branch. `screener_results.tenant_id` is the scope anchor, derived server-side.
- **§8 (ask-first, before coding):** new file-upload endpoint(s), a likely schema/migration change (049), touches student PII, refactor likely > 3 files / > 100 lines. **Confirm approval before implementation.**
- **§2A (review):** PII + tenant ⇒ **no self-merge.** Kelsey (non-author) reviews the build PR.
- **Reviewers at PR:** privacy-reviewer (§4B), tenant-isolation-auditor (§5), security-reviewer (file upload + SQL + new endpoints). Both surfaces get reviewed.

## 6. Open items to confirm at build time

- Exact `expected_columns` contract per screener type (STAR is seeded; others as needed).
- Whether a migration (049) is needed (e.g. an FK from `assessment_type` → `screener_types.name`, or indexes for the match lookups) vs. route-layer validation only.
- Final row cap and file-size limit.
- Whether the operator and school-admin paths share one route module with a guard, or two thin routes over the shared helper.

## 7. First build-session prompt (when ready — NOT yet)

_Intentionally left as a placeholder — to be authored at build kickoff, per the sequencing in §3–§5. Not yet._
