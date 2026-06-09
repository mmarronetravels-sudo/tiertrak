// platformAdminOnly — env-allowlist gate for operator-only routes.
//
// Reads PLATFORM_ADMIN_USER_IDS from the environment once at module
// load and freezes the parsed set. Format: comma-separated integers,
// whitespace tolerated. Malformed entries are dropped silently — a
// malformed env var should not 500 the request; it should refuse it.
//
// If the env var is unset or empty, the allowlist is empty and every
// request is denied with 403. This is intentional: operator-only
// routes are dead-locked closed until the env var is set on Render.
//
// MUST run AFTER requireAuth — depends on req.user.id being populated.
//
// Why an env-allowlist and not a database role: cross-tenant operator
// access is intentionally NOT a customer-facing role. Storing it as a
// users.role value would surface it on every tenant's user list and
// would be writable via /api/users grants. The env-allowlist keeps the
// privilege out of any tenant's data plane.
require('dotenv').config();

const ALLOWLIST = (() => {
  const raw = process.env.PLATFORM_ADMIN_USER_IDS || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => Number(s));
  return new Set(ids);
})();

function platformAdminOnly(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!ALLOWLIST.has(Number(req.user.id))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

// isOperator — predicate form of the same allowlist check, for callers
// that need a boolean rather than a middleware short-circuit. Reads
// from the same frozen ALLOWLIST Set parsed at module load; there is no
// second source of truth for who counts as an operator.
//
// Consumers:
//   - canAssignRole's third arg (constants/roles.js) — the role-rank
//     check bypasses to true when the actor is an operator.
//   - GET /api/auth/me — surfaces an isOperator boolean so the FE can
//     filter the role-picker dropdown. Display-only on the FE; the BE
//     re-derives operator status from req.user.id on every assignment
//     request. The /me field is NEVER read back from the client.
//
// Inputs that are not valid integers (null, undefined, non-numeric
// strings) coerce to NaN, and ALLOWLIST.has(NaN) is false — so the
// predicate is closed by default. Matches the middleware's Number()
// coercion to handle JWT payloads where id may be string-shaped.
function isOperator(userId) {
  return ALLOWLIST.has(Number(userId));
}

module.exports = { platformAdminOnly, isOperator };
