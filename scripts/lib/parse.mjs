// Parse the summary lines of common test runners into counts.
// Unknown output returns nulls, never zeros: "no data" must not read as "0 failures".

const ANSI = /\u001b\[[0-9;]*m/g;

function num(re, text) {
  const m = re.exec(text);
  return m ? Number(m[1]) : null;
}

function collect(re, text) {
  const out = [];
  for (const m of text.matchAll(re)) out.push(m[1].trim());
  return out;
}

function jest(text) {
  const line = /^\s*Tests:\s+(.+)$/m.exec(text);
  if (!line) return null;
  const s = line[1];
  return {
    framework: 'jest',
    passed: num(/(\d+) passed/, s) ?? 0,
    failed: num(/(\d+) failed/, s) ?? 0,
    skipped: num(/(\d+) skipped/, s) ?? 0,
    total: num(/(\d+) total/, s),
    failures: collect(/^\s*● (.+?)\s*$/gm, text).filter((n) => !/^Test suite failed to run/.test(n)),
  };
}

function vitest(text) {
  const line = /^\s*Tests\s+(.+\(\d+\))\s*$/m.exec(text);
  if (!line) return null;
  const s = line[1];
  return {
    framework: 'vitest',
    passed: num(/(\d+) passed/, s) ?? 0,
    failed: num(/(\d+) failed/, s) ?? 0,
    skipped: num(/(\d+) skipped/, s) ?? 0,
    total: num(/\((\d+)\)/, s),
    failures: collect(/^\s*(?:FAIL|×)\s+(.+?)\s*$/gm, text),
  };
}

function pytest(text) {
  const line = /^=+ (.*\b(?:passed|failed|error)\b.*) in [\d.]+s.*=+\s*$/m.exec(text);
  if (!line) return null;
  const s = line[1];
  const passed = num(/(\d+) passed/, s) ?? 0;
  const failed = (num(/(\d+) failed/, s) ?? 0) + (num(/(\d+) errors?/, s) ?? 0);
  const skipped = num(/(\d+) skipped/, s) ?? 0;
  return {
    framework: 'pytest', passed, failed, skipped, total: passed + failed + skipped,
    failures: collect(/^(?:FAILED|ERROR) (\S+)/gm, text),
  };
}

function gotest(text) {
  if (!/^(ok|FAIL|---)\s/m.test(text) || !/^(ok\s+\S+|FAIL\s+\S+|--- (FAIL|PASS))/m.test(text)) return null;
  const failures = collect(/^\s*--- FAIL: (\S+)/gm, text);
  const passedTests = collect(/^\s*--- PASS: (\S+)/gm, text);
  return {
    framework: 'go',
    passed: passedTests.length || null,
    failed: failures.length,
    skipped: collect(/^\s*--- SKIP: (\S+)/gm, text).length,
    total: null,
    failures,
  };
}

function nodetest(text) {
  const pass = num(/^# pass (\d+)/m, text);
  const fail = num(/^# fail (\d+)/m, text);
  if (pass === null && fail === null) return null;
  return {
    framework: 'node',
    passed: pass ?? 0,
    failed: fail ?? 0,
    skipped: num(/^# skipped (\d+)/m, text) ?? 0,
    total: num(/^# tests (\d+)/m, text),
    failures: collect(/^\s*not ok \d+ - (.+?)\s*$/gm, text),
  };
}

export function parseTestOutput(raw) {
  const text = String(raw ?? '').replace(ANSI, '');
  for (const parser of [jest, vitest, pytest, nodetest, gotest]) {
    const r = parser(text);
    if (r) return r;
  }
  return { framework: null, passed: null, failed: null, skipped: null, total: null, failures: [] };
}
