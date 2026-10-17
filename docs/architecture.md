# Architecture

healthsweep has three parts:

| Part | File | Runs where | Job |
|---|---|---|---|
| Skill | `skills/healthsweep/SKILL.md` | Your Claude Code session | Holds every human gate and decides what happens next. |
| Workflows | `workflows/scan.js`, `workflows/verify.js` | Background, via the Workflow tool | The expensive fan-out: many agents in parallel. Never change your files. |
| CLI | `skills/healthsweep/scripts/healthsweep.mjs` + `skills/healthsweep/scripts/lib/*.mjs` | Node, called by the skill | Deterministic work: config, git checks, running your checks, dedup, cost estimate, compare, log. Zero dependencies, unit-tested. |

## Why the gates live in the skill and the fan-out in workflows

A workflow runs in the background and cannot stop to ask a person a question. healthsweep has four
points where a person must decide: a dirty working tree, the cost gate, each fix, and a regression
after a batch. Those all need `AskUserQuestion` in the main session, so they live in the skill.

The work between the gates is the opposite: dozens of independent, read-only agent calls that benefit
from running in parallel and from not filling your main context. That is what workflows are for. Each
workflow returns structured JSON plus a `next` instruction, and the skill picks up from there.

The deterministic steps are plain Node so they behave the same every run and can be tested without a
model: parsing test output, comparing runs, deduplicating findings, and rendering the evidence log
are not jobs for an agent.

Workflows must be resumable, so `scripts/check-workflows.mjs` rejects `Date.now()`, `new Date()`,
`Math.random()`, `import()`, `require()` and `process.` in `workflows/*.js`, and checks that every
phase used is declared in `meta.phases`.

## Data flow

```text
/healthsweep [path] [--scope] [--base] [--threshold] [--no-tier3] [--config]
  |
  |-- healthsweep.mjs init        -> config path, ground truth, checks (or: build a config with you)
  |-- healthsweep.mjs preflight   -> STOP if dirty; else run.json + runDir + startSha
  |-- git switch -c healthsweep/<run>
  |-- healthsweep.mjs checks --label baseline       (Tier 1)
  |-- Workflow healthsweep:scan   -> findings        (Tier 2)   -> <runDir>/tier2.json
  |-- Skill claude-security       -> CLAUDE-SECURITY-*/ (JSONL) (Tier 3, optional)
  |-- healthsweep.mjs consolidate -> findings.json, counts, cost estimates
  |-- [cost gate: you choose]
  |-- Workflow healthsweep:verify -> verdicts, draft fixes, reviews -> <runDir>/verify.json
  |-- for each fix [you approve]:
  |     git apply --check; git apply
  |     healthsweep.mjs checks --label after-<id> --files <changed>   (scoped)
  |     healthsweep.mjs compare --after after-<id>
  |     regressed -> git apply -R, report
  |     clean     -> healthsweep.mjs log --entry entries/<id>.json; commit fix + HEALTHSWEEP_LOG.md
  |-- healthsweep.mjs checks --label final ; compare --after final
  |     regressed -> git revert newest-first until clean (hard stop)
  |-- REPORT.md
```

### The scan workflow (Tier 2)

1. **Inventory.** One agent splits the scope into at most 12 modules (configurable by the skill via
   `maxModules`). Every source directory in scope must land in a module or in `skipped` with a reason.
   Dropped and skipped modules are logged so a gap never reads as "covered".
2. **Find.** One read-only finder per module per lens, all in parallel. The four lenses:
   - `logic`: wrong conditions, off-by-one, units and rounding, null paths, swallowed errors, wrong
     status transitions, missing boundary validation, missing data coerced to 0.
   - `consistency`: races between overlapping requests, non-idempotent retries, half-complete
     multi-step writes, two sources of truth for one value, totals or status from stale state, client
     state trusted over server state, stale caches. Each must name the exact interleaving.
   - `latency`: N+1 queries, sequential independent awaits, unbounded loops or result sets, blocking
     I/O on a request path, network calls inside a transaction, missing indexes or caching.
   - `maintainability`: only real risk, such as duplicated business rules that can drift apart.
   When the skill passes `inProgress` (from `--base`), one more agent security-reviews the branch diff.

### The verify workflow

A three-stage pipeline per finding:

1. **Verify.** Skeptic agents in a fresh context try to disprove the finding from the code. CRITICAL
   and HIGH findings get two lenses (`correctness` plus `reproduce`, or `latency` for latency
   findings); others get one. A finding is confirmed only if every verifier says it is real.
2. **Fix.** For confirmed findings, one fixer creates a detached git worktree at `startSha` under
   `<runDir>/wt/<id>`, runs `worktreeSetup`, writes a failing regression test, records the scoped test
   output before, makes the smallest root-cause change, records the output after, captures the diff
   and removes the worktree. Latency fixes run the benchmark before and after, or say "unmeasured".
3. **Review.** A third agent checks the patch against the ground-truth docs and active work, and
   checks that the tests show the new test failing before and passing after.

Each result gets a `recommendation`:

