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

function objectsIn(text) {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    let depth = 0; let inStr = false; let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth += 1;
      else if (c === '}' && --depth === 0) {
        try { found.push(JSON.parse(text.slice(i, j + 1))); i = j; } catch { /* not JSON, keep scanning */ }
        break;
      }
    }
  }
  return found;
}

// Agents wrap answers in prose, fences, or a CLI envelope ({"type":"result","result":"..."}).
export function extractJson(text) {
  const objs = objectsIn(String(text ?? ''));
  if (!objs.length) return null;
  const last = objs[objs.length - 1];
  for (const key of ['result', 'response', 'output', 'text']) {
    if (objs.length === 1 && typeof last[key] === 'string') {
      const inner = extractJson(last[key]);
      if (inner) return inner;
    }
  }
  return last;
}
