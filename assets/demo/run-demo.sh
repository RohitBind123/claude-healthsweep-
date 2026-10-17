#!/usr/bin/env bash
# Drives the real healthsweep CLI on the toy repo in examples/demo-repo.
# No network, no AI agent: this shows only the deterministic engine. The finder
# output is sample data; in a real run the scan agents produce it.
#
#   bash assets/demo/run-demo.sh               # fast, for a quick check
#   DEMO_PAUSE=3 bash assets/demo/run-demo.sh  # paced and screen-cleared, for the GIF
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$REPO/skills/healthsweep/scripts/healthsweep.mjs"
PAUSE="${DEMO_PAUSE:-0}"

WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"            # never write into the real ~/.claude
mkdir -p "$HOME"
DEMO="$WORK/demo-jobs"

B=$'\e[1m'; D=$'\e[2m'; C=$'\e[36m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[0m'

STEPS=0
step() {
  if [ "$PAUSE" != "0" ]; then [ "$STEPS" -gt 0 ] && sleep "$PAUSE"; clear; fi
  STEPS=$((STEPS + 1))
  printf '%s== %s ==%s\n' "$B$C" "$1" "$R"
  [ -n "${2:-}" ] && printf '%s%s%s\n' "$D" "$2" "$R"
  return 0
}
cmd() { printf '%s$ %s%s\n' "$G" "$*" "$R" >&2; }
# Show temp paths short: the run dir as $RUN, everything else under /tmp.
scrub() { sed -e "s#${RUN:-//none//}#\$RUN#g" -e "s#$WORK#/tmp#g"; }
hs() {
  local a line="healthsweep"
  for a in "$@"; do [[ "$a" == *" "* ]] && a="\"$a\""; line+=" $a"; done
  cmd "$(printf '%s' "$line" | scrub)"
  node "$CLI" "$@"
}
hold() { if [ "$PAUSE" != "0" ]; then sleep "$1"; fi; }

# Print selected top-level keys of the JSON on stdin, one compact line each.
show() {
  node -e '
    const keys = process.argv.slice(1);
    const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
    for (const k of keys) {
      const v = k.split(".").reduce((a, p) => (a == null ? a : a[p]), o);
      console.log(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }' "$@" | scrub
}

# Setup: a fresh copy of the toy repo as its own git repository.
cp -R "$REPO/examples/demo-repo" "$DEMO"
mv "$DEMO/.sample-tier2.json" "$WORK/sample-tier2.json"
git -C "$DEMO" init -q
git -C "$DEMO" add -A
git -C "$DEMO" -c user.name=demo -c user.email= -c commit.gpgsign=false commit -qm "toy job queue"
cd "$DEMO"

step "1. init: config and ground truth" "A toy job queue. README.md is the ground truth: each job is claimed by exactly one worker."
hs init | show ok configPath config.groundTruth config.checks.0.cmd missingGroundTruth

step "2. preflight on a dirty tree" "Someone has uncommitted work. healthsweep must stop and touch nothing."
cmd "echo '// wip' >> src/jobs/claim.js"
echo '// wip' >> src/jobs/claim.js
hs preflight | show ok reason dirty
cmd "git diff --stat"
git diff --stat
printf '%sSTOP: dirty tree. Nothing stashed, reset or changed.%s\n' "$Y" "$R"

step "3. clean tree, preflight OK" "The user tidies up (here: drops the wip line), then re-runs."
cmd "git checkout -- src/jobs/claim.js"
git checkout -- src/jobs/claim.js
PRE="$(node "$CLI" preflight)"
cmd "healthsweep preflight"
printf '%s\n' "$PRE" | show ok branch startSha
RUN="$(printf '%s' "$PRE" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).runDir)')"
printf '  runDir: %s\n' "$RUN" | sed "s#$WORK#/tmp#g"
printf '%s(run files live under $HOME/.claude, outside the repo, so the tree stays clean)%s\n' "$D" "$R"

step "4. baseline checks (Tier 1): the real test suite" "All tests pass. They do not exercise two workers at once."
hs checks --run "$RUN" --label baseline 2>&1 >"$WORK/checks.json" | scrub
show ok checks.0.name checks.0.framework checks.0.exitCode checks.0.passed checks.0.failed <"$WORK/checks.json"

step "5. consolidate finder output" "SAMPLE finder output (in a real run the scan agents produce this): 3 raw findings."
cp "$WORK/sample-tier2.json" "$RUN/tier2.json"
hs consolidate --run "$RUN" --tier2 "$RUN/tier2.json" \
  | show counts.total counts.bySeverity counts.byCategory threshold estimateAboveThreshold rejected
node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const f of d.findings) console.log(`  ${f.id} ${f.severity.padEnd(4)} ${f.category.padEnd(7)} ${f.file}:${f.line}  ${f.title}\n         reported by: ${f.sources.join(", ")}`);
' "$RUN/findings.json"
printf '%sThe two race reports 3 lines apart were merged into one finding.%s\n' "$D" "$R"

step "6. prompt for an independent verifier (HS-001)" "Any agent can be handed this. It must try to DISPROVE the finding."
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const [shared, findings, lensDir, out, repoRoot] = process.argv.slice(1);
  const { buildContext, findingVars, verifyLensesFor } = await import(shared);
  const f = JSON.parse(readFileSync(findings, "utf8")).findings[0];
  const lens = verifyLensesFor(f)[1];
  const context = buildContext({ repoRoot, groundTruth: ["README.md"] });
  const vars = { ...findingVars(context, f), lens: readFileSync(`${lensDir}/${lens}.md`, "utf8").trim() };
  writeFileSync(out, JSON.stringify(vars));
' "$REPO/skills/healthsweep/scripts/lib/shared.mjs" "$RUN/findings.json" \
  "$REPO/skills/healthsweep/prompts/verify-lenses" "$WORK/vars.json" "$DEMO"
cmd "healthsweep prompt verifier --vars vars.json | head"
node "$CLI" prompt verifier --vars "$WORK/vars.json" | sed "s#$WORK#/tmp#g" | fold -s -w 120 | head -21
hold 2

step "7. report" "No verifier ran in this demo, so the report says so: report only, nothing changed."
hs report --run "$RUN" --tier3-reason "disabled in config" | show ok
cmd "cat \$RUN/REPORT.md   (excerpt)"
{ sed -n '1,6p' "$RUN/REPORT.md"; sed -n '/^## Baseline/,/^## Details/p' "$RUN/REPORT.md" | sed '$d'; } \
  | grep -v '^$' | sed "s#$WORK#/tmp#g" | cut -c1-132
hold "$PAUSE"; hold 2
