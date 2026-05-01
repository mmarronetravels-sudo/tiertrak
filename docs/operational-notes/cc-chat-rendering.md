# Cowork-side operational note: CC chat rendering and password fidelity

**Tracked as:** Followup #34
**Source incident:** Session 40 activities entry, Catches #5 and #6

## Summary

Bytes written by a Node script to stderr can be transformed between the running process and the operator's clipboard when the script is executed via Claude Code's bash tool inside the VS Code Claude Code chat panel. This document records a three-point byte-diff diagnostic that isolates where in the pipeline the transformation occurs, names the specific transforms observed, and reaffirms the operational rule established in Session 40: sensitive or character-sensitive output runs in the operator's local terminal, never via CC's bash tool.

## Symptom

During a production tenant provisioning in an earlier session, plaintext passwords output by a seed script — run via CC's bash tool, captured into the chat conversation, then copied by the operator into a downstream password rotation step — failed to bcrypt-verify against the corresponding hashes that landed in the database. Standalone testing of the seed script's emit logic on a tiny isolated roster confirmed that all plaintext + hash pairs verified correctly when run outside the CC bash-tool path. The corruption therefore occurred somewhere between the script's stderr and the operator's clipboard, not in the script itself.

## Repro

A workspace-only deterministic test script (referred to hereafter as `<operator workspace>/cc-chat-rendering-repro.js`) emits a battery of 33 test strings to stderr. The script is intentionally not committed to this repo; it lives in the operator's workspace directory only. All test data is synthetic ASCII; no real passwords or PII are involved.

The test battery covers:

