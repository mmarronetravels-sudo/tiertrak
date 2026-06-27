// services/overdueLogsDigest.js
//
// Scheduled weekly "overdue progress logs" staff email. For each staff user,
// emails the active interventions on their caseload that are missing this
// week's progress log -- the SAME data the Dashboard "Weekly Reminder: Log
// Progress" card shows in-app. It reuses routes/weeklyProgress.js
// getMissingLogsForStaff verbatim rather than re-deriving "overdue", so the
// email, the dashboard, and the dedup ledger all agree on what "this week" and
// "overdue" mean.
//
// §5 cross-tenant safety (the load-bearing property of this file):
//   - The recipient set is loaded from the users table server-side. There is
//     NO request input anywhere in this path -- no req, no JWT, no path param.
//   - For each staff user we reconstruct the exact identity shape
//     resolveAccessibleTenantIds expects ({ id, tenant_id, district_id }) from
//     that user's own DB row, then call the SAME §5 helper the request path
//     uses. A legacy single-tenant user resolves to [tenant_id]; a district
//     user resolves to their user_school_access grants for their district.
//     We never iterate tenants the user cannot access.
//   - getMissingLogsForStaff then applies the elevated/caseload predicate and
//     binds s.tenant_id, so a staffer only ever receives their own students,
//     for a school they belong to.
//
// §4B PII discipline:
//   - Student names and intervention names appear ONLY in the HTML body of the
//     email sent to the one staff member authorized to see them (exactly what
//     they already see in-app). They are HTML-escaped before interpolation.
//   - Nothing PII is logged: log lines carry integer ids and counts only,
//     never names, emails, or intervention text.
//   - The subject line and any link are static and PII-free (no names, no
//     counts that identify, no tokens, no query-string PII).
//   - The send-dedup ledger (migration-050) stores integer refs + dates only.
//
// Dedup (claim-then-send): we INSERT the ledger row FIRST with ON CONFLICT DO
// NOTHING. Only the worker that wins the UNIQUE(user_id, school_tenant_id,
// week_of) slot proceeds to email. If the send fails, we delete the claim so a
// later run can retry. This makes a restart, an overlapping tick, or a
// multi-instance deploy unable to double-send (the primary requirement); the
// tradeoff -- a crash between claim and send skips that one staffer for that
// one week -- is acceptable for a weekly reminder and strictly preferable to
// double-sending student PII.
//
// The OVERDUE_LOGS_REMINDERS_ENABLED flag is enforced at the scheduler
// (server.js), NOT here, so this function stays a pure unit that an ops smoke
// can invoke on dev.
//
// Per-tenant opt-out (gate item (a), migration-051): a school or district can
// decline these emails. The declined scopes are loaded once per run from
// overdue_log_reminder_optouts (integer-only, no PII). A district-scoped
// opt-out is applied as a per-USER skip (suppresses every school under that
// district); a school-scoped opt-out is applied as a per-TENANT skip
// (suppresses only that one school). Absence of a row means eligible
// (default-on / opt-out semantics) -- we read only reminders_enabled = FALSE
// rows. If that load fails the run aborts (fail-closed: better to send nothing
// than to email a tenant that may have opted out).

const { Pool } = require('pg');
const { Resend } = require('resend');
const {
  getMissingLogsForStaff,
  getWeekStart,
} = require('../routes/weeklyProgress');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
// Consumed READ-ONLY as a recipient-eligibility predicate (item b). isOperator
// reads the frozen PLATFORM_ADMIN_USER_IDS allowlist; this file neither
// modifies that allowlist nor any authz logic -- it only asks "is this user an
// operator?" to exclude cross-tenant platform admins from the mailing.
const { isOperator } = require('../middleware/platformAdminOnly');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const resend = new Resend(process.env.RESEND_API_KEY);

// Minimal async delay used to pace outbound Resend calls (item c). No external
// dependency -- mirrors the repo's preference for a small local helper over a
// new package.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse a non-negative integer env var, falling back to `fallback` on any
// malformed value. `min` is the smallest accepted value (0 lets an operator
// disable the throttle; 1 keeps the per-run cap strictly positive).
function parseIntEnv(raw, fallback, min) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

