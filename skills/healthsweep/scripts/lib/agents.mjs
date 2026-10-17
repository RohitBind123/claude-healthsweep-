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
    command: 'codex exec -s read-only --skip-git-repo-check --ephemeral -',
    writeCommand: 'codex exec -s workspace-write --skip-git-repo-check --ephemeral -',
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
  // copilot and opencode take the prompt as a single argv entry: it is visible in `ps` and
  // bounded by the per-argument limit (~128 KB on Linux). {promptFile} is substituted as a
  // single-quoted shell token, so "$(cat -- {promptFile})" stays valid for any temp path.
  copilot: {
    bin: 'copilot',
    command: 'copilot -p "$(cat -- {promptFile})" -s --no-ask-user --allow-tool=read --deny-tool=write --deny-tool=shell',
    writeCommand: 'copilot -p "$(cat -- {promptFile})" -s --no-ask-user --allow-all-tools',
  },
  opencode: {
    bin: 'opencode',
    command: 'opencode run --agent plan "$(cat -- {promptFile})"',
    writeCommand: 'opencode run "$(cat -- {promptFile})"',
  },
});

const ENV_MODES = ['minimal', 'inherit'];
const MAX_TIMEOUT_SEC = 7200;

function intSetting(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    const range = max === Infinity ? `>= ${min}` : `from ${min} to ${max}`;
    throw new Error(`agent ${name} must be an integer ${range} (got ${JSON.stringify(value)})`);
  }
  return value;
}

export function resolveAgent(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('no agent configured: set "agent" in the healthsweep config (a preset or a command)');
  let base = {};
  if (cfg.preset) {
    base = AGENT_PRESETS[cfg.preset];
    if (!base) throw new Error(`unknown agent preset "${cfg.preset}" (use ${Object.keys(AGENT_PRESETS).join('|')})`);
  }
  const command = cfg.command ?? base.command;
  if (!command) throw new Error('agent needs a preset or a command');
  const envMode = cfg.env ?? 'minimal';
  if (!ENV_MODES.includes(envMode)) throw new Error(`agent env must be ${ENV_MODES.join('|')} (got ${JSON.stringify(envMode)})`);
  return {
    preset: cfg.preset ?? null,
    command,
    writeCommand: cfg.writeCommand ?? base.writeCommand ?? null,
    concurrency: intSetting('concurrency', cfg.concurrency ?? 3, 1, Infinity),
    timeoutSec: intSetting('timeoutSec', cfg.timeoutSec ?? 1200, 1, MAX_TIMEOUT_SEC),
    envMode,
  };
}

// --- environment scrub -----------------------------------------------------------------
// 'minimal' passes only what a coding agent needs to run and authenticate; repo secrets in
// the caller's environment (DB passwords, cloud keys) never reach the agent process.
const ENV_EXACT = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'TMPDIR', 'TZ',
  'GH_TOKEN', 'GITHUB_TOKEN', 'AWS_PROFILE', 'AWS_REGION', 'NODE_EXTRA_CA_CERTS']);
const ENV_EXACT_ANY_CASE = new Set(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']);
const ENV_PREFIXES = ['LC_', 'XDG_', 'ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'CODEX_', 'AZURE_OPENAI_', 'GEMINI_',
  'GOOGLE_', 'VERTEX', 'CURSOR_', 'COPILOT_', 'OPENCODE_', 'OPENROUTER_'];

function allowedEnvKey(key) {
  return ENV_EXACT.has(key) || ENV_EXACT_ANY_CASE.has(key.toUpperCase()) || ENV_PREFIXES.some((p) => key.startsWith(p));
}

function agentEnv(envMode, extra) {
  if (envMode === 'inherit') return { ...process.env, ...extra };
  const picked = Object.fromEntries(Object.entries(process.env).filter(([k]) => allowedEnvKey(k)));
  return { ...picked, ...extra };
}

// --- live process groups + signal cleanup ------------------------------------------------
// Each agent runs detached in its own process group; on Ctrl-C or SIGTERM the whole group
// (agent plus anything it spawned) is killed so nothing keeps editing a worktree after exit.
const liveGroups = new Set();
let signalHandlersInstalled = false;

function killGroup(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
}

export function killAllAgents() {
  for (const pid of liveGroups) killGroup(pid);
}

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => { killAllAgents(); process.exit(code); });
  }
}

