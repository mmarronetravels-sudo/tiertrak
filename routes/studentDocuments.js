const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const path = require('path');
const {
  requireAuth,
  requireStudentDocumentListAccess,
  requireDocumentReadAccess,
  requireDocumentWriteAccess,
  requireDocumentUploadAccess,
  requireExpiringListAccess,
  PARENT_VISIBLE_CATEGORIES
} = require('../middleware/authorizeDocumentAccess');

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, PNG, JPG'));
    }
  }
});

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Document categories with expiration defaults (in months)
const DOCUMENT_CATEGORIES = {
  '504 Plan': { defaultExpirationMonths: 12 },
  'IEP': { defaultExpirationMonths: 12 },
  'Evaluation Report': { defaultExpirationMonths: 36 },
  'Progress Report': { defaultExpirationMonths: null },
  'Parent Communication': { defaultExpirationMonths: null },
  'Medical Record': { defaultExpirationMonths: 12 },
  'Other': { defaultExpirationMonths: null }
};

// GET /api/student-documents/student/:studentId - Get all documents for a student
router.get('/student/:studentId', requireAuth, requireStudentDocumentListAccess, async (req, res) => {
  try {
    const { studentId } = req.params;
    const tenantId = req.targetStudent.tenant_id;

    // Parents see only their own uploads or docs in PARENT_VISIBLE_CATEGORIES.
    // Staff within the student's tenant see every document for the student.
    let result;
    if (req.user.role === 'parent') {
      result = await pool.query(`
        SELECT
          sd.*,
          u.full_name as uploaded_by_name,
          u.role as uploaded_by_role,
          CASE
            WHEN sd.expiration_date IS NOT NULL AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
            THEN true
            ELSE false
          END as expiring_soon
        FROM student_documents sd
        LEFT JOIN users u ON sd.uploaded_by = u.id
        WHERE sd.student_id = $1
          AND sd.tenant_id = $2
          AND (sd.uploaded_by = $3 OR sd.document_category = ANY($4::text[]))
        ORDER BY sd.uploaded_at DESC
      `, [studentId, tenantId, req.user.id, PARENT_VISIBLE_CATEGORIES]);
    } else {
      result = await pool.query(`
        SELECT
          sd.*,
          u.full_name as uploaded_by_name,
          u.role as uploaded_by_role,
          CASE
            WHEN sd.expiration_date IS NOT NULL AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
            THEN true
            ELSE false
          END as expiring_soon
        FROM student_documents sd
        LEFT JOIN users u ON sd.uploaded_by = u.id
        WHERE sd.student_id = $1
          AND sd.tenant_id = $2
        ORDER BY sd.uploaded_at DESC
      `, [studentId, tenantId]);
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student documents:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/student-documents/upload - Upload a document
// Middleware order matters:
//   1. requireAuth — rejects unauthenticated callers before multer buffers any bytes.
//   2. upload.single('file') — multer populates req.body (multipart fields) and req.file.
//   3. requireDocumentUploadAccess — gates on req.user + req.body.student_id, sets req.targetStudent.
// Only non-identifying fields are taken from the client body (document_category,
// description, expiration_date). tenant_id, student_id, and uploaded_by are
// server-derived from req.targetStudent and req.user.
router.post('/upload', requireAuth, upload.single('file'), requireDocumentUploadAccess, async (req, res) => {
  try {
    const { document_category, description, expiration_date } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const tenantId = req.targetStudent.tenant_id;
    const studentId = req.targetStudent.id;
    const uploadedBy = req.user.id;

    // S3 key is rebuilt from server-derived tenant + student so a forged
    // body.tenant_id cannot cause writes into another tenant's folder.
    const timestamp = Date.now();
    const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const s3Key = `tenant-${tenantId}/student-${studentId}/${timestamp}-${sanitizedFileName}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ServerSideEncryption: 'AES256',
    }));

    // Calculate expiration date if not provided and category has default
    let finalExpirationDate = expiration_date || null;
    if (!finalExpirationDate && document_category && DOCUMENT_CATEGORIES[document_category]?.defaultExpirationMonths) {
      const months = DOCUMENT_CATEGORIES[document_category].defaultExpirationMonths;
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + months);
      finalExpirationDate = expDate.toISOString().split('T')[0];
    }

    const result = await pool.query(`
      INSERT INTO student_documents (
        tenant_id, student_id, file_name, file_url, file_type, file_size, s3_key,
        document_category, description, expiration_date, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      tenantId,
      studentId,
      file.originalname,
      `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      path.extname(file.originalname).toLowerCase().replace('.', ''),
      file.size,
      s3Key,
      document_category,
      description || null,
      finalExpirationDate,
      uploadedBy
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/student-documents/download/:id - Get signed download URL
// Lookup + authorization happen in requireDocumentReadAccess, which sets req.document.
router.get('/download/:id', requireAuth, requireDocumentReadAccess, async (req, res) => {
  try {
    const document = req.document;

    // Generate signed URL (valid for 15 minutes)
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: document.s3_key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    res.json({ url: signedUrl, fileName: document.file_name });
  } catch (error) {
    console.error('Error generating download URL:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/student-documents/:id - Delete a document
// Lookup + authorization happen in requireDocumentWriteAccess, which sets
// req.document. Parent branch: uploaded_by must match req.user.id. Staff
// branch: role in STAFF_DELETE_ROLES AND tenant match. The tenant_id is
// repeated in the SQL WHERE as defense in depth.
router.delete('/:id', requireAuth, requireDocumentWriteAccess, async (req, res) => {
  try {
    const document = req.document;

    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: document.s3_key,
    }));

    await pool.query(
      'DELETE FROM student_documents WHERE id = $1 AND tenant_id = $2',
      [document.id, document.tenant_id]
    );

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/student-documents/expiring/:tenantId - Get documents expiring within 30 days
// requireExpiringListAccess has already refused parent role and verified that
// the path :tenantId matches req.user.tenant_id. The SQL sources the tenant
// from req.user (server-authoritative) and re-joins s.tenant_id = sd.tenant_id
// so a crafted student_id cannot pull rows across tenants.
router.get('/expiring/:tenantId', requireAuth, requireExpiringListAccess, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sd.*,
        s.first_name || ' ' || s.last_name as student_name,
        s.grade,
        u.full_name as uploaded_by_name
      FROM student_documents sd
      JOIN students s ON sd.student_id = s.id AND s.tenant_id = sd.tenant_id
      LEFT JOIN users u ON sd.uploaded_by = u.id
      WHERE sd.tenant_id = $1
        AND sd.expiration_date IS NOT NULL
        AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
        AND sd.expiration_date >= CURRENT_DATE
      ORDER BY sd.expiration_date ASC
    `, [req.user.tenant_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/student-documents/categories - Get available categories
router.get('/categories', requireAuth, (req, res) => {
  res.json(Object.keys(DOCUMENT_CATEGORIES));
});

module.exports = router;
module.exports.initializePool = initializePool;