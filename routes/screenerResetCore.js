// screenerResetCore — pure, dependency-free helpers for the scoped screener
// data reset (feat/screener-data-reset). No pg, no Express, no I/O: this module
// is the single source of (a) reset-scope validation and (b) the WHERE clause
// shared by BOTH the preview (SELECT COUNT) and the delete (DELETE) so the two
// can never diverge. Keeping it pure makes it unit-testable under node:test
// without a database.
//
// §5: buildScopeWhere ALWAYS leads with `tenant_id = $1`. The caller supplies
// the resolved tenant id (from resolveAccessibleTenantIds at the route layer,
// never from request input); this module never sees req/body and so cannot
// widen scope.
//
// §4B: the three mandatory filters (school_year, screening_period, subject) and
// the optional assessment_type are assessment-batch descriptors, not person
// identifiers. This module handles no names/ids/scores.

// Validate the reset scope from a request body. school_year, screening_period,
// and subject are REQUIRED non-empty (hard-refuse with 400 if any missing).
// assessment_type is an OPTIONAL narrowing filter: absent/blank → null (the
// reset is not narrowed by assessment_type). Field names mirror the sibling
// screener upload routes (camelCase request fields).
//
// Returns { scope } on success or { error: { status, body } } on failure.
// scope = { schoolYear, screeningPeriod, subject, assessmentType } where
// assessmentType is a trimmed string or null (NEVER "" — the null/empty
// distinction is load-bearing for the audit row, M049).
function validateResetScope(body) {
  const b = body || {};
  const schoolYear = String(b.schoolYear || '').trim();
  const screeningPeriod = String(b.screeningPeriod || '').trim();
  const subject = String(b.subject || '').trim();

  if (!schoolYear || !screeningPeriod || !subject) {
    return {
      error: {
        status: 400,
        body: { error: 'Missing required scope: schoolYear, screeningPeriod, and subject are all required.' }
      }
    };
  }

  // Optional narrowing filter. Blank/whitespace/absent collapses to null so the
  // un-narrowed case is stored as NULL (not ""), per M049's forensic distinction.
  const rawAssessment = b.assessmentType;
  const trimmedAssessment = rawAssessment == null ? '' : String(rawAssessment).trim();
  const assessmentType = trimmedAssessment === '' ? null : trimmedAssessment;

  return { scope: { schoolYear, screeningPeriod, subject, assessmentType } };
}

// Build the shared WHERE clause + parameter array for a reset scope. Used by
// BOTH preview and delete so the count previewed equals the rows deleted.
// tenant_id is ALWAYS $1 (the §5 lead). assessment_type is appended as the next
// positional parameter ONLY when the scope is narrowed (assessmentType !== null);
// when null, the clause omits it and the reset spans every assessment_type in
// the (tenant, year, period, subject) batch.
//
// @param {number} tenantId - resolved school-tenant id (route layer authority)
// @param {{schoolYear:string, screeningPeriod:string, subject:string, assessmentType:(string|null)}} scope
// @returns {{ whereSql: string, params: Array }}
function buildScopeWhere(tenantId, scope) {
  const conditions = [
    'tenant_id = $1',
    'school_year = $2',
    'screening_period = $3',
    'subject = $4'
  ];
  const params = [tenantId, scope.schoolYear, scope.screeningPeriod, scope.subject];

  if (scope.assessmentType !== null && scope.assessmentType !== undefined) {
    params.push(scope.assessmentType);
    conditions.push(`assessment_type = $${params.length}`);
  }

  return { whereSql: conditions.join(' AND '), params };
}

module.exports = { validateResetScope, buildScopeWhere };
