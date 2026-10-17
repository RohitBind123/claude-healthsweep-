import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyLensesFor, isConfirmed, recommend, fixVars, buildContext } from '../skills/healthsweep/scripts/lib/shared.mjs';

test('HIGH and CRITICAL get two lenses, others one', () => {
  assert.deepEqual(verifyLensesFor({ severity: 'HIGH', category: 'bug' }), ['correctness', 'reproduce']);
  assert.deepEqual(verifyLensesFor({ severity: 'CRITICAL', category: 'latency' }), ['correctness', 'latency']);
  assert.deepEqual(verifyLensesFor({ severity: 'MEDIUM', category: 'latency' }), ['latency']);
  assert.deepEqual(verifyLensesFor({ severity: 'LOW', category: 'bug' }), ['correctness']);
});

test('a finding is confirmed only if every verifier says real', () => {
  assert.equal(isConfirmed([{ real: true }, { real: true }]), true);
  assert.equal(isConfirmed([{ real: true }, { real: false }]), false);
  assert.equal(isConfirmed([]), false);
});

const fixed = { status: 'fixed', diff: '-a\n+b', benchBefore: '', benchAfter: '' };
test('recommend: unconfirmed is dropped, no fix is manual review', () => {
  assert.equal(recommend({ category: 'bug' }, false, fixed, { verdict: 'propose' }), 'dropped');
  assert.equal(recommend({ category: 'bug' }, true, null, null), 'manual-review');
  assert.equal(recommend({ category: 'bug' }, true, { ...fixed, diff: ' ' }, { verdict: 'propose' }), 'manual-review');
});

test('recommend: a behaviour change or unmeasured latency is never auto-proposed', () => {
  assert.equal(recommend({ category: 'bug' }, true, fixed, { verdict: 'propose', behaviourChange: true }), 'manual-review');
  assert.equal(recommend({ category: 'latency' }, true, fixed, { verdict: 'propose' }), 'manual-review');
  assert.equal(recommend({ category: 'latency' }, true, { ...fixed, benchBefore: '120ms', benchAfter: '80ms' }, { verdict: 'propose' }), 'propose');
  assert.equal(recommend({ category: 'bug' }, true, fixed, { verdict: 'reject' }), 'reject');
});

test('fixVars fills setup and bench steps', () => {
  const a = { repoRoot: '/r', runDir: '/run', startSha: 's', worktreeSetup: 'ln -s {repoRoot}/nm nm', checks: [], benchChecks: [] };
  const v = fixVars(a, { id: 'HS-1', category: 'latency', severity: 'HIGH', title: 't', file: 'f', line: 1, evidence: 'e' }, [{ reasoning: 'r' }], 'ctx');
  assert.equal(v.worktree, '/run/wt/HS-1');
  assert.match(v.setupSteps, /worktree add --detach \/run\/wt\/HS-1 s\n2\. cd \/run\/wt\/HS-1 && ln -s \/r\/nm nm/);
  assert.match(v.cleanupStep, /worktree remove/);
  const ready = fixVars(a, { id: 'HS-1', category: 'bug', severity: 'HIGH', title: 't', file: 'f', line: 1, evidence: 'e' }, [], 'ctx', true);
  assert.match(ready.setupSteps, /worktree is ready/);
  assert.match(ready.cleanupStep, /caller removes it/);
  assert.match(v.benchStep, /no benchmark/);
});

test('buildContext omits empty sections', () => {
  const c = buildContext({ repoRoot: '/r', groundTruth: ['README.md'] });
  assert.ok(!/in progress/.test(c));
  assert.match(c, /README\.md/);
});
