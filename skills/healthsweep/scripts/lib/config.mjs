// Load, validate and auto-detect the healthsweep config for a repository.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SEVERITIES } from './consolidate.mjs';

export const CHECK_KINDS = ['test', 'lint', 'build', 'bench'];
const MAX_TIMEOUT_SEC = 3600;

function fail(msg) {
  throw new Error(`invalid healthsweep config: ${msg}`);
}

function validateCheck(c, i) {
  if (!c || typeof c !== 'object') fail(`checks[${i}] is not an object`);
  if (!c.name) fail(`checks[${i}] has no name`);
  if (!c.cmd || typeof c.cmd !== 'string') fail(`check "${c.name}" has no cmd`);
  if (!CHECK_KINDS.includes(c.kind)) fail(`check "${c.name}" has unknown kind "${c.kind}" (use ${CHECK_KINDS.join('|')})`);
  const timeoutSec = c.timeoutSec ?? 900;
  if (!Number.isInteger(timeoutSec) || timeoutSec <= 0 || timeoutSec > MAX_TIMEOUT_SEC) {
    fail(`check "${c.name}" timeoutSec must be 1-${MAX_TIMEOUT_SEC}`);
  }
  if (c.kind === 'bench' && c.metricRegex) {
    try { new RegExp(c.metricRegex); } catch { fail(`check "${c.name}" metricRegex does not compile`); }
  }
  return {
    name: String(c.name), kind: c.kind, cmd: c.cmd, cwd: c.cwd ?? '.', timeoutSec,
    scope: Array.isArray(c.scope) ? c.scope : [], env: c.env ?? {}, metricRegex: c.metricRegex ?? null,
  };
}

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') fail('config is not an object');
  if (!Array.isArray(raw.groundTruth) || raw.groundTruth.length === 0) {
    fail('groundTruth must list at least one document that states intended behaviour');
  }
  if (!Array.isArray(raw.checks) || raw.checks.length === 0) fail('checks must list at least one command');
  const checks = raw.checks.map(validateCheck);
  const names = checks.map((c) => c.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) fail(`duplicate check name "${dup}"`);
  const threshold = String(raw.costGate?.threshold ?? 'MEDIUM').toUpperCase();
  if (!SEVERITIES.includes(threshold)) fail(`costGate.threshold must be one of ${SEVERITIES.join('|')}`);
  return {
    groundTruth: raw.groundTruth,
    activeWork: Array.isArray(raw.activeWork) ? raw.activeWork : [],
    scope: Array.isArray(raw.scope) ? raw.scope : [],
    exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
    checks,
    costGate: { threshold, maxTokens: raw.costGate?.maxTokens ?? null },
    benchTolerancePct: raw.benchTolerancePct ?? 10,
    tier3: { enabled: raw.tier3?.enabled ?? true, effort: raw.tier3?.effort ?? 'medium' },
    notes: raw.notes ?? '',
    agent: raw.agent && typeof raw.agent === 'object' ? raw.agent : null,
    modules: Array.isArray(raw.modules) ? raw.modules : null,
    worktreeSetup: typeof raw.worktreeSetup === 'string' && raw.worktreeSetup.trim() ? raw.worktreeSetup : null,
  };
}

export function resolveConfigPath({ repoRoot, home, explicit }) {
  if (explicit) return explicit;
  const inRepo = join(repoRoot, '.healthsweep.json');
  if (existsSync(inRepo)) return inRepo;
  const inHome = join(home, '.claude', 'healthsweep', `${basename(repoRoot)}.json`);
  if (existsSync(inHome)) return inHome;
  return null;
}

export function loadConfig(path) {
  return validateConfig(JSON.parse(readFileSync(path, 'utf8')));
}

const NPM_PLACEHOLDER = /no test specified/;

export function detectChecks(root) {
  const found = [];
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
    if (scripts.test && !NPM_PLACEHOLDER.test(scripts.test)) found.push({ name: 'npm-test', kind: 'test', cmd: 'npm test' });
    if (scripts.lint) found.push({ name: 'npm-lint', kind: 'lint', cmd: 'npm run lint' });
    if (scripts.typecheck) found.push({ name: 'npm-typecheck', kind: 'lint', cmd: 'npm run typecheck' });
    if (scripts.build) found.push({ name: 'npm-build', kind: 'build', cmd: 'npm run build' });
    if (scripts.bench) found.push({ name: 'npm-bench', kind: 'bench', cmd: 'npm run bench' });
  }
  if (existsSync(join(root, 'go.mod'))) found.push({ name: 'go-test', kind: 'test', cmd: 'go test ./...' });
  if (existsSync(join(root, 'Cargo.toml'))) found.push({ name: 'cargo-test', kind: 'test', cmd: 'cargo test' });
  const py = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini'].some((f) => existsSync(join(root, f)));
  if (py) found.push({ name: 'pytest', kind: 'test', cmd: 'pytest -q' });
  return found;
}
