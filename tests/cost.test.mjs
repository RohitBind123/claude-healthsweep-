import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateReviewCost, aboveThreshold, DEFAULT_COST_MODEL } from '../skills/healthsweep/scripts/lib/cost.mjs';

const mk = (severity, category = 'bug') => ({ severity, category });

test('aboveThreshold keeps findings at or above the gate', () => {
  const list = [mk('CRITICAL'), mk('HIGH'), mk('MEDIUM'), mk('LOW')];
  assert.equal(aboveThreshold(list, 'HIGH').length, 2);
  assert.equal(aboveThreshold(list, 'LOW').length, 4);
});

test('aboveThreshold rejects an unknown threshold', () => {
  assert.throws(() => aboveThreshold([], 'BIG'), /threshold/);
});

test('estimate scales with count and splits verify and fix', () => {
  const e = estimateReviewCost([mk('HIGH'), mk('HIGH')], DEFAULT_COST_MODEL);
  const per = DEFAULT_COST_MODEL.verifyTokens + DEFAULT_COST_MODEL.fixTokens + DEFAULT_COST_MODEL.reviewTokens;
  assert.equal(e.findings, 2);
  assert.equal(e.tokens, 2 * per);
  assert.ok(e.low < e.tokens && e.high > e.tokens);
});

test('latency findings cost more when a benchmark must run', () => {
  const a = estimateReviewCost([mk('HIGH', 'latency')], DEFAULT_COST_MODEL).tokens;
  const b = estimateReviewCost([mk('HIGH', 'bug')], DEFAULT_COST_MODEL).tokens;
  assert.ok(a > b);
});

test('empty list costs nothing', () => {
  const e = estimateReviewCost([], DEFAULT_COST_MODEL);
  assert.equal(e.tokens, 0);
  assert.equal(e.findings, 0);
});
