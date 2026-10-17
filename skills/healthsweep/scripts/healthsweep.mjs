#!/usr/bin/env node
// healthsweep CLI: the deterministic half of /healthsweep.
// Every command prints one JSON object on stdout; progress goes to stderr.
// Usage: node healthsweep.mjs <command> [--flag value ...]

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { loadConfig, resolveConfigPath, detectChecks } from './lib/config.mjs';
import { runChecks } from './lib/run.mjs';
import { selectScopedChecks } from './lib/glob.mjs';
import { compareRuns } from './lib/compare.mjs';
import { consolidate, countBySeverity, fromClaudeSecurity, normalizeFinding } from './lib/consolidate.mjs';
import { aboveThreshold, estimateReviewCost, DEFAULT_COST_MODEL } from './lib/cost.mjs';
import { renderLogEntry, LOG_HEADER } from './lib/logentry.mjs';
import { renderReport } from './lib/report.mjs';
import { isSafeRelPath } from './lib/md.mjs';
import { closeSync, constants as FS, fchmodSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { loadPrompts, loadSchemas } from './lib/prompts.mjs';
import { renderPrompt } from './lib/shared.mjs';
import { AGENT_PRESETS, resolveAgent } from './lib/agents.mjs';
import { scanFanout, verifyFanout } from './lib/fanout.mjs';
import { commandSurface, fingerprint, isTrusted, trust } from './lib/trust.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const GROUND_TRUTH_CANDIDATES = ['PLAN.md', 'SPEC.md', 'README.md', 'CLAUDE.md', 'AGENTS.md', 'docs/'];

// Flags that always take a value; --flag=value and a bare -- (end of options) are supported.
const STRING_FLAGS = ['repo', 'config', 'run', 'label', 'files', 'ids', 'entry', 'tier1', 'tier2', 'tier3', 'threshold', 'stamp', 'base', 'modules', 'vars', 'schema', 'before', 'after', 'concurrency', 'tier3-reason', 'tier2-total'];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--') { flags._.push(...rest.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else flags._.push(a);
  }
  for (const k of STRING_FLAGS) if (flags[k] === true) throw new Error(`--${k} needs a value`);
  return { command, flags };
}

const out = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
const err = (msg) => process.stderr.write(`${msg}\n`);
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
function safeName(kind, v) {
  if (!NAME.test(String(v))) throw new Error(`invalid ${kind} ${JSON.stringify(v)} (letters, digits, . _ - only)`);
  return String(v);
}

function splitList(v) {
  if (v === undefined || v === true) return null;
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

// Files changed in the working tree (porcelain -z, untracked included).
function dirtyPaths(repo) {
  const raw = execFileSync('git', ['-C', repo, 'status', '--porcelain', '-z', '--untracked-files=all'], { encoding: 'utf8' });
  const parts = raw.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    files.push(parts[i].slice(3));
    if (/[RC]/.test(parts[i].slice(0, 2))) i += 1;
  }
  return files;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function loadRun(runDir) {
  const p = join(runDir, 'run.json');
  if (!existsSync(p)) throw new Error(`no run.json in ${runDir}; run "preflight" first`);
  return readJson(p);
}

function cmdInit(f) {
  const repoRoot = resolve(f.repo ?? '.');
  const configPath = resolveConfigPath({ repoRoot, home: homedir(), explicit: f.config });
  if (configPath && existsSync(configPath)) {
    const config = loadConfig(configPath);
    const missing = [...config.groundTruth, ...config.activeWork].filter((g) => !existsSync(resolve(repoRoot, g)));
    return out({ ok: missing.length === 0, configPath, config, missingGroundTruth: missing });
  }
  const candidates = GROUND_TRUTH_CANDIDATES.filter((g) => existsSync(join(repoRoot, g)));
  return out({
    ok: false, configPath: null, reason: 'no-config',
    suggestedConfigPath: join(homedir(), '.claude', 'healthsweep', `${basename(repoRoot)}.json`),
    detectedChecks: detectChecks(repoRoot), groundTruthCandidates: candidates,
  });
}

function untrusted(repoRoot, configPath, config) {
  return {
    ok: false, reason: 'untrusted-config', repoRoot, configPath, fingerprint: fingerprint(config),
    commands: commandSurface(config),
    next: 'Show the user every command above verbatim. Only if they approve, run: trust --repo <repo> [--config <file>].',
  };
}

function requireTrusted(run) {
  if (!isTrusted({ home: homedir(), repoRoot: run.repoRoot, config: run.config })) {
    throw new Error('this run\'s config is not trusted (or changed since it was trusted); run preflight again');
  }
}

// Record the user's approval of exactly these commands for this repository.
function cmdTrust(f) {
  const repoRoot = resolve(git(resolve(f.repo ?? '.'), ['rev-parse', '--show-toplevel']));
  const configPath = resolveConfigPath({ repoRoot, home: homedir(), explicit: f.config });
  if (!configPath) return out({ ok: false, reason: 'no-config' });
  const config = loadConfig(configPath);
  const file = trust({ home: homedir(), repoRoot, config });
  return out({ ok: true, trusted: file, fingerprint: fingerprint(config), commands: commandSurface(config) });
}

function cmdPreflight(f) {
  const repoRoot = resolve(git(resolve(f.repo ?? '.'), ['rev-parse', '--show-toplevel']));
  const configPath = resolveConfigPath({ repoRoot, home: homedir(), explicit: f.config });
  if (!configPath) return out({ ok: false, reason: 'no-config' });
  const config = loadConfig(configPath);
  if (!isTrusted({ home: homedir(), repoRoot, config })) return out(untrusted(repoRoot, configPath, config));
  const dirty = git(repoRoot, ['status', '--porcelain']);
  const branch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  if (dirty) {
    return out({ ok: false, reason: 'dirty-tree', repoRoot, branch, dirty: dirty.split('\n') });
  }
  const runDir = join(homedir(), '.claude', 'healthsweep', 'runs', basename(repoRoot), f.stamp ? safeName('stamp', f.stamp) : stamp());
  mkdirSync(runDir, { recursive: true });
  const base = f.base ?? null;
  let inProgress = null;
  if (base) {
    const mergeBase = git(repoRoot, ['merge-base', base, 'HEAD']);
    inProgress = { base, mergeBase, stat: git(repoRoot, ['diff', '--stat', `${mergeBase}..HEAD`]) };
  }
  const run = { repoRoot, configPath, config, branch, startSha: head, runDir, inProgress, createdAt: new Date().toISOString() };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2));
  return out({ ok: true, ...run });
}

