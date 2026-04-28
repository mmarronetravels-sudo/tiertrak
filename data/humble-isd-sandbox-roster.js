/**
 * Humble ISD Sandbox Roster — synthetic data for the demo tenant
 *
 * Source of truth for the data inserted by `scripts/seed-humble-isd-sandbox.js`.
 *
 * EVERY identifier in this file is fictional. The student names and TX-DEMO-NNN
 * IDs come from the synthetic Texas demo kit at
 *   /Users/melaniemarrone/Documents/Claude/Humble ISD/Screener Templates/
 * and represent no real person. The synthetic district `Humble ISD Demo`
 * uses the email domain `humble.edu` — that domain is intentionally fictional
 * (the real Humble ISD uses humbleisd.net). No real PII is stored here.
 *
 * The TX-DEMO-NNN external IDs do NOT round-trip into the database — the
 * `students` table has no external_id column. They are kept here only as a
 * cross-reference comment so future operators can match this roster to the
 * Texas screener CSVs at upload time.
 *
 * Schema constraints honored:
 *   - users.role         CHECK ('district_admin', 'counselor', 'teacher',
 *                                'student_support_specialist', 'parent', ...)
 *   - students.tier      CHECK (1, 2, 3)
 *   - students.area      CHECK ('Behavior', 'Academic', 'Social-Emotional')
 *   - students.risk_level CHECK ('low', 'moderate', 'high')
 *   - student_interventions.status CHECK ('active', 'completed',
 *                                         'discontinued', 'archived')
 *   - parent_student_links has NO tenant_id column (known followup; do not
 *     add one here).
 *   - school_wide_access mirrors routes/staffManagement.js:68 conventions.
 */

const TENANT = {
  name: 'Humble ISD Demo',
  type: 'district',
  subdomain: 'humble-isd-demo',
};

const ADMINS = [
  { email: 'demo1@humble.edu', full_name: 'Demo Admin One' },
  { email: 'demo2@humble.edu', full_name: 'Demo Admin Two' },
];

const STAFF = [
  {
    email: 'counselor@humble.edu',
    full_name: 'Sam Carter',
    role: 'counselor',
    school_wide_access: true,
  },
  {
    email: 'interventionist@humble.edu',
    full_name: 'Jordan Reeves',
    role: 'student_support_specialist',
    school_wide_access: true,
  },
  {
    email: 'teacher@humble.edu',
    full_name: 'Taylor Brooks',
    role: 'teacher',
    school_wide_access: false,
  },
  {
    email: 'parent@humble.edu',
    full_name: 'Casey Juárez',
    role: 'parent',
    school_wide_access: false,
  },
];

