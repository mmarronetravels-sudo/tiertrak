# SECURITY REVIEW PROTOCOL

Reference for security-sensitive work in TierTrak. Loaded on demand via `@` import.

This doc complements the `security-reviewer` subagent (`.claude/agents/security-reviewer.md`). The subagent runs the checks; this doc explains the rationale, the patterns to preserve, and the worked examples.

## When a human security review is required

Any PR that touches any of the following must have a human reviewer, not just the subagent:

- `routes/auth.js`
- JWT signing, verification, or claim construction
- Any middleware that decides whether a request is authenticated or authorized
- Password or token hashing
- CSV import sanitization
- File upload validation
- Multi-tenant query scoping (see also `PRIVACY_REVIEW.md` and the `tenant-isolation-auditor`)
- Any new external HTTP call or third-party SDK addition
- Any change to rate limiting, CORS, or security headers
- Any change to session handling or cookie flags

## Secrets management

- Every secret comes from `process.env.<n>` via `dotenv`. No exceptions.
- Required secrets fail fast at startup: if `process.env.JWT_SECRET` is missing, the server should throw at boot, not silently sign with `undefined`.
- `.env`, `.env.local`, `.env.production`, and anything matching `.env.*` are deny-listed for both Claude Code reads and git (`.gitignore`).
- Never echo secret *values* in log lines, even truncated. If you must verify a secret is loaded, log its *presence* only (`console.log('[boot] JWT_SECRET present:', !!process.env.JWT_SECRET)`).
- When adding a new env var:
  1. Add it to a documented list (e.g., `.env.example`, README, or a dedicated config section).
  2. Note the required Vercel environment scope (Development / Preview / Production).
  3. Add a `throw` if it's required and missing.
  4. Never commit the actual value.

## JWT handling

Expected structure:

```js
const jwt = require('jsonwebtoken');

// Signing (auth.js)
const token = jwt.sign(
  { user_id, school_id, role },
  process.env.JWT_SECRET,
  { expiresIn: '12h', algorithm: 'HS256' }
);

// Verification (middleware)
const payload = jwt.verify(
  token,
  process.env.JWT_SECRET,
  { algorithms: ['HS256'] }   // explicit allowlist
);
```

Hard rules:
- Always pass `algorithms: ['HS256']` (or whatever the project uses). Never omit it — omission allows `alg: none` attacks.
- Never accept a token from a URL query string. Header only (`Authorization: Bearer <token>`).
- Expiration is always set. Never issue a non-expiring token.
- Claims contain the minimum needed (user id, tenant id, role, exp). No names, no emails, no PII.

## Parameterized SQL — the only allowed pattern

```js
// CORRECT
const { rows } = await pool.query(
  'SELECT * FROM students WHERE school_id = $1 AND id = $2',
  [schoolId, studentId]
);

// FORBIDDEN — even if studentId "came from a number input"
const { rows } = await pool.query(
  `SELECT * FROM students WHERE school_id = ${schoolId} AND id = ${studentId}`
);

// FORBIDDEN — template literals for SQL at all, even without user input
const { rows } = await pool.query(
  `SELECT * FROM ${tableName} WHERE id = $1`, [id]
);
```

If you need a dynamic table name or column list, validate it against a hardcoded allowlist first:

```js
const ALLOWED_SORT = new Set(['created_at', 'last_name', 'grade_level']);
if (!ALLOWED_SORT.has(sortColumn)) {
  return res.status(400).json({ error: 'Invalid sort' });
}
const { rows } = await pool.query(
  `SELECT * FROM students WHERE school_id = $1 ORDER BY ${sortColumn}`,
  [schoolId]
);
```

## Authorization pattern

Authentication (is this a valid session?) and authorization (can this user touch this resource?) are separate checks. Both are required.

```js
router.get('/students/:id', requireAuth, async (req, res) => {
  const { school_id: callerSchoolId, role } = req.user;
  const studentId = req.params.id;

  // Authorization: scope to caller's school
  const { rows } = await pool.query(
    'SELECT * FROM students WHERE id = $1 AND school_id = $2',
    [studentId, callerSchoolId]
  );

  if (rows.length === 0) {
    // Indistinguishable from "not found" — do NOT leak "wrong school"
    return res.status(404).json({ error: 'Not found' });
  }

  res.json(rows[0]);
});
```