async function cmdChecks(f) {
  const run = loadRun(f.run);
  requireTrusted(run);
  const label = safeName('label', f.label ?? 'baseline');
  const changed = splitList(f.files);
  const badPath = (changed ?? []).find((p) => !isSafeRelPath(p));
  if (badPath) throw new Error(`--files path must be repository-relative: ${badPath}`);
  if (f.files === true) throw new Error('--files needs a comma-separated list');
  const dirtyBefore = new Set(dirtyPaths(run.repoRoot));
  const checks = changed
    ? selectScopedChecks(run.config.checks, changed, { includeBench: Boolean(f['include-bench']) })
    : run.config.checks.filter((c) => c.kind !== 'bench' || f['include-bench']);
  const outDir = join(run.runDir, 'checks');
  mkdirSync(outDir, { recursive: true });
  err(`healthsweep: running ${checks.length} check(s) [${label}] one at a time`);
  const res = await runChecks(checks, {
    repoRoot: run.repoRoot, outDir, label,
    onStart: (c) => err(`  > ${c.name}: ${c.cmd}`),
    onDone: (r) => err(`  < ${r.name}: exit=${r.exitCode}${r.timedOut ? ' TIMEOUT' : ''} passed=${r.passed ?? '?'} failed=${r.failed ?? '?'} (${Math.round(r.durationMs / 1000)}s)`),
  });
  const result = { label, scopedTo: changed, sha: git(run.repoRoot, ['rev-parse', 'HEAD']), ...res };
  writeFileSync(join(run.runDir, `checks-${label}.json`), JSON.stringify(result, null, 2));
  const summary = res.checks.map(({ tail, logFile, ...c }) => c);
  // A check that writes into the repository (snapshots, build output) would mix with a fix.
  const dirtiedByChecks = dirtyPaths(run.repoRoot).filter((p) => !dirtyBefore.has(p));
  return out({ ok: true, label, file: join(run.runDir, `checks-${label}.json`), checks: summary, dirtiedByChecks });
}

function cmdCompare(f) {
  const run = loadRun(f.run);
  const before = readJson(join(run.runDir, `checks-${f.before ?? 'baseline'}.json`));
  const after = readJson(join(run.runDir, `checks-${f.after}.json`));
  const names = new Set(after.checks.map((c) => c.name));
  const scopedBefore = { checks: before.checks.filter((c) => names.has(c.name)) };
  const res = compareRuns(scopedBefore, after, { benchTolerancePct: run.config.benchTolerancePct });
  return out({ ok: !res.regressed, ...res });
}

