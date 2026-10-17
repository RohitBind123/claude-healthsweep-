import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFanout, verifyFanout } from '../skills/healthsweep/scripts/lib/fanout.mjs';
import { loadPrompts, loadSchemas } from '../skills/healthsweep/scripts/lib/prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = `node ${join(HERE, 'fixtures', 'fake-agent.mjs')}`;
const SKILL = join(HERE, '..', 'skills', 'healthsweep');
const prompts = loadPrompts(join(SKILL, 'prompts'));
const schemas = loadSchemas(join(SKILL, 'schemas'));
const agent = { command: FAKE, writeCommand: FAKE, concurrency: 2, timeoutSec: 30 };

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'hs-fan-'));
  const r = join(root, 'repo');
  mkdirSync(join(r, 'src'), { recursive: true });
  const g = (...x) => execFileSync('git', ['-C', r, ...x], { encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(r, 'src', 'a.js'), 'const queue = [];\nconst job = queue[0];\n');
  writeFileSync(join(r, 'README.md'), 'Jobs run once.\n');
  g('add', '.'); g('commit', '-qm', 'init');
  return { root, r, g, sha: g('rev-parse', 'HEAD') };
}

test('scanFanout runs inventory then one finder per module x lens, each as its own process', async () => {
  const { r, root } = repo();
  const logFile = join(root, 'calls.log');
  const res = await scanFanout({
    a: { repoRoot: r, runDir: root, groundTruth: ['README.md'], scope: [] },
    prompts, schemas, agent: { ...agent, command: `FAKE_AGENT_LOG=${logFile} ${FAKE}` },
  });
  assert.deepEqual(res.modules, [{ name: 'jobs', paths: ['src'] }]);
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].source, 'tier2:consistency');
  assert.equal(res.lostFinders, 0);
  assert.equal(readFileSync(logFile, 'utf8').trim().split('\n').length, 5); // inventory + 4 lenses
});

test('verifyFanout confirms, fixes in a private worktree, takes the diff from git, reviews, cleans up', async () => {
  const { r, root, sha, g } = repo();
  const runDir = join(root, 'run');
  mkdirSync(runDir);
  const finding = { id: 'HS-001', file: 'src/a.js', line: 2, category: 'bug', severity: 'HIGH', title: 'double claim', evidence: 'x', rationale: 'r' };
  const res = await verifyFanout({ a: { repoRoot: r, runDir, startSha: sha, findings: [finding], groundTruth: ['README.md'], checks: [] }, prompts, schemas, agent, log: (m) => process.stderr.write(m + '\n') });
  const one = res.results[0];
  assert.equal(one.confirmed, true);
  assert.equal(one.verdicts.length, 2);
  assert.equal(one.recommendation, 'propose');
  assert.match(one.fix.diff, /\+\/\/ fixed/);
  assert.equal(one.fix.agentReportedDiff, true); // the agent's own "diff" text was not trusted
  assert.deepEqual(one.fix.filesChanged, ['src/a.js']);
  assert.equal(readFileSync(join(r, 'src', 'a.js'), 'utf8').includes('fixed'), false); // user tree untouched
  assert.equal(existsSync(join(runDir, 'wt', 'HS-001')), false);
  assert.equal(g('worktree', 'list').split('\n').length, 1);
});

test('verifyFanout drops a finding a verifier refutes and never spawns a fixer', async () => {
  const { r, root, sha } = repo();
  const finding = { id: 'HS-002', file: 'src/a.js', line: 1, category: 'bug', severity: 'MEDIUM', title: 'NOT-REAL issue', evidence: 'x', rationale: 'r' };
  const res = await verifyFanout({ a: { repoRoot: r, runDir: root, startSha: sha, findings: [finding], groundTruth: ['README.md'] }, prompts, schemas, agent });
  assert.equal(res.results[0].recommendation, 'dropped');
  assert.equal(res.results[0].fix, null);
});

test('worktree setup output is excluded from the diff', async () => {
  const { r, root, sha } = repo();
  const runDir = join(root, 'run2');
  mkdirSync(runDir);
  const finding = { id: 'HS-003', file: 'src/a.js', line: 2, category: 'bug', severity: 'LOW', title: 'x', evidence: 'x', rationale: 'r' };
  const res = await verifyFanout({ a: { repoRoot: r, runDir, startSha: sha, findings: [finding], groundTruth: ['README.md'], worktreeSetup: 'ln -s {repoRoot}/src deps' }, prompts, schemas, agent });
  assert.deepEqual(res.results[0].fix.filesChanged, ['src/a.js']);
  assert.ok(!res.results[0].fix.diff.includes('deps'));
});
