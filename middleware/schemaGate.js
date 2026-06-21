// Boot-time schema assertion (migration-apply gate).
//
// The createTables() bootstrap in server.js only covers migrations 007-022.
// Every migration from 023 onward is applied by hand (psql \i) with no ledger,
// so a deploy can ship code that depends on a relation/column the DB never got
// (the M049 / M035 prod 500s). This module is the gate: it reads — never
// writes — whether each HARD dependency of the currently-deployed code exists,
// logs a single-line MIGRATION GAP banner to the SERVER LOGS if any are absent,
// and flips an internal flag that /health reads to report 'degraded'. It never
// process.exit()s.
//
// Extracted from server.js so the gate is unit-testable with a fake pool/logger
// instead of a live database.

// EXPECTED_SCHEMA: one literal entry per migration whose objects the live route
// code depends on. Adding a future migration is one obvious reviewable line.
// Migrations that create several objects atomically (e.g. M036's 9 discipline
// tables) are represented by their most-referenced relation — if the migration
// was skipped, that representative is absent too.
const EXPECTED_SCHEMA = [
  { migration: '028', table: 'districts' },                            // routes/districtAccess — scope resolution
  { migration: '028', table: 'user_school_access' },                   // middleware/resolveAccessibleTenantIds
  { migration: '031', table: 'user_school_access_audit' },             // cascade-audit trigger target
  { migration: '035', table: 'students', column: 'external_id' },      // student import upsert (prior known skip)
  { migration: '036', table: 'discipline_referrals' },                 // routes/disciplineReferrals (+8 lookups co-ship)
  { migration: '038', table: 'mtss_coordinators' },                    // routes/mtssCoordinators
  { migration: '039', table: 'mtss_coordinators_audit' },              // mtss-coordinator audit trigger target
  { migration: '041', table: 'ea_caseload_students' },                 // routes/eaCaseload (+audit co-ships)
  { migration: '042', table: 'student_race_ethnicity' },               // demographics read/write (+audit, students cols co-ship)
  { migration: '044', table: 'students', column: 'enrollment_status' },// student list/filter queries
  { migration: '045', table: 'student_grade_rollup_runs' },            // routes/studentGradeRollup (+event_rows co-ship)
  { migration: '046', table: 'user_role_change_audit' },               // role-change write path
  { migration: '047', table: 'staff_import_audit' },                   // staff import commit
  { migration: '048', table: 'student_import_audit' },                 // student import commit
  { migration: '049', table: 'screener_reset_audit' },                 // screener-reset (the gap that 500'd)
];

// Module-level health flag. Defaults to healthy and is only flipped by a
// conclusive "relation missing" result, not by a probe that failed to run.
let schemaDegraded = false;

const assertExpectedSchema = async (pool, logger = console) => {
  try {
    const missing = [];
    for (const item of EXPECTED_SCHEMA) {
      if (item.column) {
        const { rows } = await pool.query(
          `SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2`,
          [item.table, item.column]
        );
        if (rows.length === 0) missing.push(`M${item.migration}:${item.table}.${item.column}`);
      } else {
        const { rows } = await pool.query('SELECT to_regclass($1) AS reg', [`public.${item.table}`]);
        if (!rows[0].reg) missing.push(`M${item.migration}:${item.table}`);
      }
    }

    if (missing.length > 0) {
      schemaDegraded = true;
      // Loud, single-line banner to SERVER LOGS ONLY (never the /health body).
      logger.error(`MIGRATION GAP: missing [${missing.join(', ')}] — apply the corresponding migration-0XX.sql to this database before relying on the affected feature`);
    } else {
      logger.log('Schema assertion: all expected migration relations present');
    }
  } catch (error) {
    // An assertion that cannot run (transient DB error) is inconclusive, not a
    // detected gap: log it but do NOT flip /health degraded on a probe failure.
    logger.error('Schema assertion could not run:', error.message);
  }
};

const isSchemaDegraded = () => schemaDegraded;

// Sole constructor of the public /health body. It takes ONLY (degraded, time)
// and so structurally cannot contain relation names — the detailed missing list
// stays in the server logs. Keeping this the one place the body is built locks
// the info-leak contract.
const buildHealthBody = (degraded, time) => ({
  status: degraded ? 'degraded' : 'healthy',
  database: 'connected',
  time,
});

// Test-only seam: schemaDegraded is a process-lifetime singleton, so tests must
// reset it between cases. Not used by production code.
const __resetSchemaGateForTest = () => { schemaDegraded = false; };

module.exports = {
  EXPECTED_SCHEMA,
  assertExpectedSchema,
  isSchemaDegraded,
  buildHealthBody,
  __resetSchemaGateForTest,
};
