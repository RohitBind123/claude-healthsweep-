# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- README, architecture, configuration and evidence-log docs, an example config, banners and a demo
  recording script.
- Community files, CI (tests, manifest checks, markdownlint, link check) and a tag-driven release
  workflow.

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
