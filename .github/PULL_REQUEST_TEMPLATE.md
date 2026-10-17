## What and why

<!-- One or two sentences: what this changes and the problem it solves. Link the issue if there is one. -->

## How I tested it

<!-- Commands you ran and what you saw. For skill or workflow changes, describe a real /healthsweep run. -->

- [ ] `npm run check` passes
- [ ] `claude plugin validate .` passes (if `.claude-plugin/`, `skills/` or `workflows/` changed)

## Checklist

- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` ...)
- [ ] Workflows still avoid `Date.now()`, `new Date()`, `Math.random()`, `import()`, `require()` and `process.`
- [ ] No human gate moved out of the skill, and nothing applies a change without approval
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` for user-visible changes
- [ ] Docs updated if behaviour or config changed
