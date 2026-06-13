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
2. `git branch --show-current` — for **work sessions** (any code change), confirm the current branch is **not** `main` or `master`. If it is, stop and explain that TierTrak's CLAUDE.md Section 2A forbids landing from those branches.

   **Exception — activities-log-only sessions:** if this session's only intended change is appending to `activities.txt` for a prior session's close, the operator legitimately starts on `main` and the skill then creates `chore/activities-log-session-N` from `main`. The main-branch forbid does not apply to this workflow. See `feedback_activities_log_separate_pr.md` and the bottom guardrail at the foot of this file.
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

Then execute the chosen path using `gh pr create` with the PR template from CLAUDE.md Section 2A for option 2, or the corresponding git commands for the others.

**§4B discipline on the PR body itself** (option 2 only): the §2A template's Privacy impact section must attest that §4B was run, never describe what was checked for. Describing a pattern category in the body inherits the category's matching strings — a recursion trap documented in the activities log. Cite acts and results only — e.g., "§4B grep (narrow + wide) against diff vs origin/main: 0 matches." Do not enumerate the patterns; refer the reader to `docs/ai-context/4B_GREP_PATTERNS.md`.

After creating the PR, re-grep the PR body itself with the same patterns. The body must clear the same gate as the file diff. If hits appear, remediate via `gh pr edit --body-file` until both narrow and wide passes are empty.

Wait for explicit user confirmation before any destructive action (option 4).

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

  FIXES:
    <finding-id> → PR #<N> @ <40-char SHA>
  # Omit the FIXES: block entirely if this session has no
  # fix-claims to log. When present, each line is parsed and
  # gated by the misattribution check; full 40-char SHAs only.

NEXT SESSION SHOULD
  <one or two short instructions future-Claude will read at session start>
================================================================================
```

**Before staging the activities.txt edit**, run all four gates in order: the **orphaned-commit gate**, then the **merge-SHA verification gate**, then the **misattribution check**, then the **§4B grep gate**. All must pass before the entry is staged.

#### Orphaned-commit gate

Purpose: protect against a **stacked-PR mis-merge** — a feature PR whose base is another PR's branch (not `main`) that merges into that base AFTER the base PR has already merged to `main`, orphaning the feature commits from `main`. GitHub reports the feature PR as `MERGED`, yet its commits never reach `main`, so a deploy of `main` ships without them. This is the failure mode recorded in `feedback_stacked_pr_land_base_first.md` (the commit route 404'd in prod while the dry-run 200'd, because only the dry-run had reached `main`).

This gate runs FIRST, before the merge-SHA verification gate. The merge-SHA gate compares a PR's recorded head against that same PR's merge-commit second-parent — those MATCH on a stacked mis-merge (the feature tip WAS cleanly merged, just into the wrong base), so the merge-SHA gate is silent on the orphan. "Did the commits reach `main`?" is the more fundamental question and must be answered first.

**Scope — what this gate catches:**
- A feature PR merged into a stacked base branch instead of `main`, leaving its commits unreachable from `main`.
- Any logged-as-landed branch whose recorded head is not an ancestor of `origin/main`.

**Scope — what this gate does NOT catch:**
- A correctly stacked PR whose base was later merged to `main` carrying the stack (the commits DID reach `main`). The reachability test passes; the `baseRefName != main` signal is downgraded to an INFO note, not a HALT (see Step 2).
- SHA drift on a branch that did reach `main` — that is the merge-SHA gate's job.

The gate keys off the **DISPOSITION** field, reusing the merge-SHA gate's Step 0 classifier and the same `gh pr view` call (add `baseRefName` to the `--json` field list).

**Step 0 — Applicability (same classifier as the merge-SHA gate).**
- **`pr-opened:<pr-url>` with `state == MERGED`**, or **bare `merged` whose branch resolves to a merged PR** → run the gate.
- **`pr-opened:<pr-url>` with `state == OPEN`** → SKIP; emit `orphaned-commit gate: SKIPPED — PR #<N> not merged yet` (commits are expected to NOT be on main yet).
- **`merged` (bare) with no PR found** (legitimate local merge) → run Step 1 against the local branch tip; `baseRefName` is N/A.
- **`kept` / `discarded` / `unlogged-by-request`** → SKIP; emit `orphaned-commit gate: SKIPPED — <disposition> (branch not landed by design)`. A non-empty `main..branch` is expected and is not an error.

