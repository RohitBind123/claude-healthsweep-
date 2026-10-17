#!/usr/bin/env node
// A stand-in coding agent for tests: reads the prompt on stdin and answers like a headless agent.
// FAKE_AGENT_FLAKY=<file>: the first call in a run answers with prose only (tests the retry).
import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';

const prompt = readFileSync(0, 'utf8');
const say = (obj) => process.stdout.write(`Here is my answer.\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`\n`);

if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${prompt.split('\n')[0]}\n`);
const flaky = process.env.FAKE_AGENT_FLAKY;
if (flaky && !existsSync(flaky)) {
  writeFileSync(flaky, 'done');
  process.stdout.write('I looked around and everything seems fine.\n');
  process.exit(0);
}

if (prompt.includes('Split this repository')) {
  say({ modules: [{ name: 'jobs', paths: ['src'] }], skipped: [] });
} else if (prompt.includes('auditing one module')) {
  const findings = /concurrency and data consistency/.test(prompt)
    ? [{ file: 'src/a.js', line: 2, category: 'bug', severity: 'HIGH', title: 'double claim', evidence: '2  const job = queue[0]', rationale: 'two workers read the same job' }]
    : [];
  say({ findings, filesRead: ['src/a.js'] });
} else if (prompt.includes('try to DISPROVE')) {
  say({ real: !prompt.includes('NOT-REAL'), reasoning: 'traced it', codeRead: ['src/a.js:1-5'], reproduction: 'two workers at once' });
} else if (prompt.includes('You fix one confirmed defect')) {
  appendFileSync('src/a.js', '// fixed\n');
  say({ status: 'fixed', diff: 'agent-claimed diff', filesChanged: ['src/a.js'], testsBefore: 'Tests: 1 failed', testsAfter: 'Tests: 1 passed', notes: 'guarded the claim' });
} else if (prompt.includes('requirements reviewer')) {
  say({ verdict: 'propose', behaviourChange: false, reasoning: 'minimal' });
} else {
  process.stdout.write('unknown prompt\n');
}
