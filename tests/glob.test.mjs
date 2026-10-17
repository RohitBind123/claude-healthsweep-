import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchesAny, selectScopedChecks } from '../scripts/lib/glob.mjs';

test('** matches across directories, * does not', () => {
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/c.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/c.ts'));
});

test('dots are literal', () => {
  assert.ok(!globToRegExp('*.ts').test('axts'));
});

test('a directory prefix matches everything under it', () => {
  assert.ok(matchesAny('src/api/x.ts', ['src/api/']));
  assert.ok(!matchesAny('src/apiX/x.ts', ['src/api/']));
});

test('selectScopedChecks picks checks whose scope covers a changed file', () => {
  const checks = [
    { name: 'api', kind: 'test', scope: ['src/api/**'] },
    { name: 'core', kind: 'test', scope: ['src/core/**'] },
    { name: 'build', kind: 'build' },
  ];
  const picked = selectScopedChecks(checks, ['src/api/a.ts']).map((c) => c.name);
  assert.deepEqual(picked, ['api', 'build']);
});

test('a test check without scope always runs as scoped (cannot prove it is unaffected)', () => {
  const checks = [{ name: 'all', kind: 'test' }];
  assert.deepEqual(selectScopedChecks(checks, ['x.ts']).map((c) => c.name), ['all']);
});

test('bench checks are excluded from scoped runs unless latency is in play', () => {
  const checks = [{ name: 'bench', kind: 'bench', scope: ['src/**'] }];
  assert.equal(selectScopedChecks(checks, ['src/a.ts']).length, 0);
  assert.equal(selectScopedChecks(checks, ['src/a.ts'], { includeBench: true }).length, 1);
});
