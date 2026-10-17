import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrompts, renderPrompt, loadSchemas, validate, extractJson } from '../skills/healthsweep/scripts/lib/prompts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('loadPrompts reads nested prompt files by relative name', () => {
  const p = loadPrompts(join(ROOT, 'skills', 'healthsweep', 'prompts'));
  for (const name of ['finder', 'verifier', 'fixer', 'reviewer', 'inventory', 'security-review', 'lenses/consistency', 'verify-lenses/reproduce', '_rules-readonly']) {
    assert.ok(p[name], `missing prompt ${name}`);
  }
});

test('renderPrompt fills variables and partials', () => {
  const prompts = { _rule: 'Be careful.', main: 'Hi {{who}}.\n{{>_rule}}' };
  assert.equal(renderPrompt(prompts, 'main', { who: 'there' }), 'Hi there.\nBe careful.');
});

test('renderPrompt refuses a missing variable instead of printing {{x}}', () => {
  assert.throws(() => renderPrompt({ main: 'Hi {{who}}' }, 'main', {}), /who/);
});

test('renderPrompt does not re-expand braces inside substituted values', () => {
  const out = renderPrompt({ main: 'E: {{evidence}}' }, 'main', { evidence: 'const a = `{{x}}`' });
  assert.equal(out, 'E: const a = `{{x}}`');
});

test('every real prompt renders with the variables its role supplies', () => {
  const p = loadPrompts(join(ROOT, 'skills', 'healthsweep', 'prompts'));
  const ctx = { context: 'Repository root: /r' };
  const f = { id: 'HS-001', severity: 'HIGH', category: 'bug', title: 't', file: 'a.js', line: 1, evidence: 'x', rationale: 'r' };
  renderPrompt(p, 'finder', { ...ctx, moduleName: 'm', modulePaths: 'src', lens: p['lenses/logic'] });
  renderPrompt(p, 'inventory', { ...ctx, maxModules: 12, scope: '', exclude: '' });
  renderPrompt(p, 'security-review', { ...ctx, repoRoot: '/r', mergeBase: 'abc' });
  renderPrompt(p, 'verifier', { ...ctx, ...f, lens: p['verify-lenses/correctness'] });
  renderPrompt(p, 'fixer', { ...ctx, ...f, repoRoot: '/r', worktree: '/w', startSha: 's', setupSteps: '1. a', cleanupStep: '9. b', checks: '[]', benchStep: '', verification: 'v' });
  renderPrompt(p, 'reviewer', { ...ctx, ...f, diff: 'd', testsBefore: 'b', testsAfter: 'a', notes: 'n' });
});

test('validate checks required fields, types and enums', () => {
  const s = loadSchemas(join(ROOT, 'skills', 'healthsweep', 'schemas')).verdict;
  assert.deepEqual(validate(s, { real: true, reasoning: 'x', codeRead: ['a:1'] }), []);
  assert.match(validate(s, { real: 'yes', reasoning: 'x', codeRead: [] }).join(), /real/);
  assert.match(validate(s, { reasoning: 'x', codeRead: [] }).join(), /real/);
  assert.match(validate(s, { real: true, reasoning: 'x', codeRead: [], severity: 'HUGE' }).join(), /severity/);
});

test('validate descends into arrays of objects', () => {
  const s = loadSchemas(join(ROOT, 'skills', 'healthsweep', 'schemas')).findings;
  const errs = validate(s, { filesRead: [], findings: [{ file: 'a', line: 'ten', category: 'bug', severity: 'LOW', title: 't', evidence: 'e', rationale: 'r' }] });
  assert.match(errs.join(), /findings\[0\]\.line/);
});

test('extractJson takes the last JSON object from agent chatter or fences', () => {
  assert.deepEqual(extractJson('Sure.\n```json\n{"a":1}\n```\nDone.'), { a: 1 });
  assert.deepEqual(extractJson('{"a":1}\nthen {"b":{"c":[1,2]}}'), { b: { c: [1, 2] } });
  assert.deepEqual(extractJson('{"text":"has } brace"}'), { text: 'has } brace' });
  assert.equal(extractJson('no json here'), null);
});

test('extractJson unwraps a claude -p --output-format json envelope', () => {
  const env = JSON.stringify({ type: 'result', result: 'ok\n{"real":false,"reasoning":"guarded","codeRead":[]}' });
  assert.deepEqual(extractJson(env), { real: false, reasoning: 'guarded', codeRead: [] });
});
