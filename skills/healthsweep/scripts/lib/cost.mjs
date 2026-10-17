// Rough token estimate for the verify + fix stage, shown at the cost gate.
// These are planning numbers, not a bill: the gate shows a low-high range.

import { SEVERITIES } from './consolidate.mjs';

export const DEFAULT_COST_MODEL = Object.freeze({
  verifyTokens: 60_000, // fresh verifier re-reads the code and re-derives the evidence
  fixTokens: 120_000, // fixer drafts a patch in a worktree and runs scoped tests
  reviewTokens: 40_000, // requirements reviewer checks the patch against ground truth
  benchTokens: 30_000, // extra for latency findings when a benchmark must run
  spread: 0.5, // +/- 50 percent range
});

export function aboveThreshold(findings, threshold) {
  const t = SEVERITIES.indexOf(String(threshold).toUpperCase());
  if (t === -1) throw new Error(`unknown threshold "${threshold}"`);
  return findings.filter((f) => SEVERITIES.indexOf(f.severity) <= t);
}

export function estimateReviewCost(findings, model = DEFAULT_COST_MODEL) {
  let tokens = 0;
  for (const f of findings) {
    tokens += model.verifyTokens + model.fixTokens + model.reviewTokens;
    if (f.category === 'latency') tokens += model.benchTokens;
  }
  return {
    findings: findings.length,
    tokens,
    low: Math.round(tokens * (1 - model.spread)),
    high: Math.round(tokens * (1 + model.spread)),
  };
}
