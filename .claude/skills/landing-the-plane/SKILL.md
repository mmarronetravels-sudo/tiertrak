---
name: landing-the-plane
description: "Close out a TierTrak coding session cleanly. Use at the end of any task where code was changed. Verifies tests pass, finalizes the feature branch (merge/PR/keep/discard) — delegating to the superpowers:finishing-a-development-branch skill when available — and then appends a structured session entry to activities.txt so the next session can pick up with full context. Triggers on phrases like 'land the plane', 'close this out', 'wrap up', 'finish session', 'end of task', or whenever the human signals the work unit is complete."
---

# Landing the Plane

This skill is TierTrak's standard end-of-session ritual. It guarantees that every coding session ends with:
1. Tests green on the current branch
2. An explicit disposition of the branch (merged, PR opened, kept, or discarded)
3. A durable log entry in `activities.txt` so future sessions (and future teammates) can reconstruct what happened without re-reading the whole conversation

## When to use

Use this skill **every time** a coding task wraps up, not just when something ships. Even if the user says "let's keep it as-is and pick up tomorrow," log that disposition. The point is continuity.

Trigger signals:
- Explicit: "land the plane," "close this out," "wrap up," "we're done," "call it for today," "finish session"
- Implicit: the user confirms the task's acceptance criteria are met and no further edits are coming
- Task completion: the plan produced by `superpowers:writing-plans` has all checkboxes ticked

Do **not** use this skill mid-task. If tests are failing or the branch is not in a reviewable state, fix that first.

## The process

Announce at start: "I'm using the landing-the-plane skill to close this session."

### Step 1 — Verify

Run, in order:
1. `git status` — confirm no stray uncommitted changes. If any exist, surface them and ask whether to commit or discard.
2. `git branch --show-current` — confirm the current branch is **not** `main` or `master`. If it is, stop and explain that TierTrak's CLAUDE.md Section 2A forbids landing from those branches.
3. The project's test command (`npm test` from the repo root, and `npm test` or the equivalent inside `frontend/` if the task touched UI code).
4. `npm run lint` (root and/or `frontend/` as relevant).

If any of these fail, **stop**. Report the failure. Do not proceed to Step 2.

### Step 2 — Finalize the branch

If the Superpowers plugin is installed (check via `/plugin` or by the presence of the `superpowers:finishing-a-development-branch` skill), **delegate to it**. Announce: "Handing off to superpowers:finishing-a-development-branch for branch disposition." Let it present the four options (merge locally / push and open PR / keep branch / discard).

If Superpowers is **not** installed, run the equivalent inline:

```
Implementation complete. What would you like to do?
1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work
Which option?
```

Then execute the chosen path using `gh pr create` with the PR template from CLAUDE.md Section 2A for option 2, or the corresponding git commands for the others. Wait for explicit user confirmation before any destructive action (option 4).

### Step 3 — Append to activities.txt

After the branch has a clear disposition, append a new entry to `activities.txt` in the project root. Create the file if it does not yet exist. Entries are append-only; never rewrite or delete prior entries.

Use exactly this format (keep the separators — they make the file parseable):

```
================================================================================
SESSION: <ISO-8601 timestamp, e.g. 2026-04-19T15:42:00-07:00>
BRANCH:  <feature-branch-name>
DISPOSITION: <merged | pr-opened:<pr-url> | kept | discarded>
--------------------------------------------------------------------------------
TASK SUMMARY
  <2–4 lines: what the user asked for, in plain language>

FILES TOUCHED
  <relative/path/file.ext> — <one-line reason>
  <relative/path/file.ext> — <one-line reason>

MIGRATIONS RUN
  <migration-XXX-name.sql> — <description>   (or "none")

TENANT ISOLATION REVIEW
  <"no DB changes" | summary of scoping checks performed>

PRIVACY REVIEW (Section 4B)
  PII fields touched: <list | "none">
  Logging audit: <"verified no PII in logs" | notes>
  Cross-tenant risk: <"none identified" | details>

VERIFICATION
  <exact commands that were run AND their result>
    e.g. npm test — 47 passed, 0 failed
         npm run lint — clean
         psql test db migration dry-run — success

OPEN ITEMS / FOLLOW-UPS
  <bulleted list of anything not finished, or "none">

NEXT SESSION SHOULD
  <one or two short instructions future-Claude will read at session start>
================================================================================
```

### Step 4 — Report back

Show the user a 3-line summary:
- Branch disposition
- Activities entry path (`activities.txt`)
- Any open items recorded

Then stop. Do not start the next task.

## Guardrails

- Never write anything to `activities.txt` that would itself violate CLAUDE.md Section 4B. That means: **no student names, no student IDs, no staff names, no email addresses, no tenant-identifiable slugs.** Refer to records by table + row-count or by generic description ("updated 3 intervention-plan rows for 1 test tenant"), never by PII.
- Never commit `activities.txt` changes to a feature branch that will be squashed — it should ride on its own commit on the branch, or be merged separately to `main` via a trivial `chore/activities-log` PR. The project convention: **`activities.txt` is committed directly to `main` via a dedicated PR** so the log stays linear and doesn't get lost in squashes.
- If the user says "don't log this session," honor that but also log the fact that a session was explicitly not logged ("SESSION: <timestamp> / DISPOSITION: unlogged-by-request"), so the audit trail isn't silently broken.
- This skill is the last thing that runs in a session. After Step 4, respond to no further coding requests — if the user has a new task, they should start a fresh session so context starts clean (per Anthropic's `/clear` guidance).
