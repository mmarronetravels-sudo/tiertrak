// CSRF protection — double-submit cookie pattern via csrf-csrf.
//
// The auth_token JWT cookie is httpOnly and SameSite=none in prod
// (cross-origin frontend ↔ backend), so SameSite alone doesn't prevent
// CSRF on state-changing requests. We add a second, NON-httpOnly
// cookie holding a signed CSRF token. The frontend reads it from
// document.cookie and echoes the value in the X-CSRF-Token header on
// every state-changing fetch. csrf-csrf compares the cookie value to
// the header value and rejects on mismatch. An attacker's site can
// trigger the browser to send the auth_token cookie cross-origin, but
// browser SOP prevents reading the victim's csrf_token cookie, so the
// header can't be replicated and the request fails.
//
// This module exposes:
//   - csrfProtection({ mode }): Express middleware factory. mode is
//     'monitor' (log mismatch, allow request through — used in PR 1)
//     or 'enforce' (log mismatch, return 403 — used in PR 3).
//   - setCsrfCookie(req, res): issue the cookie. Called from
//     routes/auth.js on POST /login, POST /google, GET /me.
//   - clearCsrfCookie(res): clear the cookie. Called from
//     POST /logout alongside the auth_token clear.
//
// Skip-list: routes that issue the token (login, google) cannot be
// CSRF-checked because no token exists yet at that moment. Routes
// that consume URL/body tokens for an unauth-to-auth transition
// (forgot-password, verify-token, set-password) likewise have no
// session to align a CSRF cookie with. /api/contact is a public
// anonymous form — protected by a tight rate-limiter instead.

const { doubleCsrf } = require('csrf-csrf');
const jwt = require('jsonwebtoken');
const { hashIp, hashUserId, safePathForLog, isProdLike } = require('./rateLimiters');

// CSRF token signing secret. Required in prod; dev falls back to a
// constant string with a startup warning. Validated once at first
// call to getCsrfSecret() — the server.js wiring commit will call
// this at boot for fail-fast behavior.
const DEV_CSRF_SECRET = 'dev-csrf-secret-not-for-prod';
let cachedCsrfSecret;
let csrfSecretValidated = false;

function getCsrfSecret() {
  if (csrfSecretValidated) return cachedCsrfSecret;
  csrfSecretValidated = true;

  const secret = process.env.CSRF_SECRET;
  const isProd = isProdLike();

  if (!secret) {
    if (isProd) {
      console.error(
        'FATAL: CSRF_SECRET must be set in production. ' +
        'Aborting startup.'
      );
      process.exit(1);
    }
    console.warn(
      '[csrf-secret] CSRF_SECRET not set; using constant fallback. ' +
      'dev-only — do not use in prod.'
    );
    cachedCsrfSecret = DEV_CSRF_SECRET;
    return cachedCsrfSecret;
  }

  cachedCsrfSecret = secret;
  return cachedCsrfSecret;
}

// Cookie flags match auth_token's flags from routes/auth.js so the
// two cookies travel together. httpOnly is FALSE here (intentionally)
// — the FE must read the value to echo it in X-CSRF-Token. maxAge
// matches auth_token's 8h.
function getCookieOptions() {
  const isProd = isProdLike();
  return {
    httpOnly: false,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 8 * 60 * 60 * 1000
  };
}

// csrf-csrf configuration. doubleCsrf returns the protection middleware
// and a token generator. We wrap the protection middleware in our own
// monitor/enforce-mode shell below.
//
// API names match csrf-csrf v3.x (package.json floor ^3.0.0 →
// resolves to 3.2.2). v4 renamed `generateToken` → `generateCsrfToken`
// and `getTokenFromRequest` → `getCsrfTokenFromRequest`. If we upgrade
// to v4, both names change here.
//
// IMPORTANT: getCookieOptions() reads process.env.NODE_ENV at module
// load (via doubleCsrf below) — must be required AFTER dotenv.config().
const {
  doubleCsrfProtection,
  generateToken
} = doubleCsrf({
  getSecret: getCsrfSecret,
  cookieName: 'csrf_token',
  cookieOptions: getCookieOptions(),
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.headers['x-csrf-token']
});

