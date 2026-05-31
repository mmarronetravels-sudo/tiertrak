const express = require('express');
const router = express.Router();
const { requireAuth, requireStudentReadAccess } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// ============================================================
// Tenant-binding doctrine (POST handlers)
//
// Mirrors routes/prereferralForms.js per Followup #125 (per-school
// binding) + Followup #132 (helper consolidation deferred): POST
// reads optional req.body.target_tenant_id; absent → req.user.tenant_id;
// present → validated against resolveAccessibleTenantIds(req.user);
// not-in-set → 403 BEFORE any INSERT so a body-explicit cross-tenant
// probe collapses to 403, not 400-FK.
//
// GET vocab derives scope from path :tenantId + accessible-set check.
//
// Server-derived columns on POST (never read from body):
//   tenant_id, referring_staff_id, grade, status, admin_notes,
//   reviewing_admin_id, reviewed_at, time_out_of_instruction
// Body-supplied columns are limited to the destructured set below;
// any other req.body keys are silently ignored.
// ============================================================

const FORBIDDEN_BODY = { error: 'Not authorized' };

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

async function resolveAndBindTargetTenant(req) {
  const bodyTarget = req.body ? req.body.target_tenant_id : undefined;
  if (bodyTarget === undefined || bodyTarget === null) {
    return { targetTenantId: req.user.tenant_id, error: null };
  }
  if (!isPositiveInt(bodyTarget)) {
    return { targetTenantId: null, error: { status: 400, body: { error: 'Invalid target_tenant_id' } } };
  }
  const accessible = await resolveAccessibleTenantIds(req.user);
  if (!accessible.includes(bodyTarget)) {
    return { targetTenantId: null, error: { status: 403, body: { error: 'Not authorized for target tenant' } } };
  }
  return { targetTenantId: bodyTarget, error: null };
}

