const express = require('express');
const router = express.Router();
const {
  requireAuth,
  requireStudentReadAccess,
  requireTenantStaffAccess,
} = require('../middleware/authorizeInterventionAccess');
const { resolveAccessibleTenantIds } = require('../middleware/resolveAccessibleTenantIds');
const { Resend } = require('resend');

// Reuse the existing inline Resend pattern (server.js, routes/auth.js,
// routes/csvImport.js, …) — no shared mailer helper exists yet and this
// feature does not introduce one. Same RESEND_API_KEY env var already in
// production; no new dependency, no new config.
const resend = new Resend(process.env.RESEND_API_KEY);

// From-address literal mirrors routes/auth.js:472 verbatim so all
// outbound mail presents a single consistent sender.
const NOTIFY_FROM = 'ScholarPath Intervention Management <noreply@scholarpathsystems.org>';

let pool;

const initializePool = (dbPool) => {
  pool = dbPool;
};

// ============================================================
// Tenant-binding doctrine (POST handlers)
//
// Mirrors routes/prereferralForms.js per Followup #125 (per-school
// binding) + Followup #132 (helper consolidation deferred): POST
// reads optional req.body.target_tenant_id; absent → req.user.tenant_id;
// present → validated against resolveAccessibleTenantIds(req.user);
// not-in-set → 403 BEFORE any INSERT so a body-explicit cross-tenant
// probe collapses to 403, not 400-FK.
//
// GET vocab derives scope from path :tenantId + accessible-set check.
//
// Server-derived columns on POST (never read from body):
//   tenant_id, referring_staff_id, grade, status, admin_notes,
//   reviewing_admin_id, reviewed_at, time_out_of_instruction
// Body-supplied columns are limited to the destructured set below;
// any other req.body keys are silently ignored.
// ============================================================

const FORBIDDEN_BODY = { error: 'Not authorized' };

// Positive role gates for the admin-review surface. Teacher is
// deliberately NOT in VIEW_ROLES — teachers see their own authored
// referrals via GET /student/:studentId (D6 CASE projection), not the
// admin queue/detail surfaces. Parent is implicitly excluded by not
// appearing in either set; handlers that follow the existing file
// convention also add an explicit parent → 403 line as defense in
// depth, but the role-set membership check alone is sufficient.
const VIEW_ROLES = ['school_admin', 'district_admin', 'counselor', 'interventionist'];

// ACT_ROLES is the narrower gate for state-changing endpoints (claim /
// release / admin-notes / resolve). Counselors and interventionists
// can view the queue and the detail page but cannot move status or
// assign consequences. Mirrors the APPROVE_ROLES / ADMIN_ROLES split
// in routes/prereferralForms.js.
const ACT_ROLES = ['school_admin', 'district_admin'];

// EXPORT_ROLES aliases VIEW_ROLES — the row-level CSV export at
// GET /export is open to the same role set that can read the queue
// and detail surfaces. Aliased (not copied) so any future widening
// of one widens both intentionally; if v2 ever needs to diverge
// (e.g. carving counselor out of export specifically), break the
// alias into its own array AT THAT TIME and document why.
// Teacher caseload-scoped export is deferred to a separate route
// (R-1b) and would carry its own narrower allowlist.
const EXPORT_ROLES = VIEW_ROLES;

// EXPORT_STATUS_VALUES mirrors the M036 status CHECK
// (migration-036-discipline-referrals-foundation.sql:261-263)
// byte-for-byte. Declared locally rather than imported from
// routes/disciplineReports.js so the two routers stay
// independently reviewable, matching the disciplineReports
// rationale at routes/disciplineReports.js:36-38.
const EXPORT_STATUS_VALUES = ['submitted', 'under_review', 'resolved'];

// admin_notes length cap, enforced from-the-start at the route layer
// (no schema change). Mirrors the banked staff_notes/admin_notes
// length-cap follow-up, applied here for the first surface that needs
// it. 5000 chars after trim is comfortably above the longest
// reasonable narrative entry.
const ADMIN_NOTES_MAX_LENGTH = 5000;
const STAFF_NOTES_MAX_LENGTH = 5000;

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// parseDateParam(raw, fieldName) — validate an optional YYYY-MM-DD
// query param for the GET /export filter. Mirrors the shape used in
// routes/disciplineReports.js:68-76; declared locally to keep the
// two routers independently reviewable. Generic error string — never
// echoes the bad input.
function parseDateParam(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, error: `Invalid ${fieldName}` };
  }
  return { ok: true, value: raw };
}

