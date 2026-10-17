import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, nearDuplicates } from '../skills/healthsweep/scripts/lib/report.mjs';

const f = (id, o) => ({ id, file: 'src/a.ts', line: 10, category: 'bug', severity: 'HIGH', title: `t-${id}`, evidence: 'e', rationale: 'r', sources: ['tier2:logic'], ...o });
const base = {
  run: { repoRoot: '/r', branch: 'main', startSha: 'abc123', config: { scope: ['src'], checks: [] } },
  baseline: { checks: [{ name: 'unit', kind: 'test', exitCode: 1, passed: 9, failed: 1, failures: ['old test'], durationMs: 1200 }] },
  findingsDoc: { counts: { total: 2, bySeverity: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0 }, byCategory: { bug: 1, security: 0, latency: 1, maintainability: 0 } }, findings: [f('HS-001'), f('HS-002', { severity: 'MEDIUM', category: 'latency', line: 400, sources: ['tier2:latency'] })] },
  verify: null,
  tier3: { ran: false, reason: 'plugin not loaded' },
  tokens: { tier2Output: 1000, tier2Total: 50000 },
  mode: 'report-only',
  date: '2026-10-17',
};

test('report-only run says nothing was verified or changed', () => {
  const md = renderReport(base);
  assert.match(md, /Report only/i);
  assert.match(md, /No finding in this report has been independently verified/);
  assert.match(md, /No code was changed/);
});

test('report lists counts, baseline, tier 3 status and every finding', () => {
  const md = renderReport(base);
  assert.match(md, /\| HIGH \| 1 \|/);
  assert.match(md, /unit .*exit 1.*9 passed.*1 failed/);
  assert.match(md, /Tier 3.*skipped.*plugin not loaded/i);
  assert.match(md, /HS-001/);
  assert.match(md, /HS-002/);
  assert.match(md, /`src\/a\.ts:400`/);
});

test('report ends with the honesty statement', () => {
  assert.match(renderReport(base), /not a proof that nothing broke/);
});

test('unknown counts render as a dash, never 0', () => {
  const md = renderReport({ ...base, baseline: { checks: [{ name: 'build', kind: 'build', exitCode: 0, passed: null, failed: null, failures: [], durationMs: 5 }] } });
  assert.match(md, /build .*exit 0.*—/);
});

test('nearDuplicates groups findings in the same file within 20 lines', () => {
  const groups = nearDuplicates([f('A', { line: 100 }), f('B', { line: 112, category: 'latency' }), f('C', { line: 300 })]);
  assert.deepEqual(groups, [['A', 'B']]);
});