const STUDENTS = [
  // Tier 3 — high need, mixed campus
  { external_id: 'TX-DEMO-006', first_name: 'Finn',     last_name: 'Flores',    grade: '2', campus: 'Pecan Grove Elementary',     tier: 3, area: 'Academic',         risk_level: 'high'     },
  { external_id: 'TX-DEMO-010', first_name: 'Joaquín',  last_name: 'Juárez',    grade: '4', campus: 'Pecan Grove Elementary',     tier: 3, area: 'Academic',         risk_level: 'high'     },
  { external_id: 'TX-DEMO-016', first_name: 'Paolo',    last_name: 'Peña',      grade: '7', campus: 'Cypress Crossing Middle School', tier: 3, area: 'Academic',     risk_level: 'high'     },
  // Tier 2 — moderate need
  { external_id: 'TX-DEMO-002', first_name: 'Beck',     last_name: 'Bautista',  grade: 'K', campus: 'Pecan Grove Elementary',     tier: 2, area: 'Academic',         risk_level: 'moderate' },
  { external_id: 'TX-DEMO-004', first_name: 'Devon',    last_name: 'Delgado',   grade: '1', campus: 'Pecan Grove Elementary',     tier: 2, area: 'Academic',         risk_level: 'moderate' },
  { external_id: 'TX-DEMO-008', first_name: 'Hudson',   last_name: 'Herrera',   grade: '3', campus: 'Pecan Grove Elementary',     tier: 2, area: 'Behavior',         risk_level: 'moderate' },
  { external_id: 'TX-DEMO-012', first_name: 'Luis',     last_name: 'Linares',   grade: '5', campus: 'Pecan Grove Elementary',     tier: 2, area: 'Academic',         risk_level: 'moderate' },
  { external_id: 'TX-DEMO-013', first_name: 'Maya',     last_name: 'Mendoza',   grade: '6', campus: 'Cypress Crossing Middle School', tier: 2, area: 'Social-Emotional', risk_level: 'moderate' },
  { external_id: 'TX-DEMO-014', first_name: 'Nico',     last_name: 'Navarro',   grade: '6', campus: 'Cypress Crossing Middle School', tier: 2, area: 'Behavior',     risk_level: 'moderate' },
  { external_id: 'TX-DEMO-018', first_name: 'Reyna',    last_name: 'Ramírez',   grade: '8', campus: 'Cypress Crossing Middle School', tier: 2, area: 'Academic',     risk_level: 'moderate' },
  // Tier 1 — on track
  { external_id: 'TX-DEMO-001', first_name: 'Adriana',  last_name: 'Acosta',    grade: 'K', campus: 'Pecan Grove Elementary',     tier: 1, area: 'Academic',         risk_level: 'low'      },
  { external_id: 'TX-DEMO-003', first_name: 'Camila',   last_name: 'Castillo',  grade: '1', campus: 'Pecan Grove Elementary',     tier: 1, area: 'Academic',         risk_level: 'low'      },
  { external_id: 'TX-DEMO-005', first_name: 'Emilia',   last_name: 'Espinoza',  grade: '2', campus: 'Pecan Grove Elementary',     tier: 1, area: 'Academic',         risk_level: 'low'      },
  { external_id: 'TX-DEMO-007', first_name: 'Gabriela', last_name: 'Garza',     grade: '3', campus: 'Pecan Grove Elementary',     tier: 1, area: 'Academic',         risk_level: 'low'      },
  { external_id: 'TX-DEMO-009', first_name: 'Iris',     last_name: 'Ibañez',    grade: '4', campus: 'Pecan Grove Elementary',     tier: 1, area: 'Academic',         risk_level: 'low'      },
  { external_id: 'TX-DEMO-011', first_name: 'Kaylee',   last_name: 'Khan',      grade: '5', campus: 'Pecan Grove Elementary',     tier: 1, area: 'Academic',         risk_level: 'low'      },
  { external_id: 'TX-DEMO-015', first_name: 'Olympia',  last_name: 'Ortiz',     grade: '7', campus: 'Cypress Crossing Middle School', tier: 1, area: 'Academic',     risk_level: 'low'      },
  { external_id: 'TX-DEMO-017', first_name: 'Quincy',   last_name: 'Quiñonez',  grade: '8', campus: 'Cypress Crossing Middle School', tier: 1, area: 'Academic',     risk_level: 'low'      },
];