| Value | When |
|---|---|
| `propose` | Confirmed, fixed, reviewer approved, no behaviour change, and (for latency) benchmark numbers exist. |
| `manual-review` | Confirmed but no clean fix, or the reviewer flagged a behaviour change, doubt, missing evidence, or an unmeasured latency claim. |
| `reject` | The reviewer judged the patch wrong. |
| `dropped` | Not confirmed by the verifiers (false positive). |

Nothing is applied by the workflow. The skill shows every result with a diff and asks.

## Files written

Run artifacts live outside the repository so the clean-tree rule is not broken by healthsweep's own
files:

```text
~/.claude/healthsweep/
  <repo-folder-name>.json                 personal config (optional)
  runs/<repo-folder-name>/<timestamp>/
    run.json                              repoRoot, configPath, config, branch, startSha, inProgress
    checks/<label>-<check>.log            full output of every check run
    checks-<label>.json                   parsed results per label (baseline, after-<id>, final)
    tier2.json                            raw Tier 2 findings
    findings.json                         consolidated findings, counts, cost estimates, rejected
    verify.json                           verify workflow results
    wt/<id>/                              fixer worktrees (removed by the fixer when done)
    patches/<id>.patch                    each approved patch as applied
    entries/<id>.json                     input for each log entry
    REPORT.md                             final report
```

In the repository:

- `HEALTHSWEEP_LOG.md`, appended once per applied fix and committed with that fix. See
  [evidence-log.md](evidence-log.md).
- Commits on the `healthsweep/<timestamp>` branch, one per fix:
  `fix(healthsweep): <id> <title>` with `Evidence: HEALTHSWEEP_LOG.md#<id>`.
- Tier 3 writes its own `CLAUDE-SECURITY-*` directory, which ignores itself in git.

## Finding schema

Finders return this shape (from `workflows/scan.js`):

| Field | Type | Notes |
|---|---|---|
| `file` | string | Repository-relative path. Required. |
| `line` | integer | The exact line. Required. |
| `category` | `bug` \| `security` \| `latency` \| `maintainability` | Required. |
| `severity` | `CRITICAL` \| `HIGH` \| `MEDIUM` \| `LOW` | Required. |
| `confidence` | `HIGH` \| `MEDIUM` \| `LOW` | Optional. |
| `title` | string | One line. Required. |
| `evidence` | string | Verbatim code lines with line numbers, or a concrete trace or query shape. Never a paraphrase. Required. |
| `rationale` | string | The input or interleaving that triggers it, and what the user sees. Required. |
| `trigger` | string | A reproduction recipe. Optional. |

`consolidate` (in `skills/healthsweep/scripts/lib/consolidate.mjs`) normalizes each finding: severity is upper-cased,
category lower-cased, paths cleaned (`./`, backslashes, double slashes). A finding with an unknown
severity or category, no file, or empty evidence is **rejected**, not guessed at; rejected findings and
the reason are listed at the cost gate. Tier 3 records are mapped with `fromClaudeSecurity` (category
`security`, CWE and the plugin's finding id kept). After consolidation each finding also carries
`sources` (which tiers and lenses reported it) and an id `HS-001`, `HS-002`, ... in ranked order.

## How dedup works

Two findings are the same issue when they have the same file, the same category, and lines within
3 of each other. When they merge:

- the higher severity wins and its title and rationale are kept;
- `sources` becomes the union of both;
- evidence is concatenated with a `---` separator unless one already contains the other;
- `cwe` and `externalId` are kept from whichever has them.

The merged list is sorted by severity, then file, then line, and numbered. Findings in different
categories on the same line are kept apart on purpose: a race and a slow query on one line are two
problems with two fixes.

## How the cost estimate works

The estimate covers only the verify stage, which is where most of the spend is. It is shown at the
cost gate as a low-high range, never as a bill. The numbers are `DEFAULT_COST_MODEL` in
`skills/healthsweep/scripts/lib/cost.mjs`:

| Step | Tokens per finding |
|---|---|
| Verifier (re-reads code, re-derives evidence) | 60,000 |
| Fixer (patch in a worktree, scoped tests) | 120,000 |
| Requirements reviewer | 40,000 |
| Extra for latency findings (benchmark) | 30,000 |
| Spread | plus or minus 50 percent |

So each finding is planned at 220,000 tokens (250,000 for latency), and the gate shows
`low = 0.5 x total` and `high = 1.5 x total`. Two estimates are shown: findings at or above the
threshold (`costGate.threshold` or `--threshold`, default `MEDIUM`) and all findings.

The model is deliberately simple: it does not add the second verifier for CRITICAL and HIGH, and it
assumes every finding is confirmed and fixed. The real spend is reported afterwards from each
workflow's `outputTokens`, and `REPORT.md` sums them (plus Tier 3 from its own report).

## Test output parsing and regressions

`skills/healthsweep/scripts/lib/parse.mjs` reads the summary lines of jest, vitest, pytest, `node:test` and `go test`.
Unknown output gives `null` counts, never zeros, so "no data" never reads as "0 failures".

`skills/healthsweep/scripts/lib/compare.mjs` judges an after-run against the baseline for the same checks. A check
regresses when it times out (and did not before), exits non-zero after exiting 0, has failures that
were not in the baseline, passes fewer tests, fails more tests, or (bench) is slower by more than
`benchTolerancePct`. Tests that already failed in the baseline do not count against a fix.
