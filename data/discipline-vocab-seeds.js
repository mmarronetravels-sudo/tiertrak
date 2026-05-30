/**
 * Discipline-referral default vocabularies — canonical source.
 *
 * DRIFT-RISK NOTE
 * ---------------
 * The 7 default vocab lists below are ALSO embedded as VALUES blocks in
 * migration-036-discipline-referrals-foundation.sql, which one-shot
 * seeded these defaults for every school-tenant that existed when that
 * migration ran. From the new-tenant create flow forward, THIS MODULE
 * is the single source of truth. If a future content edit changes any
 * default (add a row, rename a label, change severity_level / managed_by
 * / is_restorative, etc.), update this module FIRST, then write a small
 * backfill migration that re-seeds existing tenants from the same lists
 * via INSERT … SELECT FROM (VALUES …) ON CONFLICT … DO NOTHING. Editing
 * M036 after the fact is not permitted — it has already run, and the
 * lists embedded in it are a historical seed, not a live source.
 *
 * Idempotency: seedDisciplineVocabsForTenant runs each INSERT with
 * ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING,
 * targeting the per-tenant partial-unique label index defined in M036.
 * Safe to re-run; re-runs preserve any operator additions / renames
 * made between the original seed and the re-run.
 *
 * Per-tenant counts (verification): locations 16, motivations 7,
 * others_involved 7, consequences 22, harassment_subtypes 8,
 * weapon_subtypes 4, behaviors 20.
 *
 * requires_subtype (added M037): tag on a behavior row indicating
 * the route + UI must collect a conditional subtype at referral
 * submit time. Only two canonical rows carry a tag — 'Harassment' →
 * 'harassment' (gates the discipline_harassment_subtypes picker),
 * and 'Carrying a knife or weapon' → 'weapon' (gates the
 * discipline_weapon_subtypes picker). Other rows are NULL; a tenant
 * who adds a new behavior can set the tag via the per-tenant
 * customization UI.
 */

const LOCATIONS = [
  { label: 'Classroom', sort_order: 1 },
  { label: 'Hallway / Breezeway', sort_order: 2 },
  { label: 'Cafeteria', sort_order: 3 },
  { label: 'Playground / Recess', sort_order: 4 },
  { label: 'Bus', sort_order: 5 },
  { label: 'Bus Loading Zone', sort_order: 6 },
  { label: 'Bathroom / Restroom', sort_order: 7 },
  { label: 'Office', sort_order: 8 },
  { label: 'Gym', sort_order: 9 },
  { label: 'Library', sort_order: 10 },
  { label: 'Locker Room', sort_order: 11 },
  { label: 'Parking Lot', sort_order: 12 },
  { label: 'On Field Trip', sort_order: 13 },
  { label: 'Special Event / Assembly', sort_order: 14 },
  { label: 'Other', sort_order: 15 },
  { label: 'Unknown', sort_order: 16 },
];

// SWIS canonical 7.
const MOTIVATIONS = [
  { label: 'Avoid Adult(s)', sort_order: 1 },
  { label: 'Avoid Peer(s)', sort_order: 2 },
  { label: 'Avoid Tasks/Activities', sort_order: 3 },
  { label: 'Obtain Adult Attention', sort_order: 4 },
  { label: 'Obtain Peer Attention', sort_order: 5 },
  { label: 'Obtain Items/Activities', sort_order: 6 },
  { label: "Don't Know", sort_order: 7 },
];

// SWIS canonical 7.
const OTHERS_INVOLVED = [
  { label: 'None', sort_order: 1 },
  { label: 'Peers', sort_order: 2 },
  { label: 'Staff', sort_order: 3 },
  { label: 'Teacher', sort_order: 4 },
  { label: 'Substitute', sort_order: 5 },
  { label: 'Other', sort_order: 6 },
  { label: 'Unknown', sort_order: 7 },
];

