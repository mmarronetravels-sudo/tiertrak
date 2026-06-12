-- 2026-06-12  Operator account name cleanup (fix/operator-account-name)
--
-- Purpose: user id 26 is the platform operator whose powers come from the
-- PLATFORM_ADMIN_USER_IDS env-allowlist, NOT from its row. Its full_name is
-- still the seed value "Test Parent", so the header chip renders "Test Parent"
-- above the "Platform Operator" label. Rename it to "ScholarPath Operator" so
-- the chip presents a sensible operator identity.
--
-- The front end (frontend/src/App.jsx) already renders user.full_name
-- unconditionally and branches the line below it on is_operator, so this is a
-- pure data correction — NO code change is required.
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
--     \i scripts/ops/2026-06-12-operator-id26-name.sql
--
-- The UPDATE is double-guarded on id = 26 AND email = :'op_email' so it cannot
-- touch the wrong row if op_email is mistyped (0 rows affected instead).

\echo 'Pre-UPDATE — eyeball that id 26 is the expected operator account:'
SELECT id, email, role, full_name FROM users WHERE id = 26;

UPDATE users
   SET full_name = 'ScholarPath Operator'
 WHERE id = 26
   AND email = :'op_email';

\echo 'Post-UPDATE — full_name should now be ScholarPath Operator:'
SELECT id, email, role, full_name FROM users WHERE id = 26;
