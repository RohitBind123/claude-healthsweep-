import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../skills/healthsweep/scripts/lib/redact.mjs';

test('redacts well-known token formats', () => {
  const t = [
    'aws AKIAIOSFODNN7EXAMPLE',
    'gh ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
    'pat github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    'openai sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    'slack xoxb-123456789012-abcdefghijkl',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ].join('\n');
  const r = redactSecrets(t);
  for (const s of ['AKIAIOSFODNN7EXAMPLE', 'ghp_aBcDeF', 'github_pat_11', 'sk-proj-abc', 'xoxb-1234', 'eyJhbGci']) assert.ok(!r.includes(s), s);
  assert.match(r, /\[REDACTED\]/);
});

test('redacts private key blocks', () => {
  const r = redactSecrets('a\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----\nb');
  assert.ok(!r.includes('MIIEow'));
  assert.match(r, /^a\n\[REDACTED PRIVATE KEY\]\nb$/);
});

test('masks assigned secret values but keeps the key name', () => {
  const r = redactSecrets('const password = "hunter2hunter2";\nAPI_KEY=abcdef123456\ntoken: \'xyz7890abc\'');
  assert.match(r, /password = "\[REDACTED\]"/);
  assert.match(r, /API_KEY=\[REDACTED\]/);
  assert.match(r, /token: '\[REDACTED\]'/);
});

test('connection strings lose their password', () => {
  assert.equal(redactSecrets('postgres://app:s3cr3tPass@db:5432/x'), 'postgres://app:[REDACTED]@db:5432/x');
});

test('ordinary code is untouched', () => {
  const code = 'const total = items.reduce((a, b) => a + b.price, 0);\nif (token === undefined) return;';
  assert.equal(redactSecrets(code), code);
});

test('extra literal values (for example check env values) are redacted', () => {
  assert.equal(redactSecrets('db pass is pa55word!', ['pa55word!']), 'db pass is [REDACTED]');
});