function cmdConsolidate(f) {
  const run = loadRun(f.run);
  const raw = [];
  const rejected = [];
  const add = (item) => { try { raw.push(normalizeFinding(item)); } catch (e) { rejected.push({ item, reason: e.message }); } };
  if (f.tier2) (readJson(f.tier2).findings ?? []).forEach(add);
  if (f.tier1) (readJson(f.tier1).findings ?? []).forEach(add);
  if (f.tier3) {
    let p = f.tier3;
    if (existsSync(p) && !p.endsWith('.jsonl')) {
      const name = readdirSync(p).find((n) => n.endsWith('.jsonl'));
      if (!name) throw new Error(`no .jsonl results file in ${p}`);
      p = join(p, name);
    }
    readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).forEach((line) => {
      try { raw.push(fromClaudeSecurity(JSON.parse(line))); } catch (e) { rejected.push({ item: line.slice(0, 200), reason: e.message }); }
    });
  }
  const findings = consolidate(raw);
  const threshold = f.threshold ?? run.config.costGate.threshold;
  const gated = aboveThreshold(findings, threshold);
  const result = {
    counts: countBySeverity(findings), threshold,
    estimateAboveThreshold: estimateReviewCost(gated, DEFAULT_COST_MODEL),
    estimateAll: estimateReviewCost(findings, DEFAULT_COST_MODEL),
    rejected, findings,
  };
  writeFileSync(join(run.runDir, 'findings.json'), JSON.stringify(result, null, 2));
  const { findings: _, ...summary } = result;
  return out({ ok: true, file: join(run.runDir, 'findings.json'), ...summary });
}

function cmdLog(f) {
  const run = loadRun(f.run);
  const entry = readJson(f.entry);
  const md = renderLogEntry({ date: new Date().toISOString().slice(0, 10), ...entry });
  const logPath = join(run.repoRoot, 'HEALTHSWEEP_LOG.md');
  // Never follow a symlink: a repository could point the log at a shell rc or an authorized_keys file.
  let exists = false;
  try {
    const st = lstatSync(logPath);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error('HEALTHSWEEP_LOG.md is a symlink or not a regular file; refusing to write');
    exists = true;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (realpathSync(run.repoRoot) !== realpathSync(join(logPath, '..'))) throw new Error('log path escapes the repository');
  const fd = openSync(logPath, FS.O_WRONLY | FS.O_APPEND | FS.O_CREAT | FS.O_NOFOLLOW, 0o644);
  try {
    if (!exists) { fchmodSync(fd, 0o644); writeSync(fd, `${LOG_HEADER}\n`); } // a normal repo file despite the private umask
    writeSync(fd, `\n${md}`);
  } finally { closeSync(fd); }
  return out({ ok: true, logPath });
}

function cmdReport(f) {
  const run = loadRun(f.run);
  const opt = (name) => (existsSync(join(run.runDir, name)) ? readJson(join(run.runDir, name)) : null);
  const tier2 = opt('tier2.json');
  const verify = opt('verify.json');
  const md = renderReport({
    run,
    baseline: readJson(join(run.runDir, 'checks-baseline.json')),
    findingsDoc: readJson(join(run.runDir, 'findings.json')),
    verify,
    tier3: f.tier3 ? { ran: true } : { ran: false, reason: f['tier3-reason'] ?? 'not run' },
    tokens: { tier2Output: tier2?.outputTokens ?? null, tier2Total: f['tier2-total'] ? Number(f['tier2-total']) : null, verifyOutput: verify?.outputTokens ?? null },
    mode: verify ? 'verify' : 'report-only',
    date: new Date().toISOString().slice(0, 10),
  });
  const path = join(run.runDir, 'REPORT.md');
  writeFileSync(path, md);
  return out({ ok: true, report: path });
}

// Render a role prompt for any agent: node healthsweep.mjs prompt verifier --vars vars.json
function cmdPrompt(f) {
  const prompts = loadPrompts(join(SKILL_DIR, 'prompts'));
  const name = f._[0];
  if (!name || f.list) return out({ ok: true, prompts: Object.keys(prompts).filter((n) => !n.startsWith('_')) });
  const vars = f.vars ? readJson(f.vars) : {};
  const text = renderPrompt(prompts, name, vars);
  const schemaName = f.schema;
  const schema = schemaName ? loadSchemas(join(SKILL_DIR, 'schemas'))[schemaName] : null;
  process.stdout.write(schema ? `${text}\n\nReturn ONLY one JSON object matching this JSON schema:\n${JSON.stringify(schema)}\n` : `${text}\n`);
}

function hasBin(bin) {
  try { execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }); return true; } catch { return false; }
}

