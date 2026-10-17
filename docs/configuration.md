# Configuration

healthsweep needs two things from you: the documents that say what your code is supposed to do, and
the commands that check it. Everything else is optional.

## Where the config is read from

First match wins:

1. `--config <file>` on the `/healthsweep` command line.
2. `.healthsweep.json` in the repository root. Commit it if your team shares it.
3. `~/.claude/healthsweep/<repo-folder-name>.json`. Personal, and keeps the repo untouched.

If none exists, the skill runs `init`, shows the ground-truth candidates it found (`PLAN.md`,
`SPEC.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`) and the checks it detected, asks you to
confirm them, and writes the config to the personal location (option 3) so your tree stays clean.

Detected checks come from: `package.json` scripts (`test` unless it is the npm placeholder, `lint`,
`typecheck`, `build`, `bench`), `go.mod` (`go test ./...`), `Cargo.toml` (`cargo test`), and
`pyproject.toml` / `pytest.ini` / `setup.cfg` / `tox.ini` (`pytest -q`). Treat these as a starting
point; replace them with your real commands, split into batches.

## Minimal config

```json
{
  "groundTruth": ["README.md"],
  "checks": [
    { "name": "unit", "kind": "test", "cmd": "npm test" }
  ]
}
```

## Full example

See [examples/healthsweep.config.example.json](../examples/healthsweep.config.example.json). It is
validated by the same code the plugin uses.

## Top-level fields

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `groundTruth` | string[] | yes | | Docs (repo-relative) that state intended behaviour. At least one. Every path must exist, or the run stops and asks. Fixes are reviewed against these. |
| `checks` | object[] | yes | | At least one command. Names must be unique. See below. |
| `activeWork` | string[] | no | `[]` | Docs about work in progress. Finders do not report documented in-progress behaviour as a bug, but still report bugs inside it. The reviewer flags fixes that collide with it. |
| `scope` | string[] | no | `[]` | Paths to sweep. Empty means the whole repository. `--scope a,b` on the command line takes precedence. |
| `exclude` | string[] | no | `[]` | Paths the inventory agent leaves out. |
| `notes` | string | no | `""` | Free text passed to every agent: stack, units, conventions. |
| `worktreeSetup` | string | no | `null` | Shell run inside each fixer worktree before tests, for example linking `node_modules`. `{repoRoot}` is replaced with the repository path. Blank is treated as unset. |
| `costGate.threshold` | `CRITICAL` \| `HIGH` \| `MEDIUM` \| `LOW` | no | `MEDIUM` | Findings at or above this severity are offered for verification by default. Case-insensitive. `--threshold` overrides it. |
| `costGate.maxTokens` | number | no | `null` | Accepted and stored with the run; not enforced in this version. |
| `benchTolerancePct` | number | no | `10` | A benchmark more than this percent slower than the baseline counts as a regression. |
| `tier3.enabled` | boolean | no | `true` | Run the Claude Security plugin scan (if installed). `--no-tier3` overrides it. |
| `tier3.effort` | string | no | `"medium"` | The effort passed to the Claude Security scan. |

## Check fields

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `name` | string | yes | | Unique. Used in log file names and comparisons. |
| `kind` | `test` \| `lint` \| `build` \| `bench` | yes | | `bench` checks run only when asked (latency fixes) and are compared by metric. |
| `cmd` | string | yes | | Shell command. |
| `cwd` | string | no | `"."` | Repo-relative working directory. Must stay inside the repository. |
| `timeoutSec` | integer | no | `900` | Hard kill (the whole process group) after this many seconds. Must be 1 to 3600. |
| `scope` | string[] | no | `[]` | Globs or `dir/` prefixes. A fix runs only checks whose scope covers a changed file. A check with no scope always runs. |
| `env` | object | no | `{}` | Extra environment variables. Every check also gets `CI=1` and `FORCE_COLOR=0`. |
| `metricRegex` | string | no | `null` | Bench only. The first capture group is the number in milliseconds. Must compile as a JavaScript regex. Remember to escape backslashes in JSON (`"p95=([\\d.]+)ms"`). |

Checks always run one at a time, never in parallel.

### Scope globs

- `**` matches any number of directories, `*` matches within one path segment, `?` one character.
- A pattern ending in `/` is a prefix match: `backend/src/api/` covers everything under it.
- Paths are matched against the repo-relative paths of the files a fix changed.

## Validation errors

The config is validated on every `init` and `preflight`. Errors start with
`invalid healthsweep config:` and name the problem:

| Message | Fix |
|---|---|
| `groundTruth must list at least one document that states intended behaviour` | Add a doc that says what correct means. |
| `checks must list at least one command` | Add a check. |
| `checks[N] has no name` / `check "x" has no cmd` | Fill in the field. |
| `check "x" has unknown kind "y" (use test\|lint\|build\|bench)` | Use one of the four kinds. |
| `check "x" timeoutSec must be 1-3600` | Use a whole number of seconds in range. |
| `check "x" metricRegex does not compile` | Fix the regex (and its JSON escaping). |
| `duplicate check name "x"` | Rename one. |
| `costGate.threshold must be one of CRITICAL\|HIGH\|MEDIUM\|LOW` | Use a valid severity. |

To validate a file yourself from a checkout of this repo:

```bash
node --input-type=module -e "import { validateConfig } from './skills/healthsweep/scripts/lib/config.mjs'; import { readFileSync } from 'node:fs'; validateConfig(JSON.parse(readFileSync(process.argv[1], 'utf8'))); console.log('valid')" path/to/config.json
```

## Tips

- **Split big suites.** Several scoped checks keep each fix's run short and stop one giant run from
  hanging the machine.
- **Add a benchmark if you care about latency.** Without a `bench` check, latency findings are
  manual-review only and never claimed as fixed.
- **Point ground truth at real intent.** A spec or README section that states behaviour. If none
  exists, the skill stops and asks; "looks fine to me" is not a standard.
