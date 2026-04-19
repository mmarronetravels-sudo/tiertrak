# CODING PREFERENCES

Code style and convention reference for TierTrak. Loaded on demand via `@` import.

## General principles

- **Match the file you're editing.** TierTrak has been written over time by a small team; the consistency of any given file is more valuable than applying a "best practice" that doesn't fit.
- **Smallest safe change that solves the problem.** No drive-by refactors. No rewriting a function "while you're in there."
- **Readable > clever.** A 10-line obvious function beats a 4-line dense one.
- **No dead code.** If you comment out a block "in case we need it later," delete it — git has it.

## JavaScript

- CommonJS (`require` / `module.exports`) in the backend (this is what the existing files use — check before assuming otherwise).
- ES modules (`import` / `export`) in the frontend (`frontend/src/**`).
- `const` by default; `let` when reassignment is genuinely needed; `var` never.
- Prefer destructuring (`const { rows } = await pool.query(...)`).
- Async/await, not `.then()` chains, unless the chain is genuinely clearer.
- Template literals for string interpolation (never `+` concatenation for multi-variable strings), **except in SQL** — SQL always uses parameterized queries, never template literals.
- One `require`/`import` per line. Sort: Node built-ins → external packages → local modules, with a blank line between groups.

## SQL

- All queries parameterized. No exceptions. Ever.
- Column names: `snake_case`.
- Upper-case SQL keywords (`SELECT`, `FROM`, `WHERE`, `JOIN`, `ORDER BY`).
- One clause per line for any query longer than ~60 chars:
  ```js
  const { rows } = await pool.query(
    `SELECT id, name, grade_level, created_at
     FROM students
     WHERE school_id = $1
       AND archived_at IS NULL
     ORDER BY last_name, first_name
     LIMIT $2`,
    [schoolId, limit]
  );
  ```
- Migrations: always idempotent-safe where possible (`IF NOT EXISTS`, `IF EXISTS`), always write the reverse in a comment at the top so a rollback can be scripted later.

## Error handling

Existing pattern (preserve it):

```js
try {
  // ... work ...
} catch (err) {
  console.error('[module:action]', err.message);
  res.status(500).json({ error: 'Human-readable generic message' });
}
```

- The log tag `[module:action]` helps grep. Add it.
- Log `err.message`, not `err` — the full object often contains PII-adjacent metadata.
- Never pass `err.message` (or any part of `err`) into the response body.
- 4xx responses: include a useful generic message, never the raw DB error.
- 5xx responses: always generic ("Something went wrong", "Failed to …").

## React (frontend)

- Function components only. No class components.
- Hooks: `useState`, `useEffect`, `useContext`, custom hooks as needed.
- Keep components under ~200 lines; extract sub-components when a component grows.
- No inline CSS objects in JSX for anything non-trivial — use the project's CSS files.
- Props are destructured in the function signature.
- Derive state from props where possible; avoid duplicating props into state.

## File size guidance

- Route files: stay under ~600 lines. When a route file grows past that, propose a split along resource boundaries (separate PR).
- Frontend components: stay under ~300 lines including JSX.
- If a function is over ~60 lines, it's probably doing too much — extract.

## Naming

- **Routes.** `resource.js` (singular) for CRUD on one resource; plural only when the file genuinely covers a collection concept (`staffManagement.js`, `interventionPlans.js`). When in doubt, match neighbors.
- **DB columns.** `snake_case`. Booleans start with `is_`, `has_`, or `was_`.
- **JS variables.** `camelCase`.
- **React components.** `PascalCase`.
- **Env vars.** `SCREAMING_SNAKE_CASE`.

## Comments

- Comment the *why*, never the *what*. If you're tempted to write `// loop over students`, the code is already clear.
- A comment above a non-obvious query explaining the business rule is welcome.
- `// TODO:` comments must include a name or ticket number. No anonymous TODOs.
- `// FIXME:` comments must be resolved before merging — do not ship a FIXME.

## Imports (backend)

```js
// Good
const express = require('express');
const { Pool } = require('pg');

const { requireAuth } = require('../src/utils/auth');
const { sanitizeCsvRow } = require('../src/utils/csv');
```

Group: Node built-ins → external → internal. Blank line between groups.

## Imports (frontend)

```js
// Good
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '@/lib/api';
import StudentCard from '@/components/StudentCard';

import './StudentList.css';
```

External → internal (alias paths) → styles.

## Tests

- If the project has tests for a feature you're modifying, update the tests alongside the code change.
- If it doesn't, don't introduce a new test framework without asking (Section 8 trigger).
- Manual verification steps always go in the PR description under "Verification," even when automated tests exist.

## Linting / formatting

- `npm run lint` (root) and the frontend's lint command (check `frontend/package.json`) must pass before opening a PR.
- Do not disable lint rules inline (`// eslint-disable-next-line`) without a comment explaining why, and not more than one per file — if you need more than one, the rule is probably right and the code is wrong.

## Comments on things Claude should NOT do

- Do not add JSDoc comments everywhere. Only where a function's contract is non-obvious.
- Do not add TypeScript. The project is plain JS. Section 8 trigger if you think it should change.
- Do not introduce Prettier config changes. Match existing formatting.
- Do not sort existing imports "while you're in there." Sort only your own additions into the existing order.
