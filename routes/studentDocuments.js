const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const path = require('path');

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
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        sd.*,
        u.first_name || ' ' || u.last_name as uploaded_by_name,
        u.role as uploaded_by_role,
        CASE 
          WHEN sd.expiration_date IS NOT NULL AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days' 
          THEN true 
          ELSE false 
        END as expiring_soon
      FROM student_documents sd
      LEFT JOIN users u ON sd.uploaded_by = u.id
      WHERE sd.student_id = $1
      ORDER BY sd.uploaded_at DESC
    `, [studentId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student documents:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/student-documents/upload - Upload a document
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { student_id, tenant_id, document_category, description, expiration_date, uploaded_by } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Generate unique S3 key
    const timestamp = Date.now();
    const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const s3Key = `tenant-${tenant_id}/student-${student_id}/${timestamp}-${sanitizedFileName}`;
    
    // Upload to S3
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ServerSideEncryption: 'AES256',
    };
    
    await s3Client.send(new PutObjectCommand(uploadParams));
    
    // Calculate expiration date if not provided and category has default
    let finalExpirationDate = expiration_date || null;
    if (!finalExpirationDate && document_category && DOCUMENT_CATEGORIES[document_category]?.defaultExpirationMonths) {
      const months = DOCUMENT_CATEGORIES[document_category].defaultExpirationMonths;
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + months);
      finalExpirationDate = expDate.toISOString().split('T')[0];
    }
    
    // Save to database
    const result = await pool.query(`
      INSERT INTO student_documents (
        tenant_id, student_id, file_name, file_url, file_type, file_size, s3_key,
        document_category, description, expiration_date, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      tenant_id,
      student_id,
      file.originalname,
      `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      path.extname(file.originalname).toLowerCase().replace('.', ''),
      file.size,
      s3Key,
      document_category,
      description || null,
      finalExpirationDate,
      uploaded_by
    ]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/student-documents/download/:id - Get signed download URL
router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('SELECT * FROM student_documents WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const document = result.rows[0];
    
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
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get document info first
    const docResult = await pool.query('SELECT * FROM student_documents WHERE id = $1', [id]);
    
    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const document = docResult.rows[0];
    
    // Delete from S3
    const deleteParams = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: document.s3_key,
    };
    
    await s3Client.send(new DeleteObjectCommand(deleteParams));
    
    // Delete from database
    await pool.query('DELETE FROM student_documents WHERE id = $1', [id]);
    
    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/student-documents/expiring/:tenantId - Get documents expiring within 30 days
router.get('/expiring/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        sd.*,
        s.first_name || ' ' || s.last_name as student_name,
        s.grade,
        u.first_name || ' ' || u.last_name as uploaded_by_name
      FROM student_documents sd
      JOIN students s ON sd.student_id = s.id
      LEFT JOIN users u ON sd.uploaded_by = u.id
      WHERE sd.tenant_id = $1
        AND sd.expiration_date IS NOT NULL
        AND sd.expiration_date <= CURRENT_DATE + INTERVAL '30 days'
        AND sd.expiration_date >= CURRENT_DATE
      ORDER BY sd.expiration_date ASC
    `, [tenantId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/student-documents/categories - Get available categories
router.get('/categories', (req, res) => {
  res.json(Object.keys(DOCUMENT_CATEGORIES));
});

module.exports = router;
module.exports.initializePool = initializePool;