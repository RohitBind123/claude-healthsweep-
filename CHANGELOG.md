# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The release workflow publishes to npm with Trusted Publishing (GitHub OIDC) instead of an
  `NPM_TOKEN` secret, and skips a version that is already on npm.
- Docs: release steps for maintainers (CONTRIBUTING.md), how to verify a release's provenance
  (SECURITY.md), and an npm badge in the README.

## [0.2.1] - 2026-10-17

### Added

- Published to npm as `healthsweep`: `npx healthsweep install --agent <name>`.
- `healthsweep --version`.
- The release workflow publishes to npm (with provenance) and attaches the package tarball to the
  GitHub release.
- Package test: packs the real tarball, installs it into an empty project and runs it.

## [0.2.0] - 2026-10-17

### Added

- Works with any coding agent that reads SKILL.md folders: Codex CLI, Cursor, Gemini CLI, GitHub
  Copilot, OpenCode, as well as Claude Code.
- `fanout scan` and `fanout verify`: run every finder, verifier, fixer and reviewer as a fresh headless
  agent process (presets for claude, codex, cursor, gemini, copilot, opencode, or your own command),
  so verification stays independent on agents without sub-agents.
- `install`: put the skill where each agent looks (`npx github:RohitBind123/claude-healthsweep- install --agent <name>`).
- `report`: deterministic REPORT.md, including report-only runs and near-duplicate groups.
- `prompt` and `agents` commands.
- README, architecture, configuration, evidence-log and agents docs, an example config, banners and a
  demo recording script.
- Community files, CI (tests, manifest checks, markdownlint, link check) and a tag-driven release
  workflow.

### Changed

- The skill folder is self-contained: CLI, prompts and schemas live in `skills/healthsweep/`.
- Prompts and JSON schemas are plain files shared by every mode; `workflows/*.js` are generated
  from `src/workflows/` (`npm run build`).
- The fixer worktree is created and removed by the CLI in Mode B, and the diff comes from git.

### Security

- A config's commands (checks, setup step, agent commands, env, notes) never run until the user has
  seen and trusted that exact set for that repository; any change needs trust again.
- Mode B fixer runs only with `--allow-write`, with a minimal environment, git hooks disabled for our
  git calls, and tamper detection on the shared hooks and git config.
- Patches are taken from git against a post-setup snapshot; configured checks run in the worktree and
  are compared with the baseline; build/CI/lockfile/dotfile or out-of-scope changes are never proposed
  as safe, and symlinks or mode changes are rejected.
- Secrets are redacted in findings, REPORT.md and HEALTHSWEEP_LOG.md; run artefacts are private.
- HEALTHSWEEP_LOG.md is written without following symlinks; finding paths, `--files`, `--ids`,
  `--stamp` and `--label` are validated; markdown in titles and paths is escaped.
- Installer refuses symlinked or self-overlapping destinations and folders it did not create.
- GitHub Actions pinned to commit SHAs; release job is the only one with write access.

### Fixed

- Fan-out patches kept their final newline (they were trimmed and failed `git apply`), and staged,
  committed or renamed fixer changes are captured.
- Agent runner: validated concurrency and timeouts, no crash when an agent cannot start, capped output,
  linear JSON extraction, no hang when a grandchild holds the pipes, signals kill every agent.
- Deduplication no longer merges different bugs a few lines apart; comparison reports checks it cannot
  judge as unknown and treats a missing check or lost bench metric as a regression.
- Flags accept `--key=value` and `--`, and value flags without a value are errors.
- Test-runner output is decoded as a stream, and failing-test names are normalised, so a split
  multi-byte character or jest's duplicated summary no longer looks like a new failure.
- The check runner waits for its log file to flush before it returns.

## [0.1.0] - 2026-10-17

### Added

- `/healthsweep` skill that holds every human gate: clean-tree stop, sweep branch and recovery point,
  cost gate, per-fix approval, and a hard stop with newest-first reverts on a full-suite regression.
- `healthsweep:scan` workflow (Tier 2): module inventory, then one read-only finder per module per
  lens (logic, consistency, latency, maintainability), plus a security review of the branch diff
  when `--base` is given.
- `healthsweep:verify` workflow: skeptic verifiers (two lenses for CRITICAL and HIGH), a test-first
  fixer in a private git worktree, and a requirements reviewer that checks each patch against the
  ground-truth docs and active work. Applies nothing.
- Optional Tier 3 via the Claude Security plugin, merged into the same findings list.
- `healthsweep.mjs` CLI with `init`, `preflight`, `checks`, `compare`, `consolidate` and `log`.
- Config loading from `--config`, `.healthsweep.json` or `~/.claude/healthsweep/<repo>.json`, with
  validation and check auto-detection for npm, Go, Cargo and pytest projects.
- Sequential check runner with hard per-check timeouts and scoped runs by glob.
- Test output parsing for jest, vitest, pytest, `go test` and `node:test`; unknown output is recorded
  as unknown, never as zero.
- Baseline comparison that ignores pre-existing failures and flags benchmark slowdowns past a
  tolerance.
- Finding consolidation with validation, dedup (same file, category, and lines within 3) and ranking.
- Token cost estimate for the verify stage, shown as a range at the cost gate.
- `HEALTHSWEEP_LOG.md` evidence log with the real diff and real test output for every applied fix.

[Unreleased]: https://github.com/RohitBind123/claude-healthsweep-/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/RohitBind123/claude-healthsweep-/releases/tag/v0.1.0
