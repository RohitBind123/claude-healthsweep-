// Minimal glob matching (**, *, ?) for mapping changed files to the checks that cover them.

export function globToRegExp(glob) {
  let re = '';
  const g = String(glob);
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      const slash = g[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(file, patterns = []) {
  return patterns.some((p) => (p.endsWith('/') ? file.startsWith(p) : globToRegExp(p).test(file)));
}

// Scoped run: checks whose scope covers a changed file, plus checks with no scope
// (we cannot prove they are unaffected). Bench runs only when asked.
export function selectScopedChecks(checks, changedFiles, opts = {}) {
  return checks.filter((c) => {
    if (c.kind === 'bench' && !opts.includeBench) return false;
    if (!c.scope || c.scope.length === 0) return true;
    return changedFiles.some((f) => matchesAny(f, c.scope));
  });
}
