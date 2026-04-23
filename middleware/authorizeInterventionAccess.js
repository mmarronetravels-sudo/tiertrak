const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const FORBIDDEN_BODY = { error: 'Not authorized' };

// Role string is lowercase 'parent' per the users.role CHECK constraint
// (server.js bootstrap) and every comparison in the codebase. No normalization.

function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.auth_token;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id
    };
    return next();
  } catch (err) {
    console.error('[requireAuth]', err.message);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

async function authorizeByInterventionId(req, res, studentInterventionId) {
  const interventionResult = await pool.query(
    `SELECT si.id, si.student_id, s.tenant_id
     FROM student_interventions si
     JOIN students s ON s.id = si.student_id
     WHERE si.id = $1`,
    [studentInterventionId]
  );
  if (interventionResult.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const { student_id: interventionStudentId, tenant_id: interventionTenantId } =
    interventionResult.rows[0];

  if (req.user.role === 'parent') {
    const assignmentResult = await pool.query(
      `SELECT 1 FROM intervention_assignments
       WHERE user_id = $1
         AND student_intervention_id = $2
         AND assignment_type = 'parent'
         AND can_log_progress = TRUE
       LIMIT 1`,
      [req.user.id, studentInterventionId]
    );
    if (assignmentResult.rows.length === 0) {
      return { ok: false, status: 403, body: FORBIDDEN_BODY };
    }
  } else if (req.user.tenant_id !== interventionTenantId) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }

  req.intervention = {
    id: studentInterventionId,
    student_id: interventionStudentId,
    tenant_id: interventionTenantId
  };
  return { ok: true };
}

async function requireWriteAccessByBody(req, res, next) {
  try {
    const studentInterventionId = req.body?.student_intervention_id;
    if (!studentInterventionId) {
      return res.status(400).json({ error: 'Missing required field: student_intervention_id' });
    }
    const result = await authorizeByInterventionId(req, res, studentInterventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireWriteAccessByBody]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

async function requireWriteAccessByLogId(req, res, next) {
  try {
    const { id } = req.params;
    const logResult = await pool.query(
      'SELECT student_intervention_id FROM weekly_progress WHERE id = $1',
      [id]
    );
    if (logResult.rows.length === 0) {
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const studentInterventionId = logResult.rows[0].student_intervention_id;
    const result = await authorizeByInterventionId(req, res, studentInterventionId);
    if (!result.ok) return res.status(result.status).json(result.body);
    return next();
  } catch (err) {
    console.error('[requireWriteAccessByLogId]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

module.exports = {
  requireAuth,
  requireWriteAccessByBody,
  requireWriteAccessByLogId
};
