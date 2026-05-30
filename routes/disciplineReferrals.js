const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authorizeInterventionAccess');
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
