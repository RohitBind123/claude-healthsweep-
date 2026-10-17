// Render REPORT.md for a run. Deterministic: every number comes from the run files.

import { SEVERITIES, CATEGORIES } from './consolidate.mjs';
import { mdInline, mdCode } from './md.mjs';
import { redactSecrets } from './redact.mjs';

const dash = (v) => (v === null || v === undefined ? '—' : String(v));
const NEAR_LINES = 20;

export function nearDuplicates(findings) {
  const groups = [];
  const used = new Set();
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (let i = 0; i < sorted.length; i += 1) {
    if (used.has(sorted[i].id)) continue;
    const g = [sorted[i]];
    for (let j = i + 1; j < sorted.length && sorted[j].file === sorted[i].file; j += 1) {
      if (sorted[j].line - g[g.length - 1].line <= NEAR_LINES) g.push(sorted[j]);
    }
    if (g.length > 1) { g.forEach((x) => used.add(x.id)); groups.push(g.map((x) => x.id)); }
  }
  return groups;
}

function bySource(findings) {
  const out = {};
  for (const f of findings) for (const s of f.sources ?? []) out[s] = (out[s] ?? 0) + 1;
  return out;
}

function oneLine(s, n = 400) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function renderReport({ run, baseline, findingsDoc, verify, tier3, tokens, mode, date }) {
  const findings = findingsDoc.findings;
  const c = findingsDoc.counts;
  const out = [];
  out.push(`# healthsweep report · ${date}`, '');
  out.push(`- Repository: \`${run.repoRoot}\` at \`${run.startSha.slice(0, 12)}\` (branch \`${run.branch}\`)`);
  out.push(`- Scope: ${(run.config.scope ?? []).length ? run.config.scope.map((s) => `\`${s}\``).join(', ') : 'whole repository'}`);
  out.push(`- Mode: ${mode === 'report-only' ? '**Report only.** No finding in this report has been independently verified. No code was changed.' : 'verify and fix'}`);
  out.push(`- Tier 3 (Claude Security plugin): ${tier3?.ran ? 'ran' : `skipped (${tier3?.reason ?? 'not requested'})`}`);
  if (tokens) out.push(`- Tokens: Tier 2 used ${dash(tokens.tier2Total)} agent tokens in total (${dash(tokens.tier2Output)} output).${tokens.verifyOutput ? ` Verify used ${tokens.verifyOutput} output tokens.` : ''}`);
  out.push('');

  out.push('## Findings by severity and category', '');
  out.push(`| Severity | Count |`, `|---|---|`, ...SEVERITIES.map((s) => `| ${s} | ${c.bySeverity[s]} |`), `| **Total** | **${c.total}** |`, '');
  out.push(`| Category | Count |`, `|---|---|`, ...CATEGORIES.map((k) => `| ${k} | ${c.byCategory[k]} |`), '');
  const src = bySource(findings);
  out.push('Reported by (a finding can come from more than one finder):', '');
  out.push(...Object.entries(src).sort().map(([s, n]) => `- \`${s}\`: ${n}`), '');

  out.push('## Baseline checks (Tier 1)', '');
  out.push('Pre-existing failures below are recorded, not fixed. Later runs are judged against this baseline.', '');
  for (const ch of baseline.checks) {
    out.push(`- ${ch.name} (${ch.kind}): exit ${dash(ch.exitCode)}${ch.timedOut ? ' TIMED OUT' : ''}, ${ch.passed == null ? '—' : `${ch.passed} passed`}, ${ch.failed == null ? '—' : `${ch.failed} failed`}, ${Math.round((ch.durationMs ?? 0) / 1000)}s`);
    for (const name of ch.failures ?? []) out.push(`  - failing before the sweep: ${name}`);
  }
  out.push('');

  const dups = nearDuplicates(findings);
  if (dups.length) {
    out.push('## Possibly the same issue', '');
    out.push('These findings sit within 20 lines of each other in one file. Check them together; they may be one root cause.', '');
    out.push(...dups.map((g) => `- ${g.join(', ')}`), '');
  }

  const verdicts = new Map((verify?.results ?? []).map((r) => [r.finding.id, r]));
  out.push('## All findings', '');
  out.push('| ID | Severity | Category | Where | Title | Status |', '|---|---|---|---|---|---|');
  for (const f of findings) {
    const v = verdicts.get(f.id);
    const status = v ? v.recommendation : 'unverified';
    out.push(`| ${f.id} | ${f.severity} | ${f.category} | \`${mdCode(f.file)}:${f.line}\` | ${mdInline(f.title, 140)} | ${status} |`);
  }
  out.push('');

  out.push('## Details', '');
  for (const f of findings) {
    out.push(`### ${f.id} · ${f.severity} · ${f.category} · ${mdInline(f.title, 200)}`, '');
    out.push(`- Where: \`${mdCode(f.file)}:${f.line}\``);
    out.push(`- Reported by: ${(f.sources ?? []).join(', ')}${f.confidence ? ` (finder confidence ${f.confidence})` : ''}`);
    if (f.rationale) out.push(`- Why: ${oneLine(f.rationale, 1200)}`);
    if (f.trigger) out.push(`- Trigger: ${oneLine(f.trigger, 600)}`);
    out.push('', '```', redactSecrets(String(f.evidence)).replace(/```/g, '`​``').slice(0, 2500), '```', '');
  }

  out.push('---', '');
  out.push('This process builds stronger, auditable confidence through tests, independent review and measurement. It is not a proof that nothing broke. Unverified findings are leads, not facts: each needs independent verification before anyone acts on it.', '');
  return out.join('\n');
}
