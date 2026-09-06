# Test discovery and execution evidence

The workspace database lane verifies that each expected test was collected and
executed. It rejects a successful runner exit when files or assertions are
missing, skipped, pending or marked todo.

## Run workspace database tests

Use Node within the root package's supported engine range, install locked
dependencies with `npm ci`, and build the shared libraries listed in
[Integration Tests](../../.github/workflows/integration-tests.yml). Provide
isolated PostgreSQL and Redis services through `DB_*` and `REDIS_*` variables.
The database helpers recreate `test_database`; do not share that database with
another run or a development application.

From the repository root:

```sh
CI=1 node scripts/run-workspace-db-tests.mjs
```

To investigate one suite:

```sh
CI=1 node scripts/run-workspace-db-tests.mjs calendarMonthEndCloseActions.db.test.ts
```

An invocation with file filters records `selection.mode: filtered`. Use the
unfiltered command to verify the complete workspace database lane.

## Add a database regression

Place colocated `*.db.test.ts` or `*.db.test.tsx` tests under `packages/`,
`shared/` or `ee/packages/`. The runner config also supports JavaScript and
CommonJS/ESM filename variants. Use migrated schema and the existing database
helpers. Assert persisted outcomes and rejected operations across the boundary
that failed. Demonstrate the regression fails with the defect restored before
relying on the passing result.

Run the unfiltered command after adding or moving a test. Its discovery check
compares Git's test-file inventory with Vitest's actual file collection. A file
inside this lane's scope that Vitest omits causes failure. Files execute
serially because the existing helpers share a database name. CI jobs receive
separate database and Redis services.

## Inspect the artifacts

Local output is under `test-results/workspace-db/`. CI uploads the same files as
the `workspace-db-evidence` artifact, including on failure.

| File | Evidence |
| --- | --- |
| `discovery.json` | Repository candidates, collecting runners and unmatched files |
| `collected.json` | Vitest's selected file identities |
| `collected-tests.json` | Vitest's individual test names before execution |
| `results.json` | Vitest's execution report |
| `evidence.json` | Reconciled file/test identities, separate result counts, selection and source revision |

An interrupted process can leave null or missing reports. Those artifacts do
not demonstrate a complete run. `evidence.json` records failures for errors the
wrapper can handle. It also records the Git revision and changed paths before
and after execution. A revision change fails the run. A dirty working tree is
reported explicitly; a local pass with edits does not establish that a clean
commit or release image passed. GitHub pull-request checkouts can use a
synthetic merge revision, so compare the recorded revision with the workflow's
checkout rather than assuming it equals the branch head.

## Extend the accounting to another runner

Use `reconcileDiscovery` in
[`scripts/lib/test-discovery.mjs`](../../scripts/lib/test-discovery.mjs) with an
independent candidate inventory and actual runner collection. It rejects empty
mandatory collections, unmatched files and stale exclusions. If a manual
exclusion is necessary, supply the exact file, owner, reason, tracking issue
and an expiry date. Exclusions remain visible in the result. The workspace
database lane currently supplies no exclusions.

Use `reconcileExecution` in
[`scripts/lib/test-execution-evidence.mjs`](../../scripts/lib/test-execution-evidence.mjs)
to compare collection with the execution report. Preserve file identity,
nested test names and duplicate parameterized-name counts when adapting a
runner. This adapter currently consumes Vitest JSON; other reporter formats
need their own verified adapter.

Verify the accounting itself with:

```sh
node --test scripts/tests/test-discovery.test.mjs scripts/tests/test-execution-evidence.test.mjs
node --test scripts/tests/test-discovery.vitest.test.mjs
```

The second command requires installed server dependencies. It adds and moves
tests in a disposable Git workspace, invokes the installed Vitest binary,
detects the missing collection, repairs the configuration and reconciles the
executed tests.

## Generated calendar cases

`calendarMonthEndCloseActions.db.test.ts` uses the pinned fast-check dependency
for a 64-run calendar campaign, including explicit leap-year, century-year and
timezone-boundary examples. It seeds real PostgreSQL periods, reads hydrated
dates and invokes the month-end-close action. Its expected eligibility uses
`Date.UTC` and `Intl` calendar calculations independently of the production
policy. Invoice creation remains mocked in this action-level regression;
invoice persistence and browser behavior require their own suites.

Failures report a seed, a shrunk counterexample and its replay path. To replay
that case, copy the values from the failure into the same database command:

```sh
CI=1 FC_SEED=20260906 FC_PATH='0:0:0' node scripts/run-workspace-db-tests.mjs calendarMonthEndCloseActions.db.test.ts
```

Omit `FC_PATH` for the full campaign. `FC_SEED` selects another repeatable
campaign; the default seed is 20260906. A fixed implementation should pass the
previously failing case. See the
[fast-check runner documentation](https://fast-check.dev/docs/core-blocks/runners/)
for failure reporting.

## Verify integration selection

The workflow selector and Tier-1 runner share
[`integration-selection.mjs`](../../scripts/lib/integration-selection.mjs).
Dependency, schema, harness, script, service and EE package changes require the
full integration directory. Missing Git evidence or a failed affected-graph
lookup also widens coverage. Documentation-only changes may skip the workflow;
a direct runner invocation retains the mandatory manifest floor. Every floor
entry must exist and collect tests under the installed Vitest configuration.

```sh
node --test scripts/tests/integration-selection.test.mjs scripts/tests/integration-selection.vitest.test.mjs
```

The installed-runner check invokes both entry points in a disposable Git
repository. It inspects workflow outputs and actual execution reports, covering
affected selection, missing revisions, a failed Git diff, an unavailable graph,
and moved or empty manifest entries.

## Current enforcement scope

This accounting is wired into the workspace database lane. It does not yet
establish repository-wide discovery, complete execution evidence for the other
unit/integration/browser lanes, a required aggregate release gate, or release
image provenance. Track those deliverables in the
[production regression prevention plan](../../ee/docs/plans/2026-09-05-production-regression-prevention/PRD.md).
