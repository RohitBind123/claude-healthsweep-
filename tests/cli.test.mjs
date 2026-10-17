import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'healthsweep.mjs');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'hs-cli-'));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(repo, 'README.md'), '# demo\nAdds numbers.\n');
  writeFileSync(join(repo, '.healthsweep.json'), JSON.stringify({
    groundTruth: ['README.md'],
    checks: [{ name: 'unit', kind: 'test', cmd: "printf 'Tests:       4 passed, 4 total\\n'", timeoutSec: 30, scope: ['src/**'] }],
  }));
  g('add', '.');
  g('commit', '-qm', 'init');
  const run = (...args) => {
    const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    return { code: r.status, json: JSON.parse(r.stdout), stderr: r.stderr };
  };
  return { root, home, repo, run, g };
}

test('preflight stops on a dirty tree and touches nothing', () => {
  const { repo, run } = setup();
  writeFileSync(join(repo, 'wip.txt'), 'in progress');
  const r = run('preflight', '--repo', repo);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.reason, 'dirty-tree');
  assert.deepEqual(r.json.dirty, ['?? wip.txt']);
  assert.equal(readFileSync(join(repo, 'wip.txt'), 'utf8'), 'in progress');
});

test('full happy path: preflight, baseline, consolidate, scoped checks, compare, log', () => {
  const { repo, run } = setup();
  const pre = run('preflight', '--repo', repo, '--stamp', 't1');
  assert.equal(pre.json.ok, true);
  const runDir = pre.json.runDir;

  const base = run('checks', '--run', runDir, '--label', 'baseline');
  assert.equal(base.json.checks[0].passed, 4);

  const tier2 = join(runDir, 'tier2.json');
  writeFileSync(tier2, JSON.stringify({ findings: [
    { file: 'src/a.js', line: 3, category: 'bug', severity: 'HIGH', title: 'off by one', evidence: 'i <= n', source: 'tier2:bugs' },
    { file: 'src/a.js', line: 4, category: 'bug', severity: 'LOW', title: 'dup', evidence: 'i <= n', source: 'tier2:logic' },
    { file: 'src/b.js', line: 9, category: 'latency', severity: 'LOW', title: 'loop', evidence: 'for..await', source: 'tier2:perf' },
    { file: 'src/c.js', line: 1, category: 'bug', severity: 'HIGH', title: 'no evidence', evidence: '' },
  ] }));
  const c = run('consolidate', '--run', runDir, '--tier2', tier2);
  assert.equal(c.json.counts.total, 2);
  assert.equal(c.json.counts.bySeverity.HIGH, 1);
  assert.equal(c.json.rejected.length, 1);
  assert.equal(c.json.estimateAboveThreshold.findings, 1);

  const scoped = run('checks', '--run', runDir, '--label', 'after-HS-001', '--files', 'src/a.js');
  assert.equal(scoped.json.checks.length, 1);
  const cmp = run('compare', '--run', runDir, '--after', 'after-HS-001');
  assert.equal(cmp.json.ok, true);

  const entry = join(runDir, 'entry.json');
  writeFileSync(entry, JSON.stringify({
    finding: { id: 'HS-001', title: 'off by one', severity: 'HIGH', category: 'bug', file: 'src/a.js', line: 3, evidence: 'i <= n' },
    verification: 'reproduced with n=0', diff: '-i <= n\n+i < n', testsBefore: 'Tests: 4 passed', testsAfter: 'Tests: 5 passed',
  }));
  const lg = run('log', '--run', runDir, '--entry', entry);
  assert.equal(lg.json.ok, true);
  const md = readFileSync(join(repo, 'HEALTHSWEEP_LOG.md'), 'utf8');
  assert.match(md, /# HEALTHSWEEP_LOG/);
  assert.match(md, /HS-001 · HIGH · bug · off by one/);
});

test('init without a config suggests checks and ground truth', () => {
  const root = mkdtempSync(join(tmpdir(), 'hs-cli-'));
  writeFileSync(join(root, 'README.md'), '# x');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
  const r = spawnSync('node', [CLI, 'init', '--repo', root], { encoding: 'utf8', env: { ...process.env, HOME: root } });
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.reason, 'no-config');
  assert.deepEqual(j.groundTruthCandidates, ['README.md']);
  assert.equal(j.detectedChecks[0].cmd, 'npm test');
});

test('unknown command exits 64', () => {
  const r = spawnSync('node', [CLI, 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 64);
});
