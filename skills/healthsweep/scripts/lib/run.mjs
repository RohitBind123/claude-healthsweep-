// Run configured checks one at a time with hard timeouts.
// Sequential on purpose: whole suites in parallel can hang a laptop.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { parseTestOutput } from './parse.mjs';

const TAIL_CHARS = 4000;

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function runCheck(check, { repoRoot, outDir, label = '' }) {
  const cwd = resolve(repoRoot, check.cwd ?? '.');
  const rel = relative(repoRoot, cwd);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return Promise.reject(new Error(`check "${check.name}" cwd is outside the repository`));
  }
  const logFile = join(outDir, `${label ? `${label}-` : ''}${safeName(check.name)}.log`);
  const log = createWriteStream(logFile);
  const startedAt = Date.now();

  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    const child = spawn(check.cmd, {
      cwd, shell: true, detached: true,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...check.env },
    });
    const onData = (text) => {
      log.write(text);
      output += text;
      if (output.length > 4_000_000) output = output.slice(-2_000_000);
    };
    // setEncoding uses a streaming decoder, so a character split across chunks stays whole
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, check.timeoutSec * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      // resolve only after the log file is flushed, so callers can read it at once
      log.end(() => finish(code));
    });

    function finish(code) {
      const parsed = parseTestOutput(output);
      let metricMs = null;
      if (check.kind === 'bench' && check.metricRegex) {
        const m = new RegExp(check.metricRegex).exec(output);
        metricMs = m ? Number(m[1]) : null;
      }
      done({
        name: check.name, kind: check.kind, cmd: check.cmd, cwd: check.cwd ?? '.',
        exitCode: timedOut ? null : code, timedOut, startedAt, durationMs: Date.now() - startedAt,
        ...parsed, metricMs, logFile, tail: output.slice(-TAIL_CHARS),
      });
    }
  });
}

export async function runChecks(checks, ctx) {
  const results = [];
  for (const c of checks) {
    if (ctx.onStart) ctx.onStart(c);
    const r = await runCheck(c, ctx);
    if (ctx.onDone) ctx.onDone(r);
    results.push(r);
  }
  return { checks: results };
}