// csvEscapeField — RFC 4180 quoting + OWASP spreadsheet-formula-
// injection guard for the GET /export handler.
//   - null / undefined → '' (empty cell)
//   - Non-string values stringified via String(v).
//   - If the cell starts with one of = + - @ TAB CR, prefix a single
//     quote so Excel / Sheets / Numbers treat it as text, not a
//     formula. (LF can't be the leading char on a wire-format cell
//     that already passed CSV parsing; included in the quote-wrap
//     trigger set for safety, not the prefix set.)
//   - If the cell contains , " CR LF, wrap in double quotes and
//     double any internal double quotes.
function csvEscapeField(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : String(value);
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// formatBooleanForCsv — 3-state boolean to CSV cell.
// NULL/undefined → '' (empty cell, meaning "unknown" per M042 doctrine).
// TRUE / FALSE → 'true' / 'false' (matches the M042 audit table's
// BOOLEAN::TEXT canonical form so the export wire form aligns with
// the audit-log wire form).
function formatBooleanForCsv(value) {
  if (value === null || value === undefined) return '';
  return value === true ? 'true' : value === false ? 'false' : '';
}

// parseAdminNotes(raw) — validate + normalize an admin_notes payload.
// Callers must first decide whether the key being absent from the body
// is acceptable (PATCH /:id/admin-notes requires it; PATCH /:id/resolve
// treats absent as "preserve existing"). Once invoked, raw should be a
// string or explicit null.
//
// Returns { ok: true, value } where value is the trimmed string or null
// (empty-after-trim collapses to null so a deliberate clear works).
// Returns { ok: false, error } when raw is not string/null or when the
// trimmed string exceeds ADMIN_NOTES_MAX_LENGTH.
function parseAdminNotes(raw) {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'admin_notes must be a string' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > ADMIN_NOTES_MAX_LENGTH) {
    return { ok: false, error: 'admin_notes exceeds maximum length' };
  }
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

// parseStaffNotes(raw) — POST / variant of parseAdminNotes. Accepts
// `undefined` as {ok:true, value:null} because POST / treats an absent
// staff_notes key as "no note" (the L2+ required-note check at the
// path-fork below catches the cases where a note is mandatory).
// parseAdminNotes deliberately rejects undefined because its PATCH
// callers must distinguish key-absent (preserve existing column) from
// key-present-null (explicit clear).
function parseStaffNotes(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'staff_notes must be a string' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > STAFF_NOTES_MAX_LENGTH) {
    return { ok: false, error: 'staff_notes exceeds maximum length' };
  }
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

async function resolveAndBindTargetTenant(req) {
  const bodyTarget = req.body ? req.body.target_tenant_id : undefined;
  if (bodyTarget === undefined || bodyTarget === null) {
    if (req.user.tenant_id == null) {
      return { targetTenantId: null, error: { status: 400, body: { error: 'target_tenant_id is required' } } };
    }
    return { targetTenantId: req.user.tenant_id, error: null };
  }
  if (!isPositiveInt(bodyTarget)) {
    return { targetTenantId: null, error: { status: 400, body: { error: 'Invalid target_tenant_id' } } };
  }
  const accessible = await resolveAccessibleTenantIds(req.user);
  if (!accessible.includes(bodyTarget)) {
    return { targetTenantId: null, error: { status: 403, body: { error: 'Not authorized for target tenant' } } };
  }
  return { targetTenantId: bodyTarget, error: null };
}

// Load a discipline_referrals row by id and assert it belongs to a
// tenant in the caller's accessible-tenant set (§5 dual-path doctrine
// via helper, never inlined). Returns
//   { ok: true, row, accessible }                     on success
//   { ok: false, status, body }                       on failure
// so the caller responds with a byte-identical 403 for both "row not
// found" and "wrong tenant" — preventing existence-disclosure across
// tenants. The accessible-tenant list is returned alongside the row so
// downstream defense-in-depth SELECTs can reuse it without a second
// resolveAccessibleTenantIds() call. Mirrors loadFormAndAssertTenant
// in routes/prereferralForms.js.
async function loadReferralAndAssertTenant(referralId, user) {
  const result = await pool.query(
    'SELECT id, tenant_id, status, reviewing_admin_id FROM discipline_referrals WHERE id = $1',
    [referralId]
  );
  if (result.rows.length === 0) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  const accessible = await resolveAccessibleTenantIds(user);
  if (!accessible.includes(result.rows[0].tenant_id)) {
    return { ok: false, status: 403, body: FORBIDDEN_BODY };
  }
  return { ok: true, row: result.rows[0], accessible };
}

// ============================================================
// notifySchoolAdminsOfReferral(tenantId) — fire-and-forget email nudge
// to a school's admin(s) that a new referral landed in their queue, so
// submissions don't sit unseen.
//
// Invoked AFTER the create transaction COMMITs and AFTER the 201 is sent
// (see POST /). It must never throw, never block the response, and never
// affect the referral write — a mail failure is a soft failure.
//
// §4B PII discipline (deliberately PII-free):
//   - The email body carries NO student name, behavior, notes, grade, or
//     referral id — only "a referral was submitted, log in to review."
//     Any deep link points at FRONTEND_URL root, never a referral-
//     specific URL (no referral id in an email body or link).
//   - Recipient resolution is tenant-scoped: school_admin users whose
//     users.tenant_id = the referral's tenant (the already-validated
//     targetTenantId from resolveAndBindTargetTenant). Recipients are
//     NEVER read from request input. district_admin is intentionally not
//     notified in this version.
//   - Recipients are mailed individually so no admin's address is
//     disclosed to another (staff email is §4B staff PII); each send is
//     independently guarded so one failure doesn't drop the rest.
//   - On failure we log a redacted marker only: tenant_id (integer) +
//     err.name. Never recipient addresses, never row data.
//   - No school_admin recipients for the tenant → return silently.
// ============================================================
async function notifySchoolAdminsOfReferral(tenantId) {
  try {
    const adminRes = await pool.query(
      `SELECT email FROM users WHERE tenant_id = $1 AND role = 'school_admin'`,
      [tenantId]
    );
    const recipients = adminRes.rows
      .map((r) => r.email)
      .filter((e) => typeof e === 'string' && e.length > 0);
    if (recipients.length === 0) return;

    const reviewUrl = process.env.FRONTEND_URL || '';
    const reviewButton = reviewUrl
      ? `<div style="text-align: center; margin: 30px 0;">
              <a href="${reviewUrl}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In to Review</a>
            </div>`
      : '';

    const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">New Discipline Referral</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>A new discipline referral was submitted at your school.</p>
              <p>Log in to review the queue.</p>
              ${reviewButton}
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
              <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                ScholarPath Intervention Management by ScholarPath Systems<br>
                FERPA Compliant • Student Data Protected
              </p>
            </div>
          </div>
        `;

    // Individual sends — one recipient per message (no shared To/Cc), so
    // no admin's address is disclosed to another. Each guarded so a
    // single failure doesn't abort the remaining recipients.
    await Promise.all(
      recipients.map(async (to) => {
        try {
          await resend.emails.send({
            from: NOTIFY_FROM,
            to,
            subject: 'New discipline referral submitted',
            html,
          });
        } catch (error) {
          console.error('[disciplineReferrals:notify]', 'tenant_id=', tenantId, 'err_name=', error && error.name);
        }
      })
    );
  } catch (error) {
    // Redacted: tenant_id (integer) + err.name only. Never recipient
    // addresses, never student/referral data.
    console.error('[disciplineReferrals:notify]', 'tenant_id=', tenantId, 'err_name=', error && error.name);
  }
}

// ============================================================
// GET /vocab/:tenantId — all 7 active discipline vocab lists for one
// tenant. Behaviors carry severity_level + managed_by + requires_subtype
// (M037) so the FE can drive the two-path form without label-matching.
// Consequences carry is_restorative so the FE can render the badge.
//
// Path :tenantId is int-validated, then checked against
// resolveAccessibleTenantIds for §5 dual-path membership. Failures
// collapse to 403 (no existence-disclosure across tenants).
// ============================================================
router.get('/vocab/:tenantId', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const pathTenantId = parseInt(req.params.tenantId, 10);
    if (!isPositiveInt(pathTenantId)) {
      return res.status(400).json({ error: 'Invalid tenantId' });
    }
    const accessible = await resolveAccessibleTenantIds(req.user);
    if (!accessible.includes(pathTenantId)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const [behaviors, locations, motivations, others, consequences, harass, weapon] = await Promise.all([
      pool.query(
        `SELECT id, label, severity_level, managed_by, requires_subtype, sort_order
         FROM discipline_behaviors
         WHERE tenant_id = $1 AND is_active = TRUE
         ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_locations
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_motivations
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_others_involved
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, is_restorative, sort_order FROM discipline_consequences
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_harassment_subtypes
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
      pool.query(
        `SELECT id, label, sort_order FROM discipline_weapon_subtypes
         WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label`,
        [pathTenantId]
      ),
    ]);

    res.json({
      behaviors: behaviors.rows,
      locations: locations.rows,
      motivations: motivations.rows,
      others_involved: others.rows,
      consequences: consequences.rows,
      harassment_subtypes: harass.rows,
      weapon_subtypes: weapon.rows,
    });
  } catch (error) {
    // No body echo; tenant_id only (id integer, not PII).
    console.error('[disciplineReferrals:vocab]', 'tenant_id=', req.params.tenantId, 'err=', error.message);
    res.status(500).json({ error: 'Failed to load vocab' });
  }
});

