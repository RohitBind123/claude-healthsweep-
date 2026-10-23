import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchemas } from '../skills/healthsweep/scripts/lib/prompts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, 'workflows');

// Paths of every `$schema` key, at any depth.
function dollarSchemaPaths(value, path = '') {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(k === '$schema' ? [`${path}.${k}`] : []),
    ...dollarSchemaPaths(v, `${path}.${k}`),
  ]);
}

// The SCHEMAS object a built workflow passes to agent({ schema }).
function inlinedSchemas(src) {
  const start = src.indexOf('const SCHEMAS = ');
  assert.ok(start >= 0, 'workflow has no `const SCHEMAS = ` block');
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n}\n', open);
  return JSON.parse(src.slice(open, close + 2));
}

// The Claude Code Workflow runtime rejects a structured-output schema that has a `$schema` key,
// so the workflow fails at launch.
test('schema files that feed the workflows have no $schema key', () => {
  const schemas = loadSchemas(join(ROOT, 'skills', 'healthsweep', 'schemas'));
  assert.ok(Object.keys(schemas).length > 0);
  assert.deepEqual(dollarSchemaPaths(schemas), []);
});

for (const name of readdirSync(WORKFLOWS).filter((n) => n.endsWith('.js'))) {
  test(`workflows/${name}: no inlined agent() schema has a $schema key`, () => {
    const schemas = inlinedSchemas(readFileSync(join(WORKFLOWS, name), 'utf8'));
    assert.ok(Object.keys(schemas).length > 0);
    assert.deepEqual(dollarSchemaPaths(schemas), []);
  });
}
