// Canonical list of staff roles that receive tenant-wide visibility into
// student/intervention/document data. A user whose `role` is in this set
// is treated as "elevated" for within-tenant scope decisions even if the
// `users.school_wide_access` boolean has drifted out of sync.
//
// Single source of truth — consumed by:
//   - routes/students.js              (tenant-wide read predicate)
//   - routes/weeklyProgress.js        (Weekly Reminder read predicate)
//   - routes/studentDocuments.js      (Expiring Documents read predicate)
//   - routes/staffManagement.js       (POST + PUT recalc of school_wide_access)
//   - server.js                       (bootstrap back-fill UPDATE)
//   - scripts/seed-humble-isd-sandbox.js          (roster validation)
//   - scripts/seed-tenant-sandbox-template.js     (roster validation)
//
// Adding or removing a role here changes who can see tenant-wide PII —
// route as a §4B / §5 PR with all three reviewer subagents.

const ELEVATED_ROLES = [
  'district_admin',
  'district_tech_admin',
  'school_admin',
  'counselor',
  'interventionist',
];

// Canonical list of roles authorized to manage interventions — every
// staff role except `parent`. Semantically mirrors the FE's
// `canManageInterventions` predicate (frontend/src/App.jsx:411).
// Consumed as the read-gate allowlist on staff-roster surfaces (e.g.,
// GET /api/staff/:tenantId) whose consumer scope is the full
// intervention-management surface — both the per-intervention staff-
// picker dropdown in AssignmentManager (teacher-reachable) and the
// Admin Panel Staff Management table are subsets of this set.
//
// Named by semantic intent rather than by list-of-uses so the constant
// stays reusable if a second route surfaces the same scope. Adding or
// removing a role here changes who can read tenant-wide staff rosters
// — route as a §4B / §5 PR with all three reviewer subagents.
const INTERVENTION_MANAGER_ROLES = [
  'district_admin',
  'district_tech_admin',
  'school_admin',
  'counselor',
  'teacher',
  'interventionist',
];

// Canonical list of roles authorized to run the End-of-Year grade
// roll-up (POST /api/student-grade-rollup/{preview,commit,undo/:runId}).
// Scope of authority is determined by resolveAccessibleTenantIds at the
// per-endpoint scope check (lines ~308/436/769 in routes/studentGradeRollup.js)
// — this constant only controls WHO may run the roll-up at all, not
// WHICH schools each caller may target. district_admin gets their
// full district set; school_admin gets their building (legacy single-
// tenant path) or their user_school_access grants (district path).
//
// Consumed by:
//   - routes/studentGradeRollup.js  (3 role gates: preview/commit/undo)
//   - frontend/src/context/AppContext.jsx  (derived canRunRollup)
//
// Adding or removing a role here changes who can perform a destructive
// bulk write to students.grade / enrollment_status / exit_reason /
// exit_date for an entire school in one transaction. Route as a §4B /
// §5 PR with all three reviewer subagents.
const ROLLUP_ROLES = [
  'district_admin',
  'school_admin',
];

// Role rank for delegated role assignment. Numeric tiers (powers of 20
// for headroom; absolute values are not semantically meaningful, only
// the ordering is):
//
//   district_admin       80    — district-wide; only operator assigns
//   district_tech_admin  60    — district-wide; tech surface
//   school_admin         40    — building-level
//   teacher / counselor / interventionist / education_assistant / parent
//                        20    — sub-roles (peer tier among themselves)
//
// "operator" is intentionally absent from this map. Operator status is
// a synthetic privilege carried by the PLATFORM_ADMIN_USER_IDS env-var
// allowlist (middleware/platformAdminOnly.js), not a DB role. It is
// recomputed server-side per request via isOperator(req.user.id) and
// passed as the third arg to canAssignRole.
//
// Adding or removing a role here changes who can assign whom — route
// as a §4B / §5 PR with all three reviewer subagents. Three-writer
// drift hazard with users.role's DB CHECK (M041/M043) and the FE mirror
// at frontend/src/constants/staffRoles.js; keep all three in lockstep.
const ROLE_RANK = {
  district_admin: 80,
  district_tech_admin: 60,
  school_admin: 40,
  teacher: 20,
  counselor: 20,
  interventionist: 20,
  education_assistant: 20,
  parent: 20,
};

// canAssignRole — pure predicate for the role-rank condition of the
// delegated role assignment guard. Three independent conditions must
// ALL hold for an assignment to be authorized; this function answers
// ONLY the rank condition. The other two MUST be enforced at the call
// site:
//
//   (1) Target user is within the actor's accessible-school set via
//       middleware/resolveAccessibleTenantIds (never inlined per §5
//       dual-path doctrine). NOT checked here.
//   (2) Target user is not the actor (self-mutation guard).
//       NOT checked here.
//   (3) The role being assigned is permitted given the actor's rank
//       and operator status. THIS function.
//
// Operator bypass: when actorIsOperator is true, any role in ROLE_RANK
// is assignable. The operator's DB role is irrelevant; an operator's
// users.role could be any string and the bypass still fires. Unknown
// target role strings are rejected even for operators — only roles in
// ROLE_RANK are assignable.
//
// Non-operator rank check: targetRole must be strictly below actorRole
// by numeric rank. Equal-rank assignments are rejected by default; the
// only exception is the school_admin peer rule — a school_admin may
// assign a peer school_admin. Within-tenant scope of that exception is
// enforced by condition (1) at the call site (the target's
// school_tenant_id must be in the actor's accessible-school set
// returned by resolveAccessibleTenantIds), not here.
//
// Unknown or missing actor/target roles return false (defense in depth
// for malformed JWT payloads or callers that forget the universe
// check upstream). Display-only consumers on the FE must mirror this
// predicate exactly — see frontend/src/constants/staffRoles.js.
function canAssignRole(actorRole, targetRole, actorIsOperator) {
  if (actorIsOperator === true) {
    return Object.prototype.hasOwnProperty.call(ROLE_RANK, targetRole);
  }
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole];
  if (actorRank === undefined || targetRank === undefined) {
    return false;
  }
  if (targetRank < actorRank) {
    return true;
  }
  if (actorRole === 'school_admin' && targetRole === 'school_admin') {
    return true;
  }
  return false;
}

module.exports = {
  ELEVATED_ROLES,
  INTERVENTION_MANAGER_ROLES,
  ROLLUP_ROLES,
  ROLE_RANK,
  canAssignRole,
};