// Intervention assignments — Tier 2 + Tier 3 only. Tier 1 students are clean.
// `template_name` must match an `intervention_templates.name` row where
// tenant_id IS NULL (i.e., a system-default template). All names below come
// from the default set inserted by schema.sql:80-95 and migrations 003-005.
// `start_age_days` is the number of days before today; the seed SQL computes
// start_date = CURRENT_DATE - start_age_days at run time, so the data ages
// gracefully if the seed is re-run weeks later. Spread runs roughly 6-13
// weeks back to give a realistic interventions-in-flight mix.
const INTERVENTIONS = [
  // Tier 2
  { student_external_id: 'TX-DEMO-002', template_name: 'Phonics Intervention',     assigned_by_email: 'counselor@humble.edu',       progress: 35, start_age_days: 64, notes: 'Twice-weekly small group with phonemic awareness focus.' },
  { student_external_id: 'TX-DEMO-004', template_name: 'Small Group Instruction',  assigned_by_email: 'counselor@humble.edu',       progress: 40, start_age_days: 78, notes: 'Reading group at level A. 3x weekly during literacy block.' },
  { student_external_id: 'TX-DEMO-008', template_name: 'Check-in/Check-out',       assigned_by_email: 'counselor@humble.edu',       progress: 55, start_age_days: 85, notes: 'Daily morning check-in and afternoon check-out with classroom teacher.' },
  { student_external_id: 'TX-DEMO-012', template_name: 'Small Group Instruction',  assigned_by_email: 'interventionist@humble.edu', progress: 50, start_age_days: 71, notes: 'Math fluency small group. 4x weekly, 25 min per session.' },
  { student_external_id: 'TX-DEMO-013', template_name: 'Social Skills Group',      assigned_by_email: 'counselor@humble.edu',       progress: 45, start_age_days: 57, notes: 'Weekly counselor-led group focused on conflict resolution and peer relationships.' },
  { student_external_id: 'TX-DEMO-014', template_name: 'Self-Monitoring Checklist', assigned_by_email: 'interventionist@humble.edu', progress: 30, start_age_days: 43, notes: 'Daily on-task self-monitoring across 5 class periods. Weekly review with interventionist.' },
  { student_external_id: 'TX-DEMO-018', template_name: 'Mentor Program',           assigned_by_email: 'interventionist@humble.edu', progress: 60, start_age_days: 92, notes: 'Weekly mentor meetings focused on academic organization and goal-setting.' },
  // Tier 3 — all three Academic students use a Tier 2 academic template at
  // intensive (Tier 3) frequency, per demo design. Notes flag intensive delivery.
  { student_external_id: 'TX-DEMO-006', template_name: 'Phonics Intervention',     assigned_by_email: 'interventionist@humble.edu', progress: 30, start_age_days: 78, notes: 'Daily 1:1 intensive phonics, 30 min. Targeted CVC + digraph practice.' },
  { student_external_id: 'TX-DEMO-010', template_name: 'Small Group Instruction',  assigned_by_email: 'interventionist@humble.edu', progress: 25, start_age_days: 78, notes: 'Daily 1:3 intensive reading group, 45 min. Below grade-level passage work + family reading routine.' },
  { student_external_id: 'TX-DEMO-016', template_name: 'Small Group Instruction',  assigned_by_email: 'interventionist@humble.edu', progress: 20, start_age_days: 64, notes: 'Daily 1:3 intensive reading group, 45 min. Grade-level passage comprehension + tier-2 vocabulary.' },
];