// ============================================================
// GET /vocab/:tenantId — all 7 active discipline vocab lists for one
// tenant. Behaviors carry severity_level + managed_by + requires_subtype
// (M037) so the FE can drive the two-path form without label-matching.
// Consequences carry is_restorative so the FE can render the badge.
//
// Path :tenantId is int-validated, then checked against
// resolveAccessibleTenantIds for §5 dual-path membership. Failures
// collapse to 403 (no existence-disclosure across tenants).
// ============================================================
router.get('/vocab/:tenantId', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const pathTenantId = parseInt(req.params.tenantId, 10);
    if (!isPositiveInt(pathTenantId)) {
      return res.status(400).json({ error: 'Invalid tenantId' });
    }
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(pathTenantId)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const [behaviors, locations, motivations, others, consequences, harass, weapon] = await Promise.all([
      pool.query(
        `SELECT id, label, severity_level, managed_by, requires_subtype, sort_order
         FROM discipline_behaviors
         WHERE tenant_id = $1 AND is_active = TRUE
         ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_locations
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_motivations
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_others_involved
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, is_restorative, sort_order FROM discipline_consequences
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_harassment_subtypes
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_weapon_subtypes
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
    ]);

    res.json({
      behaviors: behaviors.rows,
      locations: locations.rows,
      motivations: motivations.rows,
      others_involved: others.rows,
      consequences: consequences.rows,
      harassment_subtypes: harass.rows,
      weapon_subtypes: weapon.rows,
    });
  } catch (error) {
    // No body echo; tenant_id only (id integer, not PII).
    console.error('[disciplineReferrals:vocab]', 'tenant_id=', req.params.tenantId, 'err=', error.message);
    res.status(500).json({ error: 'Failed to load vocab' });
  }
});

// ============================================================
// GET /student/:studentId — referrals on a student's record.
//
// Visibility (design D6 — enforced in the SQL projection, NOT the UI):
//   - Structured fields (date, behavior, severity_level, status,
//     consequences, referring_staff_name) visible to every
//     authenticated non-parent role for any student in the viewer's
//     accessible-tenant set.
//   - staff_notes: counselor / school_admin / district_admin /
//     interventionist see all; teacher sees ONLY referrals they
//     authored (dr.referring_staff_id = $4); everyone else NULL.
//   - admin_notes: counselor / school_admin / district_admin /
//     interventionist see all; everyone else NULL.
//   - Parents: 403 (existence-of-referral is itself FERPA-protected;
//     same precedent as prereferralForms /student/:studentId).
//
// Note-gating lives ONLY in the SELECT CASE expressions; the
// staff_notes / admin_notes columns are never plucked into JS and
// post-filtered. A viewer whose CASE resolves to ELSE NULL never
// receives the underlying text in the query result, period.
//
// Tenant scope: requireStudentReadAccess admits parent-by-link or
// staff-by-accessible-set; the handler then filters
// dr.tenant_id = ANY($2::int[]) for defense in depth.
//
// Time scope: ?scope=current (default) — incident_date on or after
// Aug 1 of the current school year (server-derived). ?scope=all
// removes the floor. Aug 1 boundary is a US convention; promotable
// to a per-tenant setting later if a district needs it.
// ============================================================
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const accessible = await resolveAccessibleTenantIds(req.user);

    let schoolYearFloor = null;
    if (req.query.scope !== 'all') {
      const now = new Date();
      const cutoffYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
      schoolYearFloor = `${cutoffYear}-08-01`;
    }

    const result = await pool.query(
      `SELECT
         dr.id,
         dr.incident_date,
         dr.status,
         db.label          AS behavior_label,
         db.severity_level,
         dl.label          AS location_label,
         ru.full_name      AS referring_staff_name,
         COALESCE(
           (SELECT json_agg(json_build_object('label', dc.label, 'is_restorative', dc.is_restorative)
                            ORDER BY dc.sort_order)
              FROM discipline_referral_consequences drc
              JOIN discipline_consequences dc
                ON dc.id = drc.consequence_id AND dc.tenant_id = drc.tenant_id
             WHERE drc.referral_id = dr.id AND drc.tenant_id = dr.tenant_id),
           '[]'::json
         )                 AS consequences,
         CASE
           WHEN $3::text IN ('counselor','school_admin','district_admin','interventionist') THEN dr.staff_notes
           WHEN $3::text = 'teacher' AND dr.referring_staff_id = $4::int THEN dr.staff_notes
           ELSE NULL
         END               AS staff_notes,
         CASE
           WHEN $3::text IN ('counselor','school_admin','district_admin','interventionist') THEN dr.admin_notes
           ELSE NULL
         END               AS admin_notes
       FROM discipline_referrals dr
       JOIN discipline_behaviors db
         ON db.id = dr.behavior_id AND db.tenant_id = dr.tenant_id
       JOIN discipline_locations dl
         ON dl.id = dr.location_id AND dl.tenant_id = dr.tenant_id
       LEFT JOIN users ru
         ON ru.id = dr.referring_staff_id
       WHERE dr.student_id = $1
         AND dr.tenant_id  = ANY($2::int[])
         AND ($5::date IS NULL OR dr.incident_date >= $5::date)
       ORDER BY dr.incident_date DESC, dr.created_at DESC`,
      [req.params.studentId, accessible, req.user.role, req.user.id, schoolYearFloor]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      '[disciplineReferrals:studentHistory]',
      'user_id=', req.user && req.user.id,
      'student_tenant_id=', req.student && req.student.tenant_id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load referral history' });
  }
});

// ============================================================
// POST / — create a discipline referral.
//
// Path-fork by behavior.managed_by:
//   'staff' (L1) — staff captures the situation + optional response;
//                  staff_notes optional; consequence_id allowed (single).
//                  motivation_id / others_involved_id rejected (L2+-only).
//   'admin' (L2+) — staff captures the situation; admin assigns
//                   consequence at review (PR #3). consequence_id
//                   rejected. staff_notes REQUIRED ("what happened" —
//                   admin wasn't present).
//
// Conditional subtype enforcement via behavior.requires_subtype
// ('harassment' | 'weapon' | NULL — set by M037). Explicit equality —
// requires_subtype may be NULL, never truthy-check.
//
// Composite FKs from M036 reject cross-tenant location / behavior /
// motivation / others_involved / subtype ids at the schema layer.
// Pre-checks below turn unknown ids into clean 400s instead of 23503
// FK violations, but the schema is the trust boundary.
//
// PII discipline (§4B):
//   - staff_notes is the only free-text PII column on this route.
//     Trimmed at parse; empty-after-trim → NULL.
//   - Error responses are generic strings; no body echo.
//   - console.error lines carry tenant_id (integer) + user_id (integer)
//     + err.message only. No student_id, no behavior label, no notes.
// ============================================================
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

  const { targetTenantId, error: bindError } = await resolveAndBindTargetTenant(req);
  if (bindError) return res.status(bindError.status).json(bindError.body);

  const {
    student_id,
    behavior_id,
    location_id,
    incident_date,
    incident_time,
    motivation_id,
    others_involved_id,
    harassment_subtype_id,
    weapon_subtype_id,
    consequence_id,
    staff_notes,
  } = req.body || {};

  if (!isPositiveInt(student_id) || !isPositiveInt(behavior_id) || !isPositiveInt(location_id)) {
    return res.status(400).json({ error: 'Missing or invalid required field(s)' });
  }

  const trimmedNotes = typeof staff_notes === 'string' ? staff_notes.trim() : null;
  const notesValue = trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Student must belong to the target tenant; derive grade in the same hop.
    const studentRes = await client.query(
      'SELECT grade, tenant_id FROM students WHERE id = $1',
      [student_id]
    );
    if (studentRes.rows.length === 0 || studentRes.rows[0].tenant_id !== targetTenantId) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow per S87 5a3cfd1 */ }
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const grade = studentRes.rows[0].grade;

    // Behavior must exist + be active + belong to target tenant.
    const behaviorRes = await client.query(
      `SELECT severity_level, managed_by, requires_subtype
       FROM discipline_behaviors
       WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
      [behavior_id, targetTenantId]
    );
    if (behaviorRes.rows.length === 0) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
      return res.status(400).json({ error: 'Invalid behavior' });
    }
    const behavior = behaviorRes.rows[0];

    // Path-fork validation.
    if (behavior.managed_by === 'staff') {
      if (motivation_id != null || others_involved_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior level' });
      }
    } else {
      if (consequence_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Consequence is assigned at admin review' });
      }
      if (!notesValue) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'A description of what happened is required' });
      }
    }

    // Conditional subtype enforcement (explicit equality on requires_subtype).
    if (behavior.requires_subtype === 'harassment') {
      if (!isPositiveInt(harassment_subtype_id)) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Harassment subtype is required for this behavior' });
      }
      if (weapon_subtype_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior' });
      }
    } else if (behavior.requires_subtype === 'weapon') {
      if (!isPositiveInt(weapon_subtype_id)) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Weapon subtype is required for this behavior' });
      }
      if (harassment_subtype_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior' });
      }
    } else {
      if (harassment_subtype_id != null || weapon_subtype_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior' });
      }
    }

    // Optional consequence on the L1 path: tenant + active check.
    if (behavior.managed_by === 'staff' && consequence_id != null) {
      if (!isPositiveInt(consequence_id)) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Invalid consequence' });
      }
      const conqRes = await client.query(
        `SELECT 1 FROM discipline_consequences
         WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
        [consequence_id, targetTenantId]
      );
      if (conqRes.rows.length === 0) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Invalid consequence' });
      }
    }

    // INSERT referral. incident_date COALESCEs to CURRENT_DATE at the DB
    // so a missing field doesn't depend on Node's clock vs PG's clock.
    const referralRes = await client.query(
      `INSERT INTO discipline_referrals (
         tenant_id, student_id, referring_staff_id, grade,
         incident_date, incident_time, location_id, behavior_id,
         motivation_id, others_involved_id,
         harassment_subtype_id, weapon_subtype_id,
         staff_notes, status
       ) VALUES (
         $1, $2, $3, $4,
         COALESCE($5, CURRENT_DATE), $6, $7, $8,
         $9, $10,
         $11, $12,
         $13, 'submitted'
       ) RETURNING id, status, incident_date, incident_time, created_at`,
      [
        targetTenantId, student_id, req.user.id, grade,
        incident_date || null, incident_time || null, location_id, behavior_id,
        motivation_id || null, others_involved_id || null,
        harassment_subtype_id || null, weapon_subtype_id || null,
        notesValue,
      ]
    );
    const referral = referralRes.rows[0];

    // L1 + consequence: write the join row inside the same transaction.
    if (behavior.managed_by === 'staff' && consequence_id != null) {
      await client.query(
        `INSERT INTO discipline_referral_consequences (referral_id, consequence_id, tenant_id)
         VALUES ($1, $2, $3)`,
        [referral.id, consequence_id, targetTenantId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      id: referral.id,
      status: referral.status,
      incident_date: referral.incident_date,
      incident_time: referral.incident_time,
      created_at: referral.created_at,
      managed_by: behavior.managed_by,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow per S87 5a3cfd1 */ }
    console.error('[disciplineReferrals:create]', 'tenant_id=', targetTenantId, 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Failed to create referral' });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
