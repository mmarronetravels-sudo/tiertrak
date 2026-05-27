/**
 * Sandbox Roster Template — canonical schema for scripts/seed-tenant-sandbox-template.js
 *
 * ---------------------------------------------------------------------------
 *   PRIVACY BANNER (CLAUDE.md §4B — read before editing)
 * ---------------------------------------------------------------------------
 *
 * This file is a SCHEMA DOCUMENT, not a real roster. It contains placeholder
 * strings only. Copy this file to a location OUTSIDE this repository (a local
 * operator-only directory), fill it in with SYNTHETIC data, and pass the
 * absolute path of your copy to the seed script:
 *
 *     node scripts/seed-tenant-sandbox-template.js --roster <absolute-path>
 *
 * Hard rules:
 *   - Do NOT commit a filled-in roster to this repository, ever — even if
 *     you believe the data is synthetic. Customer-identifying fixtures (real
 *     district names, real campus names paired with real grade bands, etc.)
 *     can re-identify a sandbox tenant once paired with the seed SQL.
 *   - All student names, IDs, and identifying details must be fictional.
 *   - The email domain must be fictional or operator-controlled — never a
 *     real customer domain.
 *   - Do NOT paste real CSV data, real SIS exports, or real screener output
 *     into a roster file. Use entirely invented synthetic data.
 *
 * The committed reference roster `data/humble-isd-sandbox-roster.js` is a
 * sample of a fully-populated roster that uses a fictional `humble.edu`
 * domain and synthetic Texas demo names. Treat it as documentation; do not
 * copy real customer data into a similarly-shaped file.
 *
 * ---------------------------------------------------------------------------
 *   Schema constraints honored by the seed script
 * ---------------------------------------------------------------------------
 *
 *   - users.role         CHECK (one of: 'district_admin', 'school_admin',
 *                                'district_tech_admin', 'teacher', 'counselor',
 *                                'interventionist', 'parent')
 *                        ADMINS default to 'district_admin'. Override by
 *                        setting `role` explicitly on an ADMINS entry — e.g.,
 *                        'school_admin' for charter or international tenants.
 *                        Any ALLOWED_ROLES value is permitted. STAFF must
 *                        specify a role explicitly.
 *   - users.school_wide_access  REQUIRED on every STAFF entry. Boolean. The
 *                        seed script does NOT infer this from role.
 *   - tenants.subdomain  Lowercase letters, digits, hyphens only
 *                        (/^[a-z0-9-]+$/). Used as the tenant URL slug.
 *   - students.tier      CHECK (1, 2, 3)
 *   - students.area      CHECK ('Behavior', 'Academic', 'Social-Emotional')
 *   - students.risk_level CHECK ('low', 'moderate', 'high')
 *   - student_interventions.status  Always 'active' in the seed (the script
 *                        does not parameterize this).
 *   - intervention_templates  template_name on each INTERVENTIONS entry must
 *                        match an existing system-default row (tenant_id IS
 *                        NULL) by exact name. The seed's Preflight 3 hard-
 *                        fails if a name is missing or duplicated.
 *   - parent_student_links has NO tenant_id column (known followup; do not
 *                        add one here). PARENT_LINK is optional.
 *
 * ---------------------------------------------------------------------------
 *   Cross-reference rules
 * ---------------------------------------------------------------------------
 *
 *   - STUDENTS[].external_id is the SIS-issued student identifier (formerly
 *     roster-only; as of Migration 035 also persisted to the students table).
 *     Values round-trip into the database via the CSV importer and POST/PUT
 *     /students routes (commits 9f5c415, a9e791d). The seed scripts in
 *     scripts/seed-*.js still discard external_id at INSERT time — separate
 *     follow-up. Within this roster the field is also used to cross-reference
 *     INTERVENTIONS, PROGRESS_NOTES, and PARENT_LINK back to a student.
 *   - external_ids must be unique within STUDENTS.
 *   - Emails must be unique across ADMINS ∪ STAFF.
 *   - Every assigned_by_email / author_email / parent_email must match an
 *     ADMINS or STAFF email exactly.
 *   - Every student_external_id reference (in INTERVENTIONS, PROGRESS_NOTES,
 *     PARENT_LINK) must match a STUDENTS[].external_id exactly.
 *
 * ---------------------------------------------------------------------------
 */

