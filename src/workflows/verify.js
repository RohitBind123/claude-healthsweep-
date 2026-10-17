export const meta = {
  name: 'verify',
  description: 'healthsweep: independently re-derive each finding, draft a fix in a private worktree with scoped tests, and check the fix against the ground truth. Applies nothing.',
  whenToUse: 'Started by the /healthsweep skill after the cost gate with args {repoRoot, runDir, startSha, findings, groundTruth, activeWork, checks, benchChecks, worktreeSetup, notes}. A bare invocation does nothing: run /healthsweep instead.',
  phases: [
    { title: 'Verify', detail: 'fresh-context skeptics re-derive the evidence; HIGH and CRITICAL get two lenses' },
    { title: 'Fix', detail: 'one fixer per confirmed finding, in its own git worktree, test first' },
    { title: 'Review', detail: 'a third agent checks each patch against the ground truth and active work' },
  ],
}

const PROMPTS = /*@PROMPTS*/ null
const SCHEMAS = /*@SCHEMAS*/ null
/*@SHARED*/
const render = (name, vars) => renderPrompt(PROMPTS, name, vars)

const a = typeof args === 'string' ? (() => { try { return JSON.parse(args) } catch { return null } })() : args
if (!a || !a.repoRoot || !a.runDir || !a.startSha || !Array.isArray(a.findings)) {
  log('verify was started without settings; run /healthsweep instead')
  return { started: false, reason: 'no-args', next: 'Tell the user to run /healthsweep; do not improvise.' }
}
const badFindings = a.findings.filter(f => !validFinding(f))
if (badFindings.length) log(`ignored ${badFindings.length} malformed finding(s): ${badFindings.map(f => JSON.stringify(f && f.id)).join(', ')}`)
a.findings = a.findings.filter(validFinding)
if (!a.findings.length) return { started: true, results: [], outputTokens: 0 }

const context = buildContext(a, ` (at commit ${a.startSha})`)
const startSpent = budget.spent()

const results = await pipeline(
  a.findings,
  async (f) => {
    const verdicts = (await parallel(verifyLensesFor(f).map(lens => () =>
      agent(render('verifier', { ...findingVars(context, f), lens: PROMPTS[`verify-lenses/${lens}`] }),
        { label: `verify:${f.id}:${lens}`, phase: 'Verify', schema: SCHEMAS.verdict })))).filter(Boolean)
    return { finding: f, verdicts, confirmed: isConfirmed(verdicts) }
  },
  async (v) => {
    if (!v.confirmed) return { ...v, fix: null }
    const fix = await agent(render('fixer', fixVars(a, v.finding, v.verdicts, context)), { label: `fix:${v.finding.id}`, phase: 'Fix', schema: SCHEMAS.fix })
    return { ...v, fix }
  },
  async (v) => {
    const needsReview = v.fix && v.fix.status === 'fixed' && String(v.fix.diff || '').trim()
    const review = needsReview
      ? await agent(render('reviewer', reviewVars(context, v.finding, v.fix)), { label: `review:${v.finding.id}`, phase: 'Review', schema: SCHEMAS.review })
      : null
    const { recommendation, reasons } = assess(v.finding, v.confirmed, v.fix, review)
    return { ...v, review, recommendation, reasons }
  },
)

const clean = results.filter(Boolean)
const tally = clean.reduce((t, r) => ({ ...t, [r.recommendation]: (t[r.recommendation] || 0) + 1 }), {})
log(`verify done: ${JSON.stringify(tally)}`)
return {
  started: true,
  results: clean,
  tally,
  lost: a.findings.length - clean.length,
  outputTokens: budget.spent() - startSpent,
  next: `Save this result to ${a.runDir}/verify.json, then continue the /healthsweep skill at the approval step. Nothing has been applied.`,
}
