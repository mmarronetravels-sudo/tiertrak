const express = require('express');
const router = express.Router();
const { INTERVENTION_MANAGER_ROLES } = require('../constants/roles');
const { requireWriteAccessByBody } = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { applyStudentAccessGate } = require('../middleware/canAccessStudent');

const FORBIDDEN_BODY = { error: 'Not authorized' };

let pool;

const initializePool = (p) => {
  pool = p;
};

// GET assignments for an intervention
router.get('/:studentInterventionId', async (req, res) => {
  try {
    const { studentInterventionId } = req.params;
    
    const result = await pool.query(`
      SELECT ia.*, u.full_name as user_name, u.email as user_email, u.role as user_role
      FROM intervention_assignments ia
      JOIN users u ON ia.user_id = u.id
      WHERE ia.student_intervention_id = $1
      ORDER BY ia.assignment_type, u.full_name
    `, [studentInterventionId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST add assignment to intervention.
//
// Tenant binding (§5): the body's student_intervention_id is resolved via the
// canonical requireWriteAccessByBody middleware, which walks
// student_interventions → students.tenant_id and gates via the same
// applyStudentAccessGate as PR-A. Sets req.intervention = {id, student_id,
// tenant_id} for downstream defense-in-depth.
router.post('/', requireWriteAccessByBody, async (req, res) => {
  if (!INTERVENTION_MANAGER_ROLES.includes(req.user && req.user.role)) {
    return res.status(403).json(FORBIDDEN_BODY);
  }
  try {
    const { student_intervention_id, user_id, assignment_type } = req.body;
    
    const result = await pool.query(`
      INSERT INTO intervention_assignments (student_intervention_id, user_id, assignment_type, can_log_progress)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (student_intervention_id, user_id) DO NOTHING
      RETURNING *
    `, [student_intervention_id, user_id, assignment_type]);
    
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'User already assigned to this intervention' });
    }
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove assignment.
//
// Tenant binding (§5): :id is an intervention_assignments row id — one level
// of indirection past anything the existing middleware handles. Inline gate
// (Option C per the PR-B prep pass) follows PR-A's POST shape: walk
// assignment → student_intervention → students to get tenant_id + tier, then
// delegate the decision to applyStudentAccessGate. Not-found and wrong-tenant
// collapse to a byte-identical 403 to avoid cross-tenant existence disclosure.
// Note (banked): extract a requireWriteAccessByAssignmentId middleware helper
// if a third inline gate of this shape appears.
router.delete('/:id', async (req, res) => {
  if (!INTERVENTION_MANAGER_ROLES.includes(req.user && req.user.role)) {
    return res.status(403).json(FORBIDDEN_BODY);
  }
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const accessible = await resolveAccessibleTenantIds(req.user);
    const ar = await pool.query(
      `SELECT si.student_id, s.tenant_id, s.tier
         FROM intervention_assignments ia
         JOIN student_interventions si ON si.id = ia.student_intervention_id
         JOIN students s ON s.id = si.student_id
        WHERE ia.id = $1`,
      [id]
    );
    if (ar.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentRow = {
      id: ar.rows[0].student_id,
      tenant_id: ar.rows[0].tenant_id,
      tier: ar.rows[0].tier,
    };
    const { decision } = await applyStudentAccessGate(req.user, studentRow, {
      legacyAllowed: accessible.includes(ar.rows[0].tenant_id),
    });
    if (decision !== 'allow') {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    await pool.query('DELETE FROM intervention_assignments WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