// Progress notes — 2 per Tier 2 student (14), 3 per Tier 3 student (9). Total 23.
// Authored by the staff member who assigned the intervention. created_at is
// set to a realistic timestamp via the seed SQL (CURRENT_TIMESTAMP minus
// per-note offset).
const PROGRESS_NOTES = [
  // Beck Bautista (T2 K Phonics, by counselor)
  { student_external_id: 'TX-DEMO-002', author_email: 'counselor@humble.edu', age_days: 14, note: 'Beck recognized 18/26 letter sounds today during phonics warmup. Up from 14 last week.' },
  { student_external_id: 'TX-DEMO-002', author_email: 'counselor@humble.edu', age_days: 4,  note: 'Worked on CVC blending — completed 6 of 10 cards correctly. Encouraged use of finger-tracking strategy.' },
  // Devon Delgado (T2 1 Small Group, by counselor)
  { student_external_id: 'TX-DEMO-004', author_email: 'counselor@humble.edu', age_days: 17, note: 'Joined small group at table 3 today. Read level-A book with one prompt. Engaged throughout.' },
  { student_external_id: 'TX-DEMO-004', author_email: 'counselor@humble.edu', age_days: 6,  note: 'Sight word check: 22/40 correct. Will revisit the/of/to/in next session.' },
  // Hudson Herrera (T2 3 Check-in/Check-out, by counselor)
  { student_external_id: 'TX-DEMO-008', author_email: 'counselor@humble.edu', age_days: 12, note: 'Morning check-in went well. Hudson stated his goal: stay seated during reading block.' },
  { student_external_id: 'TX-DEMO-008', author_email: 'counselor@humble.edu', age_days: 3,  note: 'Afternoon check-out: 4 of 5 daily goals met. One disruption logged during transition to lunch.' },
  // Luis Linares (T2 5 Small Group, by interventionist)
  { student_external_id: 'TX-DEMO-012', author_email: 'interventionist@humble.edu', age_days: 18, note: 'Math fluency probe: 28/40 in 3 minutes. Up 6 from last probe.' },
  { student_external_id: 'TX-DEMO-012', author_email: 'interventionist@humble.edu', age_days: 5,  note: 'Worked on multi-digit subtraction with regrouping. Two-step word problems still a struggle.' },
  // Maya Mendoza (T2 6 Social Skills, by counselor)
  { student_external_id: 'TX-DEMO-013', author_email: 'counselor@humble.edu', age_days: 15, note: 'Participated in conflict-resolution role-play. Volunteered to lead the I-statement practice round.' },
  { student_external_id: 'TX-DEMO-013', author_email: 'counselor@humble.edu', age_days: 2,  note: 'Reported difficulty with peer at lunch yesterday. Practiced calm-down strategy together.' },
  // Nico Navarro (T2 6 Self-Monitoring, by interventionist)
  { student_external_id: 'TX-DEMO-014', author_email: 'interventionist@humble.edu', age_days: 11, note: 'Self-monitored on-task behavior during 4 of 5 class periods. Total checks: 31/40.' },
  { student_external_id: 'TX-DEMO-014', author_email: 'interventionist@humble.edu', age_days: 4,  note: 'Reviewed yesterday’s checklist. Nico noticed a pattern of off-task during note-taking.' },
  // Reyna Ramírez (T2 8 Mentor, by interventionist)
  { student_external_id: 'TX-DEMO-018', author_email: 'interventionist@humble.edu', age_days: 21, note: 'Met with mentor for 25 minutes. Discussed upcoming science project deadline.' },
  { student_external_id: 'TX-DEMO-018', author_email: 'interventionist@humble.edu', age_days: 7,  note: 'Reviewed organizational checklist. Reyna brought planner to all classes today.' },
  // Finn Flores (T3 2 Phonics intensive, by interventionist) — 3 notes
  { student_external_id: 'TX-DEMO-006', author_email: 'interventionist@humble.edu', age_days: 19, note: 'Daily intensive phonics: 30 min targeted CVC + digraph practice. Mastery: 12/20.' },
  { student_external_id: 'TX-DEMO-006', author_email: 'interventionist@humble.edu', age_days: 9,  note: 'Decoded short-vowel CVC words at 60% accuracy. Up from 45% baseline.' },
  { student_external_id: 'TX-DEMO-006', author_email: 'interventionist@humble.edu', age_days: 1,  note: 'Letter-sound fluency probe: 35 sounds/min. Goal is 42 by end of grading period.' },
  // Joaquín Juárez (T3 4 Small Group intensive, by interventionist) — 3 notes
  { student_external_id: 'TX-DEMO-010', author_email: 'interventionist@humble.edu', age_days: 16, note: 'Daily intensive 1:3 group. Reading-level probe: instructional level moved from 1.8 to 2.1.' },
  { student_external_id: 'TX-DEMO-010', author_email: 'interventionist@humble.edu', age_days: 8,  note: 'Worked on context-clue strategy with leveled passage. Completed 4/5 inference questions.' },
  { student_external_id: 'TX-DEMO-010', author_email: 'interventionist@humble.edu', age_days: 2,  note: 'Family contacted re: at-home reading log. Casey confirmed nightly 15-min reading routine in place.' },
  // Paolo Peña (T3 7 Small Group intensive, by interventionist) — 3 notes
  { student_external_id: 'TX-DEMO-016', author_email: 'interventionist@humble.edu', age_days: 13, note: 'Intensive small-group reading. Grade-level passage comprehension: 3 of 8 questions correct.' },
  { student_external_id: 'TX-DEMO-016', author_email: 'interventionist@humble.edu', age_days: 6,  note: 'Vocabulary-in-context work. Paolo identified definitions for 6 of 10 academic-tier-2 words.' },
  { student_external_id: 'TX-DEMO-016', author_email: 'interventionist@humble.edu', age_days: 1,  note: 'Targeted text-structure practice. Cause-and-effect signal words mastered; sequence still emerging.' },
];

// Parent-to-student link. parent_student_links has NO tenant_id column.
const PARENT_LINK = {
  parent_email: 'parent@humble.edu',
  student_external_id: 'TX-DEMO-010', // Joaquín Juárez (T3 Academic, Grade 4)
  relationship: 'parent',
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
