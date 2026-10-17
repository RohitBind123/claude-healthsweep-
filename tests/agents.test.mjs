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
