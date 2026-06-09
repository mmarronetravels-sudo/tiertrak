// ESM mirror of constants/roles.js (backend, CommonJS).
// FE bundle scope: ROLE_RANK numeric tiers + canAssignRole predicate
// for the delegated-role-assignment feature.
//
// DRIFT WARNING — three-writer hazard.
// The rank map and predicate below MUST stay byte-for-byte aligned with:
//   1. constants/roles.js (BE, authoritative app-layer source)
//   2. users.role's DB CHECK constraint (migrations 041 + 043 — the
//      universe of valid role strings)
// There is no automated CI check yet that diffs the FE list against
// the BE list. If you change one, change all three. A CI drift-check
// follow-up is banked alongside this PR (sibling of the PR-D ESM↔CJS
// drift follow-up and the FE↔BE role-list drift guard follow-up).
//
// DISPLAY-ONLY contract.
// The FE uses canAssignRole to filter the role-picker dropdown in the
// staff modals (AddStaffModal, EditStaffModal) so users see only
// roles they could plausibly assign. The BE remains the trust
// boundary — every POST /api/staff, POST /api/users, PUT
// /api/staff/:id, and PUT /api/users/:id re-derives operator status
// server-side via isOperator(req.user.id) and re-runs canAssignRole
// against the predicate. The FE field user.is_operator (sourced from
// /api/auth/me) is for visibility only; the FE has no authority to
// assert it.
//
// Operator is intentionally absent from the rank map. The third arg
// to canAssignRole carries the operator bypass.
export const ROLE_RANK = {
  district_admin: 80,
  district_tech_admin: 60,
  school_admin: 40,
  teacher: 20,
  counselor: 20,
  interventionist: 20,
  education_assistant: 20,
  parent: 20,
};

// canAssignRole — pure predicate mirroring constants/roles.js. Three
// independent conditions must ALL hold on the BE for an assignment to
// be authorized: (1) target tenant scope via resolveAccessibleTenantIds,
// (2) target is not the actor (self-mutation guard), (3) the role-rank
// check this function answers. The FE only consumes (3) for dropdown
// filtering; (1) and (2) are BE-only.
//
// Operator bypass: when actorIsOperator is true, any role in ROLE_RANK
// is assignable. The operator's apparent role in /me's response (the
// users.role column) is irrelevant.
//
// Non-operator: targetRole must be strictly below actorRole by rank.
// Equal-rank rejected EXCEPT the school_admin peer rule (school_admin
// may assign peer school_admin; within-tenant scope of that exception
// is enforced server-side, not here).
//
// Unknown/missing roles return false. Match the BE shape exactly.
export function canAssignRole(actorRole, targetRole, actorIsOperator) {
  if (actorIsOperator === true) {
    return Object.prototype.hasOwnProperty.call(ROLE_RANK, targetRole);
  }
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole];
  if (actorRank === undefined || targetRank === undefined) {
    return false;
  }
  if (targetRank < actorRank) {
    return true;
  }
  if (actorRole === 'school_admin' && targetRole === 'school_admin') {
    return true;
  }
  return false;
}
