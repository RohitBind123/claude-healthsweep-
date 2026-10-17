import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, targetDir, SKILL_SRC, MARKER, containmentError } from '../scripts/install.mjs';

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

test('--agent with no value is refused instead of falling back', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  for (const args of [['--agent'], ['--agent', '--project'], ['--agent', '--dry-run']]) {
    const r = run(home, home, ...args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /--agent needs a value/);
    assert.match(r.err, /usage:/);
  }
  assert.ok(!existsSync(join(home, '.agents')));
});

test('install errors exit 1 and print usage', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  const r = run(home, home, '--agent', 'nope');
  assert.equal(r.code, 1);
  assert.match(r.err, /usage: healthsweep install/);
});

test('--link points at the absolute real path of the skill', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  assert.equal(run(home, home, '--agent', 'gemini', '--link').code, 0);
  const target = readlinkSync(join(home, '.gemini', 'skills', 'healthsweep'));
  assert.equal(target, realpathSync(SKILL_SRC));
  assert.ok(!existsSync(join(SKILL_SRC, MARKER)), 'marker must not be written into the source');
});

test('a copy install writes a marker and can be reinstalled over', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  assert.equal(run(home, home, '--agent', 'codex').code, 0);
  assert.ok(existsSync(join(home, '.agents', 'skills', 'healthsweep', MARKER)));
  assert.equal(run(home, home, '--agent', 'codex').code, 0);
});

test('an existing folder without the marker is kept unless --force', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  const dest = join(home, '.cursor', 'skills', 'healthsweep');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'mine.txt'), 'keep me');
  const r = run(home, home, '--agent', 'cursor');
  assert.equal(r.code, 1);
  assert.match(r.err, /--force/);
  assert.equal(readFileSync(join(dest, 'mine.txt'), 'utf8'), 'keep me');
  assert.equal(run(home, home, '--agent', 'cursor', '--force').code, 0);
  assert.ok(!existsSync(join(dest, 'mine.txt')));
  assert.ok(existsSync(join(dest, 'SKILL.md')));
});

test('a symlink at the destination is replaced', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  assert.equal(run(home, home, '--agent', 'gemini', '--link').code, 0);
  assert.equal(run(home, home, '--agent', 'gemini').code, 0);
  const dest = join(home, '.gemini', 'skills', 'healthsweep');
  assert.ok(!lstatSync(dest).isSymbolicLink());
  assert.ok(existsSync(join(SKILL_SRC, 'SKILL.md')), 'source untouched');
});

test('--project refuses a symlinked skills directory shipped by the repo', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  const proj = mkdtempSync(join(tmpdir(), 'hs-proj-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'hs-else-'));
  symlinkSync(elsewhere, join(proj, '.claude'), 'dir');
  const r = run(home, proj, '--agent', 'claude', '--project');
  assert.equal(r.code, 1);
  assert.match(r.err, /symlink/);
  assert.ok(!existsSync(join(elsewhere, 'skills')));
});

test('a destination that resolves to the skill source is refused', () => {
  const home = mkdtempSync(join(tmpdir(), 'hs-inst-'));
  mkdirSync(join(home, '.agents'));
  symlinkSync(dirname(SKILL_SRC), join(home, '.agents', 'skills'), 'dir');
  for (const extra of [['--dry-run'], ['--force', '--dry-run']]) {
    const r = run(home, home, '--agent', 'codex', ...extra);
    assert.equal(r.code, 1);
    assert.match(r.err, /skill source/);
  }
  const r = run(SKILL_SRC, SKILL_SRC, '--agent', 'claude', '--project', '--dry-run');
  assert.equal(r.code, 1);
  assert.match(r.err, /skill source/);
  assert.ok(existsSync(join(SKILL_SRC, 'SKILL.md')));
});

test('containmentError catches equal, nested and enclosing paths', () => {
  assert.match(containmentError('/a/src', '/a/src'), /skill source/);
  assert.match(containmentError('/a/src', '/a/src/x/healthsweep'), /skill source/);
  assert.match(containmentError('/a/b/src', '/a/b'), /skill source/);
  assert.equal(containmentError('/a/src', '/a/srcx/healthsweep'), null);
  assert.equal(containmentError('/a/src', '/h/.agents/skills/healthsweep'), null);
});