// Skip-list for paths that should bypass CSRF entirely. Matched
// against req.path AFTER the /api mount prefix is stripped — i.e.
// /api/auth/login arrives here as /auth/login. Prefix matching covers
// /auth/verify-token/:token without listing every token value.
const SKIP_PATH_PREFIXES = [
  '/auth/login',
  '/auth/google',
  '/auth/forgot-password',
  '/auth/verify-token',
  '/auth/set-password',
  '/auth/register',
  '/auth/create-parent',
  '/contact'
];

function shouldSkip(req) {
  const p = req.path;
  return SKIP_PATH_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix + '/')
  );
}

// peekUserIdFromCookie — decoded-but-not-verified peek of the
// auth_token cookie. Used ONLY for diagnostic log enrichment on
// CSRF-mismatch events, which are by definition pre-auth: the
// mismatch fires before requireAuth runs, so req.user is not yet
// populated. The userId extracted here is diagnostic signal only —
// never used for authorization. It is pepper-hashed downstream so a
// forged or stale token's id never appears in cleartext.
//
// jwt.decode (not jwt.verify) is intentional. Signature verification
// does not apply on a pre-auth log path, and verifying would throw
// on expired/tampered tokens — exactly the cases we still want to
// correlate.
//
// Destructure-and-discard: ONLY the `id` field is bound to a local
// variable. If the JWT payload ever carries additional fields, the
// destructure ensures they never reach the log surface even transiently.
//
// All decode failure modes (missing cookie, malformed token, decode
// throw) are silently caught and return null — the log line then
// shows hashedUserId=unknown.
function peekUserIdFromCookie(req) {
  try {
    const { id } = jwt.decode(req.cookies?.auth_token) || {};
    return id ?? null;
  } catch {
    return null;
  }
}

// Shared mismatch logger. PII-stripped: redacted path (not URL),
// hashed IP (not raw), pepper-hashed cookie-peeked userId (not raw,
// not email). Never logs the token values themselves.
function logCsrfMismatch(req, mode) {
  console.warn(
    '[csrf:' + mode + '] mismatch',
    'method=' + req.method,
    'path=' + safePathForLog(req),
    'hashedIp=' + hashIp(req.ip),
    'hashedUserId=' + hashUserId(peekUserIdFromCookie(req))
  );
}

// csrfProtection — middleware factory. mode is 'monitor' (PR 1) or
// 'enforce' (PR 3 flip). The PR 2 → PR 3 flip is a one-line diff in
// server.js: 'monitor' → 'enforce'.
function csrfProtection({ mode }) {
  if (mode !== 'monitor' && mode !== 'enforce') {
    throw new Error(
      "csrfProtection: mode must be 'monitor' or 'enforce', got: " + mode
    );
  }
  return (req, res, next) => {
    if (shouldSkip(req)) return next();

    doubleCsrfProtection(req, res, (err) => {
      if (err) {
        logCsrfMismatch(req, mode);
        if (mode === 'enforce') {
          return res.status(403).json({ error: 'Invalid CSRF token' });
        }
        // monitor mode: log only, proceed to handler
      }
      next();
    });
  };
}

// setCsrfCookie — called from routes/auth.js after auth_token is set
// (POST /login, POST /google) and at GET /me (so existing live
// sessions pick up a token without re-login on rollout).
function setCsrfCookie(req, res) {
  // generateToken sets the cookie as a side effect AND returns the
  // token string. We don't need the return value — the FE reads the
  // cookie directly.
  generateToken(req, res);
}

// clearCsrfCookie — called from POST /logout alongside the
// auth_token clear. Cookie options must match the set-cookie options
// (minus maxAge) or browsers may silently refuse to clear, mirroring
// the auth.js getAuthClearCookieOptions() pattern.
function clearCsrfCookie(res) {
  const isProd = isProdLike();
  res.clearCookie('csrf_token', {
    httpOnly: false,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax'
  });
}

module.exports = {
  csrfProtection,
  setCsrfCookie,
  clearCsrfCookie,
  // exported for explicit boot-time validation from server.js (the
  // wiring commit will call this alongside initializeRateLimitStore
  // and getLogIpPepper to fail fast on missing prod config).
  getCsrfSecret
};
