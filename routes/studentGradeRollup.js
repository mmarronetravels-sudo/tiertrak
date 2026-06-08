// routes/studentGradeRollup.js — EOY student grade roll-up endpoints.
//
// Three endpoints, all role-gated to ROLLUP_ROLES (district_admin +
// school_admin per constants/roles.js). Scope of authority per caller
// is determined by resolveAccessibleTenantIds at the per-endpoint
// scope check — see §5 / criterion 4 below:
//
//   POST /api/student-grade-rollup/preview
//     Read-only. Classifies every active student at the target school
//     into promote / graduate / unclassified buckets relative to a
//     terminal_grade. Returns counts + an HMAC-signed preview_token
//     that binds the (school, terminal, exits, snapshot) tuple for 15
//     minutes. Commits nothing.
//
//   POST /api/student-grade-rollup/commit
//     Body is just { preview_token }. The token's payload is the SOLE
//     source of truth for target_school_tenant_id, terminal_grade, and
//     the exit set — body fields with those names are ignored. Re-runs
//     the preview SELECT, recomputes the snapshot hash, and refuses
//     (409) if the school's state has drifted since /preview was
//     issued. Then writes promotions / graduations / exits to
//     students.{grade,enrollment_status,exit_reason,exit_date} and
//     records the run header + per-student child rows in the
//     student_grade_rollup_runs / student_grade_rollup_event_rows M045
//     audit tables. One transaction; transaction-local
//     set_config('app.actor_user_id', ...) for cascade-trigger
//     attribution parity with M032/M033 sites.
//
//   POST /api/student-grade-rollup/undo/:runId
//     Reverses a previous run. For each child row, reads the student's
//     current state; if it matches the post-rollup state we wrote,
//     reverts to the pre-rollup state; if it diverged (mid-year edit
//     between commit and undo), the student is skipped and reported.
//     Never clobbers a mid-year edit.
//
// §5 contract criteria enforced (numbered to match the design review):
//   1. Header scope is derived from the helper-resolved target +
//      target school's own row, NEVER from req.user or req.body.
//   2. Child rows inherit scope from the header in-transaction.
//   3. preview_token payload carries target_school_tenant_id so a
//      school-A preview cannot commit against school B even if the
//      operator's accessible-set spans both.
//   4. Every read SELECT scopes on tenant_id (single integer, not
//      ANY($::int[])) — the roll-up targets exactly one school at a
//      time by design.
//   5. /undo resolves scope against the run header's stored
//      target_school_tenant_id, not the request body. Out-of-scope
//      returns 404 (existence-disclosure doctrine, matches
//      routes/students.js:931-983 archive endpoint), not 403; 403 is
//      reserved for the role-gate failure.
//
// §4B PII posture: no PII fields in request bodies, response bodies,
// or log lines. Student IDs in /preview unclassified + /undo skipped
// arrays are tenant-internal integers, not PII (consistent with
// routes/disciplineReferrals.js precedent + memory
// project_followup_disciplineReferrals_students_lookup_tighten
// reasoning). Error bodies are generic strings — no exit_reason echo,
// no terminal_grade echo, no error.message leakage (the redaction
// pattern, NOT the routes/students.js error.message leak pattern
// flagged in Followup #239).
//
// Environment requirement: PREVIEW_TOKEN_SECRET must be set in
// production. Fail-fast at first call via getPreviewTokenSecret()
// mirrors the getCsrfSecret() / getLogIpPepper() pattern in
// middleware/csrfProtection.js and middleware/rateLimiters.js.

const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const { requireAuth } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { rollupOperationLimiter, isProdLike } = require('../middleware/rateLimiters');
const {
  GRADE_SEQUENCE,
  EXIT_REASONS,
  classifyTransition,
} = require('../constants/gradeProgression');
const { ROLLUP_ROLES } = require('../constants/roles');

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ---------------------------------------------------------------------
// PREVIEW_TOKEN_SECRET — required in prod; dev falls back to a constant
// with a startup warning. Validated lazily on first use.
// ---------------------------------------------------------------------
const DEV_PREVIEW_SECRET = 'dev-preview-token-secret-not-for-prod';
let cachedPreviewSecret;
let previewSecretValidated = false;

