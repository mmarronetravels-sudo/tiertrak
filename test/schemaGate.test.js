'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPECTED_SCHEMA,
  assertExpectedSchema,
  isSchemaDegraded,
  buildHealthBody,
  __resetSchemaGateForTest,
} = require('../middleware/schemaGate');

// --- Test doubles ------------------------------------------------------------

// A fake pg pool that answers the two query shapes assertExpectedSchema issues:
//   - to_regclass($1)  -> table presence            (param: 'public.<table>')
//   - information_schema.columns WHERE ... $1,$2     (params: [table, column])
// Tables in `missingTables` report absent; columns in `missingColumns`
// (as '<table>.<column>') report absent. Everything else reports present.
function makeFakePool({ missingTables = [], missingColumns = [] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('information_schema.columns')) {
        const [table, column] = params;
        const key = `${table}.${column}`;
        return { rows: missingColumns.includes(key) ? [] : [{ exists: 1 }] };
      }
      // to_regclass branch
      const qualified = params[0];                 // 'public.<table>'
      const table = qualified.replace(/^public\./, '');
      return { rows: [{ reg: missingTables.includes(table) ? null : qualified }] };
    },
  };
}

// A fake pool whose every query rejects — simulates a transient DB failure.
function makeThrowingPool(message = 'connection terminated unexpectedly') {
  return {
    async query() { throw new Error(message); },
  };
}

// Captures console-style log lines so we can assert on the banner.
function makeCapturingLogger() {
  const errors = [];
  const logs = [];
  return {
    logger: {
      error: (...args) => errors.push(args.join(' ')),
      log: (...args) => logs.push(args.join(' ')),
    },
    errors,
    logs,
  };
}

// --- Missing-relation path ---------------------------------------------------

test('assertExpectedSchema flips schemaDegraded and logs the MIGRATION GAP banner when a relation is missing', async () => {
  __resetSchemaGateForTest();
  const pool = makeFakePool({ missingTables: ['screener_reset_audit'] });
  const { logger, errors } = makeCapturingLogger();

  await assertExpectedSchema(pool, logger);

  assert.equal(isSchemaDegraded(), true, 'flag must flip to degraded');
  const banner = errors.find((line) => line.startsWith('MIGRATION GAP: missing ['));
  assert.ok(banner, 'a single-line MIGRATION GAP banner must be logged');
  assert.match(banner, /M049:screener_reset_audit/, 'banner names the missing relation for the server logs');
});

test('assertExpectedSchema detects a missing COLUMN dependency (e.g. M035 students.external_id)', async () => {
  __resetSchemaGateForTest();
  const pool = makeFakePool({ missingColumns: ['students.external_id'] });
  const { logger, errors } = makeCapturingLogger();

  await assertExpectedSchema(pool, logger);

  assert.equal(isSchemaDegraded(), true);
  const banner = errors.find((line) => line.startsWith('MIGRATION GAP'));
  assert.match(banner, /M035:students\.external_id/);
});

// --- Info-leak lock: /health body must never enumerate schema names ----------

test('/health body reports degraded but contains NO table/relation or column names', async () => {
  __resetSchemaGateForTest();
  const pool = makeFakePool({ missingTables: ['screener_reset_audit', 'mtss_coordinators'] });
  const { logger } = makeCapturingLogger();
  await assertExpectedSchema(pool, logger);

  const body = buildHealthBody(isSchemaDegraded(), '2026-06-21T00:00:00Z');
  assert.equal(body.status, 'degraded', 'public status signals degraded');

  // The serialized body must not leak ANY name from the manifest.
  const serialized = JSON.stringify(body);
  for (const item of EXPECTED_SCHEMA) {
    assert.ok(!serialized.includes(item.table), `health body must not contain table name "${item.table}"`);
    if (item.column) {
      assert.ok(!serialized.includes(item.column), `health body must not contain column name "${item.column}"`);
    }
  }
  // It also must not contain the banner keyword or a "missing" list.
  assert.ok(!serialized.toLowerCase().includes('missing'), 'health body must not enumerate a missing list');
});

// --- Happy path --------------------------------------------------------------

test('happy path: all relations/columns present -> /health stays healthy and flag is false', async () => {
  __resetSchemaGateForTest();
  const pool = makeFakePool();                 // nothing missing
  const { logger, errors, logs } = makeCapturingLogger();

  await assertExpectedSchema(pool, logger);

  assert.equal(isSchemaDegraded(), false, 'flag stays healthy');
  assert.equal(errors.length, 0, 'no error banner on the happy path');
  assert.ok(logs.some((line) => line.includes('all expected migration relations present')));

  const body = buildHealthBody(isSchemaDegraded(), '2026-06-21T00:00:00Z');
  assert.equal(body.status, 'healthy');
});

// --- Transient probe failure: inconclusive, must NOT flip degraded -----------

test('transient probe failure logs but does NOT flip schemaDegraded (inconclusive != gap)', async () => {
  __resetSchemaGateForTest();
  const pool = makeThrowingPool('connection terminated unexpectedly');
  const { logger, errors } = makeCapturingLogger();

  await assertExpectedSchema(pool, logger);

  assert.equal(isSchemaDegraded(), false, 'a probe that could not run must not be treated as a detected gap');
  assert.ok(
    errors.some((line) => line.startsWith('Schema assertion could not run:')),
    'the inconclusive probe is logged'
  );
  assert.ok(
    !errors.some((line) => line.startsWith('MIGRATION GAP')),
    'no MIGRATION GAP banner on an inconclusive probe'
  );
});
