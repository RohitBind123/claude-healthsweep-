import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, pool, resolveAgent, AGENT_PRESETS } from '../skills/healthsweep/scripts/lib/agents.mjs';

const FAKE = `node ${join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs')}`;
const VERDICT = { type: 'object', required: ['real', 'reasoning', 'codeRead'], properties: { real: { type: 'boolean' }, reasoning: { type: 'string' }, codeRead: { type: 'array' } } };

test('dispatch sends the prompt on stdin and returns validated JSON', async () => {
  const r = await dispatch({ command: FAKE, prompt: 'Please try to DISPROVE it', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.value.real, true);
  assert.equal(r.attempts, 1);
});

test('dispatch retries once when the answer is not valid JSON for the schema', async () => {
  const flag = join(mkdtempSync(join(tmpdir(), 'hs-ag-')), 'flag');
  const r = await dispatch({ command: FAKE, prompt: 'Please try to DISPROVE it', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20, env: { FAKE_AGENT_FLAKY: flag } });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test('dispatch gives up with the errors after the retry', async () => {
  const r = await dispatch({ command: FAKE, prompt: 'something unknown', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /no JSON/);
});

test('dispatch can pass the prompt as a file instead of stdin', async () => {
  const r = await dispatch({ command: 'cat {promptFile} >/dev/null; echo \'{"real":false,"reasoning":"x","codeRead":[]}\'', prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.value.real, false);
});

test('dispatch times out a hung agent', async () => {
  const r = await dispatch({ command: 'sleep 5', prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 1, retries: 0 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /timed out/);
});

test('pool runs at most n tasks at once and keeps order', async () => {
  let live = 0; let peak = 0;
  const out = await pool([1, 2, 3, 4, 5], 2, async (x) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 20));
    live -= 1;
    return x * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test('pool turns a thrown task into null', async () => {
  const out = await pool([1, 2], 2, async (x) => { if (x === 1) throw new Error('x'); return x; });
  assert.deepEqual(out, [null, 2]);
});

test('resolveAgent expands a preset and keeps overrides', () => {
  const a = resolveAgent({ preset: 'codex', concurrency: 2 });
  assert.match(a.command, /^codex exec .*-s read-only/);
  assert.match(a.writeCommand, /workspace-write/);
  assert.equal(a.concurrency, 2);
  const custom = resolveAgent({ command: 'my-agent --ro', writeCommand: 'my-agent --rw' });
  assert.equal(custom.command, 'my-agent --ro');
});

test('resolveAgent refuses an unknown preset or a missing command', () => {
  assert.throws(() => resolveAgent({ preset: 'nope' }), /preset/);
  assert.throws(() => resolveAgent(null), /agent/);
});

test('every preset has a read-only command and a separate write command', () => {
  for (const [name, p] of Object.entries(AGENT_PRESETS)) {
    assert.ok(p.command && p.writeCommand && p.command !== p.writeCommand, name);
  }
});

// ---- hardening (review findings) ----
import { readdirSync, mkdirSync, rmSync as rmDir } from 'node:fs';
import { spawn as spawnProc } from 'node:child_process';
import { killAllAgents } from '../skills/healthsweep/scripts/lib/agents.mjs';

const AGENTS_LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'healthsweep', 'scripts', 'lib', 'agents.mjs');
const OK_JSON = 'echo \'{"real":false,"reasoning":"x","codeRead":[]}\'';

// Point os.tmpdir() at a fresh dir (optionally with a space) for one test.
async function withTmpdir(name, fn) {
  const base = mkdtempSync(join(tmpdir(), 'hs-tmp-'));
  const dir = join(base, name);
  mkdirSync(dir);
  const prev = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try { return await fn(dir); } finally {
    if (prev === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prev;
    rmDir(base, { recursive: true, force: true });
  }
}

test('resolveAgent rejects bad concurrency and timeoutSec', () => {
  for (const concurrency of [0, -1, 1.5, '3', NaN]) {
    assert.throws(() => resolveAgent({ preset: 'codex', concurrency }), /concurrency/);
  }
  for (const timeoutSec of [0, 7201, 2.5, '60']) {
    assert.throws(() => resolveAgent({ preset: 'codex', timeoutSec }), /timeoutSec/);
  }
  const a = resolveAgent({ preset: 'codex', concurrency: 1, timeoutSec: 7200 });
  assert.equal(a.concurrency, 1);
  assert.equal(a.timeoutSec, 7200);
});

test('resolveAgent returns envMode (minimal by default, inherit on request)', () => {
  assert.equal(resolveAgent({ preset: 'codex' }).envMode, 'minimal');
  assert.equal(resolveAgent({ preset: 'codex', env: 'inherit' }).envMode, 'inherit');
  assert.throws(() => resolveAgent({ preset: 'codex', env: 'all' }), /env/);
});

test('pool refuses a non-integer or < 1 worker count', async () => {
  for (const n of [0, -2, 1.5, undefined, '2']) {
    await assert.rejects(() => pool([1, 2], n, async (x) => x), /pool/);
  }
});

test('dispatch returns an error result (no crash) when the agent cannot start', async () => {
  await withTmpdir('t', async (dir) => {
    const r = await dispatch({ command: `cat {promptFile}; ${OK_JSON}`, prompt: 'p', schema: VERDICT, cwd: join(dir, 'does-not-exist'), timeoutSec: 20 });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(), /could not start|ENOENT/);
    assert.deepEqual(readdirSync(dir), [], 'prompt temp dir must be removed');
  });
});

test('dispatch removes the prompt temp dir after a normal run and after a timeout', async () => {
  await withTmpdir('t', async (dir) => {
    const ok = await dispatch({ command: `cat {promptFile} >/dev/null; ${OK_JSON}`, prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20 });
    assert.equal(ok.ok, true);
    const slow = await dispatch({ command: 'cat {promptFile} >/dev/null; sleep 5', prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 1, retries: 0 });
    assert.equal(slow.ok, false);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('dispatch quotes {promptFile} so a temp path with a space works', async () => {
  await withTmpdir('with space', async () => {
    const r = await dispatch({ command: `test -f {promptFile} && cat -- {promptFile} | grep -q needle && ${OK_JSON}`, prompt: 'needle', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20 });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const sub = await dispatch({ command: `X="$(cat -- {promptFile})"; case "$X" in *needle*) ${OK_JSON};; esac`, prompt: 'needle', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20 });
    assert.equal(sub.ok, true, JSON.stringify(sub.errors));
  });
});

test('copilot and opencode presets read the prompt file with cat --', () => {
  for (const name of ['copilot', 'opencode']) {
    for (const cmd of [AGENT_PRESETS[name].command, AGENT_PRESETS[name].writeCommand]) {
      assert.match(cmd, /"\$\(cat -- \{promptFile\}\)"/, name);
    }
  }
});

test('dispatch keeps only the tail of a huge stdout and still finds the answer', async () => {
  const cmd = `node -e "process.stdout.write('{'.repeat(3*1024*1024)); process.stdout.write('\\n' + JSON.stringify({real:true,reasoning:'x',codeRead:[]}))"`;
  const t0 = Date.now();
  const r = await dispatch({ command: cmd, prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 30, retries: 0 });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.raw.length <= 2 * 1024 * 1024);
  assert.ok(Date.now() - t0 < 10000, 'must not be quadratic');
});

test('dispatch resolves soon after exit when a grandchild keeps stdout open', async () => {
  const t0 = Date.now();
  const r = await dispatch({ command: `(sleep 20 &) ; ${OK_JSON}`, prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 60, retries: 0 });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0}ms`);
});

test('killAllAgents kills live agents so dispatch returns promptly', async () => {
  const t0 = Date.now();
  const p = dispatch({ command: 'sleep 30', prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 60, retries: 0 });
  await new Promise((r) => setTimeout(r, 300));
  killAllAgents();
  const r = await p;
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 5000);
});

test('SIGTERM kills live agent process groups and exits 143', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hs-sig-'));
  const pidFile = join(dir, 'pid');
  const script = `import { dispatch } from ${JSON.stringify(AGENTS_LIB)};
    dispatch({ command: 'echo $$ > ${pidFile}; sleep 30', prompt: 'p', schema: {}, cwd: ${JSON.stringify(dir)}, timeoutSec: 60, retries: 0 });
    setInterval(() => {}, 1000);`;
  const child = spawnProc(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
  let pid = null;
  for (let i = 0; i < 50 && !pid; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    try { pid = Number(readFileSync(pidFile, 'utf8').trim()) || null; } catch { /* not yet */ }
  }
  assert.ok(pid, 'agent never started');
  const code = await new Promise((resolve) => { child.on('exit', (c, s) => resolve(c ?? s)); child.kill('SIGTERM'); });
  assert.equal(code, 143);
  await new Promise((r) => setTimeout(r, 200));
  assert.throws(() => process.kill(pid, 0), 'agent shell must be dead');
  rmDir(dir, { recursive: true, force: true });
});

test('envMode minimal hides unrelated parent secrets; inherit passes them', async () => {
  const cmd = `node -e "process.stdout.write(JSON.stringify({real:!!process.env.SECRET_DB_PASSWORD,reasoning:String(!!process.env.OPENAI_API_KEY)+String(!!process.env.EXTRA),codeRead:[]}))"`;
  process.env.SECRET_DB_PASSWORD = 'hunter2';
  process.env.OPENAI_API_KEY = 'sk-test';
  try {
    const min = await dispatch({ command: cmd, prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20, env: { EXTRA: '1' } });
    assert.equal(min.ok, true, JSON.stringify(min.errors));
    assert.equal(min.value.real, false);
    assert.equal(min.value.reasoning, 'truetrue');
    const inh = await dispatch({ command: cmd, prompt: 'p', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20, envMode: 'inherit' });
    assert.equal(inh.value.real, true);
  } finally {
    delete process.env.SECRET_DB_PASSWORD;
    delete process.env.OPENAI_API_KEY;
  }
});

test('dispatch with retries:0 runs the agent exactly once', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'hs-ag-')), 'log');
  const r = await dispatch({ command: FAKE, prompt: 'something unknown', schema: VERDICT, cwd: tmpdir(), timeoutSec: 20, env: { FAKE_AGENT_LOG: log }, retries: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});
