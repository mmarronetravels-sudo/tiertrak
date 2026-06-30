// districtAuthzCore — the DB-free authorization prefix shared by the
// district_admin route surfaces (routes/districtSchools.js, the
// resolveDistrictSchool helper in routes/districtAcademicCalendar.js, and the
// adjacent inline gate in routes/districtAccess.js). Extracted so the §5 role +
// own-district check lives in exactly ONE place and can be unit-tested with no
// req/res, router, or database — mirroring how schoolAcademicCalendarCore /
// schoolOverdueLogOptoutsCore extracted their gates.
//
// authorizeDistrictAdmin(user, rawId) reproduces the previously-inlined gate
// byte-for-byte:
//   - validateIntParam(rawId) === null   -> { error: { status: 400,
//                                            message: 'Invalid district id' } }
//   - user.role !== 'district_admin'     -> { error: { status: 403,
//                                            message: 'Forbidden' } }
//   - user.district_id !== districtId    -> { error: { status: 403,
//                                            message: 'Forbidden' } }
//       Legacy single-tenant users carry district_id = null, so the strict !==
//       fails closed: null !== <number> -> 403. district_id is an int4 column,
//       so pg returns it as a JS number — the comparison is number-vs-number.
//   - otherwise                          -> { districtId }
//
// validateIntParam is imported from the canonical source (schoolAcademicCalendarCore
// re-exports schoolOverdueLogOptoutsCore's), the same validator the district
// calendar surfaces already use, so the 400 behavior is identical to the prior
// inline copies (parseInt, reject n<=0 or n>INT4_MAX).
//
// §5: this is the cross-district fence prefix. It deliberately does NOT perform
// the school-membership DB check — resolveDistrictSchool keeps that query after
// this prefix. §4B: integers + a role string only, never PII.

const { validateIntParam } = require('./schoolAcademicCalendarCore');

function authorizeDistrictAdmin(user, rawId) {
  const districtId = validateIntParam(rawId);
  if (districtId === null) {
    return { error: { status: 400, message: 'Invalid district id' } };
  }
  if (user.role !== 'district_admin' || user.district_id !== districtId) {
    return { error: { status: 403, message: 'Forbidden' } };
  }
  return { districtId };
}

module.exports = { authorizeDistrictAdmin };