function cmdAgents() {
  return out({
    ok: true,
    presets: Object.fromEntries(Object.entries(AGENT_PRESETS).map(([k, p]) => [k, { installed: hasBin(p.bin), command: p.command, writeCommand: p.writeCommand }])),
  });
}

// Scan or verify through any headless coding agent (one fresh process per task).
async function cmdFanout(f) {
  const run = loadRun(f.run);
  requireTrusted(run);
  const stage = f._[0];
  // The agent comes only from the trusted config: a command-line override would bypass trust.
  const agent = resolveAgent(run.config.agent);
  if (f.concurrency) agent.concurrency = Number(f.concurrency);
  const prompts = loadPrompts(join(SKILL_DIR, 'prompts'));
  const schemas = loadSchemas(join(SKILL_DIR, 'schemas'));
  const base = { repoRoot: run.repoRoot, runDir: run.runDir, groundTruth: run.config.groundTruth, activeWork: run.config.activeWork, notes: run.config.notes };
  if (stage === 'scan') {
    const modules = f.modules ? readJson(f.modules) : run.config.modules;
    const res = await scanFanout({ a: { ...base, scope: run.config.scope, exclude: run.config.exclude, inProgress: run.inProgress, modules }, prompts, schemas, agent, log: err });
    writeFileSync(join(run.runDir, 'tier2.json'), JSON.stringify(res, null, 2));
    return out({ ok: true, stage, file: join(run.runDir, 'tier2.json'), findings: res.findings.length, lostFinders: res.lostFinders, modules: res.modules.length });
  }
  if (stage === 'verify') {
    const doc = readJson(join(run.runDir, 'findings.json'));
    const ids = splitList(f.ids);
    const badId = (ids ?? []).find((id) => !/^HS-\d{3,}$/.test(id));
    if (badId) throw new Error(`invalid finding id ${JSON.stringify(badId)}`);
    const unknown = (ids ?? []).filter((id) => !doc.findings.some((x) => x.id === id));
    if (unknown.length) throw new Error(`unknown finding id(s): ${unknown.join(', ')}`);
    const findings = ids ? doc.findings.filter((x) => ids.includes(x.id)) : aboveThreshold(doc.findings, f.threshold ?? run.config.costGate.threshold);
    const checks = run.config.checks.filter((c) => c.kind !== 'bench').map(({ name, cmd, cwd, timeoutSec }) => ({ name, cmd, cwd, timeoutSec }));
    const benchChecks = run.config.checks.filter((c) => c.kind === 'bench').map(({ name, cmd, cwd, timeoutSec }) => ({ name, cmd, cwd, timeoutSec }));
    const baselinePath = join(run.runDir, 'checks-baseline.json');
    const res = await verifyFanout({
      a: {
        ...base, startSha: run.startSha, findings, checks, benchChecks, worktreeSetup: run.config.worktreeSetup,
        allowWrite: Boolean(f['allow-write']),
        checkConfigs: run.config.checks.filter((c) => c.kind !== 'bench'),
        baseline: existsSync(baselinePath) ? readJson(baselinePath) : null,
        benchTolerancePct: run.config.benchTolerancePct,
      },
      prompts, schemas, agent, log: err,
    });
    writeFileSync(join(run.runDir, 'verify.json'), JSON.stringify(res, null, 2));
    return out({ ok: true, stage, file: join(run.runDir, 'verify.json'), verified: res.results.length, tally: res.tally, errors: res.errors, fixerRan: Boolean(f['allow-write']) });
  }
  throw new Error('usage: fanout <scan|verify> --run <dir> [--preset name] [--modules file] [--ids a,b | --threshold T]');
}

const COMMANDS = { init: cmdInit, preflight: cmdPreflight, checks: cmdChecks, compare: cmdCompare, consolidate: cmdConsolidate, log: cmdLog, report: cmdReport, prompt: cmdPrompt, agents: cmdAgents, fanout: cmdFanout, trust: cmdTrust };

async function main() {
  process.umask(0o077); // run artefacts (logs, findings, prompts) are private to the user
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (e) { out({ ok: false, error: e.message }); process.exit(1); }
  const { command, flags } = parsed;
  const fn = COMMANDS[command];
  if (!fn) {
    err(`usage: healthsweep.mjs <${Object.keys(COMMANDS).join('|')}> [--flags]`);
    process.exit(64);
  }
  try {
    await fn(flags);
  } catch (e) {
    out({ ok: false, error: e.message });
    process.exit(1);
  }
}

main();
