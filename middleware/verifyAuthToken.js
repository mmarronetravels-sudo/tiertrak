const jwt = require('jsonwebtoken');

// verifyAuthToken — single seam for auth_token signature verification.
//
// The sole behavioral addition over a bare jwt.verify(token, secret) is the
// algorithm allowlist: tokens are issued HS256 (jwt.sign default, symmetric
// JWT_SECRET — see routes/auth.js login/google-auth) and only HS256 is
// accepted on the way back in. Pinning the algorithm closes the
// algorithm-confusion gap (alg:none, or an RS256 token whose "public key"
// is the HS256 secret) before the decoded id is ever used for a DB lookup.
//
// Callers keep their own try/catch and 401 mapping — this helper does not
// swallow or translate the throw; it only narrows what verify will accept.
function verifyAuthToken(token, secret) {
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

module.exports = { verifyAuthToken };
