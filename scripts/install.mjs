// Install the self-contained skills/healthsweep folder where each coding agent looks for skills.
// Paths from each tool's skills docs (see docs/agents.md). ~/.agents/skills is read by Codex,
// Cursor, Gemini CLI, GitHub Copilot and OpenCode, so "agents" covers most tools at once.

import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename, relative, isAbsolute, sep } from 'node:path';
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

// Written into every copy install so a later install knows it may replace that folder.
export const MARKER = '.healthsweep-install';

const isInside = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
};

// Returns an error message when installing src into dest would overwrite or recurse into the source.
export function containmentError(src, dest) {
  if (isInside(src, dest)) return `refusing to install: ${dest} is the skill source or inside it (${src})`;
  if (isInside(dest, src)) return `refusing to install: the skill source (${src}) is inside ${dest}`;
  return null;
}

// realpath of the nearest existing ancestor, with the missing remainder appended.
function realpathLoose(p) {
  const missing = [];
  let cur = p;
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    missing.unshift(basename(cur));
    cur = up;
  }
  return join(realpathSync(cur), ...missing);
}

function lstatOrNull(p) {
  try { return lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// A repo could ship .claude/skills (or any parent) as a symlink pointing anywhere on disk.
function assertNoSymlinkedParents(base, dest) {
  const parts = relative(base, dirname(dest)).split(sep).filter(Boolean);
  let cur = base;
  for (const part of parts) {
    cur = join(cur, part);
    const st = lstatOrNull(cur);
    if (!st) return;
    if (st.isSymbolicLink()) throw new Error(`refusing to install: ${cur} is a symlink (a repository can point it anywhere)`);
  }
}

function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const i = argv.indexOf('--agent');
  let agent = 'agents';
  if (i !== -1) {
    agent = argv[i + 1];
    if (agent === undefined || agent.startsWith('-')) throw new Error('--agent needs a value');
  }
  return {
    scope: has('--project') ? 'project' : 'user',
    agents: has('--all') ? Object.keys(TARGETS).filter((a) => a !== 'agents') : [agent],
    dryRun: has('--dry-run'), link: has('--link'), force: has('--force'),
  };
}

// Checks everything before touching disk; returns the real source path.
function preflight(dest, base, opts) {
  if (opts.scope === 'project') assertNoSymlinkedParents(base, dest);
  const src = realpathSync(SKILL_SRC);
  const err = containmentError(src, join(realpathLoose(dirname(dest)), basename(dest)));
  if (err) throw new Error(err);
  const st = lstatOrNull(dest);
  if (st && !st.isSymbolicLink() && !opts.force && !(st.isDirectory() && existsSync(join(dest, MARKER)))) {
    throw new Error(`refusing to replace ${dest}: it was not created by healthsweep install (no ${MARKER}); re-run with --force to replace it`);
  }
  return src;
}

function placeSkill(src, dest, link) {
  mkdirSync(dirname(dest), { recursive: true });
  const st = lstatOrNull(dest);
  if (st?.isSymbolicLink()) unlinkSync(dest);
  else if (st) rmSync(dest, { recursive: true, force: true });
  if (link) { symlinkSync(src, dest, 'dir'); return; }
  cpSync(src, dest, { recursive: true });
  writeFileSync(join(dest, MARKER), 'Installed by healthsweep install. Safe to delete this folder.\n');
}

export function install(argv) {
  const opts = parseArgs(argv);
  const home = process.env.HOME || homedir();
  const base = opts.scope === 'project' ? process.cwd() : home;
  const seen = new Set();
  const plan = opts.agents
    .map((agent) => ({ agent, dest: targetDir(agent, opts.scope, home, process.cwd()) }))
    .filter(({ dest }) => !seen.has(dest) && seen.add(dest));
  // Check every destination first so --all never stops half-way through.
  const checked = plan.map((p) => ({ ...p, src: preflight(p.dest, base, opts) }));
  for (const { agent, dest, src } of checked) {
    if (opts.dryRun) { console.log(`would install for ${agent}: ${dest}`); continue; }
    placeSkill(src, dest, opts.link);
    console.log(`installed for ${agent}: ${dest}${opts.link ? ' (symlink)' : ''}`);
    if (TARGETS[agent].note) console.log(`  note: ${TARGETS[agent].note}`);
  }
  if (!opts.dryRun) console.log('Restart your agent, then ask it to run healthsweep (or type /healthsweep where slash skills are supported).');
}

export const USAGE = `usage: healthsweep install [--agent ${Object.keys(TARGETS).join('|')}] [--all] [--project] [--link] [--force] [--dry-run]`;
