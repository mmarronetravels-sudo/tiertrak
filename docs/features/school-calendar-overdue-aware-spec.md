# School Academic Calendar — Overdue-Logs Calendar & Cadence Awareness — Spec

**Spec date:** 2026-06-28
**Product:** ScholarPath Intervention Monitoring (TierTrak)
**Status:** DESIGN APPROVED. Read-only audit complete (2026-06-28). Building in PR slices; PR 1 (M052 migration) first.
**Branch when building:** `feat/school-calendar-overdue-aware` — **cut off `main`**, not off the activities-log branch.

---

## 1. Goal

Make the weekly overdue-progress-logs digest (`services/overdueLogsDigest.js`) **calendar- and cadence-aware**:

- A per-school academic calendar (term ranges + break ranges) so the overdue rule **skips weeks outside the school's session or inside a break**, instead of today's flag-forever behavior.
- The overdue rule also **honors each plan's `log_frequency`** (only `biweekly` is sub-weekly; everything else stays weekly cadence).
- Schools with **no calendar** fall back to an **env-driven default break window (mid-June → mid-Aug)**, not flag-forever.
- `school_admin` manages their **own building's** calendar; **operator** sets it for any school — mirroring the #339 own-building scoping pattern (`schoolOverdueLogOptouts.js` / `operatorOverdueLogOptouts.js`).

## 2. What already exists (from the audit)

- **Digest:** `services/overdueLogsDigest.js`. Zero request input — recipient set loaded from `users` server-side; per-user §5 scope via `resolveAccessibleTenantIds(user)`. Loads opt-out scopes once per run into integer-only `Set`s (fail-closed). Flag-gated by `OVERDUE_LOGS_REMINDERS_ENABLED` at the scheduler (`server.js`), not in the service.
- **Shared overdue predicate:** `getMissingLogsForStaff(user, tenantId)` in `routes/weeklyProgress.js` — reused verbatim by both the in-app dashboard "Weekly Reminder" card (`GET /missing/:tenantId`) and the digest. Today it treats **every** plan as weekly: `NOT EXISTS (weekly_progress WHERE week_of = currentWeek)`. `getWeekStart()` (Monday boundary) is exported and shared.
- **`student_interventions.log_frequency`** — `VARCHAR(20) DEFAULT 'weekly'` (migration-025), **no CHECK**. Observed values: `weekly`, `daily`, `3x_week`, `2x_week`, `biweekly`. Only `biweekly` is sub-weekly.
- **#339 scoping pattern (the template to mirror for later PRs):**
  - `schoolOverdueLogOptoutsCore.resolveOwnSchoolId(role, accessible, requested)` — `school_admin`-only role gate **before** input parse; target school resolved strictly from `resolveAccessibleTenantIds(req.user)`; supplied id must be a member of that set or 403. DB-free, unit-testable.
  - `routes/schoolOverdueLogOptouts.js` — `requireAuth` for the surface, `mutationUserLimiter` on writes, integers/booleans only in bodies/logs.
  - `routes/operatorOverdueLogOptouts.js` — `requireAuth, platformAdminOnly`, addresses any tenant by path id with a `tenants type='school'` existence pre-flight.
- **House style M031..M051:** BIGSERIAL PK, denormalized integer refs, **no foreign keys**, `IF NOT EXISTS`, single `BEGIN/COMMIT`, `COMMENT ON TABLE`, integers/dates only (no PII). Highest migration today is **051**; the new one is **052**.

## 3. Design decisions (settled with the user)

