// The scan and verify stages for agents without Claude Code workflows: every task runs as a
// fresh headless agent process (see agents.mjs). Same prompts, schemas and rules as the workflows.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dispatch, pool } from './agents.mjs';
import {
  LENS_KEYS, renderPrompt, buildContext, findingVars, verifyLensesFor, isConfirmed, fixVars, reviewVars, recommend,
} from './shared.mjs';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const sh = (cmd, cwd) => execFileSync(cmd, { cwd, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// -z output: "XY path\0" per entry, never quoted; renames add the old path as an extra entry.
function changedFiles(wt) {
  const raw = execFileSync('git', ['-C', wt, 'status', '--porcelain', '-z', '--untracked-files=all'], { encoding: 'utf8' });
  const parts = raw.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const xy = parts[i].slice(0, 2);
    files.push(parts[i].slice(3));
    if (xy.includes('R') || xy.includes('C')) i += 1;
  }
  return files;
}

export async function scanFanout({ a, prompts, schemas, agent, log = () => {} }) {
  const context = buildContext(a);
  const read = (prompt, schema) => dispatch({ command: agent.command, prompt, schema, cwd: a.repoRoot, timeoutSec: agent.timeoutSec });
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

  const results = await pool(cells, agent.concurrency, async (c, i) => {
    const prompt = c.review
      ? renderPrompt(prompts, 'security-review', { context, repoRoot: a.repoRoot, mergeBase: a.inProgress.mergeBase })
      : renderPrompt(prompts, 'finder', { context, moduleName: c.m.name, modulePaths: c.m.paths.join(', '), lens: prompts[`lenses/${c.l}`] });
    const r = await read(prompt, schemas.findings);
    const label = c.review ? 'security-review' : `${c.m.name}:${c.l}`;
    log(`  [${i + 1}/${cells.length}] ${label}: ${r.ok ? `${r.value.findings.length} finding(s)` : `FAILED (${r.errors.join('; ')})`}`);
    if (!r.ok) return null;
    const source = c.review ? 'tier2:security-review' : `tier2:${c.l}`;
    return { module: c.review ? '(in-progress diff)' : c.m.name, lens: c.review ? 'security-review' : c.l, ...r.value, findings: r.value.findings.map((f) => ({ ...f, source })) };
  }, (e, c) => log(`  ${c.review ? 'security-review' : `${c.m.name}:${c.l}`}: ERROR ${e.message}`));
  const ok = results.filter(Boolean);
  return {
    modules,
    findings: ok.flatMap((r) => r.findings),
    coverage: ok.map((r) => ({ module: r.module, lens: r.lens, filesRead: r.filesRead.length, notCovered: r.notCovered || [] })),
    lostFinders: cells.length - ok.length,
  };
}

async function fixInWorktree({ a, f, verdicts, context, prompts, schemas, agent }) {
  if (!agent.writeCommand) return { status: 'setup-failed', diff: '', filesChanged: [], testsBefore: '', testsAfter: '', notes: 'no agent writeCommand configured' };
  const wt = join(a.runDir, 'wt', f.id);
  mkdirSync(join(a.runDir, 'wt'), { recursive: true });
  if (existsSync(wt)) git(a.repoRoot, ['worktree', 'remove', '--force', wt]);
  git(a.repoRoot, ['worktree', 'add', '--detach', wt, a.startSha]);
  try {
    if (a.worktreeSetup) sh(a.worktreeSetup.replace(/\{repoRoot\}/g, a.repoRoot), wt);
    const fromSetup = new Set(changedFiles(wt));
    const r = await dispatch({ command: agent.writeCommand, prompt: renderPrompt(prompts, 'fixer', fixVars(a, f, verdicts, context, true)), schema: schemas.fix, cwd: wt, timeoutSec: agent.timeoutSec });
    if (!r.ok) return { status: 'tests-failed', diff: '', filesChanged: [], testsBefore: '', testsAfter: '', notes: `fixer failed: ${r.errors.join('; ')}` };
    // The diff comes from git, not from the agent's claim, and excludes what setup created.
    const files = changedFiles(wt).filter((p) => !fromSetup.has(p));
    if (files.length) git(wt, ['add', '-N', '--', ...files]);
    const diff = files.length ? git(wt, ['diff', '--', ...files]) : '';
    return { ...r.value, diff, filesChanged: files, agentReportedDiff: r.value.diff !== diff };
  } finally {
    git(a.repoRoot, ['worktree', 'remove', '--force', wt]);
  }
}

export async function verifyFanout({ a, prompts, schemas, agent, log = () => {} }) {
  const context = buildContext(a, ` (at commit ${a.startSha})`);
  const read = (prompt, schema) => dispatch({ command: agent.command, prompt, schema, cwd: a.repoRoot, timeoutSec: agent.timeoutSec });
  const errors = [];
  const results = await pool(a.findings, agent.concurrency, async (f) => {
    const vs = await Promise.all(verifyLensesFor(f).map((lens) =>
      read(renderPrompt(prompts, 'verifier', { ...findingVars(context, f), lens: prompts[`verify-lenses/${lens}`] }), schemas.verdict)));
    const verdicts = vs.filter((v) => v.ok).map((v) => v.value);
    const confirmed = vs.every((v) => v.ok) && isConfirmed(verdicts);
    log(`  ${f.id}: ${confirmed ? 'confirmed' : 'not confirmed'} by ${verdicts.length} verifier(s)`);
    const fix = confirmed ? await fixInWorktree({ a, f, verdicts, context, prompts, schemas, agent }) : null;
    const needsReview = fix && fix.status === 'fixed' && String(fix.diff || '').trim();
    const rv = needsReview ? await read(renderPrompt(prompts, 'reviewer', reviewVars(context, f, fix)), schemas.review) : null;
    const review = rv && rv.ok ? rv.value : null;
    return { finding: f, verdicts, confirmed, fix, review, recommendation: recommend(f, confirmed, fix, review) };
  }, (e, f) => { errors.push({ id: f.id, error: e.message }); log(`  ${f.id}: ERROR ${e.message}`); });
  const clean = results.filter(Boolean);
  const tally = clean.reduce((t, r) => ({ ...t, [r.recommendation]: (t[r.recommendation] || 0) + 1 }), {});
  return { results: clean, tally, lost: a.findings.length - clean.length, errors };
}