**Step 1 — Reachability (the hard gate).**
- `git fetch origin main -q`
- `HEAD_OID=$(gh pr view <PR> --json headRefOid -q .headRefOid)` — for a local merge with no PR, use the branch tip: `HEAD_OID=$(git rev-parse <branch>)`.
- `git merge-base --is-ancestor "$HEAD_OID" origin/main`
  - exit `0` → **landed (PASS)** — continue to Step 2.
  - exit `1` → **ORPHANED (HALT)** — print the block below.
- `merge-base --is-ancestor` is the canonical test — robust to a deleted branch ref and to post-merge commits on the branch. The human-readable equivalent for the failure block is `git log --oneline origin/main..origin/<headRefName>` (the count of commits not on `main`).

**Step 2 — baseRefName (paired diagnostic / soft-signal).**
- `BASE=$(gh pr view <PR> --json baseRefName -q .baseRefName)` — N/A for a local merge.
- Reachability PASSED and `BASE == main` → silently continue to the merge-SHA verification gate.
- Reachability PASSED but `BASE != main` (a MERGED PR) → emit an **INFO note, NOT a HALT**:
  `orphaned-commit gate: INFO — PR #<N> merged via stacked base <BASE>; commits DID reach main (verify intended).`
  This is the correct-stacked-flow case (the base was later merged to `main` carrying the stack). Record the INFO note in the entry's VERIFICATION section.

**On HALT** — print exactly (SHA + kebab branch names only; §4B-safe, same output discipline as the other gates):

```
ORPHANED-COMMIT GATE — HALT
  PR:            #<N>   state=MERGED   base=<baseRefName>
  Branch:        <headRefName>
  Head SHA:      <40-char HEAD_OID>
  Reachability:  head is NOT an ancestor of origin/main
  Not on main:   <count>  (git log --oneline origin/main..origin/<headRefName>)

  These commits never reached main. A MERGED status with base=<baseRefName>
  (not main) means the PR merged into its stacked base. The activities entry
  was NOT written.

  Fix: open a fresh <headRefName> -> main PR with the identical commits, land
  it, then re-run the skill. See feedback_stacked_pr_land_base_first.md.
```

On a clean PASS, record in the entry's VERIFICATION section:
`orphaned-commit gate: PASS — <headRefName> head is an ancestor of origin/main (base=<baseRefName>).`

#### Merge-SHA verification gate

Purpose: protect against post-merge SHA drift between GitHub's recorded branch tip (`headRefOid` at the time of merge) and the local merge commit's second parent. When these diverge, the activities entry would record a "merged" disposition for a commit that is not actually the one preserved as the merge's feature-side parent.

**Scope — what this gate catches:**
- Post-merge force-push to the feature branch that retroactively changes its tip
- Admin override merge of a SHA that is not the PR's head
- Stale-ref scenarios where the merged SHA differs from the branch tip GitHub last recorded

