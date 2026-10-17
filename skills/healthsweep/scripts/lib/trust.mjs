// A healthsweep config is code: its checks, setup step and agent commands run in your shell.
// Nothing runs until the user has seen every command and trusted that exact set for that repo.
// Any later change to a command, cwd, env, the setup step, the agent or the notes needs trust again.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAgent } from './agents.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function commandSurface(config) {
  let agent = null;
  if (config.agent) {
    try { const a = resolveAgent(config.agent); agent = { command: a.command, writeCommand: a.writeCommand }; } catch (e) { agent = { error: e.message }; }
  }
  return {
    checks: (config.checks ?? []).map((c) => ({ name: c.name, cmd: c.cmd, cwd: c.cwd ?? '.', env: c.env ?? {} })),
    worktreeSetup: config.worktreeSetup ?? null,
    agent,
    notes: config.notes ?? '',
  };
}

export function fingerprint(config) {
  return sha(JSON.stringify(commandSurface(config)));
}

function trustFile(home, repoRoot) {
  return join(home, '.claude', 'healthsweep', 'trusted', `${sha(repoRoot).slice(0, 32)}.json`);
}

export function isTrusted({ home, repoRoot, config }) {
  const p = trustFile(home, repoRoot);
  if (!existsSync(p)) return false;
  try {
    const t = JSON.parse(readFileSync(p, 'utf8'));
    return t.repoRoot === repoRoot && t.fingerprint === fingerprint(config);
  } catch { return false; }
}

export function trust({ home, repoRoot, config }) {
  const p = trustFile(home, repoRoot);
  mkdirSync(join(home, '.claude', 'healthsweep', 'trusted'), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify({ repoRoot, fingerprint: fingerprint(config), surface: commandSurface(config), trustedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return p;
}