// Minimal HTML escaper for any DB-sourced string interpolated into the email
// body (student names, intervention names). Prevents a stored value like a
// name containing "<" from breaking or injecting markup. Mirrors the hardening
// tracked for the CSV-import full_name path.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render the per-staffer email body from their own overdue rows. `rows` is the
// output of getMissingLogsForStaff: { id, intervention_name, student_id,
// log_frequency, first_name, last_name, tier }. All DB strings are escaped.
function renderOverdueEmailHtml(rows) {
  const dashboardUrl = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/`
    : null;

  const listItems = rows
    .map((r) => {
      const name = `${escapeHtml(r.last_name)}, ${escapeHtml(r.first_name)}`;
      const intervention = escapeHtml(r.intervention_name);
      const frequency = escapeHtml(r.log_frequency);
      const tier = escapeHtml(r.tier);
      return `
        <li style="margin-bottom: 10px;">
          <strong>${name}</strong> &mdash; ${intervention}
          <span style="color: #6b7280; font-size: 13px;">(Tier ${tier}, ${frequency})</span>
        </li>`;
    })
    .join('');

  const cta = dashboardUrl
    ? `<div style="text-align: center; margin: 30px 0;">
         <a href="${dashboardUrl}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Open ScholarPath to Log Progress</a>
       </div>`
    : '';

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Weekly Reminder: Log Progress</h1>
      </div>
      <div style="padding: 30px; background: #f9fafb;">
        <p>The following active interventions on your caseload are missing this week's progress log:</p>
        <ul style="padding-left: 20px;">${listItems}</ul>
        ${cta}
        <p style="color: #6b7280; font-size: 14px;">If you have already logged progress for these, no action is needed.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          ScholarPath Intervention Management by ScholarPath Systems<br>
          FERPA Compliant • Student Data Protected
        </p>
      </div>
    </div>
  `;
}

// Send one staffer's overdue-logs email. Mirrors the existing inline Resend
// pattern (routes/auth.js). Throws on transport failure or a Resend-reported
// error so the caller can roll back the dedup claim.
async function sendOverdueLogsEmail(toEmail, rows) {
  const { error } = await resend.emails.send({
    from: 'ScholarPath Intervention Management <noreply@scholarpathsystems.org>',
    to: toEmail,
    subject: 'Weekly Reminder: Log Progress',
    html: renderOverdueEmailHtml(rows),
  });
  if (error) {
    // error is the Resend error object (no student PII). Surface it so the
    // caller releases the claim and a later run retries.
    throw new Error(`Resend send failed: ${error.message || 'unknown error'}`);
  }
}