**Scope — what this gate does NOT catch:**
- Prose misattribution within the activities entry (e.g., a TASK SUMMARY claiming a fix landed in PR #N when it actually landed in PR #M). The gate pulls all SHAs from `gh` and `git`; it cannot cross-check narrative claims. The misattribution check in the next sub-section addresses the structural form (citing a commit not in the cited PR) via a required FIXES: block; free-prose claims outside that block remain ungated.

The gate keys off the **DISPOSITION** field of the entry being drafted.

**Step 0 — Recover PR number.** The DISPOSITION field is operator-authored each session and is NOT auto-updated post-merge. The `pr-opened:<pr-url>` form persists only if the operator preserves it; bare `merged` after a PR-shipped session is an anti-pattern because it strips the PR# that the gate needs to run at all. Classify:

1. **`pr-opened:<pr-url>`** — parse PR# from URL; query `gh pr view <PR> --json state,mergeCommit,headRefOid,headRefName`.
   - `state == MERGED` → proceed to Step 1.
   - `state == OPEN` → emit `merge-sha verification: SKIPPED — PR #<N> not merged yet` and continue.
2. **`merged`** (bare) — the gate must NOT silently skip. Run a branch→PR lookup:
   `gh pr list --search "head:<branch-name>" --state merged --json number,url -q '.[0]'`
   - If a merged PR **is found** → HALT with the UNVERIFIABLE block below (the DISPOSITION is wrong for this session).
   - If no PR found → legitimate local merge; emit `merge-sha verification: SKIPPED — local merge, no PR` and continue.
3. **`kept` / `discarded` / `unlogged-by-request`** — N/A.

**Step 1 — Capture feature tip SHA.**
`HEAD_OID=$(gh pr view <PR> --json headRefOid -q .headRefOid)`

**Step 2 — Capture merge-commit second-parent SHA.**
- `MERGE_OID=$(gh pr view <PR> --json mergeCommit -q .mergeCommit.oid)`
- `git fetch origin main`
- Detect merge style by parent count:
  `PARENT_COUNT=$(git rev-list --parents -n 1 "$MERGE_OID" 2>/dev/null | tr ' ' '\n' | tail -n +2 | wc -l | tr -d ' ')`
- If `MERGE_OID` is empty/null → **rebase or fast-forward** (no merge commit on `main`). Emit LOUD-SKIP.
- If `PARENT_COUNT == 1` → **squash merge**. Emit LOUD-SKIP.
- If `PARENT_COUNT == 2` → true merge commit; `PARENT2=$(git rev-parse "$MERGE_OID^2")`.

**Step 3 — Compare.** 40-char string equality of `HEAD_OID` and `PARENT2`.

**On MATCH** — silently continue to the §4B grep paragraph below.

**On MISMATCH** — HALT before composing the entry. Print exactly:

```
MERGE-SHA VERIFICATION — MISMATCH
  Work PR:               #<pr-number>
  Feature branch:        <headRefName>
  Feature tip SHA:       <40-char HEAD_OID>
  Merge commit SHA:      <40-char MERGE_OID>
  Merge second-parent:   <40-char PARENT2>

  The merge commit's second parent does not match the feature
  branch's recorded tip. The activities entry was NOT written.
  Likely causes:
    - Commits pushed to the feature branch after the PR was merged
    - PR merged from a different SHA than the branch tip
    - Force-push to the feature branch post-merge

  Resolve before logging. Options:
    1. Investigate — stop here; do not log this session
    2. Log with a DIVERGENCE note recording both SHAs in
       OPEN ITEMS / FOLLOW-UPS (only after investigation concludes)
    3. Abort the skill
```

**On UNVERIFIABLE** (bare `merged` DISPOSITION but a merged PR exists for the branch) — HALT. Print exactly:

```
MERGE-SHA VERIFICATION — UNVERIFIABLE
  Branch:        <branch-name>
  DISPOSITION:   merged   (bare; documented as "local merge, no PR")
  PR found:      #<N>     (via gh pr list --search head:<branch-name>)

  The DISPOSITION claims a local merge but a merged PR exists for
  this branch. The activities entry was NOT written.

  Fix: change DISPOSITION to "pr-opened:<pr-url>" and re-run.
```

**On SQUASH / REBASE / FAST-FORWARD merge** — gate cannot run because the feature tip SHA is not preserved on `main`. Print this LOUD-SKIP block to the user (NOT just a buried VERIFICATION note):

```
========================================================================
MERGE-SHA VERIFICATION — SKIPPED  (PR #<N>, <squash | rebase | fast-forward>)
------------------------------------------------------------------------
The feature tip SHA is not preserved on main with this merge style,
so the gate cannot run for this entry.

This skip is expected if you intentionally squash/rebase a PR. If you
start seeing this skip on EVERY session, the project's merge convention
has drifted away from merge-commits and this protection has effectively
turned off. Re-evaluate the gate.
========================================================================
```

Record in the entry's VERIFICATION section: `merge-sha verification: SKIPPED — <squash | rebase | fast-forward> merge for PR #<N>`. The all-caps `SKIPPED` token is grep-able across `activities.txt` history so a streak of skips across consecutive sessions is visible.

**Output rules (all blocks above).** Print SHAs and kebab-case branch names ONLY. Never include PR title, commit subjects, ref descriptions, or row data — they can carry PII (per §4B and `feedback_4b_per_entry_standard.md`). 40-char SHAs and `feat/...`/`sec/...`/`chore/...` branch names are safe by construction.

#### Misattribution check

Purpose: protect against the failure mode in which an activities entry claims a specific fix lives in PR #N but the cited commit was never part of PR #N. Catches the S99-class misattribution that the merge-SHA gate cannot — head-SHA equality between PR head and merge second-parent is silent on what individual commits sat on the branch leading up to that head.

**Honest residual.** This check verifies that a cited commit is **contained** in the cited PR's commit list, not that it is the **correct** fix. A wrong-but-present commit (one that IS in PR #N's commit list but isn't the fix the prose describes) would still PASS. The auto-fill flow (which presents the cited PR's own commits for the operator to pick from) is the behavioral mitigation against citing-the-wrong-commit; the mechanical check covers only the structural failure mode of citing a commit that simply isn't in the PR at all.

