const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const FORBIDDEN_BODY = { error: 'Not authorized' };

// Categories a linked parent may read even if they did not upload the file.
// Parents always see their own uploads regardless of category; this list
// governs staff-uploaded documents that are also parent-visible.
const PARENT_VISIBLE_CATEGORIES = [
  '504 Plan',
  'IEP',
  'Medical Record',
  'Parent Communication'
];

// Staff roles permitted to delete a document when the tenant matches.
// Teachers are intentionally excluded.
const STAFF_DELETE_ROLES = [
  'district_admin',
  'school_admin',
  'counselor',
  'behavior_specialist'
];

// requireAuth — duplicated from middleware/authorizeInterventionAccess.js.
// DRY debt is intentional and captured in this PR's followups so the two
// resource-scoped middleware files stay independently reviewable. A later
// chore/* branch can consolidate both copies into a shared module.
const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { rows } = await pool.query(
      'SELECT id, role, tenant_id FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Not authenticated' });

    req.user = rows[0];
    next();
  } catch (err) {
    console.error('[requireAuth]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// Returns { ok, studentTenantId } for "can this user access this student's data?"
// Staff: tenant match. Parent: row in parent_student_links.
async function resolveStudentAccess(userRow, studentId) {
  const studentResult = await pool.query(
    'SELECT id, tenant_id FROM students WHERE id = $1',
    [studentId]
  );
  if (studentResult.rows.length === 0) {
    return { ok: false, studentTenantId: null };
  }
  const studentTenantId = studentResult.rows[0].tenant_id;

  if (userRow.role === 'parent') {
    const linkResult = await pool.query(
      `SELECT 1 FROM parent_student_links
       WHERE parent_user_id = $1 AND student_id = $2
       LIMIT 1`,
      [userRow.id, studentId]
    );
    return { ok: linkResult.rows.length > 0, studentTenantId };
  }

  return { ok: userRow.tenant_id === studentTenantId, studentTenantId };
}

// GET /student/:studentId — list documents for a student.
// Sets req.targetStudent = { id, tenant_id }. Per-doc category filtering is
// applied in the route SQL based on req.user.role.
async function requireStudentDocumentListAccess(req, res, next) {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      return res.status(400).json({ error: 'Missing required parameter: studentId' });
    }
    const { ok, studentTenantId } = await resolveStudentAccess(req.user, studentId);
    if (!ok) return res.status(403).json(FORBIDDEN_BODY);
    req.targetStudent = { id: Number(studentId), tenant_id: studentTenantId };
    return next();
  } catch (err) {
    console.error('[requireStudentDocumentListAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// GET /download/:id — generate a signed URL for one document.
// Parent: linked to the doc's student AND (uploaded it OR category is parent-visible).
// Staff: tenant match with the doc.
// Sets req.document = { id, tenant_id, student_id, s3_key, file_name, uploaded_by, document_category }.
async function requireDocumentReadAccess(req, res, next) {
  try {
    const { id } = req.params;
    const docResult = await pool.query(
      `SELECT id, tenant_id, student_id, s3_key, file_name, uploaded_by, document_category
       FROM student_documents WHERE id = $1`,
      [id]
    );
    if (docResult.rows.length === 0) return res.status(403).json(FORBIDDEN_BODY);
    const doc = docResult.rows[0];

    if (req.user.role === 'parent') {
      const { ok } = await resolveStudentAccess(req.user, doc.student_id);
      if (!ok) return res.status(403).json(FORBIDDEN_BODY);
      const ownUpload = doc.uploaded_by === req.user.id;
      const categoryVisible = PARENT_VISIBLE_CATEGORIES.includes(doc.document_category);
      if (!ownUpload && !categoryVisible) return res.status(403).json(FORBIDDEN_BODY);
    } else if (req.user.tenant_id !== doc.tenant_id) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    req.document = doc;
    return next();
  } catch (err) {
    console.error('[requireDocumentReadAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// DELETE /:id — delete one document.
// Staff: role in STAFF_DELETE_ROLES AND tenant match.
// Parent: uploaded_by matches AND still linked to the student.
// Sets req.document = { id, tenant_id, student_id, s3_key, uploaded_by }.
async function requireDocumentWriteAccess(req, res, next) {
  try {
    const { id } = req.params;
    const docResult = await pool.query(
      `SELECT id, tenant_id, student_id, s3_key, uploaded_by
       FROM student_documents WHERE id = $1`,
      [id]
    );
    if (docResult.rows.length === 0) return res.status(403).json(FORBIDDEN_BODY);
    const doc = docResult.rows[0];

    if (req.user.role === 'parent') {
      if (doc.uploaded_by !== req.user.id) return res.status(403).json(FORBIDDEN_BODY);
      const { ok } = await resolveStudentAccess(req.user, doc.student_id);
      if (!ok) return res.status(403).json(FORBIDDEN_BODY);
    } else {
      if (!STAFF_DELETE_ROLES.includes(req.user.role)) return res.status(403).json(FORBIDDEN_BODY);
      if (req.user.tenant_id !== doc.tenant_id) return res.status(403).json(FORBIDDEN_BODY);
    }

    req.document = doc;
    return next();
  } catch (err) {
    console.error('[requireDocumentWriteAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// POST /upload — upload a document.
// Staff: tenant match on body.student_id.
// Parent: linked to body.student_id.
// Sets req.targetStudent = { id, tenant_id } for the route to derive the
// server-authoritative tenant_id and uploaded_by.
async function requireDocumentUploadAccess(req, res, next) {
  try {
    const studentId = req.body && req.body.student_id;
    if (!studentId) {
      return res.status(400).json({ error: 'Missing required field: student_id' });
    }
    const { ok, studentTenantId } = await resolveStudentAccess(req.user, studentId);
    if (!ok) return res.status(403).json(FORBIDDEN_BODY);
    req.targetStudent = { id: Number(studentId), tenant_id: studentTenantId };
    return next();
  } catch (err) {
    console.error('[requireDocumentUploadAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// GET /expiring/:tenantId — staff-only, must match their own tenant.
async function requireExpiringListAccess(req, res, next) {
  try {
    const { tenantId } = req.params;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing required parameter: tenantId' });
    }
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    if (Number(tenantId) !== req.user.tenant_id) return res.status(403).json(FORBIDDEN_BODY);
    return next();
  } catch (err) {
    console.error('[requireExpiringListAccess]', err.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

module.exports = {
  requireAuth,
  requireStudentDocumentListAccess,
  requireDocumentReadAccess,
  requireDocumentWriteAccess,
  requireDocumentUploadAccess,
  requireExpiringListAccess,
  PARENT_VISIBLE_CATEGORIES,
  STAFF_DELETE_ROLES
};
