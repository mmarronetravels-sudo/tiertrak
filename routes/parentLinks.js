const express = require('express');
const router = express.Router();
const {
  requireAuth,
  requireTenantStaffAccess
} = require('../middleware/authorizeInterventionAccess');

let pool;

const initializePool = (p) => {
  pool = p;
};

const FORBIDDEN_BODY = { error: 'Not authorized' };

// GET parents for a student
router.get('/student/:studentId', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT psl.*, u.full_name as parent_name, u.email as parent_email
      FROM parent_student_links psl
      JOIN users u ON psl.parent_user_id = u.id
      WHERE psl.student_id = $1
      ORDER BY psl.relationship
    `, [studentId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching parent links:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET students for a parent (used by parent portal)
// Parents-only self-parity: only the parent themselves can list their own
// linked students. Staff have no current FE caller for this surface
// (frontend/src/App.jsx:6135 is the parent-portal caller). Narrower-then-
// loosen — widen later if a staff use case appears.
router.get('/parent/:parentUserId', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'parent'
        || Number(req.params.parentUserId) !== req.user.id) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const { parentUserId } = req.params;
    
    const result = await pool.query(`
      SELECT s.*, psl.relationship
      FROM students s
      JOIN parent_student_links psl ON s.id = psl.student_id
      WHERE psl.parent_user_id = $1
      ORDER BY s.last_name, s.first_name
    `, [parentUserId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching parent students:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST link parent to student
router.post('/', async (req, res) => {
  try {
    const { parent_user_id, student_id, relationship } = req.body;
    
    // Check if student already has 2 parents
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM parent_student_links WHERE student_id = $1',
      [student_id]
    );
    
    if (parseInt(countResult.rows[0].count) >= 2) {
      return res.status(400).json({ error: 'Student already has 2 parent accounts linked' });
    }
    
    const result = await pool.query(`
      INSERT INTO parent_student_links (parent_user_id, student_id, relationship)
      VALUES ($1, $2, $3)
      ON CONFLICT (parent_user_id, student_id) DO NOTHING
      RETURNING *
    `, [parent_user_id, student_id, relationship || 'parent']);
    
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'This parent is already linked to this student' });
    }
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error linking parent:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove parent link
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query('DELETE FROM parent_student_links WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing parent link:', error);
    res.status(500).json({ error: error.message });
  }
});
// GET all parent-student links for a tenant (for Admin panel)
router.get('/tenant/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        psl.id,
        psl.parent_user_id,
        psl.student_id,
        psl.relationship,
        u.full_name as parent_name,
        u.email as parent_email,
        s.first_name || ' ' || s.last_name as student_name
      FROM parent_student_links psl
      JOIN users u ON psl.parent_user_id = u.id
      JOIN students s ON psl.student_id = s.id
      WHERE s.tenant_id = $1
      ORDER BY u.full_name, s.last_name
    `, [tenantId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tenant parent links:', error);
    res.status(500).json({ error: error.message });
  }
});module.exports = router;
module.exports.initializePool = initializePool;