- The base64url alphabet (the Session 40 incident's exact charset)
- Smart-typography candidates: hyphen pairs/triples, ellipsis, straight quotes, apostrophe-in-word
- Markdown attractor characters: underscore, asterisk, backtick, pipe, square bracket, www-style auto-link
- Backslash escape sequences
- Multi-space runs (2/3/4 spaces)
- HTML angle brackets
- Boundary / control bytes: CR, tab, NUL, ESC, leading/trailing whitespace, paragraph break
- A column-aligned table mirroring the original incident's output layout
- Two adversarial single-row tables specifically targeting cell-edge trailing-underscore and trailing-hyphen hypotheses

Bytes are captured at three points in the pipeline:

| Point | Where | Capture mechanism |
|-------|-------|-------------------|
| **A** | Operator's local terminal — direct stderr from the Node process | `node <script> 2> /tmp/A.bin` |
| **B** | CC bash tool — stderr redirected to disk inside the bash subprocess, then `xxd`'d to disk | `node <script> 2> /tmp/B.bin && xxd /tmp/B.bin > /tmp/B.hex` |
| **C** | CC chat panel — stderr flows into the bash tool's tool-result, which renders into the chat panel; operator selects the rendered output and copies it into a local file | (no redirect at script run time; operator copy/paste into `/tmp/C.txt` from the chat panel; `xxd /tmp/C.txt > /tmp/C.hex`) |

Pairwise diffs:

- `diff A.hex B.hex` — bash-tool-shell-redirect transformations
- `diff B.hex C.hex` — chat-rendering plus clipboard transformations
- `diff A.hex C.hex` — end-to-end (the operationally relevant comparison)

For the diagnostic recorded in this document:

- `shasum -a 256 /tmp/A.bin` = `69ac5c1f1193452e0c86031911a58b3baebc452c393a25edd7a5405030760d8c` (1778 bytes)
- `shasum -a 256 /tmp/B.bin` = identical to A.bin
- `diff /tmp/A.hex /tmp/B.hex` reported FILES IDENTICAL
- `shasum -a 256 /tmp/C.txt` = `a852e9efa03dc65b60b1dd8ed095ee791249edb42fa789f8943c85993e534dac` (1778 bytes — same size as A.bin, different content)

## Findings

### Finding 1: CR (0x0D) is rewritten to LF (0x0A) somewhere downstream of the bash-tool's disk redirect

**Severity:** moderate. Reproducible. Single-byte in-place substitution; no add or drop.

`diff A.bin C.txt` shows identical file sizes (1778 bytes each) and shasums that differ in exactly one byte. The differing byte sits at offset `0x44b` (decimal 1099), inside `TEST 25 carriageReturn` whose original test value is the literal three bytes `aa<CR>bb`:

| Source | Bytes around offset 0x44b |
|--------|---------------------------|
| **A.bin** (operator's local terminal) | `61 61 0d 62 62 0a` (`aa<CR>bb<LF>`) |
| **C.txt** (CC chat panel → operator clipboard) | `61 61 0a 62 62 0a` (`aa<LF>bb<LF>`) |

`0x0D` (carriage return, U+000D) was rewritten to `0x0A` (line feed, U+000A) somewhere downstream of the disk redirect.

The rewrite cannot be attributed to the bash-tool capture itself: B.bin (which goes through the same bash tool, just with a stderr-to-disk redirect) is byte-identical to A.bin. The rewrite is therefore in some combination of CC's bash-tool-result-to-chat-display layer, the chat-rendering layer, the OS or VS Code copy handler, and the clipboard. The diagnostic does not isolate further; the operational consequence (`CR` is unsafe through this pipeline) is the same regardless.

### Finding 2: Line-level structural corruption observed in CC's tool-result-to-chat-display layer (one observation, not deliberately reproduced)

**Severity:** unknown — observed once. Worth banking, but not characterized as a reproducible bug.

While reporting Point B's `head -40 /tmp/B.hex` output back into chat, the ASCII gloss column (the right-side text annotation produced by `xxd`) for line `0x60` showed `ering repro v1 =` — the gloss content from line `0x10` — instead of the correct `01: base64urlMix`. The hex column at line `0x60` was correct; only the right-side ASCII gloss was wrong. The on-disk `/tmp/B.hex` file (verified by the operator locally) had the correct gloss at that line.

This indicates that something in CC's tool-result-to-chat-display pipeline introduced a line-level structural corruption: a multi-character substring from one line replaced the corresponding substring at a different line, with no apparent character-level transformation rule. The hex column remained correct while the gloss column was wrong, which rules out a simple byte transformation; it suggests block-level layout or DOM-rendering interference rather than character substitution.

This finding is the most plausible candidate explanation for the original Session 40 bcrypt-verify failures — a multi-row password table is exactly the kind of structured ASCII content that could suffer line-level mixing — but the diagnostic did not include a deliberate 8-row password-table reproduction for measurement, so the connection is suggestive rather than confirmed. A future diagnostic iteration could add a deliberate password-table-shaped test case if isolation is needed.

### Finding 3: Lazy-rendering selection truncation in VS Code's CC chat panel

**Severity:** high. Reproducible. Silent data loss with no error.

During Point C capture, the operator's first attempt to select-and-copy the full chat output truncated at TEST 18 — only the visible portion of the chat panel had been rendered into the DOM, so `select-all-and-copy` captured only what was on screen. The off-screen content silently failed to enter the clipboard.

**Cause:** VS Code's CC chat panel renders content lazily; rows below the viewport are not in the DOM until scrolled into view.

**Workaround:** scroll the chat panel to the bottom of the target output before performing select-all, forcing the renderer to materialize all rows.

**Operational hazard:** this is a silent failure mode. There is no error, no truncation indicator, and the partial clipboard content looks plausibly complete because it ends mid-output rather than mid-character. For an 8-row password table, an operator could end up with only the first 4 rows in their clipboard and not notice until logins fail.

### What was NOT corrupted (notable because the Session 40 hypothesis predicted otherwise)

The original Session 40 entry hypothesized smart-quote substitution, em-dash transformation of base64url hyphens, or column-alignment-induced copy-paste error as candidate mechanisms. None of these reproduced in this diagnostic:

- **Base64url alphabet (TESTs 01-04)** — including hyphen runs, underscore runs, and mixed runs — survived clean.
- **Smart-typography candidates (TESTs 05-10)** — no em-dash for two- or three-hyphen sequences, no curly-quote substitution, no ellipsis collapse, no apostrophe smart-quoting in `don't can't won't`.
- **Markdown attractor characters (TESTs 11-16)** — underscore, asterisk, backtick, pipe, square bracket, and the www-style auto-link candidate all survived byte-faithful.
- **Backslash escapes (TESTs 17-20)** — literal backslash sequences survived intact.
- **Multi-space runs (TEST 21)** — 2/3/4-space runs preserved; no markdown-style space collapse.
- **HTML angle brackets (TESTs 22-24)** — preserved verbatim.
- **Control bytes (TESTs 26-28: tab, NUL, ESC)** — visually appeared "stripped" in the chat display but were actually preserved at byte level in the clipboard. Visual absence in the chat panel is a rendering choice, not a clipboard transformation.
- **Leading/trailing whitespace (TEST 29)** — preserved.
- **Paragraph break (TEST 30)** — preserved.
- **Column-aligned table (TEST 31)** — full multi-row table came through byte-clean.
- **Adversarial cell-edge tests (TESTs 32 and 33)** — both the trailing-underscore row and the trailing-hyphen row survived without transformation. The "trailing hyphen at table cell edge becomes em-dash" hypothesis is not supported by this diagnostic.

The only character-level transformation observed across the entire 33-test battery was Finding 1 (`CR` → `LF`). The chat-rendering layer's most consequential anomaly is Finding 2 (line-level structural corruption), but that was an observation in a single instance, not a deliberately reproduced effect. The actual mechanism behind the Session 40 bcrypt-verify failures is therefore not fully isolated by this diagnostic. Finding 2 is the most plausible candidate; a deliberate password-table-shaped reproduction would be needed to confirm.

## Operational rule

The rule established in Session 40 stands and is reinforced — not loosened — by these findings.

**Run in the operator's local terminal — never via CC's bash tool — when the output contains:**

- Passwords (any encoding) intended to be hand-delivered to a downstream consumer.
- Base64 or base64url data that will be verified against a separately-stored hash.
- Cryptographic key material.
- Any byte stream where character fidelity matters more than human readability.
- Any structured multi-line output (e.g., a password table) where line-level integrity matters and the operator depends on copying the full output.

**The rule does NOT apply to:**

- Build status, test results, file listings, command exit codes, or any output where a human-readable summary is sufficient.
- SQL emitted for hand-paste, including bcrypt hashes inside SQL string literals. The original Session 40 incident's SQL output (which contained the bcrypt hashes) was byte-faithful through the chat layer; only the parallel password-table stderr was corrupted. The chat-rendering layer does not transform inside SQL syntax in any way the diagnostic detected.
- Any output where the operator never copies bytes back out of the chat panel.

## Related

- **Followup #11** — `SMOKE_TESTING.md` walkthrough. The password-handling and seed-script sections of that document should reference this finding and lead with the local-terminal rule.
- **Session 40 activities entry**, Catches #5 and #6 — the original incident.
