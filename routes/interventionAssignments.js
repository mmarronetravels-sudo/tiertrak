const express = require('express');
const router = express.Router();

let pool;

const initializePool = (p) => {
  pool = p;
};

// GET assignments for an intervention
router.get('/:studentInterventionId', async (req, res) => {
  try {
    const { studentInterventionId } = req.params;
    
    const result = await pool.query(`
      SELECT ia.*, u.name as user_name, u.email as user_email, u.role as user_role
      FROM intervention_assignments ia
      JOIN users u ON ia.user_id = u.id
      WHERE ia.student_intervention_id = $1
      ORDER BY ia.assignment_type, u.name
    `, [studentInterventionId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST add assignment to intervention
router.post('/', async (req, res) => {
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

// DELETE remove assignment
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query('DELETE FROM intervention_assignments WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
