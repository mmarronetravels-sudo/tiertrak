/**
 * data/sandbox-district-roster-template.js
 *
 * Synthetic fixture roster for the §5 multi-school non-leakage proof
 * (owed since PR #244). Defines one district, three school-tenants
 * (A / B / C), and a small user + student + discipline-referral set.
 *
 * §4B: ALL DATA IS SYNTHETIC. Names, emails, grades, behaviors are
 * fabricated. The domain `sandbox-district.example` is the IETF
 * RFC 2606 reserved `.example` TLD — guaranteed not to resolve and
 * guaranteed not to collide with any real customer email. No real
 * student/staff identifiers appear anywhere in this file.
 *
 * Consumed by:
 *   - scripts/seed-district-sandbox.js     — emits provisioning SQL
 *   - scripts/teardown-district-sandbox.js — emits teardown SQL
 *
 * To change the fixture: edit this file, re-run the seed script. The
 * roster is the single source of truth for the seed + teardown pair.
 */

const DISTRICT = {
  // District name is the lookup key used by the teardown script to find
  // and remove the entire fixture. If you change this, change it in the
  // teardown invocation too.
  name: 'Sandbox District (multi-school §5 fixture)',
};

const SCHOOLS = [
  { slug: 'A', name: 'Sandbox Elementary A', subdomain: 'sandbox-school-a' },
  { slug: 'B', name: 'Sandbox Middle B',     subdomain: 'sandbox-school-b' },
  { slug: 'C', name: 'Sandbox High C',       subdomain: 'sandbox-school-c' },
];

// USERS. Each user is provisioned with a district_id and a home tenant
// (tenant_id). The home tenant is whichever school in `school_access`
// the user spends most time in — only used for the legacy single-tenant
// fallback path in resolveAccessibleTenantIds, which DOES NOT FIRE for
// users with a non-NULL district_id. school_access is the authoritative
// scope for every user in this fixture.
//
// Two proof subjects:
//   - district-admin@... → access to A+B only (NOT C). Primary proof:
//     the multi-school district admin must see A+B and never C.
//   - school-a-counselor@... → access to A only. Secondary proof:
//     a single-school district user stays confined to one school.
//
// IMPORTANT — school_wide_access semantics: both proof subjects above
// are in ELEVATED_ROLES (district_admin, counselor), so the seed will
// flip users.school_wide_access = TRUE for both. That flag is an
// IN-TENANT-SET caseload bypass (governs per-student-record visibility
// WITHIN the user's already-resolved tenant set per routes/students.js,
// routes/weeklyProgress.js, routes/studentDocuments.js), NOT a
// cross-tenant scope override. It does not widen the export's tenant
// scope past user_school_access membership. The §5 proof — "district
// admin sees A+B and never C" — holds even with the flag set.
//
// Three referring-staff teachers (one per school). Required so each
// discipline_referrals row has a non-NULL referring_staff_id FK that
// points to a real users row.
const USERS = [
  {
    email: 'district-admin@sandbox-district.example',
    full_name: 'Sandbox District Admin',
    role: 'district_admin',
    home_school_slug: 'A',
    school_access: ['A', 'B'],
  },
  {
    email: 'school-a-counselor@sandbox-district.example',
    full_name: 'Sandbox Counselor A',
    role: 'counselor',
    home_school_slug: 'A',
    school_access: ['A'],
  },
  {
    email: 'teacher-a@sandbox-district.example',
    full_name: 'Sandbox Teacher A',
    role: 'teacher',
    home_school_slug: 'A',
    school_access: ['A'],
  },
  {
    email: 'teacher-b@sandbox-district.example',
    full_name: 'Sandbox Teacher B',
    role: 'teacher',
    home_school_slug: 'B',
    school_access: ['B'],
  },
  {
    email: 'teacher-c@sandbox-district.example',
    full_name: 'Sandbox Teacher C',
    role: 'teacher',
    home_school_slug: 'C',
    school_access: ['C'],
  },
];

