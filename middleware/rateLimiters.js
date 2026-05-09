// Rate-limit store factory.
//
// Reads RATE_LIMIT_REDIS_URL and either returns a fresh per-prefix
// rate-limit-redis-backed store (URL set, prefix supplied) or undefined
// (signaling express-rate-limit to fall back to its built-in in-memory
// MemoryStore). Hard-fails the process at boot in production when the
// URL is unset — in-memory state is bypass-prone on multi-instance
// deployments and we'd rather refuse to start than silently degrade.
//
// Two call shapes:
//   - No-arg eager-validation hook: server.js:14 calls this at boot
//     specifically to surface the RATE_LIMIT_REDIS_URL FATAL before any
//     route handler loads. Returns undefined; side effect is the env
//     check plus a single cached ioredis client.
//   - Per-prefix factory: each limiter calls with its own prefix and
//     receives a fresh RedisStore wrapping the shared cached client.
//     express-rate-limit ^7 rejects passing the same Store instance to
//     more than one rateLimit() call — sharing throws on first request.
//
// The ioredis client is cached and reused across all factory calls, so
// the connection count to Redis stays at 1 regardless of limiter count.
// Env validation + client init are idempotent: repeat calls skip past
// the init block via the 'initialized' guard.

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const RedisStore = require('rate-limit-redis').default;

// isProdLike — treats any NODE_ENV that isn't literally 'development'
// or 'test' as prod-like. Catches the typo class ('prod', 'PRODUCTION',
// 'staging', empty, unset) by routing them to the prod-strict branch
// (hard-fail on missing env var) instead of silently falling back to
// dev defaults. Address security-reviewer WARN W2 on PR #71.
function isProdLike() {
  const env = process.env.NODE_ENV;
  return env !== 'development' && env !== 'test';
}

let cachedClient;
let initialized = false;

function initializeRateLimitStore(prefix) {
  if (!initialized) {
    initialized = true;

    const url = process.env.RATE_LIMIT_REDIS_URL;
    const isProd = isProdLike();

    if (!url) {
      if (isProd) {
        console.error(
          'FATAL: RATE_LIMIT_REDIS_URL must be set in production. ' +
          'In-memory rate-limit state is bypass-prone on multi-instance ' +
          'deployments. Aborting startup.'
        );
        process.exit(1);
      }
      console.warn(
        '[rate-limit] RATE_LIMIT_REDIS_URL not set; falling back to ' +
        'in-memory MemoryStore. dev-only — do not use in prod. ' +
        'Multi-instance deployments will get bypass-prone limiting.'
      );
      // cachedClient stays undefined; dev fallback path below.
    } else {
      // enableOfflineQueue: true (ioredis default, set explicitly for
      // visibility) lets ioredis buffer commands during the brief
      // initial-connection window — typically <100ms post-boot for
      // DNS + TCP + AUTH. Without queueing, rate-limit-redis's
      // RedisStore constructor — which fires SCRIPT LOAD synchronously
      // at module-load time to preload the increment script — gets a
      // rejection that becomes an unhandled promise rejection and
      // crashes the process after app.listen prints.
      // maxRetriesPerRequest: 1 bounds per-command retries against
      // a connected-but-failing Redis; offline-queue accumulation
      // is bounded by ioredis's flushQueue-on-disconnect.
      // On runtime Redis failure, express-rate-limit's default
      // passOnStoreError: false propagates store errors via
      // next(error); requests surface as 5xx through Express's
      // error middleware. This is fail-closed posture, not the
      // fail-open described in PR #71's original comment.
      // Revisiting whether to flip passOnStoreError: true on each
      // limiter for fail-open during outages is a separate product
      // decision (Followup X).
      cachedClient = new Redis(url, {
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1
      });
      cachedClient.on('error', (err) => {
        // Message-only — never log the full error object (may carry
        // connection-string fragments). Runtime Redis-failure
        // semantics are detailed in the comment block above (lines
        // 74-84): express-rate-limit's default passOnStoreError:
        // false propagates store errors via next(error), surfacing
        // as 5xx — fail-closed posture.
        console.error('[rate-limit] redis error:', err.message);
      });
    }
  }

  // No prefix: eager-validation hook (server.js:14). Side effect was
  // the env check above; no store needed.
  if (!prefix) return undefined;

  // Dev fallback (no Redis URL → no client): return undefined so each
  // limiter falls back to its own internal MemoryStore. v7 doesn't
  // trip the store-uniqueness check on undefined.
  if (!cachedClient) return undefined;

  // Per-prefix factory: fresh RedisStore wrapping the shared client.
  return new RedisStore({
    sendCommand: (...args) => cachedClient.call(...args),
    prefix
  });
}

// ===================================================================
// Logging helpers
// ===================================================================

// Server-side pepper for IP-hashing in log lines. Required in prod;
// dev falls back to a constant string with a startup warning.
// Validated once at first call to hashIp().
const DEV_PEPPER = 'dev-pepper-not-for-prod';
let cachedPepper;
let pepperValidated = false;

