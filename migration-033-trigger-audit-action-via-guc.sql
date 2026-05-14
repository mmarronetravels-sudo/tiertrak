-- Migration 033: action label sourced from transaction-local GUC.
--
-- PR B2 prerequisite. Extends M032's GUC doctrine: the audit-cascade
-- trigger now reads the action label from a session-local GUC named
-- app.audit_action, defaulting to 'cascade_user_delete' when the GUC
-- is unset. This lets app-layer explicit-revoke paths (B2's DELETE
-- handler at /api/districts/:id/users/:userId/access/:schoolTenantId)
-- write a correctly-labeled 'revoke' audit row from the SAME trigger
-- that today writes 'cascade_user_delete' on user-deletion cascades.
--
-- Why one trigger and not two: pg triggers cannot distinguish caller
-- intent (cascade vs direct DELETE) natively. Either (a) two triggers
-- gated on conditional logic that interrogates the call stack, or
-- (b) one trigger reading a caller-set GUC. Option (b) is simpler,
-- cheaper, and extends a doctrine that already exists (M032's
-- app.actor_user_id). Future writers in the audit-table action set
-- (e.g., a hypothetical 'self_remove' someday) can adopt the same
-- pattern without a schema change.
--
-- No table-shape change. The CHECK constraint at M031 line 76 already
-- admits 'grant', 'revoke', 'cascade_user_delete' — all three values
-- this trigger can emit are pre-blessed. If a future writer sets
-- app.audit_action to a value not in the allowlist, the trigger's
-- INSERT will violate the CHECK and abort the parent transaction.
-- That is the correct fail-loud behavior (surfaces the bug at the
-- writer site, not silently).
--
-- Design constraints preserved from M031 + M032:
--   - NO SECURITY DEFINER (trigger fires under caller's privileges).
--   - NO foreign keys on the audit table (FERPA §99.32 record-of-
--     disclosure retention).
--   - Append-only; no UPDATE/DELETE path exposed.
--   - actor_user_id capture (M032) preserved unchanged.
--
-- NULLIF + COALESCE guard: current_setting(name, true) returns the
-- empty string when the GUC is unset. NULLIF collapses '' to NULL,
-- COALESCE substitutes the cascade default. Non-app-layer writers
-- (direct DBA psql DELETE on user_school_access without setting the
-- GUC) preserve today's behavior: action='cascade_user_delete',
-- actor_user_id=NULL.
--
-- Future-Writers Contract (extends M032's contract):
--
--   Two transaction-local GUCs participate in audit row generation
--   from the user_school_access_audit_after_delete trigger:
--
--   1. app.actor_user_id (M032)
--        Set by the app-layer DELETE-FROM-users handlers and any
--        new writer of user_school_access. Value MUST be the
--        positive integer users.id of the authenticated actor.
--        Set via:
--          SELECT set_config('app.actor_user_id', $1, true)
--        where $1 is String(req.user.id). Captured into
--        user_school_access_audit.actor_user_id at trigger fire-time.
--
--   2. app.audit_action (M033, this migration)
--        Set ONLY by explicit-revoke writers (B2's
--        DELETE-FROM-user_school_access handler). Value MUST be one
--        of the M031 CHECK-admitted strings ('grant', 'revoke',
--        'cascade_user_delete'). For explicit revokes the value is
--        'revoke'. Set via:
--          SELECT set_config('app.audit_action', 'revoke', true)
--        Cascade paths (DELETE-FROM-users → cascade DELETE on
--        user_school_access) leave this GUC unset; trigger defaults
--        to 'cascade_user_delete'.
--
--   GUC scope: both are transaction-local (3rd arg true). They die
--   at COMMIT or ROLLBACK and cannot leak to subsequent transactions
--   on the same pooled client.
--
--   The grant action is NOT written by this trigger. M031's trigger
--   only fires AFTER DELETE; B2's POST grant path is an INSERT and
--   must write its own action='grant' audit row at the app layer
--   inside the same transaction.
--
-- Pre-flight check before applying:
--   SELECT COUNT(*) FROM user_school_access_audit;
--   SELECT COUNT(*) FROM user_school_access;
-- Expected on a pre-B2 deploy: 0 for both. A non-zero audit count
-- means M032 has captured some cascade rows already — re-running
-- M033 is still safe (CREATE OR REPLACE FUNCTION is idempotent),
-- but pause and report so the operator understands the existing
-- audit history.
--
-- Idempotency: CREATE OR REPLACE FUNCTION replaces the body in
-- place. Re-running this migration is a no-op behavior. No trigger
-- re-bind needed (the existing M031 binding on user_school_access
-- already calls this function name).

BEGIN;

CREATE OR REPLACE FUNCTION user_school_access_audit_cascade()
  RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_school_access_audit
    (user_id, district_id, school_tenant_id, action, actor_user_id)
  VALUES
    (OLD.user_id, OLD.district_id, OLD.school_tenant_id,
     COALESCE(
       NULLIF(current_setting('app.audit_action', true), ''),
       'cascade_user_delete'
     ),
     NULLIF(current_setting('app.actor_user_id', true), '')::int);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