function getPreviewTokenSecret() {
  if (previewSecretValidated) return cachedPreviewSecret;
  previewSecretValidated = true;

  const secret = process.env.PREVIEW_TOKEN_SECRET;
  if (!secret) {
    if (isProdLike()) {
      console.error(
        'FATAL: PREVIEW_TOKEN_SECRET must be set in production. ' +
        'Aborting startup.'
      );
      process.exit(1);
    }
    console.warn(
      '[preview-token-secret] PREVIEW_TOKEN_SECRET not set; using ' +
      'constant fallback. dev-only — do not use in prod.'
    );
    cachedPreviewSecret = DEV_PREVIEW_SECRET;
    return cachedPreviewSecret;
  }
  cachedPreviewSecret = secret;
  return cachedPreviewSecret;
}

const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

// HMAC-SHA256 over base64url(JSON(payload)), returns "<payload>.<sig>".
function issuePreviewToken(payload) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getPreviewTokenSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

// Returns { ok: true, payload } | { ok: false, status, body }.
function verifyPreviewToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, status: 401, body: { error: 'Invalid preview token' } };
  }
  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot === token.length - 1) {
    return { ok: false, status: 401, body: { error: 'Invalid preview token' } };
  }
  const payloadB64 = token.slice(0, dot);
  const sigStr = token.slice(dot + 1);
  const expectedSig = crypto
    .createHmac('sha256', getPreviewTokenSecret())
    .update(payloadB64)
    .digest('base64url');
  // Explicit 'utf8' on both sides: sigStr arrived via token.slice (utf8
  // string in memory); expectedSig is digest('base64url') (ASCII string).
  // Comparing the utf8-byte forms of two ASCII base64url strings is
  // semantically correct and length-safe; the explicit encoding makes
  // the intent unambiguous to readers and forecloses any future
  // refactor accidentally redefining the default.
  const sigBuf = Buffer.from(sigStr, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, status: 401, body: { error: 'Invalid preview token' } };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    return { ok: false, status: 401, body: { error: 'Invalid preview token' } };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, status: 401, body: { error: 'Invalid preview token' } };
  }
  if (typeof payload.expires_at !== 'number' || payload.expires_at < Date.now()) {
    return { ok: false, status: 410, body: { error: 'Preview token expired' } };
  }
  return { ok: true, payload };
}

// ---------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

// Validates the exits array shape. Returns { ok: true, exits } where
// exits is a normalized [{ student_id, exit_reason }, …] (sorted by
// student_id for snapshot stability), OR { ok: false, status, body }.
function validateExitsShape(rawExits) {
  if (rawExits === undefined || rawExits === null) {
    return { ok: true, exits: [] };
  }
  if (!Array.isArray(rawExits)) {
    return { ok: false, status: 400, body: { error: 'Invalid exits' } };
  }
  const seen = new Set();
  const normalized = [];
  for (const item of rawExits) {
    if (!item || typeof item !== 'object') {
      return { ok: false, status: 400, body: { error: 'Invalid exits' } };
    }
    if (!isPositiveInt(item.student_id)) {
      return { ok: false, status: 400, body: { error: 'Invalid exits' } };
    }
    if (typeof item.exit_reason !== 'string' || !EXIT_REASONS.includes(item.exit_reason)) {
      return { ok: false, status: 400, body: { error: 'Invalid exit_reason' } };
    }
    if (seen.has(item.student_id)) {
      return { ok: false, status: 400, body: { error: 'Invalid exits' } };
    }
    seen.add(item.student_id);
    normalized.push({ student_id: item.student_id, exit_reason: item.exit_reason });
  }
  normalized.sort((a, b) => a.student_id - b.student_id);
  return { ok: true, exits: normalized };
}

// Look up the target school's tenants row. Returns
// { ok: true, district_id } | { ok: false, status, body }.
// district_id is INTEGER NOT NULL on the M045 header — single-school
// (non-district) tenants are excluded. Returns 400 in that case rather
// than NULL-out the header column.
async function lookupTargetSchool(targetTenantId) {
  const { rows } = await pool.query(
    "SELECT id, district_id FROM tenants WHERE id = $1 AND type = 'school'",
    [targetTenantId]
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Target school not found' } };
  }
  if (rows[0].district_id === null || rows[0].district_id === undefined) {
    return { ok: false, status: 400, body: { error: 'Target school has no district' } };
  }
  return { ok: true, district_id: rows[0].district_id };
}

