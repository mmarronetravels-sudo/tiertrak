-- Migration 040: GUC-driven action label + actor capture on
-- mtss_coordinators_audit cascade-event trigger.
--
-- Combines the M032 (actor capture) + M033 (action label override)
-- evolution into one CREATE OR REPLACE FUNCTION step for the new
-- audit table. user_school_access_audit's trigger underwent the
-- same evolution in two separate migrations once its first
-- explicit-revoke writer (PR B2, routes/districtAccess.js) shipped;
-- the same need has now arrived for mtss_coordinators with the
-- companion grant/revoke route in this PR.
--
-- M039 deliberately deferred this evolution ("doing so up front is
-- premature for a schema-only PR"). This migration lands ALONGSIDE
-- the first explicit-revoke writer (routes/mtssCoordinators.js
-- DELETE handler) in the same PR so the trigger and its first
-- caller ship together — neither half is dormant in production.
--
-- WHY ONE COMBINED MIGRATION, NOT TWO:
--   user_school_access_audit's M032+M033 split was historical
--   contingency (M032 shipped before the first explicit-revoke
--   writer existed, M033 followed when B2 needed it). We are
--   greenfield on this audit table — the explicit-revoke writer is
--   in the same PR. A single CREATE OR REPLACE FUNCTION is atomic;
--   splitting just adds operator friction with no separation-of-
--   concerns benefit.
--
-- EXACT FUNCTION NAME (load-bearing):
--   M039 binds the AFTER DELETE trigger on mtss_coordinators to
--   public.mtss_coordinators_audit_cascade() — verified against
--   pg_proc/pg_trigger in dev before writing this migration:
--     trigger_name                          | function_name
--     mtss_coordinators_audit_after_delete  | mtss_coordinators_audit_cascade
--   CREATE OR REPLACE FUNCTION below targets that EXACT name; the
--   trigger binding remains unchanged. If the name diverged, the
--   replace would create a new unused function and the existing
--   trigger would silently keep calling the M039 hardcoded body —
--   the GUC logic would do nothing in production.
--
-- No table-shape change. The actor_user_id INTEGER column was
-- declared in M039 line 117 with NULL allowed; that nullability is
-- now load-bearing because non-GUC writers (direct DBA DELETE FROM
-- mtss_coordinators via psql, any future writer that has not yet
-- adopted the SET LOCAL pattern) will write NULL and that is the
-- correct behavior — the audit row still records WHEN the cascade
-- fired and WHICH (user, school, district) row was wiped; the
-- actor is simply unknown for non-app paths.
--
-- The CHECK constraint on action (M039 line 116) already admits
-- 'grant', 'revoke', 'cascade_user_delete'. All three values this
-- trigger can emit after M040 are pre-blessed. If a future writer
-- sets app.audit_action to a value outside the allowlist, the
-- trigger's INSERT will violate the CHECK and abort the parent
-- transaction — correct fail-loud behavior (surfaces the bug at
-- the writer site, not silently).
--
-- DESIGN CONSTRAINTS PRESERVED FROM M039:
--   - NO SECURITY DEFINER (trigger fires under caller's privileges).
--   - NO foreign keys on the audit table (FERPA §99.32
--     record-of-disclosure retention).
--   - Append-only; no UPDATE/DELETE path exposed.
--
-- NULLIF + COALESCE guard: current_setting(name, true) returns the
-- empty string (not NULL) when the GUC is unset in the current
-- session. NULLIF collapses '' to NULL so the ::int cast on
-- actor_user_id does not raise 22P02; COALESCE substitutes the
-- cascade default for the action label. Non-app-layer writers
-- preserve M039's baseline: action='cascade_user_delete',
-- actor_user_id=NULL.
--
-- FUTURE-WRITERS CONTRACT:
--
--   Two transaction-local GUCs participate in audit-row generation
--   from the mtss_coordinators_audit_after_delete trigger:
--
--   1. app.actor_user_id
--        Set by any app-layer DELETE-FROM-mtss_coordinators caller
--        and any DELETE-FROM-users caller whose cascade reaches
--        mtss_coordinators. Value MUST be the positive integer
--        users.id of the authenticated actor. Set via:
--          SELECT set_config('app.actor_user_id', $1, true)
--        where $1 is String(req.user.id). Captured into
--        mtss_coordinators_audit.actor_user_id at trigger fire-time.
--
--   2. app.audit_action
--        Set ONLY by explicit-revoke writers
--        (routes/mtssCoordinators.js DELETE handler). Value MUST be
--        one of the M039 CHECK-admitted strings ('grant', 'revoke',
--        'cascade_user_delete'). For explicit revokes the value is
--        'revoke'. Set via:
--          SELECT set_config('app.audit_action', 'revoke', true)
--        Cascade paths (DELETE-FROM-users → cascade DELETE on
--        mtss_coordinators for district users) leave this GUC unset;
--        trigger defaults to 'cascade_user_delete'.
--
--   GUC scope: both are transaction-local (3rd arg true). They die
--   at COMMIT or ROLLBACK and cannot leak to subsequent transactions
--   on the same pooled client. The route MUST run BEGIN, SET
--   LOCAL via set_config, the DELETE, and COMMIT on a SINGLE
--   checked-out client — not separate pool calls — or the GUC and
--   the DELETE land on different sessions and the trigger reads ''.
--
--   The 'grant' action is NOT written by this trigger. M039's
--   trigger only fires AFTER DELETE; routes/mtssCoordinators.js
--   POST handler writes its own action='grant' audit row at the
--   app layer inside the same transaction (mirrors
--   routes/districtAccess.js:156-161).
--
-- PRE-FLIGHT CHECK BEFORE APPLYING:
--   SELECT COUNT(*) FROM mtss_coordinators;
--   SELECT COUNT(*) FROM mtss_coordinators_audit;
-- Expected on a pre-route deploy: 0 for both. A non-zero
-- mtss_coordinators count means rows exist with no route writer
-- yet — pause and report so the operator understands provenance.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION replaces the body in
-- place. Re-running this migration is a no-op behavior. No trigger
-- re-bind needed (the existing M039 binding on mtss_coordinators
-- already calls this exact function name).
--
-- ATOMICITY: single BEGIN/COMMIT.

BEGIN;

CREATE OR REPLACE FUNCTION mtss_coordinators_audit_cascade()
  RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO mtss_coordinators_audit
    (user_id, school_tenant_id, district_id, action, actor_user_id)
  VALUES
    (OLD.user_id, OLD.school_tenant_id, OLD.district_id,
     COALESCE(
       NULLIF(current_setting('app.audit_action', true), ''),
       'cascade_user_delete'
     ),
     NULLIF(current_setting('app.actor_user_id', true), '')::int);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
