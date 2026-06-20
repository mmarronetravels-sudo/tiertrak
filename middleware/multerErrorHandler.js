// Shared multer error normalizer for the CSV import routes.
//
// Without this, an oversized or non-CSV upload makes multer call next(err)
// with no error-handling middleware downstream, so Express's default handler
// returns a 500 (with a stack trace in non-prod). This middleware maps the two
// expected upload failures to clean, static 4xx bodies instead, and removes any
// partial temp file multer may have written.
//
// Wiring (Option A): append `handleCsvUploadError` as the last entry in each
// CSV import route's middleware array (after `upload.single('file')`). The
// existing per-route multer configs are left as-is (no config dedupe). Each
// route's `fileFilter` must reject non-CSV files with `new InvalidFileTypeError()`
// (below) so type detection is correct-by-construction rather than by matching
// err.message.
//
// §4B: response bodies are static strings — never err.message, never a stack.
// Logs carry err.code only (no PII, no row data).

const multer = require('multer');
const fs = require('fs');

// Marker error for the CSV fileFilter rejection. Tagging with a stable
// `code` lets the normalizer map it to 415 by construction. Anything that is
// NOT a MulterError and NOT this code is treated as genuinely unexpected and
// falls through to Express's default handler — we do not blanket-map.
class InvalidFileTypeError extends Error {
  constructor(message = 'Only CSV files are allowed') {
    super(message);
    this.name = 'InvalidFileTypeError';
    this.code = 'INVALID_FILE_TYPE';
  }
}

// 4-arg Express error-handling middleware.
function handleCsvUploadError(err, req, res, next) {
  if (!err) return next();

  // Best-effort cleanup of any partial temp file multer wrote before erroring
  // (mainly the LIMIT_FILE_SIZE case; fileFilter rejections don't persist a
  // file). multer may already have removed it — unlink errors are ignored.
  if (req.file && req.file.path) {
    fs.unlink(req.file.path, () => {});
  }

  if (err instanceof multer.MulterError) {
    console.error('[csv-upload] multer error code:', err.code);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum upload size is 5 MB.' });
    }
    return res.status(400).json({ error: 'Invalid file upload.' });
  }

  if (err.code === 'INVALID_FILE_TYPE') {
    console.error('[csv-upload] rejected non-CSV upload');
    return res.status(415).json({ error: 'Only CSV files are allowed.' });
  }

  // Genuinely unexpected error — do NOT blanket-map to a 4xx. Hand off to the
  // default handler.
  return next(err);
}

module.exports = { handleCsvUploadError, InvalidFileTypeError };
