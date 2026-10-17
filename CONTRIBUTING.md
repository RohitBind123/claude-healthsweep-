# Contributing to healthsweep

Thanks for helping. Bug reports, docs fixes and pull requests are all welcome.

## Development setup

You need Node.js 20 or newer and git. There are no npm dependencies.

```bash
git clone https://github.com/RohitBind123/claude-healthsweep-.git
cd claude-healthsweep-
npm run check
```

`npm run check` runs two things, and CI runs the same:

- `npm run build`: regenerate `workflows/*.js` from `src/workflows/` and the shared prompts. Never edit `workflows/` by hand.
- `npm run check:workflows`: confirms `workflows/` is up to date, then static checks on `workflows/*.js` (they parse, start with a literal
  `meta` block, declare every phase they use, and avoid APIs that break resume).
- `npm test`: unit tests for `skills/healthsweep/scripts/lib/*.mjs` and the CLI, using `node:test`.

## Repository layout

```text
.claude-plugin/     plugin.json and marketplace.json
skills/healthsweep/ the /healthsweep skill (all human gates) and its config reference
workflows/          scan.js (Tier 2) and verify.js (verify, fix, review)
scripts/            healthsweep.mjs CLI and its pure helpers in lib/
tests/              node:test unit tests
docs/               architecture, configuration, evidence log
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit.

## Testing the plugin locally

Load the plugin straight from your checkout, without installing it:

```bash
claude --plugin-dir .
```

Validate the manifests:

```bash
claude plugin validate .
```

Then, in a separate clean git repository you are happy to experiment on, run `/healthsweep` with a
small `--scope`. Dynamic workflows must be enabled (on Pro: `/config`). After editing the skill or a
workflow inside a running session, use `/reload-plugins`.

## Rules for changes

- **Workflows must stay resumable.** No `Date.now()`, `new Date()`, `Math.random()`, `import()`,
  `require()` or `process.` in `workflows/*.js`. `npm run check:workflows` enforces this. Anything
  time- or environment-dependent belongs in the skill or the CLI.
- **Human gates stay in the skill.** Workflows run in the background and must never change the user's
  files or decide on their behalf.
- **Deterministic logic goes in `skills/healthsweep/scripts/lib/` with tests.** Write the test first.
- **Missing data is not zero.** Parsers return `null` for unknown counts, never `0`.
- **No new runtime dependencies** without discussing it in an issue first.
- Keep the language in prompts and docs plain. No emojis.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, `perf:`. A scope is welcome, for
example `fix(verify): ...`.

Before opening a pull request:

1. `npm run check` passes.
2. `claude plugin validate .` passes if you touched `.claude-plugin/`, `skills/` or `workflows/`.
3. Add an entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
4. Fill in the pull request template, including how you tested.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE) and
that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
