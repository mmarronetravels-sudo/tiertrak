-- 2026-06-12  Operator account identity cleanup (fix/operator-account-identity)
--
-- Purpose: user id 26 is a platform operator whose powers come from the
-- PLATFORM_ADMIN_USER_IDS env-allowlist, NOT from its row. It still carries a
-- tenant attachment, which makes the header chip render "<role> • <school>"
-- (e.g. "Parent • Lincoln Elementary"). Null its tenant_id so it no longer
-- presents as a school-scoped account. role is intentionally left unchanged;
-- the front end branches on is_operator to render the label.
--
-- This is a one-row, environment-specific data correction (id 26 is the
-- operator only in prod), NOT a schema change. It is therefore an owner-run
-- ops script, not a tracked migration/. Run via Render External PSQL + \i.
--
-- The operator email is NOT hardcoded here (scripts/ops/ is not yet gitignored
-- — open follow-up #94; a literal staff email would be a §4B/hygiene risk).
-- Supply it at run time in your own terminal BEFORE \i'ing this file:
--
--     \set op_email 'the-operator-email@example.com'
--     \i scripts/ops/2026-06-12-operator-id26-null-tenant.sql
--
-- The UPDATE is double-guarded on id = 26 AND email = :op_email so it cannot
-- touch the wrong row if op_email is mistyped (0 rows affected instead).

\echo 'Pre-UPDATE — eyeball that id 26 is the expected operator account:'
SELECT id, email, role, tenant_id FROM users WHERE id = 26;

UPDATE users
   SET tenant_id = NULL
 WHERE id = 26
   AND email = :'op_email';

\echo 'Post-UPDATE — tenant_id should now be NULL:'
SELECT id, email, role, tenant_id FROM users WHERE id = 26;
