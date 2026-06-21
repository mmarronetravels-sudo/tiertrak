'use strict';

// Regression test for the screener upload meta-error status mapping.
//
// Bug (fix/screener-unknown-assessment-type-status): the validate + commit
// handlers read `metaError.error.status` / `metaError.error.body`, but
// validateScreenerImportMeta returns { error: { status, body } } — so the
// destructured `metaError` IS { status, body }. The extra `.error` threw a
// TypeError that the handler's own catch turned into a 500, masking the
// intended 400 for an unknown/missing assessment type.
//
// These tests drive the real handlers with a dependency-free req/res
// recorder (same fakes style as test/schemaGate.test.js). The unknown-type
// path returns BEFORE any DB/file work — role check -> normalizeTargetTenantId
// (pure) -> resolveAndBindTargetTenant (DB-free when req.user.tenant_id is set
// and no target_tenant_id is supplied) -> meta validation -> respond. So no
// live DB, JWT, or rate-limit store is needed.

// Must be set before requiring the router: rateLimiters constructs its
// limiters at module load and hard-fails (process.exit) under a prod-like
// NODE_ENV when RATE_LIMIT_REDIS_URL is unset. 'test' selects the in-memory
// MemoryStore fallback with no Redis connection.
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateScreenerUpload, commitScreenerUpload } = require('../routes/screener');

// --- Test doubles ------------------------------------------------------------

// A fake Express response recorder: captures the status code and JSON body
// and supports the res.status(n).json(body) chain the handlers use.
function makeResRecorder() {
  const rec = { statusCode: undefined, body: undefined };
  const res = {
    status(code) { rec.statusCode = code; return res; },
    json(payload) { rec.body = payload; return res; },
  };
  return { res, rec };
}

// A non-parent staff request whose tenant_id is set and which carries NO
// target_tenant_id — so resolveAndBindTargetTenant falls back to
// req.user.tenant_id without touching the DB. assessmentType is supplied by
// the caller to exercise the unset vs garbage cases.
function makeReq(body) {
  return {
    user: { id: 5, role: 'staff', tenant_id: 1 },
    body,
  };
}

// --- The bug: unknown/missing assessment type must be 400, never 500 ---------

const UNKNOWN_TYPE_MESSAGE = 'Unknown or missing assessment type.';

const cases = [
  { name: 'assessmentType unset', body: {} },
  { name: 'assessmentType garbage', body: { assessmentType: 'NOT_A_REAL_SCREENER' } },
];

for (const handler of [
  { label: 'validate (/upload/validate)', fn: validateScreenerUpload },
  { label: 'commit (/upload/commit)', fn: commitScreenerUpload },
]) {
  for (const c of cases) {
    test(`${handler.label}: ${c.name} -> 400 with the unknown-type body (not 500)`, async () => {
      const { res, rec } = makeResRecorder();
      await handler.fn(makeReq(c.body), res);

      assert.equal(rec.statusCode, 400, 'must be a 400 client error, not a 500');
      assert.deepEqual(rec.body, { error: UNKNOWN_TYPE_MESSAGE });
    });
  }
}
