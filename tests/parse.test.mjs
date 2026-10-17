import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestOutput } from '../scripts/lib/parse.mjs';

test('jest summary with failures', () => {
  const out = [
    '  ● quotes › calculatePremium › locks the row',
    '',
    'Tests:       2 failed, 1 skipped, 40 passed, 43 total',
  ].join('\n');
  const r = parseTestOutput(out);
  assert.equal(r.framework, 'jest');
  assert.equal(r.passed, 40);
  assert.equal(r.failed, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.total, 43);
  assert.deepEqual(r.failures, ['quotes › calculatePremium › locks the row']);
});

test('jest repeats failure headers in its summary; names are listed once', () => {
  const out = '  ● a › b\n\n  ● a › b\n\nTests:       1 failed, 1 total\n';
  assert.deepEqual(parseTestOutput(out).failures, ['a › b']);
});

test('jest all passing', () => {
  const r = parseTestOutput('Tests:       12 passed, 12 total\n');
  assert.equal(r.passed, 12);
  assert.equal(r.failed, 0);
});

test('vitest summary', () => {
  const out = ' FAIL  src/a.test.js > sums > adds\n      Tests  1 failed | 99 passed (100)\n';
  const r = parseTestOutput(out);
  assert.equal(r.framework, 'vitest');
  assert.equal(r.passed, 99);
  assert.equal(r.failed, 1);
  assert.equal(r.total, 100);
  assert.deepEqual(r.failures, ['src/a.test.js > sums > adds']);
});

test('pytest summary', () => {
  const out = 'FAILED tests/test_x.py::test_y - AssertionError\n==== 1 failed, 20 passed, 2 skipped in 1.2s ====\n';
  const r = parseTestOutput(out);
  assert.equal(r.framework, 'pytest');
  assert.equal(r.passed, 20);
  assert.equal(r.failed, 1);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.failures, ['tests/test_x.py::test_y']);
});

test('go test summary', () => {
  const out = '--- FAIL: TestPay (0.01s)\nok  \tpkg/a\t0.1s\nFAIL\tpkg/b\t0.2s\n';
  const r = parseTestOutput(out);
  assert.equal(r.framework, 'go');
  assert.equal(r.failed, 1);
  assert.deepEqual(r.failures, ['TestPay']);
});

test('node:test summary', () => {
  const out = '# tests 10\n# pass 9\n# fail 1\nnot ok 3 - adds numbers\n';
  const r = parseTestOutput(out);
  assert.equal(r.framework, 'node');
  assert.equal(r.passed, 9);
  assert.equal(r.failed, 1);
  assert.deepEqual(r.failures, ['adds numbers']);
});

test('unknown output keeps counts null, never zero', () => {
  const r = parseTestOutput('build ok\n');
  assert.equal(r.framework, null);
  assert.equal(r.passed, null);
  assert.equal(r.failed, null);
});

test('ANSI colour codes are ignored', () => {
  const r = parseTestOutput('\u001b[1mTests:\u001b[22m       \u001b[32m5 passed\u001b[39m, 5 total');
  assert.equal(r.passed, 5);
});
