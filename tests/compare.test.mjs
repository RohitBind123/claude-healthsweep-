import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns } from '../scripts/lib/compare.mjs';

const run = (checks) => ({ checks });
const chk = (name, o) => ({ name, kind: 'test', exitCode: 0, passed: 10, failed: 0, failures: [], ...o });

test('identical runs are not a regression', () => {
  const r = compareRuns(run([chk('unit')]), run([chk('unit')]));
  assert.equal(r.regressed, false);
});

test('a pre-existing failure that still fails is not a regression', () => {
  const before = run([chk('unit', { exitCode: 1, passed: 9, failed: 1, failures: ['a'] })]);
  const after = run([chk('unit', { exitCode: 1, passed: 9, failed: 1, failures: ['a'] })]);
  const r = compareRuns(before, after);
  assert.equal(r.regressed, false);
  assert.deepEqual(r.checks[0].stillFailing, ['a']);
});

test('a new failing test is a regression even if counts look equal', () => {
  const before = run([chk('unit', { exitCode: 1, passed: 9, failed: 1, failures: ['a'] })]);
  const after = run([chk('unit', { exitCode: 1, passed: 9, failed: 1, failures: ['b'] })]);
  const r = compareRuns(before, after);
  assert.equal(r.regressed, true);
  assert.deepEqual(r.checks[0].newFailures, ['b']);
  assert.deepEqual(r.checks[0].fixed, ['a']);
});

test('a dropped pass count is a regression', () => {
  const r = compareRuns(run([chk('unit', { passed: 10 })]), run([chk('unit', { passed: 8 })]));
  assert.equal(r.regressed, true);
});

test('a build that went from exit 0 to non-zero is a regression', () => {
  const b = { name: 'build', kind: 'build', exitCode: 0, passed: null, failed: null, failures: [] };
  const r = compareRuns(run([b]), run([{ ...b, exitCode: 2 }]));
  assert.equal(r.regressed, true);
});

test('a timed-out check after a clean baseline is a regression', () => {
  const r = compareRuns(run([chk('unit')]), run([chk('unit', { timedOut: true, exitCode: null })]));
  assert.equal(r.regressed, true);
});

test('a check missing from the after run is reported, not silently passed', () => {
  const r = compareRuns(run([chk('unit'), chk('lint', { kind: 'lint' })]), run([chk('unit')]));
  assert.deepEqual(r.missing, ['lint']);
});

test('more passing tests is an improvement, not a regression', () => {
  const before = run([chk('unit', { exitCode: 1, passed: 9, failed: 1, failures: ['a'] })]);
  const after = run([chk('unit', { passed: 10 })]);
  const r = compareRuns(before, after);
  assert.equal(r.regressed, false);
  assert.deepEqual(r.checks[0].fixed, ['a']);
});

test('bench check: slower than tolerance is a regression', () => {
  const b = { name: 'bench', kind: 'bench', exitCode: 0, metricMs: 100, failures: [] };
  const slow = compareRuns(run([b]), run([{ ...b, metricMs: 120 }]), { benchTolerancePct: 10 });
  assert.equal(slow.regressed, true);
  const ok = compareRuns(run([b]), run([{ ...b, metricMs: 105 }]), { benchTolerancePct: 10 });
  assert.equal(ok.regressed, false);
  assert.equal(ok.checks[0].deltaPct, 5);
});
