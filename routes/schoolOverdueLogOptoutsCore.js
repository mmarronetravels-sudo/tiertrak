// schoolOverdueLogOptoutsCore — pure, DB-free helpers for the school_admin
// self-service overdue-logs opt-out surface (routes/schoolOverdueLogOptouts.js).
//
// Extracted from the router so the role gate and the §5 scope-resolution
// decision can be unit-tested without a database (mirrors
// routes/screenerResetCore.js). The router wires these to pg + express; all
// authorization-relevant branching lives here so a test can pin it.
//
// §5: the target school is resolved ONLY from the caller's accessible set
// (resolveAccessibleTenantIds output), never trusted from request input. A
// supplied school_tenant_id is validated to be a MEMBER of that set; anything
// else is a 403. The membership check is type-safe by construction (see
// resolveOwnSchoolId) so a valid own-school request can never be wrongly
// rejected by a number-vs-string mismatch.

const INT4_MAX = 2147483647;

// Narrowest possible writer/reader allowlist: school_admin ONLY. NOT
// district_tech_admin (read-only role by design — must never write this), NOT
// district_admin (has its own #337 endpoint; prod has no districts).
const SELF_SERVICE_ROLES = ['school_admin'];

function validateIntParam(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

function validateBool(value) {
  return typeof value === 'boolean' ? value : null;
}

// Server-authoritative feature flag. The FE hides the toggle unless this is
// true; the FE never asserts it (mirrors the is_operator convention).
function featureEnabled(env) {
  return !!env && env.OVERDUE_LOGS_REMINDERS_ENABLED === 'true';
}

// Resolve which school a self-service caller may act on.
//   role       - req.user.role
//   accessible - number[] from resolveAccessibleTenantIds(req.user)
//   requested  - raw school_tenant_id from query/body (or undefined/null)
//
// Returns { schoolTenantId } on success, or { error: { status, message } }.
//
// Order matters: the role gate runs BEFORE any input parse, so a non-
// school_admin caller is rejected without exercising the input validators
// (role-gate-before-parse convention).
//
// Type safety: both the accessible entries and the parsed request value are
// coerced to numbers before the membership check, so accessible.includes()
// compares number-to-number and cannot wrongly 403 a valid own-school request
// if a tenant id ever arrives as a string from either side.
function resolveOwnSchoolId(role, accessible, requested) {
  if (!SELF_SERVICE_ROLES.includes(role)) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  const set = (accessible || []).map(Number);

  let schoolTenantId;
  if (requested !== undefined && requested !== null) {
    schoolTenantId = validateIntParam(requested);
    if (schoolTenantId === null) {
      return { error: { status: 400, message: 'Invalid school_tenant_id' } };
    }
  } else if (set.length === 1) {
    // Sole-building admin (every prod tenant today): no explicit id needed.
    schoolTenantId = set[0];
  } else {
    // Zero accessible schools, or more than one and none named.
    return { error: { status: 400, message: 'school_tenant_id required' } };
  }

  if (!set.includes(schoolTenantId)) {
    return { error: { status: 403, message: 'Forbidden' } };
  }

  return { schoolTenantId };
}

module.exports = {
  SELF_SERVICE_ROLES,
  validateIntParam,
  validateBool,
  featureEnabled,
  resolveOwnSchoolId,
};
