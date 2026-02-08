const express = require('express');
const router = express.Router();
let pool;

const initializePool = (p) => { pool = p; };

// GET /api/intervention-bank/all
// Returns ALL bank interventions (tenant_id IS NULL, not legacy)
// with a flag showing which ones this tenant has activated
router.get('/all', async (req, res) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });

    const result = await pool.query(`
      SELECT 
        it.id,
        it.name,
        it.description,
        it.area,
        it.tier,
        it.has_plan_template,
        it.is_starter,
        CASE WHEN tib.id IS NOT NULL THEN TRUE ELSE FALSE END as is_activated,
        tib.activated_at
      FROM intervention_templates it
      LEFT JOIN tenant_intervention_bank tib 
        ON tib.template_id = it.id AND tib.tenant_id = $1
      WHERE it.tenant_id IS NULL AND (it.is_legacy IS NULL OR it.is_legacy = FALSE)
      ORDER BY it.area, it.name
    `, [tenant_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching intervention bank:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/intervention-bank/activate
// Activate a bank intervention for a tenant
router.post('/activate', async (req, res) => {
  try {
    const { tenant_id, template_id, user_id } = req.body;
    if (!tenant_id || !template_id) {
      return res.status(400).json({ error: 'tenant_id and template_id are required' });
    }

    await pool.query(`
      INSERT INTO tenant_intervention_bank (tenant_id, template_id, activated_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, template_id) DO NOTHING
    `, [tenant_id, template_id, user_id || null]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error activating intervention:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/intervention-bank/activate-bulk
// Activate multiple bank interventions at once (for starter set)
router.post('/activate-bulk', async (req, res) => {
  try {
    const { tenant_id, template_ids, user_id } = req.body;
    if (!tenant_id || !template_ids || !template_ids.length) {
      return res.status(400).json({ error: 'tenant_id and template_ids are required' });
    }

    // Use a single INSERT with unnest for efficiency
    await pool.query(`
      INSERT INTO tenant_intervention_bank (tenant_id, template_id, activated_by)
      SELECT $1, unnest($2::int[]), $3
      ON CONFLICT (tenant_id, template_id) DO NOTHING
    `, [tenant_id, template_ids, user_id || null]);

    res.json({ success: true, count: template_ids.length });
  } catch (error) {
    console.error('Error bulk activating interventions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/intervention-bank/deactivate
// Remove a bank intervention from a tenant's active list
router.delete('/deactivate', async (req, res) => {
  try {
    const { tenant_id, template_id } = req.body;
    if (!tenant_id || !template_id) {
      return res.status(400).json({ error: 'tenant_id and template_id are required' });
    }

    // Check if any students currently have this intervention assigned
    const usage = await pool.query(`
      SELECT COUNT(*) as count 
      FROM student_interventions si
      JOIN students s ON si.student_id = s.id
      WHERE si.intervention_template_id = $1 
        AND s.tenant_id = $2
        AND si.status = 'active'
    `, [template_id, tenant_id]);

    if (parseInt(usage.rows[0].count) > 0) {
      return res.status(409).json({ 
        error: 'Cannot deactivate — this intervention is currently assigned to active students',
        active_count: parseInt(usage.rows[0].count)
      });
    }

    await pool.query(`
      DELETE FROM tenant_intervention_bank 
      WHERE tenant_id = $1 AND template_id = $2
    `, [tenant_id, template_id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating intervention:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.initializePool = initializePool;