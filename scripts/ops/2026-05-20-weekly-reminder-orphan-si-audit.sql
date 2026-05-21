-- Read-only audit: orphan-intervention impact of the Weekly Reminder
-- scope fix (fix/weekly-reminder-scope-by-assignment, not yet branched).
--
-- Context: the Weekly Reminder query at routes/weeklyProgress.js:151
-- currently returns every active student_intervention in the tenant
-- regardless of who is assigned to monitor it. Proposed fix mirrors
-- the established Tier-2/3 scoping pattern from routes/students.js:170
-- by INNER JOINing intervention_assignments on (si.id, ia.user_id,
-- ia.assignment_type='staff').
--
-- Before applying that fix, we need to know how many active SIs in
-- prod have NO staff assignment row at all. After the fix, those SIs
-- would silently disappear from every teacher's Weekly Reminder
-- (because no teacher is assigned). Pre-fix they appear on every
-- teacher's reminder (no scoping). Either state is wrong, but the
-- post-fix state is the more privacy-preserving wrong state — we
-- want the count so we can document the gap and propose a separate
-- admin-observability followup.
--
-- This file is READ-ONLY. No DDL. No DML. Three SELECTs.
--
-- Run via:
--   Render Dashboard → tiertrak-db → "External PSQL Command" → copy
--     the connect command and append:
--     `-f scripts/ops/2026-05-20-weekly-reminder-orphan-si-audit.sql`
--   OR after connecting interactively:
--     `\i scripts/ops/2026-05-20-weekly-reminder-orphan-si-audit.sql`

\echo '--- Q1: per-tenant count of active SIs with NO staff assignment ---'
\echo '       (these would silently drop from Weekly Reminder post-fix)'
SELECT s.tenant_id,
       t.name AS tenant_name,
       COUNT(*) AS active_si_without_staff_assignment
  FROM student_interventions si
  JOIN students s ON s.id = si.student_id
  JOIN tenants  t ON t.id = s.tenant_id
 WHERE si.status = 'active'
   AND s.archived = false
   AND si.no_progress_monitoring_required IS NOT TRUE
   AND NOT EXISTS (
         SELECT 1
           FROM intervention_assignments ia
          WHERE ia.student_intervention_id = si.id
            AND ia.assignment_type = 'staff'
       )
 GROUP BY s.tenant_id, t.name
 ORDER BY active_si_without_staff_assignment DESC;

\echo ''
\echo '--- Q2: per-tenant count of active SIs WITH at least one staff assignment ---'
\echo '       (baseline — these are the rows the fix correctly preserves)'
SELECT s.tenant_id,
       t.name AS tenant_name,
       COUNT(*) AS active_si_with_staff_assignment
  FROM student_interventions si
  JOIN students s ON s.id = si.student_id
  JOIN tenants  t ON t.id = s.tenant_id
 WHERE si.status = 'active'
   AND s.archived = false
   AND si.no_progress_monitoring_required IS NOT TRUE
   AND EXISTS (
         SELECT 1
           FROM intervention_assignments ia
          WHERE ia.student_intervention_id = si.id
            AND ia.assignment_type = 'staff'
       )
 GROUP BY s.tenant_id, t.name
 ORDER BY active_si_with_staff_assignment DESC;

\echo ''
\echo '--- Q3: per-tenant unique staff users assigned to at least one active SI ---'
\echo '       (sanity check — how many distinct teachers would receive any reminder post-fix)'
SELECT s.tenant_id,
       t.name AS tenant_name,
       COUNT(DISTINCT ia.user_id) AS distinct_assigned_staff
  FROM intervention_assignments ia
  JOIN student_interventions si ON si.id = ia.student_intervention_id
  JOIN students s ON s.id = si.student_id
  JOIN tenants  t ON t.id = s.tenant_id
 WHERE ia.assignment_type = 'staff'
   AND si.status = 'active'
   AND s.archived = false
   AND si.no_progress_monitoring_required IS NOT TRUE
 GROUP BY s.tenant_id, t.name
 ORDER BY distinct_assigned_staff DESC;
