// The scan and verify stages for agents without Claude Code workflows: every task runs as a
// fresh headless agent process (see agents.mjs). Same prompts, schemas and rules as the workflows.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dispatch, pool } from './agents.mjs';
import { runChecks } from './run.mjs';
import { selectScopedChecks } from './glob.mjs';
import { compareRuns } from './compare.mjs';
import {
  LENS_KEYS, renderPrompt, buildContext, findingVars, verifyLensesFor, isConfirmed, fixVars, reviewVars, assess, shq,
} from './shared.mjs';

// Hooks off for every git call we make: a worktree checkout must not run repository hooks.
const GIT_SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=healthsweep', '-c', 'user.email=healthsweep@localhost'];
const gitRaw = (dir, args) => execFileSync('git', ['-C', dir, ...GIT_SAFE, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const git = (dir, args) => gitRaw(dir, args).trim();
const sh = (cmd, cwd) => execFileSync(cmd, { cwd, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ID = /^HS-\d{3,}$/;

function removeWorktree(repoRoot, wt) {
  try { git(repoRoot, ['worktree', 'remove', '--force', wt]); } catch { /* not registered or already gone */ }
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* best effort */ }
  try { git(repoRoot, ['worktree', 'prune']); } catch { /* best effort */ }
}

// Fingerprint of the shared git hooks and config: a fixer must not change either.
function gitControlHash(repoRoot) {
  const common = resolve(repoRoot, git(repoRoot, ['rev-parse', '--git-common-dir']));
  const h = createHash('sha256');
  const hooks = join(common, 'hooks');
  if (existsSync(hooks)) {
    for (const n of readdirSync(hooks).sort()) {
      const p = join(hooks, n);
      if (statSync(p).isFile()) h.update(`${n}\0${readFileSync(p)}\0`);
    }
  }
  const cfg = join(common, 'config');
  if (existsSync(cfg)) h.update(readFileSync(cfg));
  return h.digest('hex');
}

export async function scanFanout({ a, prompts, schemas, agent, log = () => {} }) {
  const context = buildContext(a);
  const read = (prompt, schema) => dispatch({ command: agent.command, prompt, schema, cwd: a.repoRoot, timeoutSec: agent.timeoutSec, envMode: agent.envMode });
  let modules = Array.isArray(a.modules) && a.modules.length ? a.modules : null;
  if (!modules) {
    log('inventory: splitting the scope into modules');
    const inv = await read(renderPrompt(prompts, 'inventory', {
      context, maxModules: a.maxModules || 12,
      scope: (a.scope || []).join(', ') || '(whole repository)', exclude: (a.exclude || []).join(', ') || '(none)',
    }), schemas.inventory);
    if (!inv.ok) throw new Error(`inventory failed: ${inv.errors.join('; ')}`);
    modules = inv.value.modules.slice(0, a.maxModules || 12);
  }
  const lenses = LENS_KEYS.filter((k) => !a.lenses || a.lenses.includes(k));
  const cells = modules.flatMap((m) => lenses.map((l) => ({ m, l })));
  if (a.inProgress?.mergeBase && String(a.inProgress.stat || '').trim()) cells.push({ review: true });
  log(`${modules.length} module(s) x ${lenses.length} lens(es), ${agent.concurrency} agents at a time`);
  const label = (c) => (c.review ? 'security-review' : `${c.m.name}:${c.l}`);

  const results = await pool(cells, agent.concurrency, async (c, i) => {
    const prompt = c.review
      ? renderPrompt(prompts, 'security-review', { context, repoRoot: a.repoRoot, mergeBase: a.inProgress.mergeBase })
      : renderPrompt(prompts, 'finder', { context, moduleName: c.m.name, modulePaths: c.m.paths.join(', '), lens: prompts[`lenses/${c.l}`] });
    const r = await read(prompt, schemas.findings);
    log(`  [${i + 1}/${cells.length}] ${label(c)}: ${r.ok ? `${r.value.findings.length} finding(s)` : `FAILED (${r.errors.join('; ')})`}`);
    if (!r.ok) return null;
    const source = c.review ? 'tier2:security-review' : `tier2:${c.l}`;
    return { module: c.review ? '(in-progress diff)' : c.m.name, lens: c.review ? 'security-review' : c.l, ...r.value, findings: r.value.findings.map((f) => ({ ...f, source })) };
  }, (e, c) => log(`  ${label(c)}: ERROR ${e.message}`));
  const ok = results.filter(Boolean);
  return {
    modules,
    findings: ok.flatMap((r) => r.findings),
    coverage: ok.map((r) => ({ module: r.module, lens: r.lens, filesRead: r.filesRead.length, notCovered: r.notCovered || [] })),
    lostFinders: cells.length - ok.length,
  };
}

// Run the configured checks that cover the changed files inside the worktree, and compare
// them with the baseline. The fixer's own test claims are never the only evidence.
async function mechanicalChecks(a, wt, id, files) {
  const scoped = selectScopedChecks(a.checkConfigs || [], files);
  if (!scoped.length || !a.baseline) return { ran: false, regressed: false, reasons: ['no configured check covers these files'] };
  const outDir = join(a.runDir, 'checks');
  mkdirSync(outDir, { recursive: true });
  const after = await runChecks(scoped, { repoRoot: wt, outDir, label: `fix-${id}` });
  const names = new Set(after.checks.map((c) => c.name));
  const cmp = compareRuns({ checks: a.baseline.checks.filter((c) => names.has(c.name)) }, after, { benchTolerancePct: a.benchTolerancePct ?? 10 });
  return {
    ran: true,
    regressed: cmp.regressed || cmp.missing.length > 0,
    reasons: cmp.checks.flatMap((c) => c.reasons.map((r) => `${c.name}: ${r}`)),
    checks: after.checks.map(({ name, exitCode, passed, failed, timedOut, tail }) => ({ name, exitCode, passed, failed, timedOut, tail: String(tail).slice(-1500) })),
  };
}

const skipped = (status, notes) => ({ status, diff: '', filesChanged: [], testsBefore: '', testsAfter: '', notes });

async function fixInWorktree({ a, f, verdicts, context, prompts, schemas, agent }) {
  if (!a.allowWrite) return skipped('skipped', 'fixer disabled: re-run fanout verify with --allow-write once the user has approved the write command');
  if (!agent.writeCommand) return skipped('setup-failed', 'no agent writeCommand configured');
  if (!ID.test(f.id)) return skipped('setup-failed', `refusing unexpected finding id ${JSON.stringify(f.id)}`);
  const wt = join(a.runDir, 'wt', f.id);
  mkdirSync(join(a.runDir, 'wt'), { recursive: true });
  removeWorktree(a.repoRoot, wt);
  git(a.repoRoot, ['worktree', 'add', '--detach', wt, a.startSha]);
  try {
    if (a.worktreeSetup) sh(a.worktreeSetup.replace(/\{repoRoot\}/g, shq(a.repoRoot)), wt);
    // Snapshot after setup: the patch is everything the fixer changed relative to this commit,
    // whether it left the change unstaged, staged it, committed it or renamed files.
    git(wt, ['add', '-A']);
    git(wt, ['commit', '-q', '--allow-empty', '--no-verify', '-m', 'healthsweep: post-setup snapshot']);
    const snapshot = git(wt, ['rev-parse', 'HEAD']);
    const controlBefore = gitControlHash(a.repoRoot);

    const r = await dispatch({
      command: agent.writeCommand, prompt: renderPrompt(prompts, 'fixer', fixVars(a, f, verdicts, context, true)),
      schema: schemas.fix, cwd: wt, timeoutSec: agent.timeoutSec, envMode: agent.envMode, retries: 0,
    });
    if (gitControlHash(a.repoRoot) !== controlBefore) {
      return skipped('tampered', 'the fixer changed git hooks or git config; the patch was discarded. Inspect .git/hooks and .git/config.');
    }
    if (!r.ok) return skipped('tests-failed', `fixer failed: ${r.errors.join('; ')}`);

    git(wt, ['add', '-A']);
    const diff = gitRaw(wt, ['diff', '--cached', '--binary', snapshot]);
    const filesChanged = git(wt, ['diff', '--cached', '--name-only', '--no-renames', snapshot]).split('\n').filter(Boolean);
    const mechanical = filesChanged.length ? await mechanicalChecks(a, wt, f.id, filesChanged) : { ran: false, regressed: false, reasons: [] };
    return { ...r.value, diff, filesChanged, agentReportedDiff: r.value.diff !== diff, mechanical };
  } finally {
    removeWorktree(a.repoRoot, wt);
  }
}

export async function verifyFanout({ a, prompts, schemas, agent, log = () => {} }) {
  const context = buildContext(a, ` (at commit ${a.startSha})`);
  const read = (prompt, schema) => dispatch({ command: agent.command, prompt, schema, cwd: a.repoRoot, timeoutSec: agent.timeoutSec, envMode: agent.envMode });
  const errors = [];
  // Fixers run one at a time: they share the repository's git metadata (worktree add/remove).
  let fixQueue = Promise.resolve();
  const serialFix = (job) => { const p = fixQueue.then(job, job); fixQueue = p.catch(() => {}); return p; };

  const results = await pool(a.findings, agent.concurrency, async (f) => {
    const vs = await Promise.all(verifyLensesFor(f).map((lens) =>
      read(renderPrompt(prompts, 'verifier', { ...findingVars(context, f), lens: prompts[`verify-lenses/${lens}`] }), schemas.verdict)));
    const verdicts = vs.filter((v) => v.ok).map((v) => v.value);
    const confirmed = vs.every((v) => v.ok) && isConfirmed(verdicts);
    log(`  ${f.id}: ${confirmed ? 'confirmed' : 'not confirmed'} by ${verdicts.length} verifier(s)`);
    const fix = confirmed ? await serialFix(() => fixInWorktree({ a, f, verdicts, context, prompts, schemas, agent })) : null;
    const needsReview = fix && fix.status === 'fixed' && String(fix.diff || '').trim();
    const rv = needsReview ? await read(renderPrompt(prompts, 'reviewer', reviewVars(context, f, fix)), schemas.review) : null;
    const review = rv && rv.ok ? rv.value : null;
    const { recommendation, reasons } = assess(f, confirmed, fix, review);
    return { finding: f, verdicts, confirmed, fix, review, recommendation, reasons };
  }, (e, f) => { errors.push({ id: f.id, error: e.message }); log(`  ${f.id}: ERROR ${e.message}`); });
  const clean = results.filter(Boolean);
  const tally = clean.reduce((t, r) => ({ ...t, [r.recommendation]: (t[r.recommendation] || 0) + 1 }), {});
  return { results: clean, tally, lost: a.findings.length - clean.length, errors };
}
