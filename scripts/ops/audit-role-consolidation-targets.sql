-- Pre-flight audit for Migration 030 (role consolidation 8 -> 7).
--
-- M030 will:
--   (a) flip rows: behavior_specialist, student_support_specialist,
--       mtss_support  ->  interventionist
--   (b) rewrite users_role_check to permit the 7-role universe:
--       district_admin, school_admin, district_tech_admin, teacher,
--       counselor, interventionist, parent
--
-- This script is READ-ONLY. Run it before applying M030.
--
-- Run via Render External PSQL Command:
--   \i scripts/ops/audit-role-consolidation-targets.sql
--
-- Output layering (S68 §3 two-layer §4B discipline applied here):
--   Query 1 is shareable-by-default — counts only, no PII.
--   Query 2 is operator-private — full row detail, PII.
--   Query 3 is shareable-by-default — guardrail count, no PII.

-- ============================================================
-- QUERY 1 (safe to share)
-- Paste this output into Cowork, PR bodies, activities.txt, chat.
-- ============================================================
--
-- EXPECTED RESULT (per S68 master index, 2026-05-13):
--   3 rows total, summing to 5:
--     behavior_specialist          | 1
--     mtss_support                 | 1
--     student_support_specialist   | 3
--
-- BEHAVIOR ON DRIFT:
--   Count drift from the expected breakdown above is INFORMATIONAL,
--   not blocking. Per the S68 §1 per-shape doctrine, M030 will flip
--   whatever rows exist at apply time, regardless of count.
--   ACTION: record the actual per-role counts in the PR body's
--   §2A "Migration dry-run" line, then proceed.
--
-- HARD STOP CONDITIONS:
--   - Query 3 returns > 0 (an out-of-band write has already touched
--     the new role literals — investigate before applying M030)

SELECT role, COUNT(*) AS user_count
  FROM users
 WHERE role IN ('behavior_specialist',
                'student_support_specialist',
                'mtss_support')
 GROUP BY role
 ORDER BY role;


-- ============================================================
-- QUERY 2 (OPERATOR-PRIVATE — DO NOT SHARE)
-- DO NOT PASTE OUTPUT BELOW INTO PR BODIES, ACTIVITIES.TXT,
-- OR CHAT TRANSCRIPTS. Contains user PII (full_name, email).
-- Read in operator terminal only. Use for shape-inspection if
-- Query 1 returns unexpected counts.
-- ============================================================

SELECT id, tenant_id, role, full_name, email, created_at
  FROM users
 WHERE role IN ('behavior_specialist',
                'student_support_specialist',
                'mtss_support')
 ORDER BY role, id;


-- ============================================================
-- QUERY 3 (safe to share)
-- Confirms the new role literals do not already exist.
-- ============================================================
--
-- EXPECTED RESULT: 0
-- STOP if > 0 — indicates an out-of-band write has already touched
-- the new role literals. Investigate before applying M030.

SELECT COUNT(*) AS already_consolidated
  FROM users
 WHERE role IN ('interventionist', 'district_tech_admin');