// ============================================================
// GET /student/:studentId — referrals on a student's record.
//
// Visibility (design D6 — enforced in the SQL projection, NOT the UI):
//   - Structured fields (date, behavior, severity_level, status,
//     consequences, referring_staff_name) visible to every
//     authenticated non-parent role for any student in the viewer's
//     accessible-tenant set.
//   - staff_notes: counselor / school_admin / district_admin /
//     interventionist see all; teacher sees ONLY referrals they
//     authored (dr.referring_staff_id = $4); everyone else NULL.
//   - admin_notes: counselor / school_admin / district_admin /
//     interventionist see all; everyone else NULL.
//   - Parents: 403 (existence-of-referral is itself FERPA-protected;
//     same precedent as prereferralForms /student/:studentId).
//
// Note-gating lives ONLY in the SELECT CASE expressions; the
// staff_notes / admin_notes columns are never plucked into JS and
// post-filtered. A viewer whose CASE resolves to ELSE NULL never
// receives the underlying text in the query result, period.
//
// Tenant scope: requireStudentReadAccess admits parent-by-link or
// staff-by-accessible-set; the handler then filters
// dr.tenant_id = ANY($2::int[]) for defense in depth.
//
// Time scope: ?scope=current (default) — incident_date on or after
// Aug 1 of the current school year (server-derived). ?scope=all
// removes the floor. Aug 1 boundary is a US convention; promotable
// to a per-tenant setting later if a district needs it.
// ============================================================
router.get('/student/:studentId', requireAuth, requireStudentReadAccess, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

    const accessible = await resolveAccessibleTenantIds(req.user);

    let schoolYearFloor = null;
    if (req.query.scope !== 'all') {
      const now = new Date();
      const cutoffYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
      schoolYearFloor = `${cutoffYear}-08-01`;
    }

    const result = await pool.query(
      `SELECT
         dr.id,
         dr.incident_date,
         dr.status,
         db.label          AS behavior_label,
         db.severity_level,
         dl.label          AS location_label,
         ru.full_name      AS referring_staff_name,
         COALESCE(
           (SELECT json_agg(json_build_object('label', dc.label, 'is_restorative', dc.is_restorative)
                            ORDER BY dc.sort_order)
              FROM discipline_referral_consequences drc
              JOIN discipline_consequences dc
                ON dc.id = drc.consequence_id AND dc.tenant_id = drc.tenant_id
             WHERE drc.referral_id = dr.id AND drc.tenant_id = dr.tenant_id),
           '[]'::json
         )                 AS consequences,
         CASE
           WHEN $3::text IN ('counselor','school_admin','district_admin','interventionist') THEN dr.staff_notes
           WHEN $3::text = 'teacher' AND dr.referring_staff_id = $4::int THEN dr.staff_notes
           ELSE NULL
         END               AS staff_notes,
         CASE
           WHEN $3::text IN ('counselor','school_admin','district_admin','interventionist') THEN dr.admin_notes
           ELSE NULL
         END               AS admin_notes
       FROM discipline_referrals dr
       JOIN discipline_behaviors db
         ON db.id = dr.behavior_id AND db.tenant_id = dr.tenant_id
       JOIN discipline_locations dl
         ON dl.id = dr.location_id AND dl.tenant_id = dr.tenant_id
       LEFT JOIN users ru
         ON ru.id = dr.referring_staff_id
       WHERE dr.student_id = $1
         AND dr.tenant_id  = ANY($2::int[])
         AND ($5::date IS NULL OR dr.incident_date >= $5::date)
       ORDER BY dr.incident_date DESC, dr.created_at DESC`,
      [req.params.studentId, accessible, req.user.role, req.user.id, schoolYearFloor]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      '[disciplineReferrals:studentHistory]',
      'user_id=', req.user && req.user.id,
      'student_tenant_id=', req.student && req.student.tenant_id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load referral history' });
  }
});

