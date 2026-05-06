// Rate-limit store initialization.
//
// Reads RATE_LIMIT_REDIS_URL and returns either a rate-limit-redis-backed
// store (URL set) or undefined (signaling express-rate-limit to fall back
// to its built-in in-memory MemoryStore). Hard-fails the process at boot
// in production when the URL is unset — in-memory state is bypass-prone
// on multi-instance deployments and we'd rather refuse to start than
// silently degrade.
//
// Intended call site: invoked once from server.js at boot, before any
// rate-limit middleware is mounted. Idempotent — repeat calls return the
// cached store.

const Redis = require('ioredis');
const RedisStore = require('rate-limit-redis').default;

let cachedStore;
let cachedClient;
let initialized = false;

function initializeRateLimitStore() {
  if (initialized) return cachedStore;
  initialized = true;

  const url = process.env.RATE_LIMIT_REDIS_URL;
  const isProd = process.env.NODE_ENV === 'production';

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
    cachedStore = undefined;
    return undefined;
  }

  cachedClient = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1
  });
  cachedClient.on('error', (err) => {
    // Message-only — never log the full error object (may carry
    // connection-string fragments). On runtime Redis failure,
    // express-rate-limit falls open per its default behavior;
    // legitimate requests proceed rather than being blocked on
    // infra issues.
    console.error('[rate-limit] redis error:', err.message);
  });

  cachedStore = new RedisStore({
    sendCommand: (...args) => cachedClient.call(...args),
    prefix: 'rl:'
  });
  return cachedStore;
}

module.exports = {
  initializeRateLimitStore
};
