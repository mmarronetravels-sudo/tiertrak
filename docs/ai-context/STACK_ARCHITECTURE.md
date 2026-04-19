# STACK ARCHITECTURE

Detailed architecture reference for TierTrak. Loaded on demand via `@` import, not on every session.

See `CLAUDE.md` Section 2 for the hard stack constraints. This file fills in the "how it all fits" that Section 2 deliberately omits to keep per-session context small.

## Deployment topology

```
               ┌────────────────────────────┐
               │         Browser            │
               │  (React + Vite bundle)     │
               └──────────────┬─────────────┘
                              │ HTTPS
                              │
               ┌──────────────▼─────────────┐
               │        Vercel Edge         │
               │  - Serves the static SPA   │
               │  - Routes /api/* to the    │
               │    Express server          │
               └──────────────┬─────────────┘
                              │
               ┌──────────────▼─────────────┐
               │   Express 5 + Node.js      │
               │   (server.js entrypoint)   │
               │   - JWT middleware         │
               │   - Google OAuth exchange  │
               │   - Raw pg queries         │
               └─┬────────┬────────┬────────┘
                 │        │        │
    ┌────────────▼───┐ ┌──▼────┐ ┌─▼─────────┐
    │  PostgreSQL    │ │  S3   │ │  Resend   │
    │ (Supabase)     │ │       │ │           │
    └────────────────┘ └───────┘ └───────────┘
```

## Repository layout

```
tiertrak/
├── CLAUDE.md                   # Authoritative session instructions
├── server.js                   # Express app entrypoint (large; read fully before editing)
├── schema.sql                  # Current target schema
├── migration-*.sql             # Applied migrations, numbered
├── seed-test-data.sql          # Local-dev seed; never run in prod
├── package.json                # Backend deps (Express, pg, jwt, multer, …)
├── routes/                     # One file per resource; all follow the same pattern
│   ├── auth.js                 # JWT + Google OAuth
│   ├── students.js             # Student CRUD
│   ├── interventionPlans.js    # Plans, assignments, logs
│   ├── mtssMeetings.js         # Meetings + outcomes
│   ├── csvImport.js            # CSV roster import
│   ├── prereferralForms.js     # Forms + S3 uploads
│   └── …
├── scripts/                    # Seed + admin scripts (never run against prod)
├── src/
│   └── utils/                  # Shared backend utilities
├── data/                       # Static reference data (e.g., tier1 assessment items)
├── frontend/                   # Vite + React SPA (separate package.json)
│   ├── src/                    # Components, hooks, pages
│   ├── public/                 # Static assets
│   └── vercel.json             # Frontend deployment config
└── docs/                       # Scoping docs, tier1 resources, ai-context
```

## Routing conventions (backend)

Every route file in `routes/` follows the same pattern. Preserve it:

```js
// routes/exampleResource.js
const express = require('express');
const { Pool } = require('pg');
const { requireAuth } = require('../src/utils/auth');  // JWT middleware

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

router.get('/', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;  // ALWAYS from JWT, never from request input
  try {
    const { rows } = await pool.query(
      'SELECT ... FROM example_resource WHERE school_id = $1 ORDER BY ...',
      [schoolId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[exampleResource:list]', err.message); // NEVER log PII or full err
    res.status(500).json({ error: 'Failed to list resources' });
  }
});

module.exports = router;
```

Non-negotiables embedded in this pattern:
- JWT middleware on every authenticated route (no exceptions for "just read-only")
- Tenant identifier derived from `req.user`, not request input
- Parameterized queries only; never string interpolation
- Error handler logs the error **message**, not the full object, and never echoes request bodies
- Response error bodies are generic ("Failed to …"), never leak DB details

## Database conventions

- `snake_case` column names throughout
- `id` is `serial primary key` unless a UUID is specifically needed
- Every tenant-scoped table has an indexed tenant column (`school_id`, `tenant_id`, etc.)
- `created_at timestamptz NOT NULL DEFAULT now()` on every row
- `updated_at timestamptz` on rows that mutate (application sets on update)
- Foreign keys are explicit; we do NOT rely on ORM cascade — we write the `ON DELETE` behavior into DDL
- Migrations are numbered (`migration-018-*.sql`). Never reuse or skip a number. Never edit a shipped migration — write a new one.

## Auth flow

1. Browser requests Google OAuth consent via frontend.
2. Frontend sends ID token to `/api/auth/google`.
3. Backend verifies the token with `google-auth-library`, looks up (or provisions) the user, enforces domain/school mapping, issues a TierTrak JWT.
4. JWT contains: `user_id`, `school_id`, `role`, `exp`. Nothing else.
5. Every subsequent API call sends the JWT in `Authorization: Bearer <jwt>`.
6. `requireAuth` middleware verifies the JWT and attaches decoded claims to `req.user`.
7. Route handlers read `req.user.school_id` for tenant scoping and `req.user.role` for RBAC.

Password logins (Resend magic links, recovery flows) go through `routes/auth.js` — see `migration-013-password-reset.sql` for the token table shape.

## File upload flow (S3)

1. Frontend requests a presigned upload URL from a dedicated endpoint.
2. Backend validates the caller's tenant + role, validates the proposed filename + content-type against an allowlist, and generates a presigned PUT URL scoped to a tenant-specific key prefix (`schools/<school_id>/<resource>/<uuid>-<safe-filename>`).
3. Frontend uploads directly to S3.
4. Frontend POSTs the resulting S3 key back to the backend to record it against the resource.
5. Downloads go through a presigned GET URL, never a raw bucket path.

Raw bucket URLs must never appear in API responses or frontend code.

## CSV import flow

Multer → local tmp file → parse with `csv-parser` → sanitize each row → parameterized inserts in a transaction → `fs.unlink` the tmp file in a `finally`. The `finally` is non-negotiable: uploaded CSV files contain PII and must not persist.

## Frontend conventions

- Vite build, React 18+, plain CSS (no CSS-in-JS framework), React Router for pages
- No global state management library — component state + context where needed
- API calls go through a small `fetch` wrapper that attaches the JWT from localStorage
- Never store a password in state or localStorage. JWTs may live in memory or localStorage per the current implementation — before changing this, read `frontend/src` end-to-end
- Never `dangerouslySetInnerHTML` with backend-returned content

## Things that look like they should exist but don't

- No ORM. Do not add one.
- No Redis / caching layer. Do not add one without approval.
- No background job queue. Long-running work is out of scope for a request/response cycle; if a new feature needs async work, that is a Section 8 ask-first trigger.
- No email provider besides Resend. Do not add Sendgrid, Postmark, etc.
- No websockets. Real-time updates, if ever added, should be proposed and approved first.