// ============================================================
// GET /picker/:tenantId — narrow building-wide student picker for
// the discipline-referral create flow. Returns the minimum payload
// to render a typeahead list: id, first_name, last_name, grade.
// NO tier, NO risk_level, NO history, NO documents, NO external_id,
// NO dob, NO parent_email.
//
// Open to all non-parent roles (requireTenantStaffAccess admits any
// staff role whose accessible-tenant set includes the path tenant).
// The shape was chosen to data-minimize the surface that an
// education_assistant — and every other non-parent staff role —
// sees when filing a referral. PR-2 of N for the education-assistant
// feature; the picker landed here so EA's building-wide WRITE
// capability has a roster source that does not over-disclose.
//
// Path :tenantId is int-validated; tenant access is enforced by
// requireTenantStaffAccess against resolveAccessibleTenantIds(req.user).
// Cross-tenant probe → 403 at the middleware layer.
//
// Query params:
//   search (optional, string): substring match on first_name OR last_name,
//     case-insensitive via LOWER(...) LIKE LOWER(...). Behavior matches
//     routes/students.js:197-199 exactly (no divergence per S115 operator
//     directive; LIKE-wildcard (%/_) hardening is tracked as a follow-up
//     across both sites in lockstep). Falsy search → no filter applied.
//   limit  (optional, positive int): cap on rows returned. Default 50,
//     max 200 (mirrors GET /queue/:tenantId).
//
// PII discipline (§4B):
//   - SELECT enumerates id, first_name, last_name, grade EXPLICITLY.
//     No SELECT * or s.* — see picker invariant from PR-1
//     privacy-reviewer report.
//   - Error log carries tenant_id (integer) + user_id (integer) +
//     err.message only. No body echo, no name fragments.
// ============================================================
router.get('/picker/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!isPositiveInt(tenantId)) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    const { search } = req.query;
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

    let query = `SELECT id, first_name, last_name, grade
                   FROM students
                  WHERE tenant_id = $1`;
    const params = [tenantId];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(first_name) LIKE LOWER($${params.length}) OR LOWER(last_name) LIKE LOWER($${params.length}))`;
    }

    params.push(limit);
    query += ` ORDER BY last_name, first_name LIMIT $${params.length}`;

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error(
      '[disciplineReferrals:picker]',
      'tenant_id=', req.params.tenantId,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load picker' });
  }
});

// ============================================================
// POST / — create a discipline referral.
//
// Path-fork by behavior.managed_by:
//   'staff' (L1) — staff captures the situation + optional response;
//                  staff_notes optional; consequence_id allowed (single).
//                  motivation_id / others_involved_id rejected (L2+-only).
//   'admin' (L2+) — staff captures the situation; admin assigns
//                   consequence at review (PR #3). consequence_id
//                   rejected. staff_notes REQUIRED ("what happened" —
//                   admin wasn't present).
//
// Conditional subtype enforcement via behavior.requires_subtype
// ('harassment' | 'weapon' | NULL — set by M037). Explicit equality —
// requires_subtype may be NULL, never truthy-check.
//
// Composite FKs from M036 reject cross-tenant location / behavior /
// motivation / others_involved / subtype ids at the schema layer.
// Pre-checks below turn unknown ids into clean 400s instead of 23503
// FK violations, but the schema is the trust boundary.
//
// PII discipline (§4B):
//   - staff_notes is the only free-text PII column on this route.
//     Trimmed at parse; empty-after-trim → NULL.
//   - Error responses are generic strings; no body echo.
//   - console.error lines carry tenant_id (integer) + user_id (integer)
//     + err.message only. No student_id, no behavior label, no notes.
// ============================================================
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);

  const { targetTenantId, error: bindError } = await resolveAndBindTargetTenant(req);
  if (bindError) return res.status(bindError.status).json(bindError.body);

  const {
    student_id,
    behavior_id,
    location_id,
    incident_date,
    incident_time,
    motivation_id,
    others_involved_id,
    harassment_subtype_id,
    weapon_subtype_id,
    consequence_id,
    staff_notes,
  } = req.body || {};

  if (!isPositiveInt(student_id) || !isPositiveInt(behavior_id) || !isPositiveInt(location_id)) {
    return res.status(400).json({ error: 'Missing or invalid required field(s)' });
  }

  // Future incident_date guard. Anchored to UTC midnight on both sides
  // so the comparison aligns with the DB COALESCE(..., CURRENT_DATE) on
  // a UTC-running server (Render). Sub-day TZ slop is acceptable; the
  // failure mode this guards against is multi-day/month/year typos, not
  // hour-of-day boundaries. FE date-picker is not the trust boundary.
  if (incident_date !== undefined && incident_date !== null && incident_date !== '') {
    if (typeof incident_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(incident_date)) {
      return res.status(400).json({ error: 'Invalid incident_date' });
    }
    const incidentUtcMidnight = new Date(incident_date + 'T00:00:00Z');
    if (Number.isNaN(incidentUtcMidnight.getTime())) {
      return res.status(400).json({ error: 'Invalid incident_date' });
    }
    const todayUtcMidnight = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    if (incidentUtcMidnight.getTime() > todayUtcMidnight.getTime()) {
      return res.status(400).json({ error: 'incident_date cannot be in the future' });
    }
  }

  const parsedNotes = parseStaffNotes(staff_notes);
  if (!parsedNotes.ok) {
    return res.status(400).json({ error: parsedNotes.error });
  }
  const notesValue = parsedNotes.value;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Student must belong to the target tenant; derive grade in the same hop.
    // Tenant filter in the WHERE clause (defense-in-depth) — cross-tenant
    // student_id returns zero rows at the SQL layer instead of a row+JS check.
    const studentRes = await client.query(
      'SELECT grade FROM students WHERE id = $1 AND tenant_id = $2',
      [student_id, targetTenantId]
    );
    if (studentRes.rows.length === 0) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow per S87 5a3cfd1 */ }
      return res.status(403).json(FORBIDDEN_BODY);
    }
    const grade = studentRes.rows[0].grade;

    // Behavior must exist + be active + belong to target tenant.
    const behaviorRes = await client.query(
      `SELECT severity_level, managed_by, requires_subtype
       FROM discipline_behaviors
       WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
      [behavior_id, targetTenantId]
    );
    if (behaviorRes.rows.length === 0) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
      return res.status(400).json({ error: 'Invalid behavior' });
    }
    const behavior = behaviorRes.rows[0];

    // Path-fork validation.
    if (behavior.managed_by === 'staff') {
      if (motivation_id != null || others_involved_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior level' });
      }
    } else {
      if (consequence_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Consequence is assigned at admin review' });
      }
      if (!notesValue) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'A description of what happened is required' });
      }
    }

    // Conditional subtype enforcement (explicit equality on requires_subtype).
    if (behavior.requires_subtype === 'harassment') {
      if (!isPositiveInt(harassment_subtype_id)) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Harassment subtype is required for this behavior' });
      }
      if (weapon_subtype_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior' });
      }
    } else if (behavior.requires_subtype === 'weapon') {
      if (!isPositiveInt(weapon_subtype_id)) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Weapon subtype is required for this behavior' });
      }
      if (harassment_subtype_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior' });
      }
    } else {
      if (harassment_subtype_id != null || weapon_subtype_id != null) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Field not allowed for this behavior' });
      }
    }

    // Optional consequence on the L1 path: tenant + active check.
    if (behavior.managed_by === 'staff' && consequence_id != null) {
      if (!isPositiveInt(consequence_id)) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Invalid consequence' });
      }
      const conqRes = await client.query(
        `SELECT 1 FROM discipline_consequences
         WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
        [consequence_id, targetTenantId]
      );
      if (conqRes.rows.length === 0) {
        try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
        return res.status(400).json({ error: 'Invalid consequence' });
      }
    }

    // INSERT referral. incident_date COALESCEs to CURRENT_DATE at the DB
    // so a missing field doesn't depend on Node's clock vs PG's clock.
    const referralRes = await client.query(
      `INSERT INTO discipline_referrals (
         tenant_id, student_id, referring_staff_id, grade,
         incident_date, incident_time, location_id, behavior_id,
         motivation_id, others_involved_id,
         harassment_subtype_id, weapon_subtype_id,
         staff_notes, status
       ) VALUES (
         $1, $2, $3, $4,
         COALESCE($5, CURRENT_DATE), $6, $7, $8,
         $9, $10,
         $11, $12,
         $13, 'submitted'
       ) RETURNING id, status, incident_date, incident_time, created_at`,
      [
        targetTenantId, student_id, req.user.id, grade,
        incident_date || null, incident_time || null, location_id, behavior_id,
        motivation_id || null, others_involved_id || null,
        harassment_subtype_id || null, weapon_subtype_id || null,
        notesValue,
      ]
    );
    const referral = referralRes.rows[0];

    // L1 + consequence: write the join row inside the same transaction.
    if (behavior.managed_by === 'staff' && consequence_id != null) {
      await client.query(
        `INSERT INTO discipline_referral_consequences (referral_id, consequence_id, tenant_id)
         VALUES ($1, $2, $3)`,
        [referral.id, consequence_id, targetTenantId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      id: referral.id,
      status: referral.status,
      incident_date: referral.incident_date,
      incident_time: referral.incident_time,
      created_at: referral.created_at,
      managed_by: behavior.managed_by,
    });

    // Post-commit, fire-and-forget admin notification. Not awaited into
    // the response path; the helper swallows all errors so a mail
    // failure can never affect the 201 already sent or the committed
    // row. tenant scope = the validated targetTenantId. .catch() is
    // belt-and-suspenders — the helper does not reject — to guarantee no
    // unhandled rejection.
    notifySchoolAdminsOfReferral(targetTenantId).catch(() => {});
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow per S87 5a3cfd1 */ }
    console.error('[disciplineReferrals:create]', 'tenant_id=', targetTenantId, 'user_id=', req.user && req.user.id, 'err=', error.message);
    res.status(500).json({ error: 'Failed to create referral' });
  } finally {
    client.release();
  }
});

// ============================================================
// GET /queue/:tenantId — admin review queue for one school.
//
// Visibility gate (§4B/§5):
//   - parent: 403 (existence-of-referral is FERPA-protected; same
//     precedent as POST and GET /student/:studentId).
//   - VIEW_ROLES (school_admin, district_admin, counselor,
//     interventionist): see the queue summary for any referral whose
//     tenant_id matches the path :tenantId. Teachers are NOT in
//     VIEW_ROLES — they reach their own authored referrals via the
//     student-record D6 CASE projection.
//
// Tenant scope: requireTenantStaffAccess verified path :tenantId is in
// the caller's accessible-tenant set per §5 dual-path; the SQL filter
// uses tenant_id = $1 for defense in depth.
//
// PII discipline (§4B): summary fields only. staff_notes / admin_notes
// are NOT in the queue payload — the detail endpoint serves notes via
// the D6 CASE projection when one referral is opened.
//
// Filters: ?status=submitted|under_review|resolved (optional).
// Pagination: ?limit=N (default 50, max 200), ?offset=N (default 0).
// Ordering: incident_date DESC, created_at DESC.
// ============================================================
router.get('/queue/:tenantId', requireAuth, requireTenantStaffAccess, async (req, res) => {
  try {
    if (!VIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const tenantId = Number(req.params.tenantId);
    if (!isPositiveInt(tenantId)) {
      return res.status(400).json({ error: 'Invalid tenant id' });
    }

    const status = typeof req.query.status === 'string' ? req.query.status : null;
    if (status !== null && !['submitted', 'under_review', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    const rawLimit = parseInt(req.query.limit, 10);
    const rawOffset = parseInt(req.query.offset, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const result = await pool.query(
      `SELECT
         dr.id,
         dr.incident_date,
         dr.status,
         db.label          AS behavior_label,
         db.severity_level,
         s.first_name      AS student_first_name,
         s.last_name       AS student_last_name,
         s.grade           AS student_grade,
         rs.full_name      AS referring_staff_name,
         ra.full_name      AS reviewing_admin_name,
         (SELECT COUNT(*)::int
            FROM discipline_referral_consequences drc
           WHERE drc.referral_id = dr.id
             AND drc.tenant_id   = dr.tenant_id) AS consequence_count
       FROM discipline_referrals dr
       JOIN students s
         ON s.id = dr.student_id AND s.tenant_id = dr.tenant_id
       JOIN discipline_behaviors db
         ON db.id = dr.behavior_id AND db.tenant_id = dr.tenant_id
       LEFT JOIN users rs ON rs.id = dr.referring_staff_id
       LEFT JOIN users ra ON ra.id = dr.reviewing_admin_id
       WHERE dr.tenant_id = $1
         AND ($2::text IS NULL OR dr.status = $2::text)
       ORDER BY dr.incident_date DESC, dr.created_at DESC
       LIMIT $3 OFFSET $4`,
      [tenantId, status, limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      '[disciplineReferrals:queue]',
      'tenant_id=', req.params.tenantId,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load queue' });
  }
});

// ============================================================
// GET /export — CSV download of discipline referrals matching the
// supplied filters. Structured fields only — staff_notes and
// admin_notes are NEVER projected (§4B hard line; the SELECT
// enumerates an explicit column list, no SELECT *).
//
// MUST be registered BEFORE GET /:id below — Express matches routes
// in registration order, and 'export' would otherwise match the /:id
// pattern and fail isPositiveInt with a misleading 400.
//
// Visibility gate: EXPORT_ROLES (alias of VIEW_ROLES — school_admin,
// district_admin, counselor, interventionist). Parent + teacher + EA
// + any other role → 403. Teacher caseload-scoped export is deferred
// to R-1b.
//
// Role gate fires BEFORE any input parsing (S116 role-gate-before-
// input-parse lesson), so a probing parent/teacher gets a clean 403
// even on malformed params, never a 400 that would confirm endpoint
// existence.
//
// Tenant scope: resolveAccessibleTenantIds(req.user) is the trust
// boundary (§5 dual-path doctrine; never inlined). The optional
// school_tenant_id query param narrows WITHIN the accessible set; an
// id outside the accessible set returns a byte-identical 403 with
// no existence disclosure.
//
// Joins:
//   - students INNER (NOT NULL + NO ACTION FK ⇒ a referral cannot
//     exist whose student row is missing — safe against silent drops)
//   - discipline_behaviors INNER (NOT NULL + NO ACTION composite FK)
//   - tenants INNER (NOT NULL + NO ACTION FK)
//   - users (referring_staff) LEFT — matches the file's existing
//     queue/detail/student-history precedent (defense in depth even
//     though the FK is NOT NULL + NO ACTION); the user-tenant
//     boundary lives in user_school_access at the application layer,
//     not in this join. CALLED OUT FOR TENANT-ISOLATION-AUDITOR.
//   - student_race_ethnicity correlated subquery uses the composite
//     predicate (sre.student_id = s.id AND sre.tenant_id = s.tenant_id)
//     so §5 stays visible in the query even though the M042 composite
//     FK enforces it at the schema layer.
//
// Demographic fields per operator decision: grade, iep_flag,
// sec_504_flag, ell_flag, gender, race_ethnicity. The latter two
// are a DEVIATION from R-1 spec §9 (which excluded race/ethnicity
// from v1 and didn't list gender). Surfaced in the PR body for
// privacy-reviewer assessment.
//
// CSV discipline (§4B):
//   - Every cell run through csvEscapeField — RFC 4180 quoting on
//     , " CR LF with quote-doubling, plus an OWASP formula-injection
//     guard prefixing ' on a leading = + - @ TAB CR.
//   - Filename in Content-Disposition is static; HTTP headers can be
//     logged by intermediaries, so no school name or date range
//     there. Operator renames on save.
//   - 3-state flag rendering: NULL → empty cell; TRUE/FALSE →
//     'true'/'false' (aligned with the M042 audit table's TEXT form).
//   - race_ethnicity rendered as semicolon-joined stable codes, NOT
//     display labels — labels live in app constants per M042.
//   - Empty result set returns a valid header-only file (per spec §5),
//     not a 404.
//   - Error log carries integers + err.message only — no names, no
//     school slug, no labels, no row contents.
//
// Open from spec Q5: row-volume handling. v1 is uncapped — the
// first real-world large export will tell us if a cap/stream is
// needed.
// ============================================================
router.get('/export', requireAuth, async (req, res) => {
  let accessible;
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    if (!EXPORT_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    accessible = await resolveAccessibleTenantIds(req.user);

    const startParsed = parseDateParam(req.query.start_date, 'start_date');
    if (!startParsed.ok) return res.status(400).json({ error: startParsed.error });
    const endParsed = parseDateParam(req.query.end_date, 'end_date');
    if (!endParsed.ok) return res.status(400).json({ error: endParsed.error });

    const status = typeof req.query.status === 'string' ? req.query.status : null;
    if (status !== null && !EXPORT_STATUS_VALUES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    let behaviorId = null;
    if (req.query.behavior_id !== undefined && req.query.behavior_id !== '') {
      const parsed = parseInt(req.query.behavior_id, 10);
      if (!isPositiveInt(parsed)) {
        return res.status(400).json({ error: 'Invalid behavior_id' });
      }
      behaviorId = parsed;
    }

    // school_tenant_id narrows WITHIN the accessible set. Not-in-set
    // collapses to 403 with no existence disclosure (matches the
    // probe-resistance idiom used throughout this file).
    let scopeIds = accessible;
    if (req.query.school_tenant_id !== undefined && req.query.school_tenant_id !== '') {
      const parsed = parseInt(req.query.school_tenant_id, 10);
      if (!isPositiveInt(parsed)) {
        return res.status(400).json({ error: 'Invalid school_tenant_id' });
      }
      if (!accessible.includes(parsed)) {
        return res.status(403).json(FORBIDDEN_BODY);
      }
      scopeIds = [parsed];
    }

    const result = await pool.query(
      `SELECT
         dr.id                                                AS referral_id,
         TO_CHAR(dr.incident_date, 'YYYY-MM-DD')              AS incident_date,
         s.first_name                                         AS student_first_name,
         s.last_name                                          AS student_last_name,
         s.id                                                 AS student_internal_id,
         s.grade                                              AS grade,
         s.iep_flag                                           AS iep_flag,
         s.sec_504_flag                                       AS sec_504_flag,
         s.ell_flag                                           AS ell_flag,
         s.gender                                             AS gender,
         COALESCE(
           (SELECT ARRAY_AGG(sre.category ORDER BY sre.category)
              FROM student_race_ethnicity sre
             WHERE sre.student_id = s.id
               AND sre.tenant_id  = s.tenant_id),
           ARRAY[]::varchar[]
         )                                                    AS race_ethnicity,
         t.name                                               AS school_name,
         db.label                                             AS behavior_label,
         dr.status                                            AS status,
         rs.full_name                                         AS referring_staff_name,
         dr.referring_staff_id                                AS referring_staff_id
       FROM discipline_referrals dr
       JOIN students s
         ON s.id        = dr.student_id
        AND s.tenant_id = dr.tenant_id
       JOIN discipline_behaviors db
         ON db.id        = dr.behavior_id
        AND db.tenant_id = dr.tenant_id
       JOIN tenants t
         ON t.id = dr.tenant_id
       LEFT JOIN users rs
         ON rs.id = dr.referring_staff_id
       WHERE dr.tenant_id = ANY($1::int[])
         AND ($2::date IS NULL OR dr.incident_date >= $2::date)
         AND ($3::date IS NULL OR dr.incident_date <= $3::date)
         AND ($4::int  IS NULL OR dr.behavior_id    = $4::int)
         AND ($5::text IS NULL OR dr.status         = $5::text)
       ORDER BY dr.incident_date DESC, dr.id DESC`,
      [scopeIds, startParsed.value, endParsed.value, behaviorId, status]
    );

    const headers = [
      'referral_id',
      'incident_date',
      'student_first_name',
      'student_last_name',
      'student_internal_id',
      'grade',
      'iep_flag',
      'sec_504_flag',
      'ell_flag',
      'gender',
      'race_ethnicity',
      'school_name',
      'behavior_label',
      'status',
      'referring_staff_name',
      'referring_staff_id',
    ];

    const lines = [headers.join(',')];
    for (const row of result.rows) {
      const raceCodes = Array.isArray(row.race_ethnicity)
        ? row.race_ethnicity.join(';')
        : '';
      const cells = [
        csvEscapeField(row.referral_id),
        csvEscapeField(row.incident_date),
        csvEscapeField(row.student_first_name),
        csvEscapeField(row.student_last_name),
        csvEscapeField(row.student_internal_id),
        csvEscapeField(row.grade),
        csvEscapeField(formatBooleanForCsv(row.iep_flag)),
        csvEscapeField(formatBooleanForCsv(row.sec_504_flag)),
        csvEscapeField(formatBooleanForCsv(row.ell_flag)),
        csvEscapeField(row.gender),
        csvEscapeField(raceCodes),
        csvEscapeField(row.school_name),
        csvEscapeField(row.behavior_label),
        csvEscapeField(row.status),
        csvEscapeField(row.referring_staff_name),
        csvEscapeField(row.referring_staff_id),
      ];
      lines.push(cells.join(','));
    }
    const body = lines.join('\r\n') + '\r\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="discipline-referrals.csv"');
    res.status(200).send(body);
  } catch (error) {
    // Strict err.code + err.name only — never err.message — per
    // security-reviewer WARN-1 (post-triad redaction). PG error
    // messages can embed parameter literals and, in unanticipated
    // error classes, row content; this route's projection includes
    // student names, school name, and behavior labels (all §4B PII),
    // so a future failure mode whose err.message echoed a row value
    // would leak that value into application logs. err.code (e.g.
    // '22008' for invalid datetime) + err.name preserve operator
    // debug signal without the literal-passthrough risk.
    console.error(
      '[disciplineReferrals:export]',
      'user_id=', req.user && req.user.id,
      'tenant_count=', accessible ? accessible.length : 'unresolved',
      'err_code=', error.code,
      'err_name=', error.name
    );
    res.status(500).json({ error: 'Failed to export referrals' });
  }
});

// ============================================================
// GET /:id — single-referral detail for the admin review surface.
//
// Visibility gate (§4B/§5):
//   - parent: 403 (existence-of-referral is FERPA-protected).
//   - VIEW_ROLES: see the referral if its tenant is in the caller's
//     accessible-tenant set. Cross-tenant probe and non-existent id
//     collapse to a byte-identical 403 via loadReferralAndAssertTenant.
//
// D6 CASE-projection of staff_notes / admin_notes is kept even though
// every current VIEW_ROLE resolves to "see notes" — if the role gate
// ever widens, the SQL gate keeps notes off the wire for non-allowed
// roles (defense in depth).
//
// Tenant scope: helper performs the §5 dual-path check; the SELECT
// also filters dr.tenant_id = ANY($2::int[]) so a divergence between
// the helper and the SELECT can't leak a row.
//
// PII discipline (§4B): error log carries referral_id (int) + user_id
// (int) + err.message only. No body echo, no labels.
// ============================================================
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    if (!VIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const referralId = Number(req.params.id);
    if (!isPositiveInt(referralId)) {
      return res.status(400).json({ error: 'Invalid referral id' });
    }

    const auth = await loadReferralAndAssertTenant(referralId, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const result = await pool.query(
      `SELECT
         dr.id,
         dr.tenant_id,
         dr.student_id,
         dr.incident_date,
         dr.incident_time,
         dr.status,
         dr.reviewing_admin_id,
         dr.reviewed_at,
         dr.time_out_of_instruction,
         dr.created_at,
         dr.updated_at,
         s.first_name      AS student_first_name,
         s.last_name       AS student_last_name,
         s.grade           AS student_grade,
         db.id             AS behavior_id,
         db.label          AS behavior_label,
         db.severity_level,
         db.managed_by,
         db.requires_subtype,
         dl.id             AS location_id,
         dl.label          AS location_label,
         dm.id             AS motivation_id,
         dm.label          AS motivation_label,
         doi.id            AS others_involved_id,
         doi.label         AS others_involved_label,
         dhs.id            AS harassment_subtype_id,
         dhs.label         AS harassment_subtype_label,
         dws.id            AS weapon_subtype_id,
         dws.label         AS weapon_subtype_label,
         rs.full_name      AS referring_staff_name,
         ra.full_name      AS reviewing_admin_name,
         CASE
           WHEN $3::text IN ('counselor','school_admin','district_admin','interventionist') THEN dr.staff_notes
           WHEN $3::text = 'teacher' AND dr.referring_staff_id = $4::int THEN dr.staff_notes
           ELSE NULL
         END               AS staff_notes,
         CASE
           WHEN $3::text IN ('counselor','school_admin','district_admin','interventionist') THEN dr.admin_notes
           ELSE NULL
         END               AS admin_notes,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', dc.id,
              'label', dc.label,
              'is_restorative', dc.is_restorative,
              'sort_order', dc.sort_order,
              'assigned_at', drc.assigned_at
            ) ORDER BY dc.sort_order, dc.label)
              FROM discipline_referral_consequences drc
              JOIN discipline_consequences dc
                ON dc.id = drc.consequence_id AND dc.tenant_id = drc.tenant_id
             WHERE drc.referral_id = dr.id AND drc.tenant_id = dr.tenant_id),
           '[]'::json
         )                 AS consequences
       FROM discipline_referrals dr
       JOIN students s
         ON s.id = dr.student_id AND s.tenant_id = dr.tenant_id
       JOIN discipline_behaviors db
         ON db.id = dr.behavior_id AND db.tenant_id = dr.tenant_id
       JOIN discipline_locations dl
         ON dl.id = dr.location_id AND dl.tenant_id = dr.tenant_id
       LEFT JOIN discipline_motivations dm
         ON dm.id = dr.motivation_id AND dm.tenant_id = dr.tenant_id
       LEFT JOIN discipline_others_involved doi
         ON doi.id = dr.others_involved_id AND doi.tenant_id = dr.tenant_id
       LEFT JOIN discipline_harassment_subtypes dhs
         ON dhs.id = dr.harassment_subtype_id AND dhs.tenant_id = dr.tenant_id
       LEFT JOIN discipline_weapon_subtypes dws
         ON dws.id = dr.weapon_subtype_id AND dws.tenant_id = dr.tenant_id
       LEFT JOIN users rs ON rs.id = dr.referring_staff_id
       LEFT JOIN users ra ON ra.id = dr.reviewing_admin_id
       WHERE dr.id = $1 AND dr.tenant_id = ANY($2::int[])`,
      [referralId, auth.accessible, req.user.role, req.user.id]
    );

    if (result.rows.length === 0) {
      // Helper passed but the defensive SELECT scope returned nothing —
      // treat as not-authorized rather than 500 to preserve the
      // existence-non-disclosure contract.
      return res.status(403).json(FORBIDDEN_BODY);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(
      '[disciplineReferrals:detail]',
      'referral_id=', req.params.id,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to load referral' });
  }
});

// ============================================================
// PATCH /:id/claim — admin opens a submitted referral for review.
//
// Transition: status 'submitted' → 'under_review'. From-state is
// encoded in the SQL WHERE clause; the request body never carries
// a target status. Side effects: reviewing_admin_id = req.user.id
// (always server-derived, never read from body), reviewed_at = now.
//
// Gates:
//   - requireAuth + ACT_ROLES (school_admin, district_admin).
//   - loadReferralAndAssertTenant collapses not-found and cross-tenant
//     to a byte-identical 403.
//
// Operational-state vs authz: if the helper passed but the UPDATE
// touches 0 rows, the referral exists in the caller's tenant but is
// not in 'submitted' status. Return 400, not 403 — matches the
// prereferralForms transition-endpoint precedent (e.g. /:id/submit at
// routes/prereferralForms.js:558).
//
// PII discipline (§4B): error log carries referral_id (int) + user_id
// (int) + err.message only.
// ============================================================
router.patch('/:id/claim', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    if (!ACT_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const referralId = Number(req.params.id);
    if (!isPositiveInt(referralId)) {
      return res.status(400).json({ error: 'Invalid referral id' });
    }

    const auth = await loadReferralAndAssertTenant(referralId, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const result = await pool.query(
      `UPDATE discipline_referrals
          SET status             = 'under_review',
              reviewing_admin_id = $3,
              reviewed_at        = CURRENT_TIMESTAMP,
              updated_at         = CURRENT_TIMESTAMP
        WHERE id        = $1
          AND tenant_id = ANY($2::int[])
          AND status    = 'submitted'
        RETURNING id, status, reviewing_admin_id, reviewed_at, updated_at`,
      [referralId, auth.accessible, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Referral is not in a claimable state' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(
      '[disciplineReferrals:claim]',
      'referral_id=', req.params.id,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to claim referral' });
  }
});

// ============================================================
// PATCH /:id/release — admin releases a claimed referral back to the
// queue without resolving.
//
// Transition: status 'under_review' → 'submitted'. From-state is
// encoded in the SQL WHERE clause. Side effects: reviewing_admin_id
// and reviewed_at are cleared so the row reads as "fresh in queue"
// for the next admin.
//
// Any admin in ACT_ROLES can release — not just the admin who claimed
// it. Per product call, this avoids a stuck state when the claiming
// admin is out of office or has left the district. The audit trail
// of who held the claim moves to the trigger / audit log layer if/when
// one is added; the row itself is intentionally a current-state shape.
//
// admin_notes is NOT cleared on release. A release-back is reversible
// state, and destroying draft notes silently is a footgun. The next
// admin who claims can read or overwrite them.
//
// Gates + error model mirror /:id/claim.
// ============================================================
router.patch('/:id/release', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    if (!ACT_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const referralId = Number(req.params.id);
    if (!isPositiveInt(referralId)) {
      return res.status(400).json({ error: 'Invalid referral id' });
    }

    const auth = await loadReferralAndAssertTenant(referralId, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const result = await pool.query(
      `UPDATE discipline_referrals
          SET status             = 'submitted',
              reviewing_admin_id = NULL,
              reviewed_at        = NULL,
              updated_at         = CURRENT_TIMESTAMP
        WHERE id        = $1
          AND tenant_id = ANY($2::int[])
          AND status    = 'under_review'
        RETURNING id, status, reviewing_admin_id, reviewed_at, updated_at`,
      [referralId, auth.accessible]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Referral is not in a releasable state' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(
      '[disciplineReferrals:release]',
      'referral_id=', req.params.id,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to release referral' });
  }
});

// ============================================================
// PATCH /:id/admin-notes — save (or clear) admin_notes mid-review.
//
// Required while the referral is under_review so admins can persist
// draft notes incrementally without committing to /resolve. Status is
// NOT changed by this endpoint.
//
// Body contract: { admin_notes: string | null }
//   - Key absent → 400 "Missing admin_notes". Use a different endpoint
//     to reach the row without touching notes.
//   - Non-string (other than null) → 400.
//   - String trimmed to NULL → clears the column (deliberate clear).
//   - String length after trim > ADMIN_NOTES_MAX_LENGTH → 400.
//
// Gates:
//   - requireAuth + ACT_ROLES (write surface; counselor/interventionist
//     can read notes via GET /:id but cannot write them).
//   - loadReferralAndAssertTenant collapses not-found/cross-tenant to 403.
//   - SQL WHERE status = 'under_review' is the authoritative from-state
//     gate. Helper-passed + UPDATE-touched-0 ⇒ 400 (operational state).
//
// PII discipline (§4B): admin_notes contents are never logged, never
// echoed in error bodies. Error log carries referral_id (int) +
// user_id (int) + err.message only.
// ============================================================
router.patch('/:id/admin-notes', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
    if (!ACT_ROLES.includes(req.user.role)) {
      return res.status(403).json(FORBIDDEN_BODY);
    }

    const referralId = Number(req.params.id);
    if (!isPositiveInt(referralId)) {
      return res.status(400).json({ error: 'Invalid referral id' });
    }

    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, 'admin_notes')) {
      return res.status(400).json({ error: 'Missing admin_notes' });
    }
    const parsed = parseAdminNotes(body.admin_notes);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const auth = await loadReferralAndAssertTenant(referralId, req.user);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const result = await pool.query(
      `UPDATE discipline_referrals
          SET admin_notes = $3,
              updated_at  = CURRENT_TIMESTAMP
        WHERE id        = $1
          AND tenant_id = ANY($2::int[])
          AND status    = 'under_review'
        RETURNING id, status, updated_at`,
      [referralId, auth.accessible, parsed.value]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Notes can only be saved while a referral is under review' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(
      '[disciplineReferrals:adminNotes]',
      'referral_id=', req.params.id,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to save admin notes' });
  }
});

// ============================================================
// PATCH /:id/resolve — terminal transition: under_review → resolved.
//
// Attaches one or more consequence rows to the referral and optionally
// updates admin_notes in the same transaction. reviewing_admin_id and
// reviewed_at are intentionally preserved on resolve so the row carries
// the audit trail of who handled it.
//
// Body contract:
//   { consequence_ids: positive_int[], admin_notes?: string | null }
//   - consequence_ids: REQUIRED. Non-empty array of positive ints; the
//     handler dedupes via Set. Every id must resolve to an active
//     consequence in the row's tenant; otherwise 400 with a generic
//     "Invalid consequence(s)".
//   - admin_notes: OPTIONAL. Absent key ⇒ preserve existing column.
//     Present (incl. explicit null / empty-after-trim) ⇒ overwrite.
//     parseAdminNotes enforces the 5000-char cap.
//
// Replace-set semantics: existing join rows are deleted and replaced
// with the supplied set in the same transaction, so re-resolving (in
// the unlikely case the row was ever bounced back, which the current
// matrix forbids — resolved is terminal) yields a clean state. The
// replacement is wrapped in a single tx; UPDATE-touched-0 ⇒ ROLLBACK
// and 400, no half-written state.
//
// Gates: requireAuth + ACT_ROLES + loadReferralAndAssertTenant (403
// collapse). SQL WHERE status = 'under_review' is the authoritative
// from-state guard.
//
// PII discipline (§4B): admin_notes contents are never logged or
// echoed in error bodies. Error log carries referral_id (int) +
// user_id (int) + err.message only.
// ============================================================
router.patch('/:id/resolve', requireAuth, async (req, res) => {
  if (req.user.role === 'parent') return res.status(403).json(FORBIDDEN_BODY);
  if (!ACT_ROLES.includes(req.user.role)) {
    return res.status(403).json(FORBIDDEN_BODY);
  }

  const referralId = Number(req.params.id);
  if (!isPositiveInt(referralId)) {
    return res.status(400).json({ error: 'Invalid referral id' });
  }

  const body = req.body || {};

  if (!Array.isArray(body.consequence_ids)) {
    return res.status(400).json({ error: 'consequence_ids must be an array' });
  }
  if (body.consequence_ids.length === 0) {
    return res.status(400).json({ error: 'At least one consequence is required' });
  }
  if (!body.consequence_ids.every(isPositiveInt)) {
    return res.status(400).json({ error: 'Invalid consequence_ids' });
  }
  const uniqueIds = Array.from(new Set(body.consequence_ids));

  const hasNotesField = Object.prototype.hasOwnProperty.call(body, 'admin_notes');
  let notesValue = null;
  if (hasNotesField) {
    const parsed = parseAdminNotes(body.admin_notes);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    notesValue = parsed.value;
  }

  // Tenant assertion (pre-tx, read-only). Failure modes here are wrapped
  // in their own try so they don't leak into the tx rollback path.
  let auth;
  try {
    auth = await loadReferralAndAssertTenant(referralId, req.user);
  } catch (error) {
    console.error(
      '[disciplineReferrals:resolve]',
      'referral_id=', req.params.id,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    return res.status(500).json({ error: 'Failed to resolve referral' });
  }
  if (!auth.ok) return res.status(auth.status).json(auth.body);
  const tenantId = auth.row.tenant_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate every supplied consequence id: exists + active + same
    // tenant as the row. Count-comparison collapses ids-not-found and
    // ids-from-another-tenant to a single 400 (no existence disclosure).
    const conqRes = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM discipline_consequences
        WHERE id = ANY($1::int[])
          AND tenant_id = $2
          AND is_active = TRUE`,
      [uniqueIds, tenantId]
    );
    if (conqRes.rows[0].n !== uniqueIds.length) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow per S87 5a3cfd1 */ }
      return res.status(400).json({ error: 'Invalid consequence(s)' });
    }

    // Replace-set: clear any existing join rows for this referral then
    // bulk-insert the supplied set. Composite FK on the join enforces
    // same-tenant at the schema layer.
    await client.query(
      `DELETE FROM discipline_referral_consequences
        WHERE referral_id = $1 AND tenant_id = $2`,
      [referralId, tenantId]
    );

    // Placeholder layout: $1 = referralId, $2 = tenantId, $3..$N = ids.
    const valueRows = uniqueIds.map((_, i) => `($1, $${i + 3}, $2)`).join(', ');
    await client.query(
      `INSERT INTO discipline_referral_consequences (referral_id, consequence_id, tenant_id)
       VALUES ${valueRows}`,
      [referralId, tenantId, ...uniqueIds]
    );

    // Terminal status transition. admin_notes is overwritten only when
    // the body carried the key; the CASE-on-bool keeps PATCH semantics
    // (omitted field → preserve). reviewing_admin_id and reviewed_at
    // are intentionally NOT touched — they carry the audit trail of who
    // handled the referral.
    const updateRes = await client.query(
      `UPDATE discipline_referrals
          SET status      = 'resolved',
              admin_notes = CASE WHEN $4::bool THEN $3 ELSE admin_notes END,
              updated_at  = CURRENT_TIMESTAMP
        WHERE id        = $1
          AND tenant_id = $2
          AND status    = 'under_review'
        RETURNING id, status, reviewing_admin_id, reviewed_at, updated_at`,
      [referralId, tenantId, notesValue, hasNotesField]
    );

    if (updateRes.rows.length === 0) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow per S87 5a3cfd1 */ }
      return res.status(400).json({ error: 'Referral is not in a resolvable state' });
    }

    await client.query('COMMIT');
    res.json(updateRes.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow per S87 5a3cfd1 */ }
    console.error(
      '[disciplineReferrals:resolve]',
      'referral_id=', req.params.id,
      'user_id=', req.user && req.user.id,
      'err=', error.message
    );
    res.status(500).json({ error: 'Failed to resolve referral' });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.initializePool = initializePool;
