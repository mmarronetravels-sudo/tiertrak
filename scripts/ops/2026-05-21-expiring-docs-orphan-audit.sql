-- Read-only audit: blast-radius of the Expiring-Documents scope fix
-- (fix/teacher-dashboard-expiring-documents-scope).
--
-- Context: the Expiring Documents widget query at
-- routes/studentDocuments.js:238 currently returns every expiring doc in
-- the path-tenant regardless of which teacher is requesting. The tenant
-- boundary is intact (requireExpiringListAccess + WHERE sd.tenant_id =
-- $1), but the within-tenant teacher boundary is absent — a cross-
-- teacher PII leak inside a tenant, same class as the Weekly Reminder
-- bug PR #136 fixed.
--
-- Proposed fix mirrors the established Tier-2/3 teacher-scoping pattern
-- from routes/students.js:162-178 (with the weeklyProgress.js belt-and-
-- suspenders of ia.assignment_type = 'staff'): elevated callers
-- (school_admin || schoolWideAccess === true) still see every expiring
-- doc in the tenant; non-elevated staff see only docs for students they
-- are actively assigned to monitor via intervention_assignments.
--
-- students.teacher_id is intentionally NOT consulted — it is a display
-- denormalization for roster rendering, never an access predicate
-- anywhere in the backend. The only enforced teacher↔student access
-- path in TierTrak today is intervention_assignments.
--
-- Before applying the fix we want to know, per tenant, how many
-- currently-expiring docs would (a) disappear from non-elevated
-- teachers' widgets, and (b) split that cohort by Tier so we can
-- identify whether a meaningful tail is Tier 2/3 docs whose students
-- never got a staff intervention_assignment row (data hygiene tail,
-- not a fix-correctness concern). Counts are NOT pasted into
-- activities.txt — they live in the PR body only per the S87 workflow
-- lesson on PR-body-vs-activities-log PII discipline.
--
-- Composite tenant-binding: only student_documents and students carry
-- tenant_id. The sd→s join uses composite (sd.student_id = s.id AND
-- s.tenant_id = sd.tenant_id). student_interventions and
-- intervention_assignments have no tenant_id column (schema lesson #7
-- from S87) so their tenancy is transitive via the (s.id, s.tenant_id)
-- anchor.
--
-- This file is READ-ONLY. No DDL. No DML. Four SELECTs.
--
-- Run via:
--   Render Dashboard → tiertrak-db → "External PSQL Command" → copy
--     the connect command and append:
--     `-f scripts/ops/2026-05-21-expiring-docs-orphan-audit.sql`
--   OR after connecting interactively:
--     `\i scripts/ops/2026-05-21-expiring-docs-orphan-audit.sql`

\echo '--- Q1: per-tenant count of expiring docs whose student has NO active staff intervention_assignment ---'
\echo '       (these would disappear from non-elevated-teacher widgets post-fix; visible to school_admin / schoolWideAccess only)'
SELECT s.tenant_id,
       t.name AS tenant_name,
       COUNT(*) AS expiring_docs_without_staff_assignment
  FROM student_documents sd
  JOIN students s ON s.id = sd.student_id AND s.tenant_id = sd.tenant_id
  JOIN tenants  t ON t.id = s.tenant_id
 WHERE sd.expiration_date IS NOT NULL
   AND sd.expiration_date >= CURRENT_DATE
   AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
   AND NOT EXISTS (
         SELECT 1
           FROM student_interventions si
           JOIN intervention_assignments ia
             ON ia.student_intervention_id = si.id
            AND ia.assignment_type = 'staff'
          WHERE si.student_id = s.id
            AND si.status = 'active'
       )
 GROUP BY s.tenant_id, t.name
 ORDER BY expiring_docs_without_staff_assignment DESC;

\echo ''
\echo '--- Q2: per-tenant count of expiring docs whose student HAS at least one active staff intervention_assignment ---'
\echo '       (baseline — visible to school_admin, schoolWideAccess, AND assigned staff post-fix)'
SELECT s.tenant_id,
       t.name AS tenant_name,
       COUNT(*) AS expiring_docs_with_staff_assignment
  FROM student_documents sd
  JOIN students s ON s.id = sd.student_id AND s.tenant_id = sd.tenant_id
  JOIN tenants  t ON t.id = s.tenant_id
 WHERE sd.expiration_date IS NOT NULL
   AND sd.expiration_date >= CURRENT_DATE
   AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
   AND EXISTS (
         SELECT 1
           FROM student_interventions si
           JOIN intervention_assignments ia
             ON ia.student_intervention_id = si.id
            AND ia.assignment_type = 'staff'
          WHERE si.student_id = s.id
            AND si.status = 'active'
       )
 GROUP BY s.tenant_id, t.name
 ORDER BY expiring_docs_with_staff_assignment DESC;

\echo ''
\echo '--- Q3: Q1 cohort split by Tier ---'
\echo '       (Tier 1 = students relying on the all-teacher roster broadcast; Tier 2/3 with no staff assignment = data-hygiene tail)'
SELECT s.tenant_id,
       t.name AS tenant_name,
       s.tier,
       COUNT(*) AS expiring_docs_without_staff_assignment_by_tier
  FROM student_documents sd
  JOIN students s ON s.id = sd.student_id AND s.tenant_id = sd.tenant_id
  JOIN tenants  t ON t.id = s.tenant_id
 WHERE sd.expiration_date IS NOT NULL
   AND sd.expiration_date >= CURRENT_DATE
   AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
   AND NOT EXISTS (
         SELECT 1
           FROM student_interventions si
           JOIN intervention_assignments ia
             ON ia.student_intervention_id = si.id
            AND ia.assignment_type = 'staff'
          WHERE si.student_id = s.id
            AND si.status = 'active'
       )
 GROUP BY s.tenant_id, t.name, s.tier
 ORDER BY s.tenant_id, s.tier;

\echo ''
\echo '--- Q4: per-tenant distinct staff users who would receive at least one expiring-doc row post-fix ---'
\echo '       (sanity check — how many teachers actually keep a non-empty widget)'
SELECT s.tenant_id,
       t.name AS tenant_name,
       COUNT(DISTINCT ia.user_id) AS distinct_assigned_staff_with_expiring_docs
  FROM student_documents sd
  JOIN students s ON s.id = sd.student_id AND s.tenant_id = sd.tenant_id
  JOIN tenants  t ON t.id = s.tenant_id
  JOIN student_interventions si ON si.student_id = s.id AND si.status = 'active'
  JOIN intervention_assignments ia
    ON ia.student_intervention_id = si.id
   AND ia.assignment_type = 'staff'
 WHERE sd.expiration_date IS NOT NULL
   AND sd.expiration_date >= CURRENT_DATE
   AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
 GROUP BY s.tenant_id, t.name
 ORDER BY distinct_assigned_staff_with_expiring_docs DESC;
