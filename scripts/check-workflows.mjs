#!/usr/bin/env node
// Static checks for workflows/*.js: they must parse, start with a literal meta block,
// declare every phase they use, and avoid APIs that break workflow resume.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows');
const HOOKS = ['args', 'budget', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow'];
const BANNED = [/Date\.now\(/, /Math\.random\(/, /new Date\(\)/, /\bimport\s*\(/, /\brequire\(/, /process\./];
let failed = 0;

for (const name of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  const src = readFileSync(join(dir, name), 'utf8');
  const problems = [];
  if (!/^export const meta = \{/.test(src)) problems.push('must start with `export const meta = {`');
  const body = src.replace(/^export const meta/m, 'const meta');
  try {
    // eslint-disable-next-line no-new-func
    new Function(...HOOKS, `return (async () => {${body}\n})`);
  } catch (e) {
    problems.push(`does not parse: ${e.message}`);
  }
  for (const re of BANNED) if (re.test(src)) problems.push(`uses ${re.source} (breaks resume or sandbox)`);
  const metaPhases = [...src.matchAll(/\{\s*title:\s*'([^']+)'/g)].map((m) => m[1]);
  const used = new Set([
    ...[...src.matchAll(/phase\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/phase:\s*'([^']+)'/g)].map((m) => m[1]),
  ]);
  for (const p of used) if (!metaPhases.includes(p)) problems.push(`phase "${p}" is not declared in meta.phases`);
  if (problems.length) {
    failed += 1;
    console.error(`FAIL workflows/${name}\n  - ${problems.join('\n  - ')}`);
  } else console.log(`ok   workflows/${name} (phases: ${metaPhases.join(', ')})`);
}
process.exit(failed ? 1 : 0);
