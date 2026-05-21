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

module.exports = { ELEVATED_ROLES };