const STUDENTS = [
  { external_id: 'SBX-A-001', tenant_slug: 'A', first_name: 'Synthetic', last_name: 'StudentA1', grade: '3' },
  { external_id: 'SBX-A-002', tenant_slug: 'A', first_name: 'Synthetic', last_name: 'StudentA2', grade: '4' },
  { external_id: 'SBX-B-001', tenant_slug: 'B', first_name: 'Synthetic', last_name: 'StudentB1', grade: '6' },
  { external_id: 'SBX-B-002', tenant_slug: 'B', first_name: 'Synthetic', last_name: 'StudentB2', grade: '7' },
  { external_id: 'SBX-C-001', tenant_slug: 'C', first_name: 'Synthetic', last_name: 'StudentC1', grade: '9' },
  { external_id: 'SBX-C-002', tenant_slug: 'C', first_name: 'Synthetic', last_name: 'StudentC2', grade: '10' },
];

// REFERRALS. 3 / 2 / 2 across A / B / C with varied incident_date and
// status so the export's date and status filters can be exercised.
//
// Isolation-leak surfacer: REFERRAL #6 (School C, 'Profanity',
// 'submitted', incident_date_offset -5) deliberately shares date +
// status + behavior with REFERRAL #1 (School A). A broken isolation
// path that returns rows the admin shouldn't see will SURFACE C-#6 in
// the same filter window as A-#1 — the date/status/behavior overlap
// guarantees a side-by-side comparison row, not a row that quietly
// hides under a non-matching filter.
//
// REFERRAL #7 (School C, 'Disorderly conduct', 'resolved', offset -2)
// also lands inside the export's default date range; even an
// unfiltered export call leaks it if isolation is broken.
//
// incident_date_offset is negative days before CURRENT_DATE at seed
// time. The emitter computes `CURRENT_DATE - INTERVAL 'N days'`.
const REFERRALS = [
  // -------- School A (3 rows) --------
  { student_external_id: 'SBX-A-001', referring_staff_email: 'teacher-a@sandbox-district.example',
    incident_date_offset: -5, status: 'submitted',    behavior_label: 'Profanity',
    location_label: 'Classroom' },
  { student_external_id: 'SBX-A-001', referring_staff_email: 'teacher-a@sandbox-district.example',
    incident_date_offset: -3, status: 'under_review', behavior_label: 'Defiance / disrespect / insubordination',
    location_label: 'Hallway / Breezeway' },
  { student_external_id: 'SBX-A-002', referring_staff_email: 'teacher-a@sandbox-district.example',
    incident_date_offset: -1, status: 'resolved',     behavior_label: 'Disorderly conduct',
    location_label: 'Cafeteria' },
  // -------- School B (2 rows) --------
  { student_external_id: 'SBX-B-001', referring_staff_email: 'teacher-b@sandbox-district.example',
    incident_date_offset: -4, status: 'submitted',    behavior_label: 'Dress code violation',
    location_label: 'Classroom' },
  { student_external_id: 'SBX-B-002', referring_staff_email: 'teacher-b@sandbox-district.example',
    incident_date_offset: -2, status: 'under_review', behavior_label: 'Profanity',
    location_label: 'Bus' },
  // -------- School C (2 rows; MUST NOT appear in district-admin's A+B export) --------
  // C-#6: date+status+behavior overlap with A-#1 — surfaces side-by-side if isolation breaks
  { student_external_id: 'SBX-C-001', referring_staff_email: 'teacher-c@sandbox-district.example',
    incident_date_offset: -5, status: 'submitted',    behavior_label: 'Profanity',
    location_label: 'Classroom' },
  // C-#7: independent date in the export's default window
  { student_external_id: 'SBX-C-002', referring_staff_email: 'teacher-c@sandbox-district.example',
    incident_date_offset: -2, status: 'resolved',     behavior_label: 'Disorderly conduct',
    location_label: 'Gym' },
];

module.exports = { DISTRICT, SCHOOLS, USERS, STUDENTS, REFERRALS };
