# Using healthsweep with any coding agent

healthsweep is an [Agent Skills](https://agentskills.io/specification) folder (`skills/healthsweep/`)
with a zero-dependency Node CLI inside it. Any agent that reads SKILL.md folders can run it. How the
heavy work fans out depends on what your agent can do:

| Mode | When | Fan-out | Independent verification |
|---|---|---|---|
| A. Claude Code workflows | Claude Code with the plugin installed | dynamic workflows (`healthsweep:scan`, `healthsweep:verify`) | yes, fresh sub-agents |
| B. Headless agents | any agent, plus at least one agent CLI on `PATH` | `healthsweep fanout`: one fresh agent process per task | yes, fresh processes |
| C. Scan only | no workflows and no agent CLI | the agent runs each finder prompt itself | no, so the run ends as report-only |

The prompts (`skills/healthsweep/prompts/`), JSON schemas (`skills/healthsweep/schemas/`) and pipeline
rules (`scripts/lib/shared.mjs`) are shared by all three modes, so a finding is judged the same way
whichever agent runs it.

## Install

Claude Code (recommended: adds workflows and the Tier 3 Claude Security scan):

```text
/plugin marketplace add RohitBind123/claude-healthsweep-
/plugin install healthsweep@healthsweep
```

Every other agent:

Pin a version (`healthsweep@0.2.2`, as below) so the install is reproducible and runs code you have reviewed. Without npm, install straight from a GitHub release: `npx github:RohitBind123/claude-healthsweep-#v0.2.2 install --agent codex`.

```bash
npx healthsweep@0.2.2 install --agent codex     # or cursor, gemini, copilot, opencode, claude
npx healthsweep@0.2.2 install --agent agents    # ~/.agents/skills, read by most agents
npx healthsweep@0.2.2 install --all             # every agent's folder
npx healthsweep@0.2.2 install --agent copilot --project   # into this repo (.github/skills)
```

Add `--link` to symlink a local checkout instead of copying (handy while developing) and `--dry-run`
to see where it would go. Restart the agent afterwards.

| Agent | User folder | Project folder |
|---|---|---|
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| Codex CLI | `~/.agents/skills` | `.agents/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| Gemini CLI | `~/.gemini/skills` | `.gemini/skills` |
| GitHub Copilot | `~/.copilot/skills` | `.github/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |
| Shared | `~/.agents/skills` (Codex, Cursor, Gemini CLI, Copilot, OpenCode) | `.agents/skills` |

## Mode B: choose the agent that runs the sub-tasks

Add an `agent` entry to your healthsweep config. A preset is easiest:

```json
{ "agent": { "preset": "codex", "concurrency": 3, "timeoutSec": 1200, "env": "minimal" } }
```

`healthsweep agents` lists the presets and which CLIs are installed. Each preset has a read-only
command (finders, verifiers, reviewers) and a write command (the fixer, which works inside a private
git worktree that the CLI creates, sets up and removes):

| Preset | Read-only command | Fixer command | Tested |
|---|---|---|---|
| `claude` | `claude -p --permission-mode plan --output-format json` | `claude -p --permission-mode acceptEdits --allowedTools "Bash Read Edit Write Glob Grep" --output-format json` | yes (smoke test, 2026-10-17) |
| `codex` | `codex exec -s read-only --skip-git-repo-check --ephemeral -` | `codex exec -s workspace-write --skip-git-repo-check --ephemeral -` | yes (smoke test, 2026-10-17) |
| `cursor` | `agent -p "…" --mode ask --output-format text --trust` | `agent -p "…" --force --output-format text --trust` | from docs |
| `gemini` | `gemini -p "…" --approval-mode plan -o json` | `gemini -p "…" --approval-mode auto_edit -o json` | from docs |
| `copilot` | `copilot -p "$(cat {promptFile})" -s --no-ask-user --allow-tool=read --deny-tool=write --deny-tool=shell` | `copilot … --allow-all-tools` | from docs |
| `opencode` | `opencode run --agent plan "$(cat {promptFile})"` | `opencode run "$(cat {promptFile})"` | from docs |

Your own command works too:

```json
{ "agent": { "command": "my-agent --read-only", "writeCommand": "my-agent --sandbox workspace" } }
```

The prompt goes to the command on standard input. If the command contains `{promptFile}`, the prompt
is written to a temporary file and that path is substituted instead. The agent's answer must end with
one JSON object; healthsweep extracts it (fenced or bare, or inside a `{"result": "..."}` envelope),
validates it against the role's schema, and asks once more if it does not match.

The fixer's diff is taken from `git` in the worktree, never from the agent's own description, and
anything the `worktreeSetup` step created is left out.

### Safety notes for Mode B

- Changing `agent` (or any command) changes the config fingerprint, so healthsweep asks you to trust
  the config again before anything runs.
- `fanout verify` drafts fixes only with `--allow-write`. The skill asks first and shows the exact
  write command. Without the flag only the read-only verifiers run.
- The fixer can edit files and run commands. It runs inside a throwaway worktree under
  `~/.claude/healthsweep/runs/…`, never in your repository, but a write-mode agent can still reach
  anything your user account can. Use your agent's sandbox options where it has them.
- Agents get a minimal environment by default (`"env": "minimal"`): PATH, HOME, locale, proxy
  settings and the agent tools' own auth variables, not every secret in your shell. Use
  `"env": "inherit"` only if your agent needs something else.
- If the fixer changes git hooks or git config, its patch is discarded and the finding is marked
  `reject`. The configured checks run in the worktree and are compared with your baseline, so a fix
  that breaks a check is never proposed.
- Ctrl-C stops every agent process healthsweep started.
- Read-only presets rely on each tool's own read-only or plan mode. Check your tool's docs if you
  change them.
- Presets marked "from docs" have not been run end to end by the maintainers yet. Reports welcome.

## Mode C: by hand

`healthsweep prompt --list` lists the roles. `healthsweep prompt finder --vars vars.json --schema findings`
prints the exact prompt plus the schema its answer must match, so any agent (or a person) can run a
role and save the JSON.
