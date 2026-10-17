import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'healthsweep', 'scripts', 'healthsweep.mjs');

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
  run('trust', '--repo', repo);
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
    { file: 'src/a.js', line: 4, category: 'bug', severity: 'LOW', title: 'loop is off by one', evidence: 'i <= n', source: 'tier2:logic' },
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
  const rep = run('report', '--run', runDir, '--tier3-reason', 'not installed');
  assert.equal(rep.json.ok, true);
  const reportMd = readFileSync(rep.json.report, 'utf8');
  assert.match(reportMd, /Report only/);
  assert.match(reportMd, /off by one/);

  const lg = run('log', '--run', runDir, '--entry', entry);
  assert.equal(lg.json.ok, true);
  const md = readFileSync(join(repo, 'HEALTHSWEEP_LOG.md'), 'utf8');
  assert.match(md, /# HEALTHSWEEP_LOG/);
  assert.match(md, /HS-001 · HIGH · bug · off by one/);
  assert.equal(statSync(join(repo, 'HEALTHSWEEP_LOG.md')).mode & 0o777, 0o644);
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

test('init accepts absolute ground-truth paths outside the repo', () => {
  const { repo, run, root } = setup();
  const outside = join(root, 'SPEC.md');
  writeFileSync(outside, '# spec');
  writeFileSync(join(repo, '.healthsweep.json'), JSON.stringify({
    groundTruth: ['README.md', outside],
    checks: [{ name: 'unit', kind: 'test', cmd: 'true' }],
  }));
  const r = run('init', '--repo', repo);
  assert.deepEqual(r.json.missingGroundTruth, []);
  assert.equal(r.json.ok, true);
});

test('prompt renders a role prompt with its schema for any agent', () => {
  const root = mkdtempSync(join(tmpdir(), 'hs-cli-'));
  const vars = join(root, 'v.json');
  writeFileSync(vars, JSON.stringify({ context: 'Repository root: /r', id: 'HS-001', severity: 'HIGH', category: 'bug', title: 'race', file: 'a.js', line: 3, evidence: 'x', rationale: 'r', lens: 'Read the code.' }));
  const r = spawnSync('node', [CLI, 'prompt', 'verifier', '--vars', vars, '--schema', 'verdict'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /try to DISPROVE it/);
  assert.match(r.stdout, /Return ONLY one JSON object/);
  assert.match(r.stdout, /"real"/);
  const list = JSON.parse(spawnSync('node', [CLI, 'prompt', '--list'], { encoding: 'utf8' }).stdout);
  assert.ok(list.prompts.includes('fixer'));
  assert.ok(!list.prompts.includes('_rules-readonly'));
});

test('unknown command exits 64', () => {
  const r = spawnSync('node', [CLI, 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 64);
});

test('fanout scan and verify run through a configured headless agent', () => {
  const { repo, run, g } = setup();
  const fake = `node ${join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs')}`;
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.js'), 'const queue = [];\nconst job = queue[0];\n');
  const cfg = JSON.parse(readFileSync(join(repo, '.healthsweep.json'), 'utf8'));
  writeFileSync(join(repo, '.healthsweep.json'), JSON.stringify({ ...cfg, agent: { command: fake, writeCommand: fake, concurrency: 2 } }));
  g('add', '.');
  g('commit', '-qm', 'src');
  assert.equal(run('preflight', '--repo', repo, '--stamp', 'fan0').json.reason, 'untrusted-config'); // agent added: trust again
  run('trust', '--repo', repo);
  const runDir = run('preflight', '--repo', repo, '--stamp', 'fan').json.runDir;
  run('checks', '--run', runDir, '--label', 'baseline');
  const scan = run('fanout', 'scan', '--run', runDir);
  assert.equal(scan.json.findings, 1);
  run('consolidate', '--run', runDir, '--tier2', join(runDir, 'tier2.json'));
  const ver = run('fanout', 'verify', '--run', runDir, '--threshold', 'HIGH', '--allow-write');
  assert.equal(ver.json.tally.propose, 1);
  const rep = run('report', '--run', runDir);
  assert.match(readFileSync(rep.json.report, 'utf8'), /\| propose \|/);
});

test('agents lists every preset with whether it is installed', () => {
  const r = spawnSync('node', [CLI, 'agents'], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  for (const k of ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'opencode']) assert.equal(typeof j.presets[k].installed, 'boolean');
});

test('an untrusted repo config runs nothing and lists every command for the user', () => {
  const { repo, run, home } = setup();
  const marker = join(home, 'pwned');
  writeFileSync(join(repo, '.healthsweep.json'), JSON.stringify({
    groundTruth: ['README.md'],
    checks: [{ name: 'unit', kind: 'test', cmd: `touch ${marker}` }],
    worktreeSetup: 'echo setup',
  }));
  const pre = run('preflight', '--repo', repo, '--stamp', 'evil');
  assert.equal(pre.json.ok, false);
  assert.equal(pre.json.reason, 'untrusted-config');
  assert.match(JSON.stringify(pre.json.commands), /touch .*pwned/);
  assert.match(JSON.stringify(pre.json.commands), /echo setup/);
  assert.equal(existsSync(marker), false);
});

test('checks refuse a run whose config changed after it was trusted', () => {
  const { repo, run } = setup();
  const runDir = run('preflight', '--repo', repo, '--stamp', 'tamper').json.runDir;
  const p = join(runDir, 'run.json');
  const r = JSON.parse(readFileSync(p, 'utf8'));
  r.config.checks[0].cmd = 'echo changed';
  writeFileSync(p, JSON.stringify(r));
  const c = run('checks', '--run', runDir);
  assert.equal(c.json.ok, false);
  assert.match(c.json.error, /not trusted/);
});

test('log refuses to write through a symlinked HEALTHSWEEP_LOG.md', () => {
  const { repo, run, g, root } = setup();
  const target = join(root, 'victim-rc');
  writeFileSync(target, 'original\n');
  symlinkSync(target, join(repo, 'HEALTHSWEEP_LOG.md'));
  g('add', '.'); g('commit', '-qm', 'link');
  const runDir = run('preflight', '--repo', repo, '--stamp', 'sym').json.runDir;
  const entry = join(runDir, 'e.json');
  writeFileSync(entry, JSON.stringify({ finding: { id: 'HS-001', title: 't', severity: 'LOW', category: 'bug', file: 'a', line: 1, evidence: 'e' }, verification: 'v', diff: 'd', testsBefore: 'b', testsAfter: 'a' }));
  const r = run('log', '--run', runDir, '--entry', entry);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /symlink/);
  assert.equal(readFileSync(target, 'utf8'), 'original\n');
});

test('bad --stamp, --files and --ids values are refused', () => {
  const { repo, run } = setup();
  assert.equal(run('preflight', '--repo', repo, '--stamp', '../../x').json.ok, false);
  const runDir = run('preflight', '--repo', repo, '--stamp', 'val').json.runDir;
  const c = run('checks', '--run', runDir, '--label', 'x', '--files', '../outside.js');
  assert.equal(c.json.ok, false);
  assert.match(c.json.error, /path/);
  const lbl = run('checks', '--run', runDir, '--label', '../evil');
  assert.equal(lbl.json.ok, false);
});

test('run artefacts are private to the user', () => {
  const { repo, run } = setup();
  const runDir = run('preflight', '--repo', repo, '--stamp', 'perm').json.runDir;
  assert.equal(statSync(runDir).mode & 0o077, 0);
  assert.equal(statSync(join(runDir, 'run.json')).mode & 0o077, 0);
});

test('checks report files a check command modified in the repository', () => {
  const { repo, run, g } = setup();
  writeFileSync(join(repo, '.healthsweep.json'), JSON.stringify({ groundTruth: ['README.md'], checks: [{ name: 'snap', kind: 'test', cmd: 'echo changed >> README.md' }] }));
  g('add', '.'); g('commit', '-qm', 'cfg');
  run('trust', '--repo', repo);
  const runDir = run('preflight', '--repo', repo, '--stamp', 'dirt').json.runDir;
  const c = run('checks', '--run', runDir);
  assert.deepEqual(c.json.dirtiedByChecks, ['README.md']);
});

test('flags accept --key=value and refuse a missing value', () => {
  const { repo, run } = setup();
  const pre = run('preflight', `--repo=${repo}`, '--stamp=eq');
  assert.equal(pre.json.ok, true);
  const runDir = pre.json.runDir;
  const c = run('checks', '--run', runDir, '--label');
  assert.equal(c.json.ok, false);
  assert.match(c.json.error, /--label needs a value/);
});

test('one bad tier-3 line is rejected without losing the rest', () => {
  const { repo, run, root } = setup();
  const runDir = run('preflight', '--repo', repo, '--stamp', 't3').json.runDir;
  run('checks', '--run', runDir);
  const t3 = join(root, 'cs');
  mkdirSync(t3);
  writeFileSync(join(t3, 'CLAUDE-SECURITY-RESULTS.jsonl'), [
    JSON.stringify({ file: 'src/a.js', line: 3, severity: 'HIGH', title: 'sqli', evidence: 'q()' }),
    '{not json',
    JSON.stringify({ file: '/etc/passwd', line: 1, severity: 'LOW', title: 'x', evidence: 'y' }),
  ].join('\n'));
  const c = run('consolidate', '--run', runDir, '--tier3', t3);
  assert.equal(c.json.ok, true);
  assert.equal(c.json.counts.total, 1);
  assert.equal(c.json.rejected.length, 2);
  const empty = join(root, 'empty');
  mkdirSync(empty);
  const e = run('consolidate', '--run', runDir, '--tier3', empty);
  assert.equal(e.json.ok, false);
  assert.match(e.json.error, /no \.jsonl/);
});
