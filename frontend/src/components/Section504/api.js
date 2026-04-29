// Section 504 API wrappers — staff routes (PR #24, /api/student-504).
//
// One module owns three pieces of contract for every 504 fetch the staff
// frontend makes:
//
//   1. credentials: 'include' on every request — the auth_token cookie is
//      httpOnly, so without this flag the JWT does not ride along and
//      requireAuth returns 401. Every helper below routes through send().
//
//   2. tenant scoping is server-side only. We never put tenant_id in the
//      URL, query string, or body. routes/student504.js derives tenant_id
//      from req.user.tenant_id (JWT claim) — see CLAUDE.md §5.
//
//   3. Error envelope discards the response body. Backend error strings
//      for 504 endpoints are generic today, but treating every failure as
//      opaque prevents future-added detail (e.g., a column name in a PG
//      error) from accidentally surfacing on the wire to a UI toast and
//      then a log line. This is the §4B "no PII in errors" rule applied
//      preemptively at the FE boundary.
//
// Cross-tenant note: the staff routes return 404 (not 403) when a
// requested cycleId / consentId / determinationId / planId belongs to
// another tenant — existence is not leaked. Callers that surface "not
// found" to the user should NOT distinguish between "doesn't exist" and
// "wrong tenant" in the rendered message.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function send(API_URL, path, init) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
  });
  if (!res.ok) {
    // Body intentionally not read. The status code alone is enough for
    // UI branching; downstream callers map this to a generic message.
    throw new Error(`504 API request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// GET /api/student-504/cycles/student/:studentId
// Returns array of cycle rows, newest first. Empty array for "no cycles
// yet" AND for "studentId belongs to another tenant" — non-leaky.
export function listCyclesForStudent(API_URL, studentId) {
  return send(API_URL, `/student-504/cycles/student/${studentId}`, {
    method: 'GET',
  });
}

// GET /api/student-504/cycles/:cycleId
// Returns the cycle bundle: cycle row + consents[] + eligibility_determinations[]
// + plans[] + team_members[]. 404 for both "not found" and "wrong tenant".
// Used by Section504CycleView in commit 2.
export function getCycleBundle(API_URL, cycleId) {
  return send(API_URL, `/student-504/cycles/${cycleId}`, {
    method: 'GET',
  });
}

// POST /api/student-504/cycles
// Body: { student_id, form_set_id, form_set_version }. The backend
// validates form_set_id + form_set_version against tenant_form_sets
// scoped to the calling user's tenant; an unconfigured tenant gets a
// clean 400 ("Invalid form set or version for this tenant").
export function createCycle(API_URL, { student_id, form_set_id, form_set_version }) {
  return send(API_URL, `/student-504/cycles`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ student_id, form_set_id, form_set_version }),
  });
}

// POST /api/student-504/consents — Form C (Prior Notice and Consent to Evaluate).
//
// Append-only revision contract: each successful POST creates a NEW row in
// student_504_evaluation_consents for the cycle. The cycle bundle returns
// the full history; latest-by-created_at is treated as "current" by the FE.
// There is no PUT — staff cannot edit a saved consent in place; they
// "Save" again, which appends a new revision.
//
// Body shape (all optional except cycle_id):
//   {
//     cycle_id,
//     consent_status?:        'pending' | 'granted' | 'denied' | 'revoked',
//     parent_signature_text?: string (≤300 chars),
//     parent_signature_at?:   ISO timestamp (YYYY-MM-DDTHH:MM:SSZ),
//     staff_signature_text?:  string (≤300 chars),
//     staff_signature_at?:    ISO timestamp,
//   }
//
// Privacy: staff_signature_text is parent-visible at write time per the
// PRIVACY_REVIEW.md print-mode caveat. The FE surface that drives this
// field MUST display the parent-visible warning to staff before save.
export function createConsent(API_URL, body) {
  return send(API_URL, `/student-504/consents`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

// POST /api/student-504/eligibility-determinations — Form I.
//
// Append-only revision contract identical to /consents: each successful
// POST creates a NEW row; no PUT. Latest-by-created_at is "current."
//
// Body shape (all optional except cycle_id):
//   {
//     cycle_id,
//     eligibility_status?:    'pending' | 'eligible' | 'not_eligible',
//     determination_notes?:   string (UNCAPPED — eligibility reasoning
//                             paragraphs, see route comment),
//     determined_at?:         ISO timestamp (YYYY-MM-DDTHH:MM:SSZ),
//   }
//
// Privacy: determination_notes is STAFF-ONLY per the §4B permission
// tier matrix. The parent route family does NOT expose this resource at
// all (routes/parent504.js has no eligibility-determinations handler),
// so the column cannot leak via the parent surface. The FE surface that
// drives this field MUST keep it OUTSIDE any print-scope container so
// commit 5's CSS print gating reliably excludes it from the printed
// Form I delivered to the parent.
export function createDetermination(API_URL, body) {
  return send(API_URL, `/student-504/eligibility-determinations`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}
