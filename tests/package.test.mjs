// Packs the real npm tarball, installs it into an empty project and runs it: what users get.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('package.json is publishable and matches the plugin version', () => {
  assert.equal(pkg.name, 'healthsweep');
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.bin.healthsweep, 'scripts/bin.mjs');
  assert.equal(pkg.publishConfig?.access, 'public');
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(pkg.version, plugin.version);
  assert.match(readFileSync(join(ROOT, 'skills', 'healthsweep', 'SKILL.md'), 'utf8'), new RegExp(`version: "${pkg.version.replace(/\./g, '\\.')}"`));
});

test('the tarball ships the skill, CLI and installer, and nothing private', () => {
  const [info] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' }));
  const files = info.files.map((f) => f.path);
  for (const f of ['scripts/bin.mjs', 'scripts/install.mjs', 'skills/healthsweep/SKILL.md', 'skills/healthsweep/scripts/healthsweep.mjs', 'skills/healthsweep/prompts/finder.md', 'skills/healthsweep/schemas/verdict.json', 'LICENSE', 'README.md']) {
    assert.ok(files.includes(f), `missing ${f}`);
  }
  for (const f of files) {
    assert.ok(!/^(tests|examples|assets|src|tasks|\.github)\//.test(f), `should not ship ${f}`);
  }
  assert.ok(info.size < 200_000, `tarball too large: ${info.size} bytes`);
});

test('installed from the tarball, the healthsweep command works', () => {
  const work = mkdtempSync(join(tmpdir(), 'hs-pkg-'));
  const tgz = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', work], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop();
  const proj = join(work, 'proj');
  const home = join(work, 'home');
  execFileSync('mkdir', ['-p', proj, home]);
  writeFileSync(join(proj, 'package.json'), '{"name":"p","version":"1.0.0","private":true}');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', join(work, tgz)], { cwd: proj });
  const bin = join(proj, 'node_modules', '.bin', 'healthsweep');
  const env = { ...process.env, HOME: home };
  const inst = spawnSync(bin, ['install', '--agent', 'codex'], { cwd: proj, env, encoding: 'utf8' });
  assert.equal(inst.status, 0, inst.stderr);
  assert.ok(existsSync(join(home, '.agents', 'skills', 'healthsweep', 'SKILL.md')));
  const agents = JSON.parse(spawnSync(bin, ['agents'], { cwd: proj, env, encoding: 'utf8' }).stdout);
  assert.equal(agents.ok, true);
  const help = spawnSync(bin, ['--version'], { cwd: proj, env, encoding: 'utf8' });
  assert.equal(help.stdout.trim(), pkg.version);
});
