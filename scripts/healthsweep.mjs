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

const GROUND_TRUTH_CANDIDATES = ['PLAN.md', 'SPEC.md', 'README.md', 'CLAUDE.md', 'AGENTS.md', 'docs/'];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else flags._.push(a);
  }
  return { command, flags };
}

const out = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
const err = (msg) => process.stderr.write(`${msg}\n`);
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

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

function cmdPreflight(f) {
  const repoRoot = resolve(git(resolve(f.repo ?? '.'), ['rev-parse', '--show-toplevel']));
  const configPath = resolveConfigPath({ repoRoot, home: homedir(), explicit: f.config });
  if (!configPath) return out({ ok: false, reason: 'no-config' });
  const config = loadConfig(configPath);
  const dirty = git(repoRoot, ['status', '--porcelain']);
  const branch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  if (dirty) {
    return out({ ok: false, reason: 'dirty-tree', repoRoot, branch, dirty: dirty.split('\n') });
  }
  const runDir = join(homedir(), '.claude', 'healthsweep', 'runs', basename(repoRoot), f.stamp ?? stamp());
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
  const label = f.label ?? 'baseline';
  const changed = f.files ? String(f.files).split(',').filter(Boolean) : null;
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
  return out({ ok: true, label, file: join(run.runDir, `checks-${label}.json`), checks: summary });
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

function readTier3(path) {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => fromClaudeSecurity(JSON.parse(l)));
}

function cmdConsolidate(f) {
  const run = loadRun(f.run);
  const raw = [];
  const rejected = [];
  const add = (item) => { try { raw.push(normalizeFinding(item)); } catch (e) { rejected.push({ item, reason: e.message }); } };
  if (f.tier2) (readJson(f.tier2).findings ?? []).forEach(add);
  if (f.tier1) (readJson(f.tier1).findings ?? []).forEach(add);
  if (f.tier3) {
    const p = existsSync(f.tier3) && !f.tier3.endsWith('.jsonl')
      ? join(f.tier3, readdirSync(f.tier3).find((n) => n.endsWith('.jsonl')))
      : f.tier3;
    readTier3(p).forEach(add);
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
  if (!existsSync(logPath)) writeFileSync(logPath, `${LOG_HEADER}\n`);
  appendFileSync(logPath, `\n${md}`);
  return out({ ok: true, logPath });
}

const COMMANDS = { init: cmdInit, preflight: cmdPreflight, checks: cmdChecks, compare: cmdCompare, consolidate: cmdConsolidate, log: cmdLog };

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
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
