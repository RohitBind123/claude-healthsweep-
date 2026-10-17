# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories:
[Report a vulnerability](https://github.com/RohitBind123/claude-healthsweep-/security/advisories/new).

Do not open a public issue for a security problem. Include what you found, how to reproduce it, and
the impact you expect. You should get a first response within a week. Fixes are released as a new
version and noted in the [changelog](CHANGELOG.md).

## Supported versions

Only the latest release receives security fixes.

## Trust model

healthsweep is not a sandbox. Know what it does before you run it:

- **It runs in your Claude Code session with your permissions.** The skill, the workflows and the
  agents they start can read files and run commands that your session is allowed to run.
- **It runs your configured commands.** `checks[].cmd` and `worktreeSetup` are executed through a
  shell, in your repository and in temporary git worktrees. A config file is code: review a
  `.healthsweep.json` from someone else before using it.
- **Only scan code you trust.** Agents read the repository and fixer agents run its tests. Prompts
  tell every agent to treat repository text as evidence, not instructions, and finder and verifier
  agents are told to stay read-only. These are instructions to a model, not an enforced boundary, so
  a hostile repository may still try to steer them.
- **What it writes.** Run artifacts go to `~/.claude/healthsweep/runs/`. In the repository it writes
  only `HEALTHSWEEP_LOG.md` and commits on a new `healthsweep/*` branch, and only for fixes you approve.
  It never pushes, opens pull requests or deploys.
- **Check output is stored.** Full logs of your checks are kept in the run directory. If your tests
  print secrets, those logs will contain them.

Issues in scope include: a way to make healthsweep apply a change without approval, write outside the
locations above, bypass the dirty-tree stop, or run commands that are not in the user's config.
