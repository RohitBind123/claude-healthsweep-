import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck, runChecks } from '../scripts/lib/run.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'hs-run-'));

test('runCheck records exit code, duration and parsed counts', async () => {
  const out = dir();
  const r = await runCheck(
    { name: 'fake', kind: 'test', cmd: "printf 'Tests:       3 passed, 3 total\\n'", cwd: '.', timeoutSec: 30, env: {} },
    { repoRoot: out, outDir: out },
  );
  assert.equal(r.exitCode, 0);
  assert.equal(r.passed, 3);
  assert.equal(r.timedOut, false);
  assert.ok(r.durationMs >= 0);
  assert.match(readFileSync(r.logFile, 'utf8'), /3 passed/);
});

test('multi-byte characters split across output chunks survive intact', async () => {
  const out = dir();
  // 132000 bytes of a 3-byte character: the 131072-byte pipe chunk boundary splits one, inside the tail
  const r = await runCheck(
    { name: 'emoji', kind: 'test', cmd: `node -e "process.stdout.write('\\u2713'.repeat(44000))"`, cwd: '.', timeoutSec: 30, env: {} },
    { repoRoot: out, outDir: out },
  );
  assert.ok(!r.tail.includes('�'));
});

test('runCheck marks a timeout and kills the process', async () => {
  const out = dir();
  const r = await runCheck(
    { name: 'slow', kind: 'test', cmd: 'sleep 5', cwd: '.', timeoutSec: 1, env: {} },
    { repoRoot: out, outDir: out },
  );
  assert.equal(r.timedOut, true);
  assert.ok(r.durationMs < 4000);
});

test('runCheck keeps a non-zero exit', async () => {
  const out = dir();
  const r = await runCheck({ name: 'bad', kind: 'build', cmd: 'exit 3', cwd: '.', timeoutSec: 10, env: {} }, { repoRoot: out, outDir: out });
  assert.equal(r.exitCode, 3);
});

test('bench check extracts the metric with metricRegex', async () => {
  const out = dir();
  const r = await runCheck(
    { name: 'b', kind: 'bench', cmd: "echo 'p95=42.5ms'", cwd: '.', timeoutSec: 10, env: {}, metricRegex: 'p95=([\\d.]+)ms' },
    { repoRoot: out, outDir: out },
  );
  assert.equal(r.metricMs, 42.5);
});

test('runChecks runs one at a time, in order', async () => {
  const out = dir();
  const res = await runChecks(
    [
      { name: 'a', kind: 'build', cmd: 'echo a', cwd: '.', timeoutSec: 10, env: {} },
      { name: 'b', kind: 'build', cmd: 'echo b', cwd: '.', timeoutSec: 10, env: {} },
    ],
    { repoRoot: out, outDir: out },
  );
  assert.deepEqual(res.checks.map((c) => c.name), ['a', 'b']);
  assert.ok(res.checks[1].startedAt >= res.checks[0].startedAt + res.checks[0].durationMs);
});

test('a cwd outside the repo is refused', async () => {
  const out = dir();
  await assert.rejects(
    runCheck({ name: 'x', kind: 'build', cmd: 'echo', cwd: '../..', timeoutSec: 5, env: {} }, { repoRoot: out, outDir: out }),
    /outside the repository/,
  );
});