Key point: the tenant scoping is part of the query, not a post-query check. `SELECT ... WHERE id = $1` followed by `if (row.school_id !== callerSchoolId)` is a race-free design but a telling information leak; always scope in SQL.

## File upload validation

Multer configuration for any upload route must include:

```js
const multer = require('multer');
const upload = multer({
  dest: '/tmp/tiertrak-uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024,   // 5 MB — tune per-route, never unlimited
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['text/csv', 'application/pdf']); // per route
    if (!allowed.has(file.mimetype)) {
      return cb(new Error('Unsupported file type'));
    }
    cb(null, true);
  }
});
```

MIME alone is not sufficient — it's client-controlled. For CSVs, still validate the parsed structure. For PDFs, validate the magic bytes if the content will be served back.

CSV files containing student data **must be deleted after processing**, regardless of success or failure:

```js
try {
  await processCsv(req.file.path, /* ... */);
  res.json({ ok: true });
} catch (err) {
  console.error('[csvImport]', err.message);
  res.status(500).json({ error: 'Import failed' });
} finally {
  if (req.file?.path) {
    fs.unlink(req.file.path, () => {}); // non-blocking cleanup
  }
}
```

## External HTTP calls

When adding a `fetch(...)` or an SDK call (Resend, Google, AWS):

- URL is hardcoded or from an env var. Never from user input.
- Authentication headers are from env vars. Never from user input.
- The response's JSON is validated against an expected shape before any field is used.
- Errors from the external call are logged with enough context to debug (`[resend:send]`, `[google:verify]`) but without echoing the full response body (which may contain user email).

## Rate limiting

The project uses a rate-limit middleware (check `server.js` for the current implementation). Whenever you add a new route, mount the rate limiter on it unless there's a documented reason not to. Auth endpoints and any endpoint accepting anonymous input (parent-link lookups, password reset requests) are non-negotiable candidates.

## Security headers / CORS

- `cors({ origin: '*' })` is forbidden on authenticated routes.
- The allowed origin list is maintained in `server.js`. Updating it is a Section 8 ask-first.
- `Helmet` or equivalent security headers should remain enabled on the Express app (check `server.js` startup for the current setup).

## Common attack shapes to check for

- **IDOR.** Any route that accepts an ID and returns a resource without a tenant scope.
- **SSRF.** Any route that makes an HTTP request with a URL derived from user input.
- **Stored XSS.** Any user input that's later rendered to HTML. React escapes by default, but `dangerouslySetInnerHTML` and `<a href={userUrl}>` with `javascript:` URLs are still live rails.
- **Open redirect.** `res.redirect(req.query.next)` without validation. Always maintain an allowlist.
- **Insecure token comparison.** Compare tokens with `crypto.timingSafeEqual`, not `===`, when timing attacks matter (parent-link tokens, password reset tokens).
- **Unvalidated JSON.** `JSON.parse` on user input without a shape check, then using fields directly.

## Rotating a leaked secret

If a secret is suspected or confirmed leaked:

1. **Immediately** rotate in the provider (Supabase DB password, AWS IAM key, Resend API key, JWT_SECRET).
2. Update the Vercel environment variable.
3. For JWT_SECRET specifically: rotating invalidates all live sessions. Communicate this.
4. Audit recent logs for the access pattern that exposed it (public repo commit, pasted into a tool, shared via chat, etc.).
5. File a short postmortem in `docs/` — blameless, what/when/how-we-noticed/what-we-fixed.

## Things NOT to do under any circumstances

- Do not add a "bypass auth for local testing" toggle. Tests use fixtures; they don't bypass middleware.
- Do not add "god mode" or "impersonate any user" admin features without a Section 8 ask-first.
- Do not write your own crypto. Use bcrypt for passwords, `crypto.randomBytes` for tokens, well-maintained libraries for everything else.
- Do not commit a `.env` file "just this once."
- Do not disable a security check to make a test pass — fix the test (or the check).