// runOverdueLogsDigest — the per-staff loop.
//
// options.dryRun (default false): when true, computes overdue lists and logs
// summary counts but neither claims a ledger row nor sends any email. Intended
// for an ops smoke on dev. Returns a summary object either way.
async function runOverdueLogsDigest({ dryRun = false } = {}) {
  const weekOf = getWeekStart(new Date().toISOString().split('T')[0]);

  // Send-burst controls (item c). Both env-tunable with conservative defaults
  // and fail safe to the default on malformed input.
  //   OVERDUE_LOGS_SEND_INTERVAL_MS — minimum pause between outbound Resend
  //     calls. Default 600ms paces ~1.67/s, conservatively under Resend's
  //     documented 2 req/s send limit. Set to 0 to disable the throttle.
  //   OVERDUE_LOGS_MAX_SENDS_PER_RUN — per-invocation backstop on real sends.
  //     Default 5000 is far above any realistic single-week staff-with-overdue
  //     count, so it never fires in normal operation; it only bounds a runaway.
  //     Capped recipients are NOT dropped: their (user, school, week_of) ledger
  //     slot is left unclaimed, so a later run within the same week_of re-sends
  //     them (the dedup INSERT wins the open slot). The cap is logged, never
  //     silent.
  const sendIntervalMs = parseIntEnv(process.env.OVERDUE_LOGS_SEND_INTERVAL_MS, 600, 0);
  const maxSendsPerRun = parseIntEnv(process.env.OVERDUE_LOGS_MAX_SENDS_PER_RUN, 5000, 1);

  // Recipient set: every staff user (role <> 'parent'). This mirrors the
  // requireTenantStaffAccess gate on the in-app route exactly -- parents are
  // the only role it rejects -- so the email reaches the same audience that
  // would see the in-app reminder. We deliberately do NOT filter by
  // INTERVENTION_MANAGER_ROLES, which would drop education_assistant.
  const { rows: staff } = await pool.query(
    `SELECT id, email, role, tenant_id, district_id, school_wide_access
       FROM users
      WHERE role <> 'parent'`
  );

  // Per-tenant opt-out scopes (gate item (a), migration-051). Loaded once per
  // run as integer-only sets -- no PII. We read ONLY reminders_enabled = FALSE
  // rows: absence of a row, or a re-enabled (TRUE) row, both mean "eligible".
  // A throw here aborts the whole run (fail-closed) rather than silently
  // sending to a tenant that may have declined.
  const optedOutSchools = new Set();
  const optedOutDistricts = new Set();
  {
    const { rows: optouts } = await pool.query(
      `SELECT school_tenant_id, district_id
         FROM overdue_log_reminder_optouts
        WHERE reminders_enabled = FALSE`
    );
    for (const o of optouts) {
      if (o.school_tenant_id != null) optedOutSchools.add(o.school_tenant_id);
      if (o.district_id != null) optedOutDistricts.add(o.district_id);
    }
  }

  const summary = { weekOf, staffConsidered: staff.length, sent: 0, alreadySent: 0, skippedEmpty: 0, skippedIneligible: 0, skippedOptedOut: 0, errors: 0, capReached: false };

  for (const user of staff) {
    // Recipient eligibility (item b), applied read-only before any work:
    //   - Operators (PLATFORM_ADMIN_USER_IDS) are cross-tenant platform admins,
    //     not a customer audience; never mail them a tenant's overdue list.
    //   - A user with no usable email cannot be a recipient.
    // Departed staff are hard-deleted upstream, so they never appear in this
    // set. Per-user deactivation has no schema representation today and is a
    // deliberate flagged follow-up -- intentionally NOT handled here.
    if (isOperator(user.id) || !user.email || String(user.email).trim() === '') {
      summary.skippedIneligible += 1; // counts only -- never log the email/name
      continue;
    }

    // District-wide opt-out (gate item (a)): a district-scoped opt-out suppresses
    // EVERY school under that district. user.district_id is constant for this
    // user and, by the §5 resolveAccessibleTenantIds contract, every school in
    // their resolved set lies within it -- so we skip the whole user here,
    // before scope resolution, rather than re-deriving it per school below.
    if (user.district_id != null && optedOutDistricts.has(user.district_id)) {
      summary.skippedOptedOut += 1; // counts only -- no id/name logged
      continue;
    }

    let tenantIds;
    try {
      // Server-side §5 scope resolution from the user's own DB row.
      tenantIds = await resolveAccessibleTenantIds(user);
    } catch (err) {
      summary.errors += 1;
      console.error('[overdue-logs-digest] scope-resolve failed user_id=', user.id, 'err=', err.message);
      continue;
    }

    for (const tenantId of tenantIds) {
      // Single-school opt-out (gate item (a)): a school-scoped opt-out suppresses
      // only this school; the user's other (non-opted-out) schools still send.
      if (optedOutSchools.has(tenantId)) {
        summary.skippedOptedOut += 1; // counts only -- no id/name logged
        continue;
      }

      // Per-run send backstop (item c). Real sends only; dry runs are unbounded
      // because they never call Resend. When hit, stop and let the next tick
      // pick up the unclaimed recipients (see header on resume semantics).
      if (!dryRun && summary.sent >= maxSendsPerRun) {
        summary.capReached = true;
        break;
      }

      let overdue;
      try {
        // Same predicate as the in-app dashboard reminder.
        overdue = await getMissingLogsForStaff(user, tenantId);
      } catch (err) {
        summary.errors += 1;
        console.error('[overdue-logs-digest] missing-logs query failed user_id=', user.id, 'tenant_id=', tenantId, 'err=', err.message);
        continue;
      }

      if (!overdue || overdue.length === 0) {
        summary.skippedEmpty += 1;
        continue;
      }

      if (dryRun) {
        // No claim, no send. Count only (no PII).
        summary.sent += 1;
        console.log('[overdue-logs-digest] (dry-run) would send user_id=', user.id, 'tenant_id=', tenantId, 'overdue_count=', overdue.length);
        continue;
      }

      // Claim the (user, school, week) slot. Only the winner emails.
      let claim;
      try {
        claim = await pool.query(
          `INSERT INTO overdue_log_reminder_sends (user_id, school_tenant_id, district_id, week_of)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, school_tenant_id, week_of) DO NOTHING
             RETURNING id`,
          [user.id, tenantId, user.district_id == null ? null : user.district_id, weekOf]
        );
      } catch (err) {
        summary.errors += 1;
        console.error('[overdue-logs-digest] dedup-claim failed user_id=', user.id, 'tenant_id=', tenantId, 'err=', err.message);
        continue;
      }

      if (claim.rowCount === 0) {
        // Already sent this week for this (user, school) -- restart/overlap.
        summary.alreadySent += 1;
        continue;
      }

      try {
        await sendOverdueLogsEmail(user.email, overdue);
        summary.sent += 1;
        console.log('[overdue-logs-digest] sent user_id=', user.id, 'tenant_id=', tenantId, 'overdue_count=', overdue.length);
      } catch (err) {
        // Release the claim so a later run retries; never log the recipient
        // address or any student data.
        summary.errors += 1;
        console.error('[overdue-logs-digest] send failed user_id=', user.id, 'tenant_id=', tenantId, 'err=', err.message);
        try {
          await pool.query('DELETE FROM overdue_log_reminder_sends WHERE id = $1', [claim.rows[0].id]);
        } catch (delErr) {
          console.error('[overdue-logs-digest] claim-rollback failed send_id=', claim.rows[0].id, 'err=', delErr.message);
        }
      }

      // Pace outbound calls regardless of send outcome -- both the success and
      // failure paths above issued a Resend request -- so a large district
      // cannot burst past the rate limit (item c).
      if (sendIntervalMs > 0) {
        await sleep(sendIntervalMs);
      }
    }

    if (summary.capReached) {
      // Logged once, counts only -- no emails/names. Not silent truncation.
      console.log('[overdue-logs-digest] per-run send cap reached cap=', maxSendsPerRun, 'sent=', summary.sent, '-- remaining recipients resume on the next tick within this week_of');
      break;
    }
  }

  console.log('[overdue-logs-digest] run complete', JSON.stringify(summary));
  return summary;
}

module.exports = { runOverdueLogsDigest, sendOverdueLogsEmail, renderOverdueEmailHtml };
