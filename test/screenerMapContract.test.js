// Unit tests for the MAP screener contract helpers — pure functions + a
// dependency-free temp-file check for preamble skipping. No DB, no network.
// Run: node --test  (or: npm test)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parsePercentile,
  deriveBenchmarkFromPercentile,
  findHeaderRowIndex,
  SCREENER_TYPE_CONTRACTS
} = require('../routes/screenerImportCore');

// --- parsePercentile -------------------------------------------------------

test('parsePercentile strips ordinal suffixes', () => {
  assert.strictEqual(parsePercentile('8th'), 8);
  assert.strictEqual(parsePercentile('95th'), 95);
});

test('parsePercentile accepts bare integers', () => {
  assert.strictEqual(parsePercentile('1'), 1);
  assert.strictEqual(parsePercentile('99'), 99);
  assert.strictEqual(parsePercentile(42), 42);
});

test('parsePercentile clamps to 1..99', () => {
  assert.strictEqual(parsePercentile('0'), 1);
  assert.strictEqual(parsePercentile('100'), 99);
  assert.strictEqual(parsePercentile('<1'), 1);
  assert.strictEqual(parsePercentile('>99'), 99);
});

test('parsePercentile takes the first integer run from a decimal', () => {
  assert.strictEqual(parsePercentile('50.5'), 50);
});

test('parsePercentile returns null on blank/invalid', () => {
  assert.strictEqual(parsePercentile('-'), null);
  assert.strictEqual(parsePercentile(''), null);
  assert.strictEqual(parsePercentile('   '), null);
  assert.strictEqual(parsePercentile(null), null);
  assert.strictEqual(parsePercentile(undefined), null);
  assert.strictEqual(parsePercentile('abc'), null);
});

// --- deriveBenchmarkFromPercentile (3-tier) --------------------------------

test('deriveBenchmarkFromPercentile: <21 → Below Benchmark', () => {
  assert.strictEqual(deriveBenchmarkFromPercentile(1), 'Below Benchmark');
  assert.strictEqual(deriveBenchmarkFromPercentile(20), 'Below Benchmark');
});

test('deriveBenchmarkFromPercentile: 21–40 → Near Benchmark', () => {
  assert.strictEqual(deriveBenchmarkFromPercentile(21), 'Near Benchmark');
  assert.strictEqual(deriveBenchmarkFromPercentile(40), 'Near Benchmark');
});

test('deriveBenchmarkFromPercentile: >=41 → At/Above Benchmark', () => {
  assert.strictEqual(deriveBenchmarkFromPercentile(41), 'At/Above Benchmark');
  assert.strictEqual(deriveBenchmarkFromPercentile(99), 'At/Above Benchmark');
});

test('deriveBenchmarkFromPercentile: null in → null out', () => {
  assert.strictEqual(deriveBenchmarkFromPercentile(null), null);
  assert.strictEqual(deriveBenchmarkFromPercentile(undefined), null);
});

// --- MAP contract map() + rowErrors ----------------------------------------

test('MAP contract maps a valid row and reports no errors', () => {
  const MAP = SCREENER_TYPE_CONTRACTS.MAP;
  const mapped = MAP.map({
    'student name': 'Doe, Jane',
    'rit score': '215',
    'achievement percentile': '60'
  });
  assert.strictEqual(mapped.lastName, 'Doe');
  assert.strictEqual(mapped.firstName, 'Jane');
  assert.strictEqual(mapped.scaledScore, 215);
  assert.strictEqual(mapped.percentileRank, 60);
  assert.strictEqual(mapped.benchmarkCategory, 'At/Above Benchmark');
  assert.deepStrictEqual(MAP.rowErrors(mapped), []);
});

test('MAP contract flags a no-score row (not silently dropped)', () => {
  const MAP = SCREENER_TYPE_CONTRACTS.MAP;
  const mapped = MAP.map({ 'student name': 'Roe, Sam', 'rit score': '-' });
  assert.strictEqual(mapped.scaledScore, null);
  assert.ok(MAP.rowErrors(mapped).includes('Missing or invalid RIT score.'));
});

// --- findHeaderRowIndex: preamble skipping ---------------------------------

function writeTmpCsv(name, contents) {
  const p = path.join(os.tmpdir(), `tiertrak-test-${process.pid}-${name}`);
  fs.writeFileSync(p, contents, 'utf8');
  return p;
}

test('findHeaderRowIndex resolves a preambled file to the real header row', () => {
  const MAP = SCREENER_TYPE_CONTRACTS.MAP;
  const csv = [
    'MAP Growth Class Profile',
    'District: NWEA Sample District',
    'Term Tested: Fall 2023-2024',
    '',
    'Student Name,Grade,RIT Score,Achievement Percentile',
    'Doe, Jane,5,215,60'
  ].join('\n');
  const p = writeTmpCsv('preamble.csv', csv);
  try {
    assert.strictEqual(findHeaderRowIndex(p, MAP), 4);
  } finally {
    fs.unlinkSync(p);
  }
});

test('findHeaderRowIndex returns 0 for a line-1 header (STAR-style)', () => {
  const STAR = SCREENER_TYPE_CONTRACTS.STAR;
  const csv = [
    'Student,Benchmark Category Level,Grade',
    'Doe, Jane,At Benchmark,5'
  ].join('\n');
  const p = writeTmpCsv('star.csv', csv);
  try {
    assert.strictEqual(findHeaderRowIndex(p, STAR), 0);
  } finally {
    fs.unlinkSync(p);
  }
});