// 22 = 16 handbook §5.1 + 6 SWIS standard. is_restorative reflects the
// nature of the action, NOT the source list. Exclusionary actions (bus
// suspension, classroom exclusion / time-out), privilege removal, and
// the status placeholder "Action pending" are FALSE despite appearing
// in the SWIS standard menu alongside genuinely restorative items.
const CONSEQUENCES = [
  { label: 'Parent notification', sort_order: 1, is_restorative: false },
  { label: 'Parental conference', sort_order: 2, is_restorative: false },
  { label: 'Warning', sort_order: 3, is_restorative: false },
  { label: 'Work assignment', sort_order: 4, is_restorative: false },
  { label: 'Detention', sort_order: 5, is_restorative: false },
  { label: 'Double detention', sort_order: 6, is_restorative: false },
  { label: 'Temporary leave', sort_order: 7, is_restorative: false },
  { label: 'In-school suspension', sort_order: 8, is_restorative: false },
  { label: 'Out-of-school suspension', sort_order: 9, is_restorative: false },
  { label: 'Recommended expulsion', sort_order: 10, is_restorative: false },
  { label: 'Referral to authorities', sort_order: 11, is_restorative: false },
  { label: 'Financial restitution', sort_order: 12, is_restorative: false },
  { label: 'Conference with student', sort_order: 13, is_restorative: true },
  { label: 'Individualized instruction', sort_order: 14, is_restorative: true },
  { label: 'Restorative practice (chat / impromptu circle)', sort_order: 15, is_restorative: true },
  { label: 'Community service', sort_order: 16, is_restorative: true },
  { label: 'Restitution', sort_order: 17, is_restorative: true },
  { label: 'Loss of privilege', sort_order: 18, is_restorative: false },
  { label: 'Request for additional support', sort_order: 19, is_restorative: true },
  { label: 'Classroom exclusion / time-out', sort_order: 20, is_restorative: false },
  { label: 'Bus suspension', sort_order: 21, is_restorative: false },
  { label: 'Action pending', sort_order: 22, is_restorative: false },
];

// SWIS / handbook reportable categories.
const HARASSMENT_SUBTYPES = [
  { label: 'Gender', sort_order: 1 },
  { label: 'Physical Characteristics', sort_order: 2 },
  { label: 'Race', sort_order: 3 },
  { label: 'Religion', sort_order: 4 },
  { label: 'Sexual', sort_order: 5 },
  { label: 'Disability/Exceptionality', sort_order: 6 },
  { label: 'Ethnicity', sort_order: 7 },
  { label: 'Other', sort_order: 8 },
];

// Handbook categories.
const WEAPON_SUBTYPES = [
  { label: 'Gun', sort_order: 1 },
  { label: 'Knife > 6"', sort_order: 2 },
  { label: 'Knife < 6"', sort_order: 3 },
  { label: 'Other', sort_order: 4 },
];

// Handbook §5.1 L1/L2/L3. Attendance rows ("Excessive tardiness",
// "Truancy") are intentionally excluded — handbook defers them to the
// attendance system. managed_by mapping: L1 = staff-managed (teacher
// writes the referral, admin sees it at review); L2/L3 = admin-managed
// (immediate office routing). Schools whose policy diverges can
// override per row via the per-tenant customization UI.
const BEHAVIORS = [
  { label: 'Profanity', sort_order: 1, severity_level: 1, managed_by: 'staff' },
  { label: 'Dress code violation', sort_order: 2, severity_level: 1, managed_by: 'staff' },
  { label: 'Defiance / disrespect / insubordination', sort_order: 3, severity_level: 1, managed_by: 'staff' },
  { label: 'Forgery of school passes or excuses', sort_order: 4, severity_level: 1, managed_by: 'staff' },
  { label: 'Disorderly conduct', sort_order: 5, severity_level: 1, managed_by: 'staff' },
  { label: 'Fighting', sort_order: 6, severity_level: 2, managed_by: 'admin' },
  { label: 'Harassment', sort_order: 7, severity_level: 2, managed_by: 'admin', requires_subtype: 'harassment' },
  { label: 'Smoking on school grounds', sort_order: 8, severity_level: 2, managed_by: 'admin' },
  { label: 'Larceny', sort_order: 9, severity_level: 2, managed_by: 'admin' },
  { label: 'Refusal to abide by school rules', sort_order: 10, severity_level: 2, managed_by: 'admin' },
  { label: 'Matters of public safety', sort_order: 11, severity_level: 2, managed_by: 'admin' },
  { label: 'Disorderly conduct — threats of violence', sort_order: 12, severity_level: 2, managed_by: 'admin' },
  { label: 'Assault', sort_order: 13, severity_level: 3, managed_by: 'admin' },
  { label: 'Arson', sort_order: 14, severity_level: 3, managed_by: 'admin' },
  { label: 'Socially unaccepted / immoral behavior', sort_order: 15, severity_level: 3, managed_by: 'admin' },
  { label: 'Destruction or defacement of property', sort_order: 16, severity_level: 3, managed_by: 'admin' },
  { label: 'Use or possession of alcohol or drugs', sort_order: 17, severity_level: 3, managed_by: 'admin' },
  { label: 'Carrying a knife or weapon', sort_order: 18, severity_level: 3, managed_by: 'admin', requires_subtype: 'weapon' },
  { label: 'Bomb threat', sort_order: 19, severity_level: 3, managed_by: 'admin' },
  { label: 'Fireworks or explosive material', sort_order: 20, severity_level: 3, managed_by: 'admin' },
];

