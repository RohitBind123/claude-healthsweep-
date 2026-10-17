# The evidence log

Every fix healthsweep applies gets one entry in `HEALTHSWEEP_LOG.md` at the root of your repository.
The entry is committed in the same commit as the fix, so `git log` and the log always agree: if a fix
is reverted, its entry goes with it.

The log is written by `healthsweep.mjs log` using `scripts/lib/logentry.mjs`. The skill never writes
entries by hand.

## What an entry contains

| Part | Source | Notes |
|---|---|---|
| Heading | date, finding id, severity, category, title | `## <date> · <id> · <severity> · <category> · <title>` |
| Where | finding `file:line` | |
| Approved by | `approvedBy` | Always `user`: a fix is only applied after you approve it in this run. |
| Commit | `commit` | Shown only when set. |
| Finding evidence (before) | the finding's verbatim code lines or trace | |
| Independent verification | the verifiers' own reasoning and reproduction | Not a restatement of the finding. |
| Change (before -> after) | the real `git diff` of the patch | |
| Tests before the fix | real output tail of the same checks from the baseline | |
| Tests after the fix | real output tail of the scoped run after applying | |
| Benchmark | command plus before and after numbers | Without a benchmark the entry says no performance claim is made. |

`date`, `diff`, `testsBefore`, `testsAfter` and `verification` are required. The renderer refuses an
entry with any of them missing or blank, so an entry can never claim a fix without the evidence.
Triple backticks inside any field are neutralized so evidence cannot break out of its code block.

## Example

This is real output of `renderLogEntry` for a sample entry (the header is written once, when the
file is created):

````markdown
# HEALTHSWEEP_LOG

Evidence log written by [healthsweep](https://github.com/RohitBind123/claude-healthsweep-).
Each entry is one approved fix: the finding, how it was verified, the exact change, and the real
test output before and after. Each entry is committed together with its fix, so `git log` and this
file always agree. This log raises confidence; it is not a proof that nothing broke.


## 2026-10-17 · HS-002 · HIGH · bug · Premium total trusted from stored quote, not recomputed from the selected plan

**Where:** `src/quotes/checkout.ts:57`  
**Approved by:** user  
**Commit:** `3f9c2ab`

**Finding evidence (before):**

```
55  const quote = await repo.getQuote(quoteId);
56  const plan = await repo.getPlan(input.planId);
57  const amount = quote.totalPremium; // stored by the last calculate call
```

**Independent verification:** Reproduced with two overlapping calculate calls for plan A then plan B: the slower response for plan A wrote totalPremium last, and checkout charged plan A while the screen showed plan B. Nothing re-checks the stored total against plan.id before charging.

**Change (before -> after):**

```diff
diff --git a/src/quotes/checkout.ts b/src/quotes/checkout.ts
--- a/src/quotes/checkout.ts
+++ b/src/quotes/checkout.ts
@@ -54,7 +54,10 @@ export async function checkout(quoteId, input) {
   const quote = await repo.getQuote(quoteId);
   const plan = await repo.getPlan(input.planId);
-  const amount = quote.totalPremium; // stored by the last calculate call
+  if (quote.planId !== plan.id) {
+    throw new ConflictError("quote total belongs to a different plan; recalculate");
+  }
+  const amount = quote.totalPremium;
```

**Tests before the fix:**

```
FAIL src/quotes/checkout.test.ts
  ● checkout > rejects a total calculated for a different plan

Tests:       1 failed, 41 passed, 42 total
```

**Tests after the fix:**

```
PASS src/quotes/checkout.test.ts

Tests:       42 passed, 42 total
```

**Benchmark:** No benchmark run. No performance claim is made for this change.
````

## Reading the log

- One entry, one fix, one commit. The commit message is `fix(healthsweep): <id> <title>` with a
  body line `Evidence: HEALTHSWEEP_LOG.md#<id>`.
- "Tests before" for a new regression test should fail and "tests after" should pass, with nothing
  else newly failing. The requirements reviewer checks this before a fix is proposed, and the skill
  re-runs the scoped checks after applying.
- The log raises confidence. It is not a proof that nothing broke: the full suite is re-run after the
  batch, and any regression stops the run and reverts fixes until the suite matches the baseline.
