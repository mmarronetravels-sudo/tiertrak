// Unit tests for middleware/verifyAuthToken.js — pure helper, no DB.
// Run: node --test  (or: npm test)
//
// These tests lock in the algorithm-confusion pin: only HS256 tokens
// signed with the shared secret may verify. alg:none and a forged
// RS256-header token must both be rejected.
const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { verifyAuthToken } = require('../middleware/verifyAuthToken');

const SECRET = 'test-secret-not-a-real-key';

// base64url without the '=' padding, matching the JWT compact form.
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// --- valid HS256 token verifies ------------------------------------------

test('verifyAuthToken accepts a valid HS256 token and returns its payload', () => {
  const token = jwt.sign({ id: 42 }, SECRET, { expiresIn: '8h' });
  const decoded = verifyAuthToken(token, SECRET);
  assert.strictEqual(decoded.id, 42);
});

// --- alg:none is rejected -------------------------------------------------

test('verifyAuthToken rejects an alg:none token', () => {
  // jsonwebtoken issues an unsigned (empty-signature) token when asked for
  // algorithm 'none'. The pinned verify refuses it (it surfaces as
  // "jwt signature is required" since the signature segment is empty) —
  // the invariant under test is that an unsigned token never verifies.
  const noneToken = jwt.sign({ id: 42 }, null, { algorithm: 'none' });
  assert.throws(
    () => verifyAuthToken(noneToken, SECRET),
    jwt.JsonWebTokenError
  );
});

// --- RS256 algorithm-confusion token is rejected --------------------------

test('verifyAuthToken rejects a forged RS256-header token (algorithm confusion)', () => {
  // The classic confusion attack: an attacker crafts a token whose header
  // declares RS256 but signs it with HMAC over the secret string. A verifier
  // with no algorithms pin that is handed the same secret as the "public
  // key" would accept it. Build the token by hand so the test needs no RSA
  // keypair and stays dependency-free.
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({ id: 42 });
  const signingInput = `${header}.${payload}`;
  const forgedSig = require('crypto')
    .createHmac('sha256', SECRET)
    .update(signingInput)
    .digest('base64url');
  const forged = `${signingInput}.${forgedSig}`;

  assert.throws(
    () => verifyAuthToken(forged, SECRET),
    /invalid algorithm/
  );
});
