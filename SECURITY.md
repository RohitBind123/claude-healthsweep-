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

- **It runs in your agent session with your permissions.** The skill, the workflows and the agents
  they start can read files and run commands that your session is allowed to run.
- **A config is code, and nothing in it runs until you trust it.** `checks[].cmd`, `cwd`, `env`,
  `worktreeSetup`, the agent commands and `notes` are fingerprinted. `preflight` refuses an untrusted
  or changed config and lists every command; the skill shows them to you and records trust only on
  your explicit yes (`~/.claude/healthsweep/trusted/`). `checks` and `fanout` re-check trust.
- **The fixer is opt-in and watched, not sandboxed.** In Mode B the fixer runs only with
  `--allow-write`, in a throwaway worktree, with a minimal environment (no unrelated secrets from your
  shell). Git hooks are disabled for healthsweep's own git calls, and if the shared hooks or git
  config change while a fixer runs, its patch is discarded. A write-mode agent can still reach what
  your account can reach: use your agent's sandbox options where it has them.
- **Patches are judged by code, not only by a model.** The patch is taken from git, the configured
  checks run in the worktree and are compared with the baseline, and patches that touch build, CI,
  lockfile or dot files, files outside the finding's folder, symlinks or file modes are never
  proposed as safe.
- **Only scan code you trust.** Agents read the repository and fixer agents run its tests. Prompts
  tell every agent to treat repository text as evidence, not instructions, and finder and verifier
  agents are told to stay read-only. These are instructions to a model, not an enforced boundary, so
  a hostile repository may still try to steer them.
- **What it writes.** Run artifacts go to `~/.claude/healthsweep/runs/`. In the repository it writes
  only `HEALTHSWEEP_LOG.md` and commits on a new `healthsweep/*` branch, and only for fixes you approve.
  It never pushes, opens pull requests or deploys.
- **Secrets are redacted, best effort.** Findings, REPORT.md and the committed HEALTHSWEEP_LOG.md
  pass through a redactor for common token formats, private keys, `password=`-style assignments and
  URL passwords. Raw check logs in the run directory are not redacted and are private to your user
  (umask 077). Review the log before you push the `healthsweep/*` branch.
- **Writes are symlink-safe.** HEALTHSWEEP_LOG.md is opened without following symlinks and must stay
  inside the repository; finding paths must be repository-relative.

Issues in scope include: a way to make healthsweep apply a change without approval, write outside the
locations above, bypass the dirty-tree stop, or run commands that are not in the user's config.
