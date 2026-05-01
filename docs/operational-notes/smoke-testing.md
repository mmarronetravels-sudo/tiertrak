# Cowork-side operational runbook: smoke testing and production data ops

**Tracked as:** Followup #11
**Master-index canonical name:** Referenced in activities entries as `SMOKE_TESTING.md` from before this directory existed; current canonical path is `docs/operational-notes/smoke-testing.md`.

**In scope:**

- VITE_API_URL preflight before any local-DB work
- Production data ops via Render psql (one-shot pattern with `BEGIN`/`COMMIT` + `RAISE EXCEPTION` preflights)
- Seed scripts and password handling (operator's local terminal, never via CC's bash tool)
- Roster template-name verification before drafting `INTERVENTIONS`
- Password rotation when chat exposure happens
- VS Code chat panel lazy-render selection truncation gotcha

**Out of scope (tracked separately):**

- Generic seed-script polish (Followups #29 / #30 / #31 / #32 / #33)
- Tenant-form-set registration walkthrough
- Anything not directly related to safe production-data operations and seed-script flows

## Why this doc exists

Sessions 38b, 39, and 40 each surfaced friction or near-misses in production data operations and seed-script flows: localhost frontend authenticating against the production backend; intervention-template-name mismatches forcing transaction rollbacks; password fidelity failures across the chat-rendering layer. This runbook consolidates the rules established in those sessions so future operators do not relearn them by repeating the friction.

## Prerequisites

- Node `>= 22.12.0` (per `package.json` engines).
- Render dashboard access for the production database, with credentials for the **External PSQL Command** listed under the database's "Connect" panel.
- A local terminal that is **not** Claude Code's bash tool — Terminal.app, iTerm2, or any equivalent that writes process stderr directly to terminal scrollback. See `cc-chat-rendering.md` for the byte-diff diagnostic that motivates this distinction.
- An operator workspace folder for uncommitted seed rosters. Roster files contain real customer identifying data and never enter the repo (the Path B convention — committed file is a placeholder schema doc, real rosters live in workspace).

## 1. VITE_API_URL preflight (before any local-DB work)

**Symptom (from a prior session):** an operator started a local backend, reset the local-DB seed admin password via `scripts/seed-tier1-local-test.js`, and tried to log in on the localhost frontend — login failed despite the password being correct in the local DB. Root cause: the localhost Vite frontend reads `VITE_API_URL` from `.env`, which currently resolves to the production Render backend. The local-DB password reset therefore had no effect on the localhost frontend's auth flow, because the frontend was never talking to the local backend.

**Preflight, before any local-DB work:**

```
grep VITE_API_URL .env
```

If the resolved value points at production, decide what you actually want before doing any prep:

- **Local frontend → local backend:** override `VITE_API_URL` to point at the local backend address for the duration of the session — typically via a temporary `.env.local`, or via a shell env var prefix on the `npm --prefix frontend run dev` invocation.
- **Local frontend → production backend:** proceed as-is, but recognize that local-DB password resets won't help with login flows; you will authenticate against production credentials.

Pick the configuration before doing any local-DB-side prep work. Picking after the fact wastes the prep.

## 2. Production data ops via Render psql (the one-shot pattern)

For any production write involving more than a single trivial statement, the established pattern is:

1. **Generate the SQL on the operator's local machine.** Either by running a seed script (Section 3) or by hand-writing a `DO` block in a local editor. Save to `/tmp/<descriptive-name>.sql` (or any other operator-controlled local path).
2. **Connect via the External PSQL Command** from the Render dashboard's database "Connect" panel — not the in-browser shell, which has line-length limits and inconsistent multi-statement handling.
3. **Execute the file in one shot** with `\i /tmp/<descriptive-name>.sql`.
4. **Always wrap in `BEGIN`/`COMMIT`** so partial state is impossible if any preflight or statement fails.
5. **Always include `RAISE EXCEPTION` preflights** for any uniqueness, foreign-key, or cardinality assumption the script relies on. The transaction rolls back atomically on any preflight failure.
6. **Always include a final `RAISE NOTICE`** that prints the inserted tenant id, the updated row count, or whatever single piece of audit-trail evidence proves the operation actually committed.
7. **Delete the SQL file from `/tmp/`** after psql completes. The file may contain bcrypt hashes that should not linger on disk.

Skeleton:

```sql
BEGIN;

DO $$
DECLARE
  v_tenant_id INTEGER;
BEGIN
  -- Preflight: subdomain uniqueness
  IF EXISTS (SELECT 1 FROM tenants WHERE subdomain = '<subdomain>') THEN
    RAISE EXCEPTION 'ABORT: tenant with subdomain % already exists', '<subdomain>';
  END IF;

  -- ... DML statements that capture v_tenant_id via RETURNING id ...

  RAISE NOTICE 'Provisioned tenant id: %', v_tenant_id;
END
$$;

COMMIT;
```

The dollar-quote tag (`$$`) should be sanitized to `[a-zA-Z0-9_]` if it is derived from any operator input — see Followup #29 for the seed-script-side hardening.

## 3. Seed scripts and password handling

**The local-terminal rule:** sensitive output — passwords (any encoding), base64/base64url data verified against a separately-stored hash, cryptographic key material — must be generated in the operator's local terminal, **never** via CC's bash tool. See `cc-chat-rendering.md` for the WHY (three-point byte-diff diagnostic; `CR` → `LF` substitution and a line-level structural-corruption observation in the chat pipeline). This doc is the HOW.

**Concrete invocation** for the generic sandbox seed script:

```
cd <operator workspace>/<sandbox-folder>
node /path/to/scripts/seed-tenant-sandbox-template.js \
  --roster ./roster.js \
  > seed.sql
```

Byte separation in the run above:

- **stdout** (SQL — bcrypt hashes only, no plaintexts) is redirected to `seed.sql`. The file is safe to hand-paste into Render psql.
- **stderr** (the plaintext password table, one row per generated account) is **not** redirected. It writes directly to terminal scrollback — byte-faithful, in volatile memory.

**Do not** redirect stderr to a file (`2> passwords.txt` and equivalents). Plaintexts must stay in volatile terminal memory until hand-delivered, not persisted to disk where they would outlive the operation. Persisting plaintexts is a §4B-adjacent problem in itself.

**After hand-delivery,** clear scrollback (`Cmd-K` in Terminal.app) or close the terminal window to limit plaintext-on-disk exposure. macOS Terminal.app saves scrollback to disk by default in some configurations; iTerm2 has its own persistence settings. The clear-or-close step defends against those.

**Hand-delivery channels:** a one-time secret-sharing service (one that destroys the secret after one read), or in-person if available. **Never** paste plaintexts into chat (CC's chat panel, Slack, email, etc.). The chat-rendering layer can corrupt them per `cc-chat-rendering.md`, and any cached message is a long-lived plaintext exposure independent of the rendering question.

## 4. Roster template-name verification (a pre-flight to a pre-flight)

Before drafting any roster's `INTERVENTIONS` array, run this read-only query against the production database via the External PSQL Command:

```sql
SELECT name
FROM intervention_templates
WHERE tenant_id IS NULL
ORDER BY name;
```

This returns the system-default intervention-template bank — the only set of names a generated `INSERT INTO student_interventions` will accept via the seed script's name-based lookup.

Names are **case-sensitive** and include punctuation and parentheticals exactly as stored. Plausible-sounding names that don't exist in the production bank (from a recent provisioning incident): `Reading Intervention`, `Math Intervention`, `Behavior Support Plan`, `Check-In/Check-Out (CICO)`. The actual production entry for the last one is `Check-in/Check-out` (lowercase "in", no parenthetical).

Doing this verification once up front saves a wasted regenerate-and-retry loop: the seed script's Preflight 3 (template-name match-count = 1) **will** catch a mismatch and roll the transaction back atomically, but only after the SQL has been generated, hand-pasted into psql, and seen the `RAISE EXCEPTION` fire. The cheap query above takes ten seconds and avoids the loop entirely.

## 5. Password rotation when chat exposure happens

When passwords have routed through the chat panel and their fidelity is suspect — or as a defensive rotation regardless — rotate **all** exposed accounts in a single transaction.

1. Generate new plaintexts in the operator's local terminal (not CC's bash tool). A short local Node one-liner using `crypto.randomBytes(12).toString('base64url')` produces 96-bit-entropy passwords.
2. bcrypt-hash them locally. Use `rounds = 10` to match the seed script's convention.
3. Construct an `UPDATE` block updating `users.password_hash` and `users.updated_at` for the affected `user_id`s. Wrap in `BEGIN`/`COMMIT`.
4. Save to `/tmp/<descriptive-name>.sql`. The SQL file contains **only bcrypt hashes** — never plaintexts.
5. Hand-paste into Render psql via External PSQL Command.
6. Verify each affected login post-rotation.
7. Delete `/tmp/<descriptive-name>.sql` and clear terminal scrollback (`Cmd-K`) once hand-delivery is complete.

Skeleton:

```sql
BEGIN;
UPDATE users SET password_hash = '<bcrypt-hash-1>', updated_at = NOW() WHERE id = <user-id-1>;
UPDATE users SET password_hash = '<bcrypt-hash-2>', updated_at = NOW() WHERE id = <user-id-2>;
-- ... repeat for each rotated account ...
COMMIT;
```

Plaintexts stay in operator terminal scrollback until hand-delivered to the affected accounts via a one-time secret-sharing channel. The same hand-delivery and post-delivery cleanup rules from Section 3 apply.

## 6. VS Code chat panel: lazy-render selection truncation

Reference: `cc-chat-rendering.md` Finding 3.

**Quick rule:** before select-all-and-copy on a multi-row chat output, scroll the chat panel to the bottom of the rendered content first. Otherwise off-screen rows are not in the DOM and the clipboard captures only what was visible — a silent truncation, no error indicator, partial content that looks plausibly complete because it ends mid-output rather than mid-character.

**Avoid relying on this workaround for sensitive content.** The Section 3 local-terminal rule is more robust: never put sensitive multi-row output (password tables, key material, base64-encoded data) into the chat panel in the first place, so the lazy-render gotcha cannot apply.

## Pre-flight checklist

Scannable summary of the rules above. Use this list during execution; the body sections explain the why.

- [ ] `VITE_API_URL` verified before any local-DB work (Section 1)
- [ ] Intervention template names verified against production via `SELECT name FROM intervention_templates WHERE tenant_id IS NULL ORDER BY name` (Section 4)
- [ ] Seed script run in operator's local terminal, NOT CC's bash tool (Section 3)
- [ ] SQL wrapped in `BEGIN; ... COMMIT;` envelope (Section 2)
- [ ] Preflights include `RAISE EXCEPTION` for uniqueness / FK / cardinality assumptions (Section 2)
- [ ] Final `RAISE NOTICE` confirms tenant id or row counts post-commit (Section 2)
- [ ] `/tmp/<file>.sql` deleted post-execution (Section 2)
- [ ] All affected logins verified post-provisioning (Sections 2 and 5)

## Related

- `docs/operational-notes/cc-chat-rendering.md` — chat-rendering byte-diff diagnostic. The WHY behind the Section 3 local-terminal rule and the Section 6 lazy-render gotcha.
- Session 38b / 39 / 40 activities entries — origins of each rule recorded above.
- Followups #29 / #30 / #31 / #32 / #33 — generic seed-script polish (out of scope for this doc; tracked separately).
