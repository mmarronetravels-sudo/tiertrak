// resolveAccessibleTenantIds — central helper enforcing the §5
// dual-path access contract documented in CLAUDE.md.
//
// Scope resolution branches on `users.district_id`:
//   - Legacy single-tenant users (district_id IS NULL):
//       accessible set is [users.tenant_id] — the single school the
//       user has belonged to since before the district-structure
//       project.
//   - District users (district_id IS NOT NULL):
//       accessible set is the membership of user_school_access for
//       that user. The composite-FK guarantees from migration-028
//       (UNIQUE(id, district_id) on users + tenants, composite FK on
//       user_school_access) make cross-district rows structurally
//       impossible at the schema layer; this helper does not need to
//       re-check district_id at query time.
//
// Returns Promise<number[]>. An empty array means "no accessible
// schools" — legitimate for district users with no grants yet (will
// happen between the first M028-shape user being created and the
// first /api/districts/:id/users/:userId/access POST from PR B2).
// Callers MUST treat an empty array as "scope is empty," NOT "scope
// is universal."
//
// Throws on DB error. Callers should handle by returning 500 to the
// requester (do not fail-open).
//
// Hazard D (S67 prep notes): the JWT must NOT carry the accessible
// list. Always resolve from the DB on every authenticated request.
// The DB row is the source of truth; the cookie is the identity
// envelope.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * @param {Object} user - User object from requireAuth middleware.
 *   Required shape:
 *   - user.id (number): non-null user ID. Sourced from JWT
 *     decoded.id + users-table lookup.
 *   - user.tenant_id (number | null): the user's home tenant.
 *     Used only on the legacy path (district_id IS NULL/
 *     undefined); ignored on the district path.
 *   - user.district_id (number | null | undefined): null/
 *     undefined for legacy single-tenant users; positive integer
 *     for district users (post-M028 onboarding).
 * @returns {Promise<number[]>} Array of school tenant IDs the
 *   user can access. Empty array means "no accessible schools"
 *   — legitimate state, never interpret as universal access. See
 *   empty-array semantics paragraph in the header comment.
 * @throws {Error} On DB connectivity or query failure. Callers
 *   should return 500; do NOT fail-open by treating an exception
 *   as universal access.
 */
async function resolveAccessibleTenantIds(user) {
  if (user.district_id === null || user.district_id === undefined) {
    return user.tenant_id == null ? [] : [user.tenant_id];
  }
  const { rows } = await pool.query(
    'SELECT school_tenant_id FROM user_school_access WHERE user_id = $1',
    [user.id]
  );
  return rows.map((r) => r.school_tenant_id);
}

module.exports = { resolveAccessibleTenantIds };
