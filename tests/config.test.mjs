import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, resolveConfigPath, detectChecks } from '../skills/healthsweep/scripts/lib/config.mjs';

const good = {
  groundTruth: ['README.md'],
  checks: [{ name: 'unit', kind: 'test', cmd: 'npm test', timeoutSec: 600 }],
};

test('a minimal config is valid and gets defaults', () => {
  const c = validateConfig(good);
  assert.equal(c.costGate.threshold, 'MEDIUM');
  assert.equal(c.checks[0].cwd, '.');
  assert.deepEqual(c.scope, []);
  assert.equal(c.benchTolerancePct, 10);
  assert.equal(c.worktreeSetup, null);
});

test('worktreeSetup is kept when given', () => {
  assert.equal(validateConfig({ ...good, worktreeSetup: 'ln -s a b' }).worktreeSetup, 'ln -s a b');
});

test('a config with no ground truth is rejected', () => {
  assert.throws(() => validateConfig({ ...good, groundTruth: [] }), /groundTruth/);
});

test('a check without a command is rejected', () => {
  assert.throws(() => validateConfig({ ...good, checks: [{ name: 'x', kind: 'test' }] }), /cmd/);
});

test('an unknown check kind is rejected', () => {
  assert.throws(() => validateConfig({ ...good, checks: [{ name: 'x', kind: 'e2e', cmd: 'a' }] }), /kind/);
});

test('duplicate check names are rejected', () => {
  const checks = [good.checks[0], { ...good.checks[0] }];
  assert.throws(() => validateConfig({ ...good, checks }), /duplicate/);
});

test('a timeout above one hour is rejected', () => {
  assert.throws(() => validateConfig({ ...good, checks: [{ ...good.checks[0], timeoutSec: 7200 }] }), /timeoutSec/);
});

test('resolveConfigPath prefers the explicit path, then the repo file, then the home file', () => {
  const root = mkdtempSync(join(tmpdir(), 'hs-'));
  const repo = join(root, 'myrepo');
  const home = join(root, 'home');
  mkdirSync(repo);
  mkdirSync(join(home, '.claude', 'healthsweep'), { recursive: true });
  writeFileSync(join(home, '.claude', 'healthsweep', 'myrepo.json'), '{}');
  assert.equal(resolveConfigPath({ repoRoot: repo, home }), join(home, '.claude', 'healthsweep', 'myrepo.json'));
  writeFileSync(join(repo, '.healthsweep.json'), '{}');
  assert.equal(resolveConfigPath({ repoRoot: repo, home }), join(repo, '.healthsweep.json'));
  assert.equal(resolveConfigPath({ repoRoot: repo, home, explicit: '/x/y.json' }), '/x/y.json');
});

test('resolveConfigPath returns null when nothing exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'hs-'));
  assert.equal(resolveConfigPath({ repoRoot: root, home: root }), null);
});

test('detectChecks finds npm scripts and python and go markers', () => {
  const root = mkdtempSync(join(tmpdir(), 'hs-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest', lint: 'eslint .', build: 'tsc' } }));
  writeFileSync(join(root, 'go.mod'), 'module x');
  writeFileSync(join(root, 'pyproject.toml'), '[tool.pytest.ini_options]');
  const names = detectChecks(root).map((c) => `${c.kind}:${c.cmd}`);
  assert.ok(names.includes('test:npm test'));
  assert.ok(names.includes('lint:npm run lint'));
  assert.ok(names.includes('build:npm run build'));
  assert.ok(names.includes('test:go test ./...'));
  assert.ok(names.includes('test:pytest -q'));
});

test('detectChecks ignores the npm placeholder test script', () => {
  const root = mkdtempSync(join(tmpdir(), 'hs-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  assert.equal(detectChecks(root).length, 0);
});
