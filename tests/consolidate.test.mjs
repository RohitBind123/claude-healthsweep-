import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFinding, consolidate, countBySeverity, fromClaudeSecurity } from '../skills/healthsweep/scripts/lib/consolidate.mjs';

const f = (o) => ({
  file: 'src/pay.ts', line: 10, category: 'bug', severity: 'MEDIUM',
  title: 'Missing lock', evidence: 'await tx.update(...)', source: 'tier2:bugs', ...o,
});

test('normalizeFinding rejects findings without evidence', () => {
  assert.throws(() => normalizeFinding(f({ evidence: '' })), /evidence/);
});

test('normalizeFinding rejects unknown category or severity', () => {
  assert.throws(() => normalizeFinding(f({ category: 'style' })), /category/);
  assert.throws(() => normalizeFinding(f({ severity: 'URGENT' })), /severity/);
});

test('normalizeFinding normalises path and casing', () => {
  const n = normalizeFinding(f({ file: './src//pay.ts', severity: 'high', category: 'Security' }));
  assert.equal(n.file, 'src/pay.ts');
  assert.equal(n.severity, 'HIGH');
  assert.equal(n.category, 'security');
});

test('duplicates within 3 lines of the same file and category merge, highest severity wins', () => {
  const out = consolidate([
    f({ line: 10, severity: 'LOW', source: 'tier2:bugs' }),
    f({ line: 12, severity: 'HIGH', source: 'tier3:claude-security' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'HIGH');
  assert.deepEqual(out[0].sources.sort(), ['tier2:bugs', 'tier3:claude-security']);
});

test('same line but different category stays separate', () => {
  const out = consolidate([f({ category: 'bug' }), f({ category: 'latency' })]);
  assert.equal(out.length, 2);
});

test('far apart lines stay separate', () => {
  const out = consolidate([f({ line: 10 }), f({ line: 40 })]);
  assert.equal(out.length, 2);
});

test('output is sorted by severity then file then line and ids are stable', () => {
  const out = consolidate([
    f({ file: 'b.ts', line: 1, severity: 'LOW' }),
    f({ file: 'a.ts', line: 5, severity: 'CRITICAL' }),
    f({ file: 'a.ts', line: 1, severity: 'CRITICAL', category: 'security' }),
  ]);
  assert.deepEqual(out.map((x) => [x.severity, x.file, x.line]), [
    ['CRITICAL', 'a.ts', 1], ['CRITICAL', 'a.ts', 5], ['LOW', 'b.ts', 1],
  ]);
  assert.equal(out[0].id, 'HS-001');
  assert.equal(out[2].id, 'HS-003');
});

test('consolidate does not mutate its input', () => {
  const input = [f({ line: 10 }), f({ line: 11, severity: 'HIGH' })];
  const copy = JSON.parse(JSON.stringify(input));
  consolidate(input);
  assert.deepEqual(input, copy);
});

test('countBySeverity counts per severity and category', () => {
  const c = countBySeverity([f({ severity: 'HIGH' }), f({ severity: 'HIGH', category: 'latency' }), f({})]);
  assert.equal(c.bySeverity.HIGH, 2);
  assert.equal(c.bySeverity.MEDIUM, 1);
  assert.equal(c.bySeverity.CRITICAL, 0);
  assert.equal(c.byCategory.latency, 1);
  assert.equal(c.total, 3);
});

test('fromClaudeSecurity maps a JSONL record', () => {
  const rec = {
    claudeSecurityPluginFindingId: 'abc', file: 'src/x.ts', line: 7, severity: 'HIGH',
    title: 'SQL injection', cweId: 'CWE-89', evidence: 'db.$queryRawUnsafe(q)', rationale: 'user input',
  };
  const n = fromClaudeSecurity(rec);
  assert.equal(n.category, 'security');
  assert.equal(n.source, 'tier3:claude-security');
  assert.equal(n.cwe, 'CWE-89');
  assert.equal(n.externalId, 'abc');
});

test('fromClaudeSecurity falls back to snippet when evidence is missing', () => {
  const n = fromClaudeSecurity({ file: 'a', line: 1, severity: 'LOW', title: 't', snippet: 'x()' });
  assert.equal(n.evidence, 'x()');
});