// Seeds the 7 default discipline vocab lists for a single new tenant.
// Caller MUST pass a pg client that already has an open transaction
// (BEGIN issued). This function does NOT manage transaction boundaries;
// it is intended to run inside the tenant-creation transaction so that
// any failure rolls back the tenant row alongside the partial seed.
async function seedDisciplineVocabsForTenant(client, tenantId) {
  await client.query(
    `INSERT INTO discipline_locations (tenant_id, label, sort_order)
     SELECT $1, label, sort_order
     FROM unnest($2::text[], $3::int[]) AS v(label, sort_order)
     ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING`,
    [tenantId, LOCATIONS.map((r) => r.label), LOCATIONS.map((r) => r.sort_order)]
  );

  await client.query(
    `INSERT INTO discipline_motivations (tenant_id, label, sort_order)
     SELECT $1, label, sort_order
     FROM unnest($2::text[], $3::int[]) AS v(label, sort_order)
     ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING`,
    [tenantId, MOTIVATIONS.map((r) => r.label), MOTIVATIONS.map((r) => r.sort_order)]
  );

  await client.query(
    `INSERT INTO discipline_others_involved (tenant_id, label, sort_order)
     SELECT $1, label, sort_order
     FROM unnest($2::text[], $3::int[]) AS v(label, sort_order)
     ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING`,
    [tenantId, OTHERS_INVOLVED.map((r) => r.label), OTHERS_INVOLVED.map((r) => r.sort_order)]
  );

  await client.query(
    `INSERT INTO discipline_consequences (tenant_id, label, sort_order, is_restorative)
     SELECT $1, label, sort_order, is_restorative
     FROM unnest($2::text[], $3::int[], $4::boolean[]) AS v(label, sort_order, is_restorative)
     ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING`,
    [
      tenantId,
      CONSEQUENCES.map((r) => r.label),
      CONSEQUENCES.map((r) => r.sort_order),
      CONSEQUENCES.map((r) => r.is_restorative),
    ]
  );

  await client.query(
    `INSERT INTO discipline_harassment_subtypes (tenant_id, label, sort_order)
     SELECT $1, label, sort_order
     FROM unnest($2::text[], $3::int[]) AS v(label, sort_order)
     ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING`,
    [tenantId, HARASSMENT_SUBTYPES.map((r) => r.label), HARASSMENT_SUBTYPES.map((r) => r.sort_order)]
  );

  await client.query(
    `INSERT INTO discipline_weapon_subtypes (tenant_id, label, sort_order)
     SELECT $1, label, sort_order
     FROM unnest($2::text[], $3::int[]) AS v(label, sort_order)
     ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING`,
    [tenantId, WEAPON_SUBTYPES.map((r) => r.label), WEAPON_SUBTYPES.map((r) => r.sort_order)]
  );

  await client.query(
    `INSERT INTO discipline_behaviors (tenant_id, label, sort_order, severity_level, managed_by, requires_subtype)
     SELECT $1, label, sort_order, severity_level, managed_by, requires_subtype
     FROM unnest($2::text[], $3::int[], $4::int[], $5::varchar[], $6::varchar[]) AS v(label, sort_order, severity_level, managed_by, requires_subtype)
     ON CONFLICT (tenant_id, lower(label)) WHERE is_active = TRUE DO NOTHING`,
    [
      tenantId,
      BEHAVIORS.map((r) => r.label),
      BEHAVIORS.map((r) => r.sort_order),
      BEHAVIORS.map((r) => r.severity_level),
      BEHAVIORS.map((r) => r.managed_by),
      BEHAVIORS.map((r) => r.requires_subtype || null),
    ]
  );
}

module.exports = {
  LOCATIONS,
  MOTIVATIONS,
  OTHERS_INVOLVED,
  CONSEQUENCES,
  HARASSMENT_SUBTYPES,
  WEAPON_SUBTYPES,
  BEHAVIORS,
  seedDisciplineVocabsForTenant,
};