**Scope — what this check catches:**
- A FIXES: line citing a commit SHA that is not in the cited PR's commit list (the S99 explicit-cite-of-a-not-in-PR-commit pattern).
- The S99 implicit-cite pattern by structural rejection: the FIXES: block requires explicit (PR #, SHA) pairs; "FIXED in-PR" prose without a structured entry contributes no fix-claim to verify, which forces explicit citation if the operator wants the fix-claim logged at all.

**Scope — what this check does NOT catch:**
- A commit that IS in the cited PR but is the wrong fix (mechanical SHA-equality cannot distinguish two same-PR commits semantically — auto-fill UX is the mitigation, not a check).
- Free-prose fix claims outside the FIXES: block (the parser reads only the structured block; prose claims remain reviewer-readable but are not gated).

**Structured FIXES: block format.** When an entry has any fix-claim to log, it MUST include a FIXES: block inside the OPEN ITEMS / FOLLOW-UPS section. The parser reads ONLY this block.

```
FIXES:
  <finding-id> → PR #<N> @ <40-char SHA>
  <finding-id> → PR #<N> @ <40-char SHA>
```

Each line matches:

```
^\s*[^→]+→\s*PR\s+#(\d+)\s+@\s+([0-9a-f]{40})\s*$
```

Full 40-char OIDs only — no abbreviated SHAs. Abbreviated SHAs would force a prefix-match that loses precision (multiple commits in a PR's history can share a 7-char prefix); 40-char OIDs make the membership comparison unambiguous.

**The check** for each (PR #N, commit X) parsed from FIXES:

1. Fetch PR #N's commit OID list:
   `OIDS=$(gh pr view N --json commits -q '.commits[].oid')`
2. Test exact-SHA membership (whole-line match):
   `echo "$OIDS" | grep -Fxq "$X"`
3. Match (exit 0) → PASS. No match (exit 1) → HALT.

This is a **SHA-only operation**. The check never reads, compares, or writes commit messages or subjects — same discipline as the merge-SHA gate (per §4B and `feedback_4b_per_entry_standard.md`).

**Why exact-SHA membership against `gh pr view --json commits` instead of `git merge-base --is-ancestor` against the merge commit:**

- **Merge-commit merges:** both primitives return the same answer.
- **Squash merges:** GitHub preserves the pre-squash feature-branch commit list in the PR's `commits` array. Membership PASSes for legitimately-squashed claims; ancestry against the post-merge squash commit would FAIL because the original SHAs aren't reachable from `main` after squash.
- **Rebase merges:** same — PR's `commits` array preserves pre-rebase SHAs; ancestry against the rebased main would fail.
- **Cherry-picks:** a cherry-pick has a different SHA than its source. Membership correctly distinguishes — citing the source SHA against the destination PR returns no membership match (the destination PR's `commits` array contains the cherry-pick's new SHA, not the source's SHA). Subject-matching, by contrast, would falsely PASS the cherry-pick because subjects survive the SHA change; this is exactly why subject-matching is rejected even as a squash/rebase fallback.

The unified primitive (membership for all merge styles) keeps the gate simple and preserves the cherry-pick guarantee that any subject-based primitive would lose.

**Auto-populate flow.** At entry-compose time, for each FIXES: line where the operator has named a PR but left the SHA unfilled (e.g., `privacy WARN-1 → PR #162 @ <fill>`), the skill:

1. Runs `gh pr view N --json commits` to fetch the PR's commit list (OIDs + headlines).
2. Presents the operator **interactively** with the commit headlines + abbreviated SHAs side-by-side, for selection only.
3. Operator picks a commit; the skill writes ONLY the 40-char full OID into the FIXES: block — never the headline.

Operator never types a SHA. Commit headlines are visible at selection time but are NOT committed to the file (per §4B output discipline). The fix-claim's narrative description (the part to the left of `→`) is operator-authored prose and lives in the entry.

**SHA-only Design B supplement — WORK-PR COMMITS section.** For every PR logged in DISPOSITION / BRANCH STATE, the skill auto-appends a new section between VERIFICATION and OPEN ITEMS:

```
------------------------------------------------------------------------
WORK-PR COMMITS (SHA-only manifest, auto-generated)
------------------------------------------------------------------------

PR #<N> commit OIDs at merge time:
  <40-char SHA>
  <40-char SHA>

PR #<M> commit OIDs at merge time:
  <40-char SHA>
```

40-char SHAs and PR numbers ONLY — no headlines, no branch names, no subject lines. Provides raw material for future auditors to spot misattribution that the structured FIXES: block didn't parse (e.g., free-prose fix claims the parser ignores), while preserving the §4B output discipline.

**On MATCH** (every FIXES: line PASSes membership, or the FIXES: block is absent) — silently continue to the §4B grep gate.

**On HALT** (any FIXES: line fails membership) — print exactly:

```
MISATTRIBUTION CHECK — HALT
  FIXES: line:          <finding-id> → PR #<N> @ <40-char SHA>
  Cited PR:             #<N>
  Cited commit:         <40-char SHA>
  PR commit list size:  <count>
  Membership test:      SHA NOT FOUND in `gh pr view <N> --json commits`

  The activities entry was NOT written. The cited commit is not
  part of the cited PR's commit list. Either:
    1. Correct the PR number to one whose commit list contains
       this SHA
    2. Correct the SHA to one actually in PR #<N>'s commit list
    3. Investigate — the fix may have been lost (S99-class
       merge-race) or never shipped
```

(Output discipline: 40-char SHAs and PR numbers only. No commit headlines, no PR titles, no subject lines. The kebab-case branch names already permitted by the merge-SHA gate's output rules remain the only branch identifiers allowed in gate output.)

#### §4B grep gate

After both the merge-SHA gate and the misattribution check have passed (or emitted documented skip notes), run §4B grep against the new content. Per `feedback_4b_per_entry_standard.md`, evaluate the diff against `origin/main` (the new entry only), not the whole file. The pattern catalog lives in `docs/ai-context/4B_GREP_PATTERNS.md`; tenant-slug enumeration is operator-supplied at grep-time per the lookup mechanism described there.

Both narrow and wide grep passes must return zero matches against added lines only (`^+` excluding `^+++`). If matches surface:
- Remediate via in-line `[tenant]` marker substitution for tenant identifiers.
- For other PII shapes, replace with generic descriptions (e.g., "3 intervention-plan rows for 1 test tenant").
- Re-run both grep passes after each remediation; do not stage until both are clean.

A supplemental pair-shape pass (`\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b`) catches the most common leak vector — real person names embedded in prose — but produces operational-text false positives that require manual review. Treat it as belt-and-suspenders, not a gating check.

This grep is not optional — it is the procedural enforcement of the bottom guardrail near the foot of this file.

**Out of scope:** master-index synchronization (assigning permanent Followup numbers, updating cross-references across memory files) is operator-side housekeeping, not part of this skill. Surface followups inside the `OPEN ITEMS / FOLLOW-UPS` section of the activities entry; permanent numbering and cross-reference reconciliation happen in a separate ritual.

### Step 4 — Report back

Show the user a 3-line summary:
- Branch disposition
- Activities entry path (`activities.txt`)
- Any open items recorded

Then stop. Do not start the next task.

## Guardrails

- Never write anything to `activities.txt` that would itself violate CLAUDE.md Section 4B. That means: **no student names, no student IDs, no staff names, no email addresses, no tenant-identifiable slugs.** Refer to records by table + row-count or by generic description ("updated 3 intervention-plan rows for 1 test tenant"), never by PII.
- The **orphaned-commit gate** in Step 3 is non-optional and runs FIRST (before the merge-SHA gate). For any DISPOSITION logged as landed-on-main (`pr-opened` whose PR is `MERGED`, or bare `merged`), the PR's recorded head must be an ancestor of `origin/main` (`git merge-base --is-ancestor`) or the gate HALTs — the commits never reached `main` (the stacked-PR mis-merge from `feedback_stacked_pr_land_base_first.md`). `baseRefName != main` on a reachable PR is an INFO note, not a HALT. The merge-SHA gate cannot catch this: it MATCHES on a stacked mis-merge because the feature tip was cleanly merged into the wrong base.
- The **merge-SHA verification gate** in Step 3 is non-optional. For any DISPOSITION that names a PR (or bare `merged` whose branch resolves to a merged PR via search), the gate must run and must pass or HALT. A LOUD-SKIP block on every session means the project's merge convention has drifted to squash/rebase and this protection has effectively turned off — re-evaluate the gate, do not normalize the skip.
- The **misattribution check** in Step 3 is non-optional for any entry that includes a FIXES: block. The block uses the parseable `<finding-id> → PR #<N> @ <40-char SHA>` format; each line's SHA must be a member of the cited PR's commit list per `gh pr view <N> --json commits`. The check is SHA-only by design — commit headlines are visible interactively at SHA-pick time but are NEVER written into `activities.txt`. The check verifies CONTAINMENT, not CORRECTNESS — a wrong-but-present commit cited as the fix would still PASS; the auto-fill UX (presenting the cited PR's own commits) is the behavioral mitigation. The `WORK-PR COMMITS` section the skill auto-appends to every entry is SHA-only manifest evidence, never headlines or subjects.
- Never commit `activities.txt` changes to a feature branch that will be squashed — it should ride on its own commit on the branch, or be merged separately to `main` via a trivial `chore/activities-log` PR. The project convention: **`activities.txt` is committed directly to `main` via a dedicated PR** so the log stays linear and doesn't get lost in squashes.
- If the user says "don't log this session," honor that but also log the fact that a session was explicitly not logged ("SESSION: <timestamp> / DISPOSITION: unlogged-by-request"), so the audit trail isn't silently broken.
- This skill is the last thing that runs in a session. After Step 4, respond to no further coding requests — if the user has a new task, they should start a fresh session so context starts clean (per Anthropic's `/clear` guidance).
