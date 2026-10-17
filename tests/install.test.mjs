import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, targetDir } from '../scripts/install.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bin.mjs');
const run = (home, cwd, ...args) => {
  const r = spawnSync('node', [BIN, 'install', ...args], { encoding: 'utf8', cwd, env: { ...process.env, HOME: home } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('every agent has a user and a project skills directory', () => {
  for (const agent of ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'opencode', 'agents']) {
    assert.ok(TARGETS[agent], agent);
    assert.ok(targetDir(agent, 'user', '/h', '/p').startsWith('/h/'), agent);
    assert.ok(targetDir(agent, 'project', '/h', '/p').startsWith('/p/'), agent);
  }
});

test('install copies a self-contained skill folder for the chosen agent', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  const r = run(home, home, '--agent', 'codex');
  assert.equal(r.code, 0, r.err);
  const dir = join(home, '.agents', 'skills', 'healthsweep');
  for (const f of ['SKILL.md', 'scripts/healthsweep.mjs', 'scripts/lib/fanout.mjs', 'prompts/finder.md', 'schemas/verdict.json', 'references/config.md']) {
    assert.ok(existsSync(join(dir, f)), f);
  }
  assert.match(readFileSync(join(dir, 'SKILL.md'), 'utf8'), /^---\nname: healthsweep/);
});

test('installed CLI runs from its new home', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  run(home, home, '--agent', 'cursor');
  const cli = join(home, '.cursor', 'skills', 'healthsweep', 'scripts', 'healthsweep.mjs');
  const r = spawnSync('node', [cli, 'prompt', '--list'], { encoding: 'utf8' });
  assert.ok(JSON.parse(r.stdout).prompts.includes('verifier'));
});

test('--all installs for every agent, --project writes under the current directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  const proj = mkdtempSync(join(tmpdir(), 'hs-proj-'));
  assert.equal(run(home, proj, '--all').code, 0);
  assert.ok(existsSync(join(home, '.gemini', 'skills', 'healthsweep', 'SKILL.md')));
  assert.ok(existsSync(join(home, '.copilot', 'skills', 'healthsweep', 'SKILL.md')));
  assert.equal(run(home, proj, '--agent', 'copilot', '--project').code, 0);
  assert.ok(existsSync(join(proj, '.github', 'skills', 'healthsweep', 'SKILL.md')));
});

test('--link symlinks instead of copying, --dry-run writes nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  run(home, home, '--agent', 'gemini', '--link');
  assert.ok(lstatSync(join(home, '.gemini', 'skills', 'healthsweep')).isSymbolicLink());
  const home2 = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  const r = run(home2, home2, '--agent', 'claude', '--dry-run');
  assert.match(r.out, /would install/);
  assert.ok(!existsSync(join(home2, '.claude', 'skills', 'healthsweep')));
});

test('an unknown agent is refused with the list of choices', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  const r = run(home, home, '--agent', 'nope');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /codex/);
});

test('bin passes other commands through to the skill CLI', () => {
  const r = spawnSync('node', [BIN, 'prompt', '--list'], { encoding: 'utf8' });
  assert.ok(JSON.parse(r.stdout).prompts.includes('fixer'));
});
