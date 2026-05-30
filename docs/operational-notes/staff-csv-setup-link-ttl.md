# Operator runbook: staff CSV setup-link expiration (7-day TTL)

**Tracked as:** Followup #144 (`ops/staff-csv-setup-link-ttl-runbook-note`)
**Master-index canonical name:** `docs/operational-notes/staff-csv-setup-link-ttl.md`. Banked at S99 close by branch slug `ops/staff-csv-setup-link-ttl-runbook-note`; assigned Followup #144 at file-creation time on 2026-05-29, pending master-index reconciliation.
**Applies to:** staff accounts created via the bulk staff CSV importer (`POST /api/csv/staff/:tenantId`)

**In scope:**
- What the setup link is and how long it lasts
- What a staff member sees when it expires
- How to get a staff member a working link after expiry

**Out of scope:**
- Password reset for existing, already-activated accounts
- The staff CSV import process itself

## What the setup link is
Staff added through the bulk CSV importer are created without a password. The system generates a one-time setup link and emails it (via Resend, from the platform's no-reply sender on the scholarpathsystems.org domain (subject: "Set up your ScholarPath account")). The staff member clicks "Set Up My Password," lands on `FRONTEND_URL/set-password?token=...`, and sets their password. The link is the only way to activate the account.

Under the hood the setup token reuses the password-reset columns: `users.password_reset_token` (a 64-character hex string) and `users.password_reset_expires`. In the database, a pending setup link is indistinguishable from a pending password reset.

## How long it lasts
Exactly 7 days from the moment the import runs (7 × 24 hours, by the millisecond — no business-day or calendar rounding). The email states the same.

Caveat: the expiry is stored in a column without a time zone (`TIMESTAMP`) and compared against the database `NOW()`. Depending on the DB server's time-zone setting, the effective cutoff can shift a few hours from a strict 7×24. Treat "7 days" as accurate to within a few hours, not to the second.

## What happens when it expires
The link stops working. The staff member sees an HTTP 400: "Invalid or expired token. Please request a new password reset."

Gotcha: that same message appears for an expired link, a link that never existed, and a link already used. You can't tell which from the message. To confirm an expiry, check the database for that user:
- token present and `password_reset_expires > NOW()` → still valid; the problem is elsewhere.
- token present but `password_reset_expires < NOW()` → expired.
- token NULL → never set or already consumed; check whether `password_hash` is set (account may already be active).

Expiry never deletes the account — only the link goes stale.

## How to reissue a link
There is currently no admin "resend setup link" button or endpoint. Options, best to worst:

1. **Staff self-service via Forgot Password (fastest, short window).** The staff member requests a reset themselves. ⚠ This link is valid for only **1 hour**, not 7 days — they must set their password right away. Recommended when the staff member is available to act immediately.

2. **Manual database update (only way to mint a fresh 7-day link).** An operator with DB access sets a new token and expiry:
```sql
   UPDATE users
   SET password_reset_token = '',
       password_reset_expires = NOW() + INTERVAL '7 days'
   WHERE email = $1 AND tenant_id = $2;
```
   Then construct the link manually — `FRONTEND_URL/set-password?token=<the hex>` — and deliver it through a secure channel. No script does this or emails it for you today.

3. **Do not re-run the CSV import for that person.** Re-importing the same email fails with "A user with this email already exists at this school" and does not generate a new token.

## Known gaps (operational reality, not tracked fixes)
- No admin-facing reissue endpoint; reissue is either a 1-hour self-service reset or a manual DB edit.
- The 1-hour vs 7-day mismatch between Forgot Password and the original setup link is an easy source of confusion.
- The expired/invalid/consumed error message is ambiguous and forces a DB check to troubleshoot.

If these become painful, consider a product follow-up: an admin "resend setup link" action that issues a fresh 7-day link.
