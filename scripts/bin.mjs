#!/usr/bin/env node
// Entry point for `npx github:RohitBind123/claude-healthsweep- <command>`.
//   install [--agent <name>|--all] [--project] [--link] [--force] [--dry-run]   put the skill where your agent looks
//   anything else                                                      run the skill CLI (init, preflight, ...)

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { install, SKILL_SRC, USAGE } from './install.mjs';

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === '--version' || cmd === '-v') {
  const { readFileSync } = await import('node:fs');
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  process.exit(0);
}
if (cmd === 'install') {
  try { install(rest); } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(1); }
} else if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`${USAGE}\n   or: healthsweep <init|preflight|checks|compare|consolidate|log|report|prompt|agents|fanout> [--flags]`);
} else {
  const r = spawnSync(process.execPath, [join(SKILL_SRC, 'scripts', 'healthsweep.mjs'), cmd, ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