// --- one agent run ---------------------------------------------------------------------
const MAX_OUTPUT_CHARS = 2 * 1024 * 1024; // keep the tail: the answer is at the end
const EXIT_GRACE_MS = 2000; // 'close' can wait forever if a grandchild holds stdout open

const appendTail = (buf, chunk) => {
  const next = buf + chunk;
  return next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next;
};

const shellQuote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

function writePromptFile(prompt) {
  const dir = mkdtempSync(join(tmpdir(), 'hs-prompt-'));
  const file = join(dir, 'prompt.md');
  try { writeFileSync(file, prompt); } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  return { dir, file };
}

function runOnce({ command, prompt, cwd, timeoutSec, env }) {
  let tmp = null;
  try {
    if (command.includes('{promptFile}')) tmp = writePromptFile(prompt);
  } catch (e) {
    return Promise.resolve({ code: null, out: '', err: '', timedOut: false, spawnError: e.message });
  }
  const cmd = tmp ? command.replaceAll('{promptFile}', shellQuote(tmp.file)) : command;
  return new Promise((done) => {
    let out = '';
    let err = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    let grace = null;
    let child = null;
    const finish = (code, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (child?.pid) liveGroups.delete(child.pid);
      if (tmp) rmSync(tmp.dir, { recursive: true, force: true });
      done({ code, out, err, timedOut, ...extra });
    };
    try {
      installSignalHandlers();
      child = spawn(cmd, { cwd, shell: true, detached: true, env });
    } catch (e) {
      finish(null, { spawnError: e.message });
      return;
    }
    if (child.pid) liveGroups.add(child.pid);
    child.on('error', (e) => { killGroup(child.pid); finish(null, { spawnError: e.message }); });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out = appendTail(out, d); });
    child.stderr.on('data', (d) => { err = appendTail(err, d); });
    child.stdin.on('error', () => {});
    if (!tmp) child.stdin.end(prompt);
    else child.stdin.end();
    timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutSec * 1000);
    child.on('exit', (code) => {
      grace = setTimeout(() => {
        killGroup(child.pid);
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code);
      }, EXIT_GRACE_MS);
    });
    child.on('close', (code) => finish(code));
  });
}

// retries: extra attempts after an invalid answer. The default (1) suits read-only roles;
// callers MUST pass retries: 0 for write commands, since a retried fixer would edit twice.
// envMode: 'minimal' (default, allowlisted env) or 'inherit' (the full parent env); `env`
// is merged on top either way.
export async function dispatch({ command, prompt, schema, cwd, timeoutSec = 1200, env = {}, envMode = 'minimal', retries = 1 }) {
  const ask = `${prompt}\n\nWhen you are done, reply with ONLY one JSON object matching this JSON schema (no other text after it):\n${JSON.stringify(schema)}\n`;
  const childEnv = agentEnv(envMode, env);
  let errors = [];
  let raw = '';
  let attempts = 0;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    attempts = attempt;
    const text = attempt === 1 ? ask : `${ask}\nYour previous answer was rejected: ${errors.join('; ')}. Reply again with only the JSON object.\n`;
    const r = await runOnce({ command, prompt: text, cwd, timeoutSec, env: childEnv });
    raw = r.out;
    if (r.spawnError) { errors = [`agent could not start: ${r.spawnError}`]; break; }
    if (r.timedOut) { errors = [`agent timed out after ${timeoutSec}s`]; continue; }
    const value = extractJson(r.out);
    if (!value) { errors = [`no JSON in the agent's answer (exit ${r.code})${r.err ? `: ${r.err.trim().slice(-300)}` : ''}`]; continue; }
    errors = validate(schema, value);
    if (!errors.length) return { ok: true, value, attempts: attempt, raw };
  }
  return { ok: false, value: null, errors, attempts, raw: raw.slice(-4000) };
}

// Run fn over items with at most n in flight; a task that throws becomes null.
export async function pool(items, n, fn, onError) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`pool needs an integer worker count >= 1 (got ${JSON.stringify(n)})`);
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
