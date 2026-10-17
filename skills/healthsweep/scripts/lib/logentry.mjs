// Render one HEALTHSWEEP_LOG.md entry. Evidence only: real diff, real test output.
// Everything is secret-redacted: this file is committed.

import { redactSecrets } from './redact.mjs';
import { mdInline, mdCode } from './md.mjs';

export const LOG_HEADER = `# HEALTHSWEEP_LOG

Evidence log written by [healthsweep](https://github.com/RohitBind123/claude-healthsweep-).
Each entry is one approved fix: the finding, how it was verified, the exact change, and the real
test output before and after. Each entry is committed together with its fix, so \`git log\` and this
file always agree. This log raises confidence; it is not a proof that nothing broke.
`;

function fence(text, lang = '') {
  const body = redactSecrets(String(text ?? '')).replace(/```/g, '`​``');
  return `\`\`\`${lang}\n${body.replace(/\n$/, '')}\n\`\`\``;
}

function required(entry, key) {
  const v = entry[key];
  if (v == null || String(v).trim() === '') throw new Error(`log entry is missing ${key}`);
}

export function renderLogEntry(entry) {
  ['date', 'diff', 'testsBefore', 'testsAfter', 'verification'].forEach((k) => required(entry, k));
  const f = entry.finding;
  const bench = entry.bench
    ? `**Benchmark** (\`${entry.bench.command}\`): before ${entry.bench.before}, after ${entry.bench.after}.`
    : '**Benchmark:** No benchmark run. No performance claim is made for this change.';
  return [
    `## ${entry.date} · ${f.id} · ${f.severity} · ${f.category} · ${mdInline(redactSecrets(f.title), 200)}`,
    '',
    `**Where:** \`${mdCode(f.file)}:${f.line}\`  `,
    `**Approved by:** ${entry.approvedBy ?? 'user'}${entry.commit ? `  \n**Commit:** \`${entry.commit}\`` : ''}`,
    '',
    '**Finding evidence (before):**',
    '',
    fence(f.evidence),
    '',
    `**Independent verification:** ${redactSecrets(String(entry.verification).replace(/[\r\n]+/g, ' '))}`,
    '',
    '**Change (before -> after):**',
    '',
    fence(entry.diff, 'diff'),
    '',
    '**Tests before the fix:**',
    '',
    fence(entry.testsBefore),
    '',
    '**Tests after the fix:**',
    '',
    fence(entry.testsAfter),
    '',
    bench,
    '',
  ].join('\n');
}