1. **Multi-term rows** — a school may have several `term` rows (semesters/quarters) and several `break` rows. Period-typed single table supports both.
2. **Single-table, no-FK, route-layer school binding.** No parent/child split, so the §5 Migration-021 composite-FK pattern does not apply here. School binding (and the "school belongs to caller's access set") is enforced at the route layer, consistent with the M050/M051 write-time-enforcement decision. **⚠️ Flag for the tenant-isolation-auditor to scrutinize when the endpoints + digest land** (the absence of a composite FK is a deliberate, audited deviation from §5's default child-table guidance).
3. **Frequency-awareness applies to the shared predicate**, so the in-app dashboard card and the email stay in agreement (the digest's whole design philosophy). Non-`biweekly` ⇒ weekly cadence (unchanged: overdue if no log this week). `biweekly` ⇒ overdue only if no log in the current **nor** the prior week (pass `priorWeek`); no per-plan start-date anchor needed.
4. **Default break window** — env-driven month-day pairs, defaulting to **mid-June → mid-Aug**, applied every year. A school with no `term` rows is treated as "in session except that annual window." Replaces flag-forever.
5. **In-session test granularity** — test the **week's Monday (`weekOf`)** against term/break ranges. In session ⇔ `weekOf` inside some `term` row AND inside no `break` row.
6. **No new CHECK on `log_frequency`** — leave the VARCHAR(20) column alone; treat any non-`biweekly` value as weekly cadence.
7. **Optional `label`** kept (e.g., "Fall Semester", "Winter Break") but **never logged and never emailed** — it is convenience metadata for the management UI only.
8. **School-only** calendar grain. District-level calendar inheritance is **deferred** as a follow-up.

## 4. Schema (PR 1 — migration-052)

`migration-052-school-academic-calendar.sql`, one table:

```
school_academic_calendar
  id                BIGSERIAL PRIMARY KEY
  school_tenant_id  INTEGER NOT NULL          -- §5 school identifier; INDEXED
  district_id       INTEGER                   -- denormalized for district reads; INDEXED; nullable
  period_type       VARCHAR(10) NOT NULL      -- CHECK IN ('term','break')
  start_date        DATE NOT NULL
  end_date          DATE NOT NULL             -- CHECK (end_date >= start_date)
  label             VARCHAR(60)               -- optional; never logged/emailed
  created_by        INTEGER                   -- actor id, no FK (house style)
  updated_by        INTEGER
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
```

- House style: BIGSERIAL PK, denormalized integer refs, **no FKs**, `IF NOT EXISTS`, single `BEGIN/COMMIT`, `COMMENT ON TABLE`.
- Indexes: `idx_school_academic_calendar_school (school_tenant_id)` (§5-required school index) and `idx_school_academic_calendar_district (district_id)`.
- Multiple rows per school per `period_type` are allowed (multi-term); **no UNIQUE constraint** on `(school_tenant_id, period_type)` — ranges are additive.
- §4B: integers + dates + an optional non-PII label only. No student/staff names, emails, or intervention data.

## 5. PR split

1. **PR 1 — migration only:** `migration-052-school-academic-calendar.sql` (this slice).
2. **PR 2 — endpoints + tests:** `routes/schoolAcademicCalendar.js` (+ core), `routes/operatorAcademicCalendar.js`, server mounts, unit tests. Mirrors #339.
3. **PR 3 — digest wiring:** frequency-aware shared predicate in `routes/weeklyProgress.js`; per-school in-session gate + default-break fallback in `services/overdueLogsDigest.js`; pure `services/schoolCalendar.js` helper.
4. **PR 4 — frontend:** `school_admin` calendar-management UI in `frontend/src/App.jsx`.

## 6. Open follow-ups to carry forward

- Tenant-isolation-auditor review of the no-FK route-layer school binding (decision #2) when PR 2/PR 3 land.
- District-level calendar inheritance (deferred, decision #8).
- Whether to add a `log_frequency` CHECK constraint later (out of scope per decision #6).

### 6.1 Carry-forward gates from the PR-1 tenant-isolation audit (verbatim)

The PR-1 audit (verdict: APPROVED WITH NOTES, 0 CRITICAL / 0 WARN) accepted the no-composite-FK / route-layer-binding decision for this single-table config shape, on the condition that PRs 2–4 satisfy the following gates. These are reproduced verbatim from the auditor report; the CRITICAL conditions are exact and must be re-audited when those PRs land.

> What PRs 2–4 MUST get right for this decision to hold (carry-forward gates for the auditor when endpoints/digest land):
>
> 1. Write path, school_admin (PR 2): every INSERT/UPDATE/DELETE must resolve the target `school_tenant_id` from `resolveOwnSchoolId(role, resolveAccessibleTenantIds(req.user), requested)` — verified to exist at `routes/schoolOverdueLogOptoutsCore.js:54` — and must reject a supplied id that is not a member of the accessible set (403). The `school_tenant_id` written must be the resolved value, never `req.body`/`req.params` taken raw. CRITICAL if the body value reaches the column unvalidated.
>
> 2. Write path, operator (PR 2): must run `requireAuth, platformAdminOnly` at the router level (precedent `routes/operatorOverdueLogOptouts.js:51`) and gate the target by a `tenants` existence + `type='school'` pre-flight before writing. CRITICAL if `platformAdminOnly` is absent or the route is merely "authenticated."
>
> 3. Read path / digest (PR 3): every SELECT against `school_academic_calendar` must filter `WHERE school_tenant_id = ANY(<resolved accessible ids>)` (or the per-tenant equivalent the digest already uses via `resolveAccessibleTenantIds`). Because there is no FK and no DB-level RLS, an unscoped `SELECT * FROM school_academic_calendar` would be a full cross-tenant read — this is the single highest-risk failure mode the deferred enforcement creates. CRITICAL on any unscoped read.
>
> 4. Reads must scope on `school_tenant_id`, not `district_id` (PR 3): given `district_id` is nullable and denormalized, a read keyed on `district_id` alone would both miss NULL-district prod tenants and risk cross-school reads within a district. Scope on the school column; treat `district_id` as metadata only until district inheritance is deliberately designed.
>
> 5. `label` non-leak (PR 2/3): the spec commits that `label` (VARCHAR(60)) is never logged and never emailed. It is not PII by construction, but confirm the digest and any error paths honor that when the code lands.
