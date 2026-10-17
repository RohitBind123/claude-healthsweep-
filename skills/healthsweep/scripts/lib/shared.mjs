// Pure pipeline rules shared by the CLI fan-out (any agent) and the Claude Code workflows.
// No imports: scripts/build-workflows.mjs inlines this file into workflows/*.js.

export const LENS_KEYS = ['logic', 'consistency', 'latency', 'maintainability'];

// {{>name}} includes another prompt; {{var}} substitutes a value. Partials expand first,
// then variables in one pass, so braces inside substituted code are never re-expanded.
export function renderPrompt(prompts, name, vars) {
  const expand = (text, depth) => {
    if (depth > 5) throw new Error('prompt partials nested too deep');
    return text.replace(/\{\{>\s*([\w/-]+)\s*\}\}/g, (_, p) => {
      if (!(p in prompts)) throw new Error(`unknown partial ${p}`);
      return expand(prompts[p], depth + 1);
    });
  };
  if (!(name in prompts)) throw new Error(`unknown prompt ${name}`);
  return expand(prompts[name], 0).replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, v) => {
    if (vars[v] === undefined || vars[v] === null) throw new Error(`prompt ${name} needs variable ${v}`);
    return String(vars[v]);
  });
}

export function buildContext(a, extra) {
  return [
    `Repository root: ${a.repoRoot}${extra || ''}`,
    `Ground truth for intended behaviour (read what is relevant before judging): ${(a.groundTruth || []).join(', ')}`,
    (a.activeWork || []).length ? `Work currently in progress (do not report deliberate, documented in-progress behaviour as a bug; DO report bugs inside it): ${a.activeWork.join(', ')}` : '',
    a.notes ? `Project notes: ${a.notes}` : '',
  ].filter(Boolean).join('\n');
}

export function findingVars(context, f) {
  return { context, id: f.id, severity: f.severity, category: f.category, title: f.title, file: f.file, line: f.line, evidence: f.evidence, rationale: f.rationale || '(none)' };
}

// Cost proportional to risk: HIGH and CRITICAL get two independent lenses, the rest one.
export function verifyLensesFor(f) {
  const second = f.category === 'latency' ? 'latency' : 'reproduce';
  if (f.severity === 'CRITICAL' || f.severity === 'HIGH') return ['correctness', second];
  return [f.category === 'latency' ? 'latency' : 'correctness'];
}

export function isConfirmed(verdicts) {
  return verdicts.length > 0 && verdicts.every((v) => v.real === true);
}

// worktreeReady: the caller (the CLI fan-out) already created the worktree and ran setup,
// so the agent only works inside it. Workflow agents create and remove it themselves.
export function fixVars(a, f, verdicts, context, worktreeReady = false) {
  const worktree = `${a.runDir}/wt/${f.id}`;
  const setup = a.worktreeSetup ? a.worktreeSetup.replace(/\{repoRoot\}/g, a.repoRoot) : '';
  const benchStep = f.category !== 'latency' ? '' : (a.benchChecks && a.benchChecks.length
    ? `7. Run the benchmark before and after: ${JSON.stringify(a.benchChecks)}. Report the real numbers.`
    : '7. There is no benchmark. Do not claim any speed-up; say "unmeasured" in notes.');
  return {
    ...findingVars(context, f),
    repoRoot: a.repoRoot,
    worktree,
    startSha: a.startSha,
    setupSteps: worktreeReady
      ? `1-2. The worktree is ready at ${worktree} (at commit ${a.startSha}, setup done). Work only inside it; it is your current directory.`
      : `1. git -C ${a.repoRoot} worktree add --detach ${worktree} ${a.startSha}\n2. cd ${worktree}${setup ? ` && ${setup}` : ''}`,
    cleanupStep: worktreeReady
      ? '9. Leave the worktree in place; the caller removes it.'
      : `9. Remove the worktree: git -C ${a.repoRoot} worktree remove --force ${worktree}`,
    checks: JSON.stringify(a.checks || []),
    benchStep,
    verification: verdicts.map((v) => `- ${v.reasoning}${v.reproduction ? `\n  reproduction: ${v.reproduction}` : ''}`).join('\n'),
  };
}

export function reviewVars(context, f, fix) {
  return { ...findingVars(context, f), diff: fix.diff, testsBefore: String(fix.testsBefore).slice(-1500), testsAfter: String(fix.testsAfter).slice(-1500), notes: fix.notes || '' };
}

// The recommendation never upgrades past what the evidence supports.
export function recommend(finding, confirmed, fix, review) {
  if (!confirmed) return 'dropped';
  if (!fix || fix.status !== 'fixed' || !String(fix.diff || '').trim()) return 'manual-review';
  let r = review ? review.verdict : 'manual-review';
  if (review && review.behaviourChange && r === 'propose') r = 'manual-review';
  if (finding.category === 'latency' && !(fix.benchBefore && fix.benchAfter) && r === 'propose') r = 'manual-review';
  return r;
}