function getLogIpPepper() {
  if (pepperValidated) return cachedPepper;
  pepperValidated = true;

  const pepper = process.env.LOG_IP_PEPPER;
  const isProd = isProdLike();

  if (!pepper) {
    if (isProd) {
      console.error(
        'FATAL: LOG_IP_PEPPER must be set in production. ' +
        'Aborting startup.'
      );
      process.exit(1);
    }
    console.warn(
      '[log-ip-pepper] LOG_IP_PEPPER not set; using constant fallback. ' +
      'dev-only — do not use in prod.'
    );
    cachedPepper = DEV_PEPPER;
    return cachedPepper;
  }

  cachedPepper = pepper;
  return cachedPepper;
}

// hashIp — SHA-256 of (ip + server-side pepper), truncated to 8 hex
// chars. Stable, non-reversible IP identifier for log lines without
// ever logging the raw IP. Pepper rotation breaks correlation across
// rotations — that's fine.
function hashIp(ip) {
  if (!ip) return 'unknown';
  return crypto
    .createHash('sha256')
    .update(ip + getLogIpPepper())
    .digest('hex')
    .slice(0, 8);
}

// safePathForLog — best-effort path-template extraction. Returns
// req.route.path if Express has resolved the route, else req.baseUrl,
// else a placeholder. Never returns the resolved URL — that can carry
// student IDs in path params (Followup #70 family).
function safePathForLog(req) {
  return req.route?.path || req.baseUrl || '<unmatched>';
}

// makeRateLimitHandler — shared 429 handler factory. Logs limiter name
// + method + safe path + hashed IP + user id, all PII-stripped. Returns
// a constant 429 body; never echoes method, full URL, body, or headers.
function makeRateLimitHandler(limiterName) {
  return (req, res /*, next, options */) => {
    console.warn(
      '[rate-limit] limit-exceeded',
      'limiter=' + limiterName,
      'method=' + req.method,
      'path=' + safePathForLog(req),
      'hashedIp=' + hashIp(req.ip),
      'userId=' + (req.user?.id ?? null)
    );
    res.status(429).json({ error: 'Too many requests' });
  };
}

// ===================================================================
// Limiter instances
// ===================================================================
//
// Each limiter owns its own RedisStore wrapper with a unique prefix
// ('rl:auth-ip:', 'rl:auth-login:', etc) — express-rate-limit ^7
// rejects passing the same Store instance to more than one rateLimit()
// call. The ioredis client is shared across limiters by the factory,
// so the connection count to Redis stays at 1. In dev with
// RATE_LIMIT_REDIS_URL unset, the factory returns undefined for every
// limiter and each gets its own internal MemoryStore (per-instance by
// construction in v7). Custom handler logs PII-stripped detail and
// returns a constant 429 body. standardHeaders 'draft-7' enables RFC
// RateLimit-* response headers; legacyHeaders disabled to avoid
// X-RateLimit-* clutter.
//
// Defined here but NOT mounted yet — the server.js wiring commit
// imports and mounts them. Per-IP limiters omit keyGenerator so that
// express-rate-limit's IPv6-aware default applies; compound and
// per-user limiters define keyGenerator explicitly.
//
// req.ip relies on app.set('trust proxy', N) being configured in
// server.js. The wiring commit handles that — until then req.ip
// returns the immediate peer (proxy IP), but limiters aren't mounted
// yet so it doesn't matter.

// authIpLimiter — /api/auth/* per-IP, 50 / 15min.
// Anti-credential-stuffing across many emails from one IP.
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  store: initializeRateLimitStore('rl:auth-ip:'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: makeRateLimitHandler('auth-ip')
});

// authLoginCompoundLimiter — /api/auth/login per-(IP, email), 10 / 15min.
// Anti-targeted-brute-force on a single account from a single IP.
// Mounted at the route level (not the prefix) because it needs
// req.body.email, which express.json() parses upstream.
const authLoginCompoundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  store: initializeRateLimitStore('rl:auth-login:'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').toLowerCase().slice(0, 100);
    return req.ip + ':' + email;
  },
  handler: makeRateLimitHandler('auth-login')
});

// contactLimiter — /api/contact per-IP, 5 / 15min.
// Public form; lowest legitimate volume; tightest IP-keyed limit.
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: initializeRateLimitStore('rl:contact:'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: makeRateLimitHandler('contact')
});

// mutationUserLimiter — per-req.user.id, 300 / 1min.
// Invoked from inside requireAuth on non-GET requests (req.user is
// populated by then). Per-user keying avoids school-wide lockout on
// shared NAT.
const mutationUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  store: initializeRateLimitStore('rl:mutation-user:'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // '' fallback fires only on an upstream bug — req.user is populated by requireAuth.
  keyGenerator: (req) => String(req.user?.id ?? ''),
  handler: makeRateLimitHandler('mutation-user')
});

// csvImportLimiter — /api/csv/* per-req.user.id, 5 / 1min.
// Heavy operation; tight per-user limit. Mounted at the prefix; for
// the rare pre-auth probe req.user is undefined and the key falls
// back to req.ip to keep the limiter from crashing on undefined keys.
const csvImportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  store: initializeRateLimitStore('rl:csv-import:'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  handler: makeRateLimitHandler('csv-import')
});

module.exports = {
  initializeRateLimitStore,
  getLogIpPepper,
  isProdLike,
  hashIp,
  safePathForLog,
  authIpLimiter,
  authLoginCompoundLimiter,
  contactLimiter,
  mutationUserLimiter,
  csvImportLimiter
};
