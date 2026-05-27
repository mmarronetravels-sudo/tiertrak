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

module.exports = { ELEVATED_ROLES, INTERVENTION_MANAGER_ROLES };
