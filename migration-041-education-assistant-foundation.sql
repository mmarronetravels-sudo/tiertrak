-- Migration 041: Education Assistant role + per-student caseload
-- association + cascade-audit table.
--
-- Adds the new staff role `education_assistant` (EA) and the
-- per-(EA, student) caseload table that scopes their student-record
-- READ access. EA's WRITE scope (file a discipline referral on any
-- student in their building) is governed at the app layer by the
-- existing POST /api/discipline-referrals route + a new narrow
-- building-wide student picker landing in PR-2; this migration adds
-- no write-side schema. Intervention logging is deferred to a later
-- phase per spec; this migration adds no intervention-scoped rows.
--
-- =========================================================
-- ROLE-MATRIX PLACEMENT (load-bearing — do not change without
-- re-running the role-gate audit):
--   - users.role CHECK widened from 7 to 8 values.
--   - constants/roles.js (ELEVATED_ROLES + INTERVENTION_MANAGER_ROLES):
--     EA is intentionally NOT added in PR-2. The strict-mode student
--     access predicate (S114, live in prod) and the staff-roster read
--     gate depend on those constants staying narrow.
--   - canAccessStudent.js: PR-2 will add a per-EA branch that joins
--     this caseload table. Fail-safe under
--     STRICT_STUDENT_ACCESS_PREDICATE via applyStudentAccessGate's
--     existing try/catch.
-- =========================================================
--
-- §5 COMPOSITE-FK CROSS-SCOPE REJECTION (CLAUDE.md §5 doctrine,
-- enforced at the schema layer, NOT the app layer):
--
--   Three composite FKs guarantee that no row can describe a
--   caseload that crosses school OR district boundaries:
--
--   1. (ea_user_id, district_id) REFERENCES users(id, district_id)
--      Mirrors M028 user_school_access (line 82) and M038
--      mtss_coordinators (line 92). For a district user (district_id
--      NOT NULL) this guarantees the EA exists in the declared
--      district. For a legacy single-tenant user (district_id NULL)
--      MATCH SIMPLE skips enforcement — correct because cross-
--      district is impossible for a user with no district.
--
--   2. (school_tenant_id, district_id) REFERENCES tenants(id, district_id)
--      Mirrors M028 (line 84) + M038 (line 94). For district tenants
--      this guarantees the school exists in the declared district.
--      For legacy single-tenant deployments (district_id NULL on the
--      tenant) MATCH SIMPLE skips — correct.
--
--   3. (student_id, school_tenant_id) REFERENCES students(id, tenant_id)
--      This is the NEW rejection layer added by this migration. The
--      M021 doctrine (CLAUDE.md §5) — UNIQUE(id, tenant_id) on
--      students + composite child FK — guarantees a caseload row
--      cannot reference a student who lives in a different building.
--      A cross-school INSERT fails with FK 23503, not at the app
--      layer. students.UNIQUE(id, tenant_id) was established by
--      M021 line 52.
--
--   Combined trust property: for any caseload row, the EA, the school,
--   and the student all live in the same district (for district users)
--   and the student lives in the named school. No app-layer check is
--   the trust boundary.
--
-- =========================================================
-- CASCADE BEHAVIOR MATRIX:
--
--   Schema-cascade source         | Composite FK fires? | Audit row label
--   -----------------------------|---------------------|----------------
--   DELETE FROM users (district)  | YES — (ea_user_id, |
--                                 |  district_id)       | 'cascade_user_delete'
--   DELETE FROM users (legacy)    | NO (MATCH SIMPLE)   | (none — app
--                                 |                     |  cleanup needed
--                                 |                     |  per F#115/#118
--                                 |                     |  pattern)
--   DELETE FROM tenants (district)| YES — (school_     |
--                                 |  tenant_id,         |
--                                 |  district_id)       | 'cascade_user_delete'
--   DELETE FROM tenants (legacy)  | NO (MATCH SIMPLE)   | (app cleanup)
--   DELETE FROM students          | YES — (student_id, |
--                                 |  school_tenant_id)  | 'cascade_user_delete'
--   DELETE FROM ea_caseload_      | n/a (direct DELETE) | from GUC, or
--     students (app-layer revoke) |                     |  'cascade_user_delete'
--                                 |                     |  default
--
--   The label 'cascade_user_delete' is the single hardcoded default
--   in the trigger function per M031/M039 doctrine. It is a misnomer
--   in this table (user / tenant / student deletes all route through
--   it), but kept identical to M039's CHECK-admitted vocabulary for
--   audit-table parity. App-layer writers override via the
--   app.audit_action GUC (see FUTURE-WRITERS CONTRACT below).
--
-- =========================================================
-- AUDIT TABLE DOCTRINE (mirrors M031 + M039):
--
--   - No foreign keys on the audit table. FERPA §99.32 record-of-
--     disclosure retention requires audit rows to outlive their
--     referents. A FK to ea_caseload_students, users, students, or
--     tenants would force ON DELETE CASCADE / SET NULL / RESTRICT,
--     each of which compromises the §99.32 contract. Denormalized
--     integer columns are the correct shape.
--   - BIGSERIAL on audit_id (not SERIAL). Append-only-unbounded;
--     the 2.1B INTEGER ceiling is reachable on multi-year district
--     fleets. Same reasoning as M031 + M039.
--   - CHECK on action enforces M039's 3-value vocabulary exactly:
--     'grant', 'revoke', 'cascade_user_delete'. Future writers that
--     set app.audit_action to a non-admitted value will violate the
--     CHECK and abort the parent transaction — correct fail-loud.
--   - NO SECURITY DEFINER on the trigger function. The trigger fires
--     in the same transaction as the parent DELETE under the
--     caller's privileges. Future reviewers should not add SECURITY
--     DEFINER reflexively — see M031 / M039 / M040 headers for the
--     rationale; the same logic applies here.
--   - Combined into one migration (M041) rather than split across
--     foundation / audit / GUC files. Same reasoning as M040 lines
--     18-25: greenfield writers ship together in PR-2, so the M032/
--     M033 historical contingency does not apply. A single
--     BEGIN/COMMIT atomic apply is operationally simpler with no
--     separation-of-concerns benefit lost.
--
-- =========================================================
-- FUTURE-WRITERS CONTRACT (consumed by PR-2 + the deferred
-- assignment-UI PR):
--
--   Two transaction-local GUCs participate in audit-row generation:
--
--   1. app.actor_user_id
--        Set by every app-layer INSERT-into / DELETE-FROM
--        ea_caseload_students caller, and every DELETE-FROM-users /
--        DELETE-FROM-tenants / DELETE-FROM-students caller whose
--        cascade reaches this table. Value MUST be the positive
--        integer users.id of the authenticated actor. Set via:
--          SELECT set_config('app.actor_user_id', $1, true)
--        where $1 is String(req.user.id). Captured into
--        ea_caseload_students_audit.actor_user_id at trigger fire-
--        time. The 'true' third arg makes the GUC transaction-local
--        — it dies at COMMIT/ROLLBACK and cannot leak to subsequent
--        transactions on the same pooled client.
--
--   2. app.audit_action
--        Set ONLY by explicit-revoke writers (the future caseload-
--        assignment DELETE handler). Value MUST be one of the
--        CHECK-admitted strings ('grant', 'revoke',
--        'cascade_user_delete'). For explicit revokes the value is
--        'revoke'. Set via:
--          SELECT set_config('app.audit_action', 'revoke', true)
--        Cascade paths (user/tenant/student delete) leave this GUC
--        unset; trigger defaults to 'cascade_user_delete'.
--
--   GUC scope contract: both are transaction-local. The route MUST
--   run BEGIN, SET LOCAL via set_config, the DELETE, and COMMIT on
--   a SINGLE checked-out client — not separate pool calls — or the
--   GUC and the DELETE land on different sessions and the trigger
--   reads ''. Mirrors M040 line 96-100.
--
--   The 'grant' action is NOT written by the trigger. The trigger
--   only fires AFTER DELETE; the future POST grant handler writes
--   its own action='grant' audit row at the app layer inside the
--   same transaction (mirrors routes/mtssCoordinators.js POST →
--   mtss_coordinators_audit pattern).
--
-- =========================================================
-- BACKWARDS COMPATIBILITY:
--   - Step 1 widens the users.role CHECK from 7 to 8 values. Every
--     pre-existing role remains valid. Zero existing user rows are
--     rewritten.
--   - Steps 2-7 create two net-new tables + one trigger. No
--     existing data is rewritten; no existing query semantics
--     change. constants/roles.js (ELEVATED_ROLES +
--     INTERVENTION_MANAGER_ROLES) is intentionally NOT updated by
--     this migration or by PR-2 — see ROLE-MATRIX PLACEMENT.
--
-- =========================================================
-- PRE-FLIGHT CHECK BEFORE APPLYING (operator's responsibility):
--   -- Expected: 0 (no one holds the new role yet)
--   SELECT COUNT(*) FROM users WHERE role = 'education_assistant';
--   -- Expected: relation does not exist (table not yet created)
--   SELECT COUNT(*) FROM ea_caseload_students;
--   -- Expected: relation does not exist
--   SELECT COUNT(*) FROM ea_caseload_students_audit;
-- A non-zero ea_caseload_students count on a re-run is fine
-- (idempotent); a non-zero users-with-EA-role count is also fine
-- (the CHECK widen is a no-op on re-run). Pause only if the row
-- counts contradict the deploy stage you are at.
--
-- =========================================================
-- IDEMPOTENCY (explicit, S68 lesson on M029's comment-vs-mechanism
-- mismatch):
--   Step 1 DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT produces the
--     same final CHECK shape on every run. The widened CHECK admits
--     all 7 prior values plus 'education_assistant'.
--   Step 2 CREATE TABLE IF NOT EXISTS produces the same final
--     ea_caseload_students shape on every run.
--   Step 3 CREATE INDEX IF NOT EXISTS produces the same indexes.
--   Step 4 CREATE TABLE IF NOT EXISTS produces the same final
--     ea_caseload_students_audit shape on every run.
--   Step 5 CREATE INDEX IF NOT EXISTS produces the same index.
--   Step 6 CREATE OR REPLACE FUNCTION updates the body if changed;
--     identical body on re-run is a no-op behavior.
--   Step 7 DROP TRIGGER IF EXISTS + CREATE TRIGGER re-establishes
--     the binding fresh on every run; same shape every time.
--
-- ATOMICITY: all seven steps inside one BEGIN/COMMIT. Either every
-- step lands or none does. Apply as a single \i unit; do not run
-- statements individually (cf. Followup #111).

BEGIN;

-- =========================================================
-- Step 1: widen users.role CHECK to admit 'education_assistant'.
-- Mirrors M030 step 3 shape (DROP + ADD). The widened CHECK is the
-- 7-role universe from M030 line 77-83 plus the new role.
-- =========================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('district_admin',
                  'school_admin',
                  'district_tech_admin',
                  'teacher',
                  'counselor',
                  'interventionist',
                  'parent',
                  'education_assistant'));

-- =========================================================
-- Step 2: per-(EA, student) caseload table.
--
-- Column naming: school_tenant_id mirrors M028 / M038 (the table
-- joins users + students, both of which carry their own tenant_id;
-- the prefix disambiguates). The composite FK on
-- (student_id, school_tenant_id) -> students(id, tenant_id) shows
-- that local column names need not match referenced names.
--
-- district_id is NULLABLE to match M038. Legacy single-tenant EAs
-- have district_id = NULL on this row; MATCH SIMPLE skips composite-
-- FK enforcement for the two district-bound FKs. The student-bound
-- FK does not involve district_id and fires regardless — so cross-
-- school is still rejected for legacy users.
--
-- created_by ON DELETE SET NULL mirrors M028 / M038. The audit
-- trail (Step 4 onward) carries the persistent record-of-disclosure;
-- created_by on the live row is best-effort attribution.
-- =========================================================
CREATE TABLE IF NOT EXISTS ea_caseload_students (
  ea_user_id       INTEGER NOT NULL,
  student_id       INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (ea_user_id, student_id),
  FOREIGN KEY (ea_user_id, district_id)
    REFERENCES users(id, district_id) ON DELETE CASCADE,
  FOREIGN KEY (school_tenant_id, district_id)
    REFERENCES tenants(id, district_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, school_tenant_id)
    REFERENCES students(id, tenant_id) ON DELETE CASCADE
);

-- =========================================================
-- Step 3: indexes. PK (ea_user_id, student_id) is already indexed
-- and covers the canAccessStudent.js per-row lookup
-- (WHERE ea_user_id = $1 AND student_id = $2). The three additional
-- indexes support:
--   - school: "list EAs whose caseload covers this student" + per-
--     building operator queries (mirrors M028/M038 school index).
--   - student: "who is in this student's EA-caseload roster" — the
--     assignment-UI lookup.
--   - district: operator queries scoped to a district (mirrors
--     M028/M038 district index).
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_ea_caseload_students_school
  ON ea_caseload_students(school_tenant_id);
CREATE INDEX IF NOT EXISTS idx_ea_caseload_students_student
  ON ea_caseload_students(student_id);
CREATE INDEX IF NOT EXISTS idx_ea_caseload_students_district
  ON ea_caseload_students(district_id);

-- =========================================================
-- Step 4: append-only audit table. Denormalized integer columns,
-- no FKs by design (FERPA §99.32 record-of-disclosure retention —
-- audit rows must outlive their referents). district_id NULLABLE
-- to match the parent table's legacy single-tenant support.
--
-- The CHECK on action admits exactly the M039-vocabulary 3 values.
-- 'cascade_user_delete' is a label-of-record for any schema-cascade
-- source (user / tenant / student delete) per M031/M039 single-
-- label trigger doctrine; the misnomer is documented in the
-- cascade-behavior matrix above.
-- =========================================================
CREATE TABLE IF NOT EXISTS ea_caseload_students_audit (
  audit_id         BIGSERIAL PRIMARY KEY,
  ea_user_id       INTEGER NOT NULL,
  student_id       INTEGER NOT NULL,
  school_tenant_id INTEGER NOT NULL,
  district_id      INTEGER,
  action           VARCHAR(32) NOT NULL
                   CHECK (action IN ('grant', 'revoke', 'cascade_user_delete')),
  actor_user_id    INTEGER,
  occurred_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NO FK to ea_caseload_students / users / students / tenants by
-- design — audit row must outlive its referent per FERPA §99.32
-- record-of-disclosure retention. See migration-031, migration-039
-- precedent (S69 privacy-reviewer agentIds ad5577dc9a9aba16b +
-- aa64397dba70ad892).
COMMENT ON TABLE ea_caseload_students_audit IS
  'Append-only audit trail for ea_caseload_students. Denormalized integer columns (ea_user_id, student_id, school_tenant_id, district_id) with NO foreign keys — rows must outlive their referents per FERPA §99.32 record-of-disclosure retention. See migration-041 header.';

-- =========================================================
-- Step 5: district-scoped index for operator queries (most-recent
-- first). Mirrors idx_mtss_coordinators_audit_district from M039
-- line 132. Rows with district_id NULL (legacy single-tenant audit
-- rows) still index correctly via btree NULL handling.
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_ea_caseload_students_audit_district
  ON ea_caseload_students_audit (district_id, occurred_at DESC);

-- =========================================================
-- Step 6: trigger function — GUC-driven action label + actor
-- capture. Combines M039's cascade-capture body with M040's GUC
-- evolution into one CREATE OR REPLACE step. Same reasoning as
-- M040 lines 18-25: greenfield writers ship together in PR-2,
-- splitting adds operator friction with no separation-of-concerns
-- benefit.
--
-- NO SECURITY DEFINER — trigger fires under caller's privileges.
-- Future reviewers should not add reflexively; see header.
--
-- NULLIF guard on current_setting: returns '' (not NULL) when the
-- GUC is unset. NULLIF collapses '' to NULL so the ::int cast on
-- actor_user_id does not raise 22P02; COALESCE substitutes the
-- cascade default for the action label. Non-app-layer writers
-- (direct DBA DELETE, future writers that have not yet adopted
-- the SET LOCAL pattern) write NULL actor + cascade label — the
-- audit row still records WHEN + WHICH-row but the actor is
-- unknown for non-app paths, which is correct fail-quiet.
-- =========================================================
CREATE OR REPLACE FUNCTION ea_caseload_students_audit_cascade()
  RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ea_caseload_students_audit
    (ea_user_id, student_id, school_tenant_id, district_id, action, actor_user_id)
  VALUES
    (OLD.ea_user_id, OLD.student_id, OLD.school_tenant_id, OLD.district_id,
     COALESCE(
       NULLIF(current_setting('app.audit_action', true), ''),
       'cascade_user_delete'
     ),
     NULLIF(current_setting('app.actor_user_id', true), '')::int);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- Step 7: bind trigger. DROP IF EXISTS + CREATE makes re-runs
-- idempotent (same shape every time). AFTER DELETE FOR EACH ROW
-- mirrors M031 / M039 binding shape.
-- =========================================================
DROP TRIGGER IF EXISTS ea_caseload_students_audit_after_delete
  ON ea_caseload_students;

CREATE TRIGGER ea_caseload_students_audit_after_delete
  AFTER DELETE ON ea_caseload_students
  FOR EACH ROW EXECUTE FUNCTION ea_caseload_students_audit_cascade();

COMMIT;
