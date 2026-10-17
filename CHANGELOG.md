# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed

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