// Stable snapshot hash. Input is a canonical-ordered string of the
// (school, terminal, sorted students-with-grades, sorted exits) tuple.
// Snapshot identity covers every field that, if changed mid-window,
// would invalidate the preview's promised post-state.
function computeSnapshotHash({ targetTenantId, terminalGrade, studentsRows, exits }) {
  const studentsPart = studentsRows
    .map((r) => `${r.id}:${r.grade}`)
    .sort()
    .join(',');
  const exitsPart = exits
    .map((e) => `${e.student_id}:${e.exit_reason}`)
    .join(',');
  const canonical = [
    `s=${targetTenantId}`,
    `t=${terminalGrade}`,
    `r=${studentsPart}`,
    `x=${exitsPart}`,
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// Returns { studentsRows, buckets, exits, toGraduateCount, unclassified }.
// studentsRows is the raw SELECT result (used for hash). buckets groups
// promotions by from-grade: { promote: { 'K': [id,…], '1st': [id,…] }, graduate: [id,…] }.
// exits is the validated input (already normalized + sorted).
// unclassified is [{ id, grade }, …].
function classifyAll(studentsRows, terminalGrade, exits) {
  const exitIds = new Set(exits.map((e) => e.student_id));
  const buckets = { promote: {}, graduate: [] };
  const unclassified = [];
  let toGraduateCount = 0;

  for (const row of studentsRows) {
    if (exitIds.has(row.id)) continue; // exits are operator-flagged, not auto-classified
    const { action, newGrade } = classifyTransition(row.grade, terminalGrade);
    if (action === 'unclassified') {
      unclassified.push({ id: row.id, grade: row.grade });
    } else if (action === 'graduate') {
      buckets.graduate.push(row.id);
      toGraduateCount++;
    } else {
      // promote
      if (!buckets.promote[row.grade]) buckets.promote[row.grade] = [];
      buckets.promote[row.grade].push(row.id);
    }
  }
  return { buckets, exits, toGraduateCount, unclassified };
}

// ---------------------------------------------------------------------
// POST /preview — read-only
// ---------------------------------------------------------------------
router.post('/preview', requireAuth, async (req, res) => {
  // Role gate FIRES BEFORE body parse (memory:
  // feedback_role_gate_before_input_parse_sweep). ROLLUP_ROLES
  // (district_admin + school_admin); scope is enforced separately at
  // the resolveAccessibleTenantIds check below.
  if (!ROLLUP_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    const { target_tenant_id, terminal_grade, exits: rawExits } = req.body || {};

    // target_tenant_id REQUIRED — no fallback to req.user.tenant_id.
    // A bulk grade write must consciously name its school. Refinement #3.
    if (!isPositiveInt(target_tenant_id)) {
      return res.status(400).json({ error: 'target_tenant_id is required' });
    }

    if (typeof terminal_grade !== 'string' || !GRADE_SEQUENCE.includes(terminal_grade)) {
      return res.status(400).json({ error: 'Invalid terminal_grade' });
    }

    const exitsCheck = validateExitsShape(rawExits);
    if (!exitsCheck.ok) {
      return res.status(exitsCheck.status).json(exitsCheck.body);
    }
    const exits = exitsCheck.exits;

    // Scope check via the §5 helper — never inlined.
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(target_tenant_id)) {
      return res.status(403).json({ error: 'Not authorized for target tenant' });
    }

    // Refinement #1: district_id comes from the target school's row,
    // NOT from req.user.district_id. A district_admin could (in theory)
    // have user_school_access into a school in a different district; we
    // trust the school's own district_id for the header provenance.
    const schoolLookup = await lookupTargetSchool(target_tenant_id);
    if (!schoolLookup.ok) {
      return res.status(schoolLookup.status).json(schoolLookup.body);
    }
    const districtId = schoolLookup.district_id;

    // Preview scan — school-scoped, single integer (criterion 4).
    const { rows: studentsRows } = await pool.query(
      `SELECT id, grade
         FROM students
        WHERE tenant_id = $1
          AND archived = FALSE
          AND enrollment_status = 'active'
        ORDER BY id`,
      [target_tenant_id]
    );

    // Every exit must reference a student in the preview set. An exit
    // referring to an archived / graduated / cross-tenant student
    // implies operator error or a probe.
    const previewIds = new Set(studentsRows.map((r) => r.id));
    for (const ex of exits) {
      if (!previewIds.has(ex.student_id)) {
        return res.status(400).json({ error: 'Exit refers to unknown student' });
      }
    }

    const { buckets, toGraduateCount, unclassified } = classifyAll(
      studentsRows,
      terminal_grade,
      exits
    );

    // transition_counts is the operator-facing summary: per from-grade
    // promote count, plus the graduate count. Keys are deterministic
    // strings the FE can render in GRADE_SEQUENCE order.
    const transitionCounts = {};
    for (const grade of GRADE_SEQUENCE) {
      const count = (buckets.promote[grade] && buckets.promote[grade].length) || 0;
      if (count > 0) {
        const next = grade === terminal_grade ? 'graduate' : null;
        transitionCounts[`${grade}_to_${next || 'next'}`] = count;
      }
    }

    const previewSnapshotHash = computeSnapshotHash({
      targetTenantId: target_tenant_id,
      terminalGrade: terminal_grade,
      studentsRows,
      exits,
    });

    const issuedAt = Date.now();
    const expiresAt = issuedAt + PREVIEW_TOKEN_TTL_MS;
    const previewToken = issuePreviewToken({
      target_school_tenant_id: target_tenant_id,
      district_id: districtId,
      terminal_grade,
      exits,
      preview_snapshot_hash: previewSnapshotHash,
      issued_at: issuedAt,
      expires_at: expiresAt,
    });

    return res.json({
      target_tenant_id,
      terminal_grade,
      transition_counts: transitionCounts,
      to_graduate_count: toGraduateCount,
      exits,
      unclassified,
      preview_token: previewToken,
      expires_at: expiresAt,
    });
  } catch (err) {
    // No error.message leak — generic 500 (Followup #239 pattern,
    // NOT the routes/students.js error.message leak pattern).
    console.error('[student-grade-rollup:preview]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------
// POST /commit — token-bound
// ---------------------------------------------------------------------
router.post('/commit', requireAuth, rollupOperationLimiter, async (req, res) => {
  if (!ROLLUP_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { preview_token } = req.body || {};
  const verify = verifyPreviewToken(preview_token);
  if (!verify.ok) {
    return res.status(verify.status).json(verify.body);
  }
  const { payload } = verify;

  // Defensive: every payload field the commit consumes must be present
  // and well-typed. Tokens we issued always satisfy this, but verify
  // shouldn't trust the structure beyond signature integrity.
  if (
    !isPositiveInt(payload.target_school_tenant_id) ||
    !isPositiveInt(payload.district_id) ||
    typeof payload.terminal_grade !== 'string' ||
    !GRADE_SEQUENCE.includes(payload.terminal_grade) ||
    !Array.isArray(payload.exits) ||
    typeof payload.preview_snapshot_hash !== 'string'
  ) {
    return res.status(401).json({ error: 'Invalid preview token' });
  }
  // Re-validate exits against EXIT_REASONS — don't trust the token to
  // hold a current allowlist value if EXIT_REASONS ever narrows.
  const exitsCheck = validateExitsShape(payload.exits);
  if (!exitsCheck.ok) {
    return res.status(401).json({ error: 'Invalid preview token' });
  }
  const exits = exitsCheck.exits;
  const targetTenantId = payload.target_school_tenant_id;
  const terminalGrade = payload.terminal_grade;

  // Criterion 5 re-check: even with a valid token, the operator must
  // still be in scope. Defends against the school-A-preview-replayed-
  // to-school-B attack (case #11 in the smoke matrix).
  let accessible;
  try {
    accessible = await resolveAccessibleTenantIds(req.user);
  } catch (err) {
    console.error('[student-grade-rollup:commit]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
  if (!accessible.includes(targetTenantId)) {
    return res.status(403).json({ error: 'Not authorized for target tenant' });
  }

  // Re-derive district_id from the target school's row in case it has
  // moved between /preview and /commit (rare; this catches it cleanly).
  const schoolLookup = await lookupTargetSchool(targetTenantId);
  if (!schoolLookup.ok) {
    return res.status(schoolLookup.status).json(schoolLookup.body);
  }
  const districtId = schoolLookup.district_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // GUC actor binding — precedent at routes/eaCaseload.js:275-277.
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(req.user.id)]
    );

    // Re-run preview SELECT inside the transaction. The pool query in
    // preview is at READ COMMITTED; this client's SELECT is too, but
    // by the time we INSERT/UPDATE below we hold row-level locks via
    // the UPDATEs themselves. We do NOT add a SELECT FOR UPDATE here
    // because the snapshot hash is what binds the in-window state —
    // a divergent state surfaces as 409 (snapshot stale) and the
    // operator re-previews.
    const { rows: studentsRows } = await client.query(
      `SELECT id, grade
         FROM students
        WHERE tenant_id = $1
          AND archived = FALSE
          AND enrollment_status = 'active'
        ORDER BY id`,
      [targetTenantId]
    );

    const previewIds = new Set(studentsRows.map((r) => r.id));
    for (const ex of exits) {
      if (!previewIds.has(ex.student_id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Preview snapshot stale' });
      }
    }

    const currentHash = computeSnapshotHash({
      targetTenantId,
      terminalGrade,
      studentsRows,
      exits,
    });
    if (currentHash !== payload.preview_snapshot_hash) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Preview snapshot stale' });
    }

    const { buckets, unclassified } = classifyAll(studentsRows, terminalGrade, exits);
    if (unclassified.length > 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Unclassified students remain' });
    }

    // ---------------- INSERT header (criterion 1) ----------------
    const headerInsert = await client.query(
      `INSERT INTO student_grade_rollup_runs (
         district_id,
         target_school_tenant_id,
         terminal_grade,
         actor_user_id,
         preview_snapshot_hash,
         total_promoted,
         total_graduated,
         total_exited,
         started_at
       ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, now())
       RETURNING id`,
      [
        districtId,
        targetTenantId,
        terminalGrade,
        req.user.id,
        payload.preview_snapshot_hash,
      ]
    );
    const runId = headerInsert.rows[0].id;

    // ---------------- Bulk UPDATE promotions ----------------
    // One UPDATE per from-grade bucket. The grade-specific WHERE
    // (grade = $4) defends against a mid-statement race — if a
    // student's grade was edited away between SELECT and UPDATE, the
    // rowcount falls short of the bucket size and we abort.
    let totalPromoted = 0;
    const childInserts = []; // [{ student_id, old_grade, new_grade, action, exit_reason }, …]

    for (const fromGrade of Object.keys(buckets.promote)) {
      const ids = buckets.promote[fromGrade];
      const newGrade = classifyTransition(fromGrade, terminalGrade).newGrade;
      const upd = await client.query(
        `UPDATE students
            SET grade = $1, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $2
            AND id = ANY($3::int[])
            AND grade = $4
            AND enrollment_status = 'active'
            AND archived = FALSE`,
        [newGrade, targetTenantId, ids, fromGrade]
      );
      if (upd.rowCount !== ids.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Preview snapshot stale' });
      }
      totalPromoted += upd.rowCount;
      for (const id of ids) {
        childInserts.push({
          student_id: id,
          old_grade: fromGrade,
          new_grade: newGrade,
          action: 'promoted',
          exit_reason: null,
        });
      }
    }

    // ---------------- Bulk UPDATE graduations ----------------
    let totalGraduated = 0;
    if (buckets.graduate.length > 0) {
      const upd = await client.query(
        `UPDATE students
            SET enrollment_status = 'graduated',
                exit_date = CURRENT_DATE,
                updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $1
            AND id = ANY($2::int[])
            AND grade = $3
            AND enrollment_status = 'active'
            AND archived = FALSE`,
        [targetTenantId, buckets.graduate, terminalGrade]
      );
      if (upd.rowCount !== buckets.graduate.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Preview snapshot stale' });
      }
      totalGraduated = upd.rowCount;
      for (const id of buckets.graduate) {
        childInserts.push({
          student_id: id,
          old_grade: terminalGrade,
          new_grade: null,
          action: 'graduated',
          exit_reason: null,
        });
      }
    }

    // ---------------- Apply exits ----------------
    // One UPDATE per exit_reason bucket because exit_reason is in SET.
    // Pre-fetch each exit's current grade so the child row's old_grade
    // is accurate (exits can come from any from-grade).
    let totalExited = 0;
    if (exits.length > 0) {
      const exitIds = exits.map((e) => e.student_id);
      const gradeLookup = await client.query(
        `SELECT id, grade FROM students
          WHERE tenant_id = $1 AND id = ANY($2::int[])`,
        [targetTenantId, exitIds]
      );
      const exitGradeById = new Map(gradeLookup.rows.map((r) => [r.id, r.grade]));

      // Group exits by reason for bulk UPDATE.
      const exitsByReason = {};
      for (const ex of exits) {
        if (!exitsByReason[ex.exit_reason]) exitsByReason[ex.exit_reason] = [];
        exitsByReason[ex.exit_reason].push(ex.student_id);
      }
      for (const reason of Object.keys(exitsByReason)) {
        // Defensive: reason was validated above, but a payload that
        // bypassed validation cannot reach this branch — paranoid
        // re-check anyway.
        if (!EXIT_REASONS.includes(reason)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid exit_reason' });
        }
        const ids = exitsByReason[reason];
        const upd = await client.query(
          `UPDATE students
              SET enrollment_status = 'exited',
                  exit_reason = $1,
                  exit_date = CURRENT_DATE,
                  updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $2
              AND id = ANY($3::int[])
              AND enrollment_status = 'active'
              AND archived = FALSE`,
          [reason, targetTenantId, ids]
        );
        if (upd.rowCount !== ids.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Preview snapshot stale' });
        }
        totalExited += upd.rowCount;
        for (const id of ids) {
          childInserts.push({
            student_id: id,
            old_grade: exitGradeById.get(id),
            new_grade: null,
            action: 'exited',
            exit_reason: reason,
          });
        }
      }
    }

    // ---------------- INSERT child rows (criterion 2) ----------------
    // school_tenant_id + district_id inherited from the header values
    // already resolved in this transaction — NOT re-read from payload
    // or body. actor_user_id likewise from req.user.id (already
    // verified by requireAuth).
    for (const child of childInserts) {
      await client.query(
        `INSERT INTO student_grade_rollup_event_rows (
           run_id,
           student_id,
           school_tenant_id,
           district_id,
           actor_user_id,
           old_grade,
           new_grade,
           action,
           exit_reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          runId,
          child.student_id,
          targetTenantId,
          districtId,
          req.user.id,
          child.old_grade,
          child.new_grade,
          child.action,
          child.exit_reason,
        ]
      );
    }

    // ---------------- UPDATE header totals + completion ----------------
    await client.query(
      `UPDATE student_grade_rollup_runs
          SET total_promoted = $1,
              total_graduated = $2,
              total_exited = $3,
              completed_at = now()
        WHERE id = $4`,
      [totalPromoted, totalGraduated, totalExited, runId]
    );

    await client.query('COMMIT');

    return res.json({
      run_id: runId,
      total_promoted: totalPromoted,
      total_graduated: totalGraduated,
      total_exited: totalExited,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) { /* ignore rollback error */ }
    console.error('[student-grade-rollup:commit]', err.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// POST /undo/:runId
// ---------------------------------------------------------------------
router.post('/undo/:runId', requireAuth, rollupOperationLimiter, async (req, res) => {
  if (!ROLLUP_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const runId = Number(req.params.runId);
  if (!isPositiveInt(runId)) {
    return res.status(400).json({ error: 'Invalid runId' });
  }

  let accessible;
  try {
    accessible = await resolveAccessibleTenantIds(req.user);
  } catch (err) {
    console.error('[student-grade-rollup:undo]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }

  // Header load runs INSIDE the transaction with FOR UPDATE so concurrent
  // /undo on the same runId serialize: the second caller blocks on the
  // row lock, then observes undone_at set by the first commit → 409.
  // Scope-mismatch returns 404 (existence-disclosure doctrine); 403 is
  // reserved for the role-gate failure above.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true)",
      [String(req.user.id)]
    );

    const headerRes = await client.query(
      `SELECT id, district_id, target_school_tenant_id, undone_at
         FROM student_grade_rollup_runs
        WHERE id = $1
        FOR UPDATE`,
      [runId]
    );
    if (headerRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Run not found' });
    }
    const header = headerRes.rows[0];
    if (!accessible.includes(header.target_school_tenant_id)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Run not found' });
    }
    if (header.undone_at !== null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Run already undone' });
    }

    const { rows: childRows } = await client.query(
      `SELECT student_id, action, old_grade, new_grade, exit_reason
         FROM student_grade_rollup_event_rows
        WHERE run_id = $1
        ORDER BY id`,
      [runId]
    );

    const reversed = [];
    const skipped = [];

    for (const child of childRows) {
      // Read current state of the student. If the student row is
      // missing (e.g., deleted post-rollup), skip-and-report.
      const cur = await client.query(
        `SELECT grade, enrollment_status, exit_reason
           FROM students
          WHERE id = $1 AND tenant_id = $2`,
        [child.student_id, header.target_school_tenant_id]
      );
      if (cur.rows.length === 0) {
        skipped.push({ student_id: child.student_id, reason: 'student_missing' });
        continue;
      }
      const curState = cur.rows[0];

      if (child.action === 'promoted') {
        // Post-state expected: grade === new_grade, status active.
        if (curState.grade !== child.new_grade || curState.enrollment_status !== 'active') {
          skipped.push({ student_id: child.student_id, reason: 'state_diverged' });
          continue;
        }
        const upd = await client.query(
          `UPDATE students
              SET grade = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
              AND tenant_id = $3
              AND grade = $4
              AND enrollment_status = 'active'`,
          [child.old_grade, child.student_id, header.target_school_tenant_id, child.new_grade]
        );
        if (upd.rowCount !== 1) {
          skipped.push({ student_id: child.student_id, reason: 'unexpected_state' });
          continue;
        }
        reversed.push(child.student_id);
      } else if (child.action === 'graduated') {
        if (curState.enrollment_status !== 'graduated') {
          skipped.push({ student_id: child.student_id, reason: 'state_diverged' });
          continue;
        }
        const upd = await client.query(
          `UPDATE students
              SET enrollment_status = 'active',
                  exit_date = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
              AND tenant_id = $2
              AND enrollment_status = 'graduated'`,
          [child.student_id, header.target_school_tenant_id]
        );
        if (upd.rowCount !== 1) {
          skipped.push({ student_id: child.student_id, reason: 'unexpected_state' });
          continue;
        }
        reversed.push(child.student_id);
      } else if (child.action === 'exited') {
        if (
          curState.enrollment_status !== 'exited' ||
          curState.exit_reason !== child.exit_reason
        ) {
          skipped.push({ student_id: child.student_id, reason: 'state_diverged' });
          continue;
        }
        const upd = await client.query(
          `UPDATE students
              SET enrollment_status = 'active',
                  exit_reason = NULL,
                  exit_date = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
              AND tenant_id = $2
              AND enrollment_status = 'exited'`,
          [child.student_id, header.target_school_tenant_id]
        );
        if (upd.rowCount !== 1) {
          skipped.push({ student_id: child.student_id, reason: 'unexpected_state' });
          continue;
        }
        reversed.push(child.student_id);
      } else {
        // Unknown action — should not occur given M045 CHECK, but
        // skip-and-report rather than crash if a future migration
        // widens the allowlist.
        skipped.push({ student_id: child.student_id, reason: 'unknown_action' });
      }
    }

    // Belt-and-suspenders: the FOR UPDATE above serializes concurrent
    // /undo callers, so this branch reaches here only when undone_at
    // was NULL at lock time. The `undone_at IS NULL` filter + rowCount
    // === 1 enforcement defends against a future refactor accidentally
    // dropping the FOR UPDATE — if zero rows match, ROLLBACK + 409
    // rather than silently re-stamping a previously undone run.
    const finalUpd = await client.query(
      `UPDATE student_grade_rollup_runs
          SET undone_at = now(), undone_by_user_id = $1
        WHERE id = $2 AND undone_at IS NULL`,
      [req.user.id, runId]
    );
    if (finalUpd.rowCount !== 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Run already undone' });
    }

    await client.query('COMMIT');

    return res.json({
      run_id: runId,
      reversed_count: reversed.length,
      skipped,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) { /* ignore */ }
    console.error('[student-grade-rollup:undo]', err.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