const TENANT = {
  name: 'REPLACE_ME_TENANT_NAME',          // Human-readable display name (e.g., 'Cypress ISD Demo')
  type: 'district',                         // 'district' or 'school' — string, non-empty
  subdomain: 'replace-me-subdomain',        // Lowercase letters, digits, hyphens only
};

// At least one ADMINS entry is required. The first admin's user-id is used
// as activated_by for the tenant_intervention_bank auto-seed. ADMINS default
// to role='district_admin' and always get school_wide_access=true. Override
// `role` per-entry for non-district tenants.
const ADMINS = [
  { email: 'admin1@example.invalid', full_name: 'Replace Me Admin One' },
  // e.g., role: 'school_admin' for charter/international tenants:
  // { email: 'admin2@example.invalid', full_name: 'Replace Me Admin Two', role: 'school_admin' },
];

// STAFF may be empty. school_wide_access is REQUIRED on every entry.
const STAFF = [
  {
    email: 'counselor@example.invalid',
    full_name: 'Replace Me Counselor',
    role: 'counselor',                      // one of the users.role CHECK values above
    school_wide_access: true,               // REQUIRED boolean — not inferred
  },
];

// At least one STUDENTS entry is required. external_id is roster-only and
// must be unique within this array. Unknown fields will produce a stderr
// WARN line on every run; remove or rename them to match the schema.
const STUDENTS = [
  {
    external_id: 'DEMO-001',                // Unique within STUDENTS; roster-only
    first_name: 'Replace',
    last_name: 'Me',
    grade: 'K',                             // String (e.g., 'K', '1', '8')
    tier: 2,                                // 1, 2, or 3
    area: 'Academic',                       // 'Behavior' | 'Academic' | 'Social-Emotional'
    risk_level: 'moderate',                 // 'low' | 'moderate' | 'high'
  },
];

// INTERVENTIONS may be empty. template_name must match an existing system-
// default intervention_templates row (tenant_id IS NULL) by exact name.
// start_age_days is the number of days before today; the seed SQL computes
// start_date = CURRENT_DATE - start_age_days at run time.
const INTERVENTIONS = [
  {
    student_external_id: 'DEMO-001',        // Must match a STUDENTS[].external_id
    template_name: 'Small Group Instruction', // Must match intervention_templates.name (system-default)
    assigned_by_email: 'counselor@example.invalid', // Must match an ADMINS or STAFF email
    progress: 25,                           // Integer 0-100
    start_age_days: 30,                     // Non-negative integer
    notes: 'Replace with a synthetic intervention note describing the plan.',
  },
];

// PROGRESS_NOTES may be empty. age_days is the number of days before now;
// the seed SQL computes created_at = CURRENT_TIMESTAMP - age_days at run
// time so the activity feed renders in chronological order.
const PROGRESS_NOTES = [
  {
    student_external_id: 'DEMO-001',        // Must match a STUDENTS[].external_id
    author_email: 'counselor@example.invalid', // Must match an ADMINS or STAFF email
    age_days: 7,                            // Non-negative integer
    note: 'Replace with a synthetic progress note describing what happened.',
  },
];

// PARENT_LINK is OPTIONAL. Omit (or set to null) if the sandbox does not
// need a parent → student link. parent_student_links has no tenant_id
// column (known followup; do not add one here).
const PARENT_LINK = {
  parent_email: 'admin1@example.invalid',   // Must match an ADMINS or STAFF email
  student_external_id: 'DEMO-001',          // Must match a STUDENTS[].external_id
  relationship: 'parent',                   // Free-form non-empty string
};

module.exports = {
  TENANT,
  ADMINS,
  STAFF,
  STUDENTS,
  INTERVENTIONS,
  PROGRESS_NOTES,
  PARENT_LINK,
};
