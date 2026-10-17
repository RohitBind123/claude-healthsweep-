// Compare an "after" check run against the baseline.
// A regression is judged against the baseline, so tests that already failed before do not count.

function diffList(a = [], b = []) {
  const setB = new Set(b);
  return a.filter((x) => !setB.has(x));
}

function compareCheck(before, after, opts) {
  const base = { name: before.name, kind: before.kind, regressed: false, reasons: [] };
  const flag = (reason) => { base.regressed = true; base.reasons.push(reason); };

  if (after.timedOut && !before.timedOut) flag('timed out');
  if (before.exitCode === 0 && after.exitCode !== 0 && !after.timedOut) flag(`exit ${after.exitCode} (was 0)`);

  base.newFailures = diffList(after.failures, before.failures);
  base.fixed = diffList(before.failures, after.failures);
  base.stillFailing = (after.failures ?? []).filter((x) => (before.failures ?? []).includes(x));
  if (base.newFailures.length) flag(`new failures: ${base.newFailures.join(', ')}`);

  if (before.passed != null && after.passed != null && after.passed < before.passed) {
    flag(`passed dropped ${before.passed} -> ${after.passed}`);
  }
  if (before.failed != null && after.failed != null && after.failed > before.failed && !base.newFailures.length) {
    flag(`failed rose ${before.failed} -> ${after.failed}`);
  }

  if (before.kind === 'bench' && before.metricMs != null) {
    if (after.metricMs == null) flag('bench metric missing in the after run');
    else if (before.metricMs > 0) {
      base.deltaPct = Math.round(((after.metricMs - before.metricMs) / before.metricMs) * 1000) / 10;
      if (base.deltaPct > opts.benchTolerancePct) flag(`bench slower by ${base.deltaPct}%`);
    } else base.deltaPct = null;
  }
  // Failing (or timing out) both times with nothing parseable: we cannot tell better from worse.
  const opaque = (c) => c.timedOut || (c.exitCode !== 0 && c.passed == null && c.failed == null && !(c.failures ?? []).length);
  base.unknown = !base.regressed && opaque(before) && opaque(after);
  return base;
}

export function compareRuns(before, after, opts = {}) {
  const o = { benchTolerancePct: 10, ...opts };
  const afterByName = new Map(after.checks.map((c) => [c.name, c]));
  const checks = [];
  const missing = [];
  for (const b of before.checks) {
    const a = afterByName.get(b.name);
    if (!a) { missing.push(b.name); continue; }
    checks.push(compareCheck(b, a, o));
  }
  return { regressed: checks.some((c) => c.regressed) || missing.length > 0, checks, missing, unknown: checks.filter((c) => c.unknown).map((c) => c.name) };
}
