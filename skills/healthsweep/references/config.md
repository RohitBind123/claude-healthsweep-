# healthsweep config reference

Where it is read from, first match wins:

1. `--config <file>`
2. `.healthsweep.json` in the repository root (commit it if your team shares it)
3. `~/.claude/healthsweep/<repo-folder-name>.json` (personal, keeps the repo untouched)

```json
{
  "groundTruth": ["README.md", "docs/SPEC.md"],
  "activeWork": ["docs/current-sprint.md"],
  "scope": ["src/api", "src/core"],
  "exclude": ["src/legacy"],
  "notes": "TypeScript service on Node 20 with PostgreSQL. All timestamps are UTC.",
  "checks": [
    { "name": "unit-api", "kind": "test", "cmd": "npx jest src/api", "cwd": "backend", "timeoutSec": 900, "scope": ["backend/src/api/**"] },
    { "name": "typecheck", "kind": "lint", "cmd": "npx tsc --noEmit", "cwd": "backend", "timeoutSec": 600 },
    { "name": "build", "kind": "build", "cmd": "npm run build", "cwd": "backend", "timeoutSec": 900 },
    { "name": "bench-api", "kind": "bench", "cmd": "node bench/api.mjs", "metricRegex": "p95=([\\d.]+)ms", "timeoutSec": 300 }
  ],
  "worktreeSetup": "ln -s {repoRoot}/backend/node_modules backend/node_modules",
  "costGate": { "threshold": "MEDIUM" },
  "benchTolerancePct": 10,
  "tier3": { "enabled": true, "effort": "medium" }
}
```

| Field | Meaning |
|---|---|
| `groundTruth` | Required. Docs that state intended behaviour. Fixes are checked against them. |
| `activeWork` | Docs about work in progress. Finders do not report documented in-progress behaviour as a bug. |
| `scope` / `exclude` | Paths to sweep. Empty scope = the whole repository. |
| `checks[].kind` | `test`, `lint`, `build` or `bench`. Checks run one at a time, never in parallel. |
| `checks[].scope` | Globs (`**`, `*`) or `dir/` prefixes. A fix runs only the checks whose scope covers its files. A check with no scope always runs. |
| `checks[].timeoutSec` | Hard kill after this many seconds (max 3600). Default 900. |
| `checks[].metricRegex` | Bench only: first capture group is the number in milliseconds. |
| `worktreeSetup` | Shell run inside each fixer worktree before tests (for example linking `node_modules`). `{repoRoot}` is replaced. |
| `costGate.threshold` | Findings at or above this severity are offered for verification by default. |
| `benchTolerancePct` | A bench more than this percent slower than baseline is a regression. |
| `tier3` | Run the Claude Security plugin scan, and at which effort. |

Split large suites into several checks with scopes. That keeps each fix's scoped run short and stops a
single giant run from hanging the machine.
