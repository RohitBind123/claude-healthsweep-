// Run a role as a fresh headless agent process: any coding agent with a non-interactive mode.
// A new process per task is what makes a verifier independent of the finder that reported it.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractJson, validate } from './prompts.mjs';

const STDIN_HINT = 'Follow the instructions given on standard input.';

// Read-only for finders, verifiers and reviewers; write for the fixer, which runs inside
// its own git worktree. Flags from each tool's headless docs (see docs/agents.md).
export const AGENT_PRESETS = Object.freeze({
  claude: {
    bin: 'claude',
    command: 'claude -p --permission-mode plan --output-format json',
    writeCommand: 'claude -p --permission-mode acceptEdits --allowedTools "Bash Read Edit Write Glob Grep" --output-format json',
  },
  codex: {
    bin: 'codex',
    command: 'codex exec -s read-only -a never --skip-git-repo-check --ephemeral -',
    writeCommand: 'codex exec -s workspace-write -a never --skip-git-repo-check --ephemeral -',
  },
  cursor: {
    bin: 'agent',
    command: `agent -p "${STDIN_HINT}" --mode ask --output-format text --trust`,
    writeCommand: `agent -p "${STDIN_HINT}" --force --output-format text --trust`,
  },
  gemini: {
    bin: 'gemini',
    command: `gemini -p "${STDIN_HINT}" --approval-mode plan -o json`,
    writeCommand: `gemini -p "${STDIN_HINT}" --approval-mode auto_edit -o json`,
  },
  copilot: {
    bin: 'copilot',
    command: 'copilot -p "$(cat {promptFile})" -s --no-ask-user --allow-tool=read --deny-tool=write --deny-tool=shell',
    writeCommand: 'copilot -p "$(cat {promptFile})" -s --no-ask-user --allow-all-tools',
  },
  opencode: {
    bin: 'opencode',
    command: 'opencode run --agent plan "$(cat {promptFile})"',
    writeCommand: 'opencode run "$(cat {promptFile})"',
  },
});

export function resolveAgent(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('no agent configured: set "agent" in the healthsweep config (a preset or a command)');
  let base = {};
  if (cfg.preset) {
    base = AGENT_PRESETS[cfg.preset];
    if (!base) throw new Error(`unknown agent preset "${cfg.preset}" (use ${Object.keys(AGENT_PRESETS).join('|')})`);
  }
  const command = cfg.command ?? base.command;
  if (!command) throw new Error('agent needs a preset or a command');
  return {
    preset: cfg.preset ?? null,
    command,
    writeCommand: cfg.writeCommand ?? base.writeCommand ?? null,
    concurrency: cfg.concurrency ?? 3,
    timeoutSec: cfg.timeoutSec ?? 1200,
  };
}

function runOnce({ command, prompt, cwd, timeoutSec, env }) {
  const usesFile = command.includes('{promptFile}');
  const dir = usesFile ? mkdtempSync(join(tmpdir(), 'hs-prompt-')) : null;
  const file = dir ? join(dir, 'prompt.md') : null;
  if (file) writeFileSync(file, prompt);
  const cmd = file ? command.replaceAll('{promptFile}', file) : command;
  return new Promise((done) => {
    let out = '';
    let err = '';
    let timedOut = false;
    const child = spawn(cmd, { cwd, shell: true, detached: true, env: { ...process.env, ...env } });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});
    if (!file) child.stdin.end(prompt);
    else child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutSec * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (dir) rmSync(dir, { recursive: true, force: true });
      done({ code, out, err, timedOut });
    });
  });
}

export async function dispatch({ command, prompt, schema, cwd, timeoutSec = 1200, env = {}, retries = 1 }) {
  const ask = `${prompt}\n\nWhen you are done, reply with ONLY one JSON object matching this JSON schema (no other text after it):\n${JSON.stringify(schema)}\n`;
  let errors = [];
  let raw = '';
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const text = attempt === 1 ? ask : `${ask}\nYour previous answer was rejected: ${errors.join('; ')}. Reply again with only the JSON object.\n`;
    const r = await runOnce({ command, prompt: text, cwd, timeoutSec, env });
    raw = r.out;
    if (r.timedOut) { errors = [`agent timed out after ${timeoutSec}s`]; continue; }
    const value = extractJson(r.out);
    if (!value) { errors = [`no JSON in the agent's answer (exit ${r.code})${r.err ? `: ${r.err.trim().slice(-300)}` : ''}`]; continue; }
    errors = validate(schema, value);
    if (!errors.length) return { ok: true, value, attempts: attempt, raw };
  }
  return { ok: false, value: null, errors, attempts: retries + 1, raw: raw.slice(-4000) };
}

// Run fn over items with at most n in flight; a task that throws becomes null.
export async function pool(items, n, fn, onError) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = null; if (onError) onError(e, items[i], i); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return results;
}
