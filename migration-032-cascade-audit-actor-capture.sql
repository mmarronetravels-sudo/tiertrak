-- Migration 032: capture actor_user_id on cascade-event audit rows.
--
-- Followup #118 completion. M031 shipped the audit table with column
-- actor_user_id INTEGER already declared, but the trigger function body
-- did not reference it — cascade-event rows wrote actor_user_id=NULL
-- because the SET LOCAL plumbing on the DELETE-FROM-users sites was
-- deferred in PR #101 (DQ6). This migration updates the trigger body to
-- read app.actor_user_id from the transaction-local GUC; the route-level
-- companion changes wrap DELETE-FROM-users handlers in an explicit
-- transaction that calls set_config('app.actor_user_id', ..., true)
-- before the DELETE.
--
-- No table-shape change. The actor_user_id INTEGER column was declared
-- in M031 line 77 with NULL allowed; that nullability is now load-bearing
-- because non-#118 writers (direct DBA DELETE FROM users via psql, future
-- DELETE-FROM-user_school_access call sites that have not yet been
-- updated) will write NULL and that is the correct behavior — the audit
-- row still records WHEN the cascade fired and WHICH (user, district,
-- school) row was wiped; the actor is simply unknown for non-app paths.
--
-- Design constraints preserved from M031:
--   - NO SECURITY DEFINER (trigger fires under caller's privileges).
--   - NO foreign keys on the audit table (rows outlive referents per
--     FERPA §99.32 record-of-disclosure retention).
--   - Append-only; no UPDATE/DELETE path exposed.
--
-- NULLIF guard: current_setting(name, true) returns the empty string
-- (not NULL) when the GUC is unset in the current session. Casting ''
-- directly to int raises 22P02. NULLIF collapses '' to NULL so the
-- ::int cast lands NULL into actor_user_id on non-#118 paths.
--
-- Future writers contract: any new app-layer DELETE that triggers a
-- cascade into user_school_access (or a direct DELETE FROM
-- user_school_access) MUST run
--   SELECT set_config('app.actor_user_id', $1, true)
-- inside its transaction before the DELETE, where $1 is String(req.user.id).
-- B2's grant/revoke routes are the next call sites to comply.
--
-- Idempotency: CREATE OR REPLACE FUNCTION replaces the body in place.
-- Re-running this migration is a no-op behavior. No trigger re-bind
-- needed (the existing trigger on user_school_access already calls this
-- function name).
--
-- Pre-flight check before applying:
--   SELECT COUNT(*) FROM user_school_access_audit;
-- Expected: 0 (B2 has not yet shipped). If non-zero, pause and report —
-- M032 should land before any audit-table data exists so the
-- actor_user_id=NULL baseline is forensically attributable to "pre-#118
-- writers" rather than "the migration ran late."

BEGIN;

CREATE OR REPLACE FUNCTION user_school_access_audit_cascade()
  RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_school_access_audit
    (user_id, district_id, school_tenant_id, action, actor_user_id)
  VALUES
    (OLD.user_id, OLD.district_id, OLD.school_tenant_id, 'cascade_user_delete',
     NULLIF(current_setting('app.actor_user_id', true), '')::int);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
