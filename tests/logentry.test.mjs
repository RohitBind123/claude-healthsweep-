import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLogEntry, LOG_HEADER } from '../skills/healthsweep/scripts/lib/logentry.mjs';

const entry = {
  date: '2026-10-17',
  finding: { id: 'HS-003', title: 'Race in claimJob', severity: 'HIGH', category: 'bug', file: 'src/q.ts', line: 42, evidence: 'no FOR UPDATE' },
  verification: 'Verifier reproduced with two parallel workers; both claimed the same job.',
  diff: '--- a/src/q.ts\n+++ b/src/q.ts\n@@\n-old\n+new\n',
  testsBefore: 'Tests: 40 passed, 40 total',
  testsAfter: 'Tests: 41 passed, 41 total',
  bench: null,
  approvedBy: 'user',
};

test('entry carries id, before/after code and real test output', () => {
  const md = renderLogEntry(entry);
  assert.match(md, /## 2026-10-17 · HS-003 · HIGH · bug · Race in claimJob/);
  assert.match(md, /`src\/q\.ts:42`/);
  assert.match(md, /```diff\n--- a\/src\/q\.ts/);
  assert.match(md, /Tests: 40 passed, 40 total/);
  assert.match(md, /Tests: 41 passed, 41 total/);
});

test('missing bench says so instead of claiming a perf change', () => {
  assert.match(renderLogEntry(entry), /No benchmark run/);
  const withBench = renderLogEntry({ ...entry, bench: { before: '120 ms', after: '80 ms', command: 'npm run bench' } });
  assert.match(withBench, /120 ms/);
  assert.match(withBench, /80 ms/);
});

test('an entry without test output is refused', () => {
  assert.throws(() => renderLogEntry({ ...entry, testsAfter: '' }), /testsAfter/);
});

test('backtick fences in evidence cannot break out of the block', () => {
  const md = renderLogEntry({ ...entry, finding: { ...entry.finding, evidence: 'a ``` b' } });
  assert.ok(!md.includes('a ``` b'));
});

test('LOG_HEADER explains what the file is', () => {
  assert.match(LOG_HEADER, /# HEALTHSWEEP_LOG/);
});

test('file paths and titles cannot inject markdown, and secrets are redacted', () => {
  const md = renderLogEntry({ ...entry, finding: { ...entry.finding, file: 'a`b.ts', title: 'x\n## forged heading' }, diff: '+const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"\n', testsAfter: 'API_KEY=abcdef123456 ok' });
  assert.ok(!md.includes('\n## forged heading'));
  assert.ok(!md.includes('a`b.ts'));
  assert.ok(!md.includes('ghp_aBcDeF'));
  assert.ok(!md.includes('abcdef123456'));
});
