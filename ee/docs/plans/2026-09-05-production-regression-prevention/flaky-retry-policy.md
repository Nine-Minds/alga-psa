# Retry-only pass policy (F025, flaky column)

Operator decision, 2026-09-29. Applies to every lane that retries a test:
`production-browser`, `server-unit`, `integration`, `infrastructure`.

## Decision

`--retry=1` stays, and so does the flaky reporter. A retry is still the cheapest
way to keep a diagnosable artifact from a wedged run. What changes is that a
retry-only pass is never silently green:

- **`pull_request` runs stay green.** Each retried test gets a `::warning::`
  annotation naming it, so the author sees it in the checks UI without being
  blocked by somebody else's infrastructure hiccup.
- **`push` (main), `schedule`, `release` and `workflow_dispatch` runs fail the
  lane's own execution-verification step** when `flaky-tests.json` lists any
  test. This matches what the browser lane has always done and PRD.md line 99:
  "a retry-only pass is reported as flaky and does not silently satisfy the
  critical release gate."

An unset event name is treated as non-`pull_request`, so the strict path is the
default rather than the exception.

## Why record the event name and branch

Every `flaky-tests.json` document carries `eventName` (`GITHUB_EVENT_NAME`) and
`branch` (`GITHUB_HEAD_REF`, falling back to `GITHUB_REF_NAME`). The weekly
report counts pull-request occurrences and main/schedule occurrences separately
(`prOccurrences` / `mainOccurrences`, rendered as the **PR** and **Main**
columns) because the two are different problems: a test that only flakes under
one contributor's branch is usually that branch, while the same test flaking on
a merged revision is a shared defect.

Documents produced before this decision carry neither field. They aggregate into
an `unknown` bucket — counted as non-PR — for their thirty-day retention rather
than being rejected, so the transition never renders as a clean week.

## Where this lives

One implementation, `scripts/lib/flaky-policy.mjs`, is shared by all four
runners so the lanes cannot drift:

- `resetFlakyPublication()` / `publishFlakyTests()` — the journal is always
  written beside the lane's other evidence, but the upload directory is filled
  only when a test actually passed on retry. An empty artifact from every shard
  of every run would spend the weekly report's whole GitHub API budget reading
  nothing.
- `flakyPolicy()` — the warn-or-fail decision above.

`--retry=1` and `--reporter=scripts/lib/vitest-flaky-reporter.mjs` are passed by
`scripts/run-server-unit-shard.mjs`, `scripts/run-tier1-integration.mjs` and
`scripts/run-infrastructure-tests.mjs` on the Vitest command line. They are
deliberately **not** in `server/vitest.config.ts` or
`vitest.server-unit-shard.config.ts`: retry policy is a CI lane decision, and a
developer running the suite locally should still see the first failure.

## Out of scope

Quarantining, owner classification (F001), making any check required (F008) and
test selection (#3448) are all unchanged by this decision.
