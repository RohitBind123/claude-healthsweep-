// Install the self-contained skills/healthsweep folder where each coding agent looks for skills.
// Paths from each tool's skills docs (see docs/agents.md). ~/.agents/skills is read by Codex,
// Cursor, Gemini CLI, GitHub Copilot and OpenCode, so "agents" covers most tools at once.

import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'healthsweep');

export const TARGETS = Object.freeze({
  claude: { user: '.claude/skills', project: '.claude/skills', note: 'For workflows and Tier 3 in Claude Code, install the plugin instead: /plugin marketplace add RohitBind123/claude-healthsweep-' },
  codex: { user: '.agents/skills', project: '.agents/skills' },
  cursor: { user: '.cursor/skills', project: '.cursor/skills' },
  gemini: { user: '.gemini/skills', project: '.gemini/skills' },
  copilot: { user: '.copilot/skills', project: '.github/skills' },
  opencode: { user: '.config/opencode/skills', project: '.opencode/skills' },
  agents: { user: '.agents/skills', project: '.agents/skills', note: 'Shared location read by Codex, Cursor, Gemini CLI, GitHub Copilot and OpenCode.' },
});

export function targetDir(agent, scope, home, cwd) {
  const t = TARGETS[agent];
  if (!t) throw new Error(`unknown agent "${agent}" (use ${Object.keys(TARGETS).join('|')})`);
  return join(scope === 'project' ? cwd : home, t[scope], 'healthsweep');
}

export function install(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
  const scope = has('--project') ? 'project' : 'user';
  const agents = has('--all') ? Object.keys(TARGETS).filter((a) => a !== 'agents') : [val('--agent') ?? 'agents'];
  const done = new Set();
  for (const agent of agents) {
    const dest = targetDir(agent, scope, process.env.HOME || homedir(), process.cwd());
    if (done.has(dest)) continue;
    done.add(dest);
    if (has('--dry-run')) { console.log(`would install for ${agent}: ${dest}`); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    if (has('--link')) symlinkSync(SKILL_SRC, dest, 'dir');
    else cpSync(SKILL_SRC, dest, { recursive: true });
    console.log(`installed for ${agent}: ${dest}${has('--link') ? ' (symlink)' : ''}`);
    if (TARGETS[agent].note) console.log(`  note: ${TARGETS[agent].note}`);
  }
  if (!has('--dry-run')) console.log('Restart your agent, then ask it to run healthsweep (or type /healthsweep where slash skills are supported).');
}

export const USAGE = `usage: healthsweep install [--agent ${Object.keys(TARGETS).join('|')}] [--all] [--project] [--link] [--dry-run]`;
