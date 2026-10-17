export const meta = {
  name: 'scan',
  description: 'healthsweep Tier 2: security review of in-progress changes plus per-module finders for bugs, races, latency and maintainability',
  whenToUse: 'Started by the /healthsweep skill with args {repoRoot, runDir, scope, exclude, groundTruth, activeWork, inProgress, modules?, notes}. A bare invocation does nothing: run /healthsweep instead.',
  phases: [
    { title: 'Inventory', detail: 'split the scope into modules (skipped when the skill passes modules)' },
    { title: 'Find', detail: 'one finder per module x lens, plus a security review of the in-progress diff' },
  ],
}

const PROMPTS = /*@PROMPTS*/ null
const SCHEMAS = /*@SCHEMAS*/ null
/*@SHARED*/
const render = (name, vars) => renderPrompt(PROMPTS, name, vars)

const a = typeof args === 'string' ? (() => { try { return JSON.parse(args) } catch { return null } })() : args
if (!a || !a.repoRoot || !a.runDir) {
  log('scan was started without settings; run /healthsweep instead')
  return { started: false, reason: 'no-args', next: 'Tell the user to run /healthsweep; do not improvise a scan.' }
}

const MAX_MODULES = a.maxModules || 12
const context = buildContext(a)
const startSpent = budget.spent()

phase('Inventory')
let modules = Array.isArray(a.modules) && a.modules.length ? a.modules : null
if (!modules) {
  const inv = await agent(render('inventory', {
    context, maxModules: MAX_MODULES,
    scope: (a.scope || []).join(', ') || '(whole repository)',
    exclude: (a.exclude || []).join(', ') || '(none)',
  }), { label: 'inventory', phase: 'Inventory', schema: SCHEMAS.inventory })
  if (!inv || !inv.modules.length) return { started: true, error: 'inventory returned no modules', findings: [] }
  modules = inv.modules.slice(0, MAX_MODULES)
  if (inv.modules.length > MAX_MODULES) log(`inventory returned ${inv.modules.length} modules; kept the first ${MAX_MODULES}, dropped: ${inv.modules.slice(MAX_MODULES).map(m => m.name).join(', ')}`)
  if (inv.skipped.length) log(`skipped: ${inv.skipped.map(s => `${s.path} (${s.reason})`).join('; ')}`)
}
const lenses = LENS_KEYS.filter(k => !a.lenses || a.lenses.includes(k))
log(`${modules.length} module(s) x ${lenses.length} lens(es)`)

phase('Find')
const tag = (r, module, lens, source) => r && { module, lens, ...r, findings: r.findings.map(f => ({ ...f, source })) }
const tasks = modules.flatMap(m => lenses.map(l => () =>
  agent(render('finder', { context, moduleName: m.name, modulePaths: m.paths.join(', '), lens: PROMPTS[`lenses/${l}`] }),
    { label: `find:${m.name}:${l}`, phase: 'Find', schema: SCHEMAS.findings })
    .then(r => tag(r, m.name, l, `tier2:${l}`))))

if (a.inProgress && a.inProgress.mergeBase && String(a.inProgress.stat || '').trim()) {
  tasks.push(() => agent(render('security-review', { context, repoRoot: a.repoRoot, mergeBase: a.inProgress.mergeBase }),
    { label: 'security-review:diff', phase: 'Find', schema: SCHEMAS.findings })
    .then(r => tag(r, '(in-progress diff)', 'security-review', 'tier2:security-review')))
}

const results = (await parallel(tasks)).filter(Boolean)
const lost = tasks.length - results.length
if (lost) log(`${lost} finder(s) returned nothing (skipped or failed); their cells are not covered`)

const findings = results.flatMap(r => r.findings)
const coverage = results.map(r => ({ module: r.module, lens: r.lens, filesRead: r.filesRead.length, notCovered: r.notCovered || [] }))
log(`${findings.length} raw finding(s) from ${results.length} finder(s)`)
return {
  started: true,
  modules,
  findings,
  coverage,
  lostFinders: lost,
  outputTokens: budget.spent() - startSpent,
  next: `Save this result's findings to ${a.runDir}/tier2.json as {"findings": [...]} and continue the /healthsweep skill at the consolidation step.`,
}
