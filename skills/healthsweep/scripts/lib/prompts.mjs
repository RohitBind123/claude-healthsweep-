// Agent-neutral prompts and schemas: one source of truth for every role.
// The Claude workflows inline these at build time; other agents get them through the CLI.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function walk(dir, ext) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, ext) : n.endsWith(ext) ? [p] : [];
  });
}

export function loadPrompts(dir) {
  return Object.fromEntries(walk(dir, '.md').sort().map((p) => [
    relative(dir, p).replace(/\\/g, '/').replace(/\.md$/, ''),
    readFileSync(p, 'utf8').replace(/\n$/, ''),
  ]));
}

export function loadSchemas(dir) {
  return Object.fromEntries(walk(dir, '.json').sort().map((p) => [
    relative(dir, p).replace(/\.json$/, ''),
    JSON.parse(readFileSync(p, 'utf8')),
  ]));
}

export { renderPrompt } from './shared.mjs';

const TYPES = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  array: Array.isArray,
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

// A small JSON-schema subset: type, required, properties, items, enum.
export function validate(schema, value, path = '') {
  const errs = [];
  const at = path || '(root)';
  if (schema.type && !TYPES[schema.type](value)) return [`${at} should be ${schema.type}`];
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at} should be one of ${schema.enum.join('|')}`);
  if (schema.type === 'object') {
    for (const r of schema.required ?? []) if (value[r] === undefined) errs.push(`${path ? `${path}.` : ''}${r} is required`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (value[k] !== undefined) errs.push(...validate(sub, value[k], path ? `${path}.${k}` : k));
    }
  }
  if (schema.type === 'array' && schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)));
  return errs;
}

const MAX_JSON_ATTEMPTS = 2000;

// Is the quote at text[i] a real (unescaped) quote? Count the backslashes before it.
function isRealQuote(text, i) {
  let n = 0;
  for (let k = i - 1; k >= 0 && text[k] === '\\'; k -= 1) n += 1;
  return n % 2 === 0;
}

// The last complete JSON object in text, found from the end backwards: try each '}' from the
// right, walk back to its matching '{' (string-aware), and parse. Matching from the closing
// brace yields the outermost object ending there. Attempts and total scanned characters are
// capped, so hostile input (megabytes of braces) costs linear time, not quadratic.
function objectsIn(text) {
  let budget = 8 * text.length + 100000;
  let close = text.lastIndexOf('}');
  for (let attempt = 0; close >= 0 && attempt < MAX_JSON_ATTEMPTS && budget > 0; attempt += 1) {
    let depth = 0; let inStr = false; let start = -1;
    for (let j = close; j >= 0 && budget > 0; j -= 1, budget -= 1) {
      const c = text[j];
      if (c === '"' && isRealQuote(text, j)) inStr = !inStr;
      else if (inStr) continue;
      else if (c === '}') depth += 1;
      else if (c === '{' && --depth === 0) { start = j; break; }
    }
    if (start >= 0) {
      try {
        const value = JSON.parse(text.slice(start, close + 1));
        return { value, start };
      } catch { /* not JSON, try the previous closing brace */ }
    }
    close = close > 0 ? text.lastIndexOf('}', close - 1) : -1;
  }
  return null;
}

// Agents wrap answers in prose, fences, or a CLI envelope ({"type":"result","result":"..."}).
export function extractJson(text) {
  const str = String(text ?? '');
  const found = objectsIn(str);
  if (!found) return null;
  const last = found.value;
  // Unwrap an envelope only when it is the only object (nothing object-like before it).
  const alone = str.lastIndexOf('{', found.start - 1) === -1 || found.start === 0;
  for (const key of ['result', 'response', 'output', 'text']) {
    if (alone && typeof last[key] === 'string') {
      const inner = extractJson(last[key]);
      if (inner) return inner;
    }
  }
  return last;
}
