# Test Metrics Sheet

CI appends one row per test run to a shared Google Sheet, so you can watch
pass rates and coverage move over time instead of opening individual Actions
runs. `scripts/record-test-metrics.mjs` does the recording, and also writes
the same numbers as a table on the Actions run summary page. It never fails a
build: the step runs with `continue-on-error` and exits quietly when the
Google credentials are not configured.

## Which runs record

| Suite label | Workflow | When |
|---|---|---|
| `unit-coverage` | `unit-tests.yml` (coverage job) | every push to main |
| `integration-tier1` | `integration-tests.yml` | push to main |
| `integration-full` | `integration-tests.yml` | nightly cron, manual `suite: full` dispatch |
| `infrastructure-full` | `integration-tests.yml` | nightly cron, manual `suite: full` dispatch |

PR runs are not recorded. They would flood the sheet, and fork PRs cannot read
the secret anyway.

Red runs still record — a drop in pass rate is the signal the sheet exists to
show. Cancelled runs do not: each recording step is gated on the suite step's
`outcome` being `success` or `failure`, so a run the job timeout killed leaves
no row instead of a row covering the fraction of the suite that finished.

The integration and infrastructure suites run in separate jobs. They shared one
job until 2026-08-21, when their combined runtime hit the 90-minute job timeout
and the cancellation of the integration suite produced the fake green described
below.

## Column schema

The production browser runner also writes
`e2e-tests/execution-evidence/metrics.json` (schema version 2), retained by the
existing Playwright diagnostics upload. It records each required journey's
file/project/title identity, first attempt, retry count, attempt statuses,
edition and lane outcome. Missing execution stays incomplete; retry-only passes
stay failed. It omits raw error and attachment payloads. `artifactManifest` is
currently null until immutable release-component identity is wired; this browser
lane result does not establish release readiness.

`scripts/record-browser-metrics.mjs` consumes this artifact through
`TEST_METRICS_BROWSER`. The browser workflow invokes it after diagnostics and
before API execution. With the existing Google metrics credentials it appends
to `browser_readiness`; without them it still writes a job summary. Live tab
creation and readback must be verified on the next candidate.

The tab uses schema version 2. `row_kind=run` carries collected/executed totals
once; `row_kind=journey` carries file/project/title identity, required/observed
flags, outcome, first attempt and retry count. Both carry edition, full tested
SHA, lane status and run URL. Missing, stale or wrong-edition evidence produces
an incomplete run row with unknown counts blank. Filter by `row_kind` before
aggregating. A PR's tested SHA may be GitHub's merge commit, rather than its
branch head; mismatches are rejected. Artifact identity remains blank until
release manifests are wired. `--dry-run` prints rows without accessing Google.

Rows land on the `metrics` tab. The script writes the header row on first use.
For an older schema, it verifies every existing heading and appends only the
missing suffix. A reordered or renamed managed heading stops the write instead
of putting values under the wrong columns. User-added trailing columns are
preserved when all managed headings match.

| Column | Meaning |
|---|---|
| `timestamp_utc` | ISO timestamp when the row was recorded |
| `suite` | label from the table above |
| `branch`, `commit` | ref name and short SHA of the tested commit |
| `passed`, `failed`, `skipped`, `todo`, `total` | test counts from the vitest JSON report |
| `pass_pct` | `passed / (passed + failed)` × 100; skipped tests do not count against it. Blank on partial runs |
| `lines_pct`, `statements_pct`, `branches_pct`, `functions_pct` | coverage totals; blank for suites that run without coverage |
| `duration_s` | wall-clock test time |
| `run_url` | link back to the Actions run |
| `executed` | `passed + failed` — how many tests actually ran |
| `run_status` | `complete` or `partial` (see below); blank when the run recorded coverage only |
| `files_measured`, `files_total` | source files in the coverage report vs. on disk; blank without coverage |
| `schema_version` | `2` for versioned rows; historical blank values are unversioned |
| `run_kind` | `pr`, `main`, `branch`, `nightly`, `manual`, `local`, or `other`, derived from the triggering event |
| `event_name` | original GitHub event name; blank for local invocations |
| `coverage_methodology` | `v8-loaded-files/source-inventory-v1` when a coverage report is present; otherwise blank |
| `expected_files`, `collected_tests` | declared file count and sum of collected assertion identities from current-revision execution evidence; blank when unavailable |
| `execution_gate_status` | reported lane gate: `passed`, `failed`, `incomplete`, or `unverified` when no execution evidence was requested |
| `tested_sha` | full GitHub tested SHA, or local evidence revision when available |

The four version fields occupy U:X on `metrics` and N:Q on
`coverage_by_dir`. All prior positions retain their meanings. The source
inventory v1 denominator includes `server/src`, `shared`, and each
`packages/*/src`, excluding generated/declaration/test files and the existing
build, migration, seed and double-underscore directories. EE and service source
roots are not comprehensively included; this is not whole-repository coverage.
Keep historical unversioned rows separate when interpreting methodology changes.
The event fields label recorded rows; they do not enable recording for workflows
whose metrics steps are currently excluded.

Execution counts, gate status and full SHA occupy Y:AB on `metrics`.
These summarize the producer's declared lane evidence, not the global release
gate. Unknown counts are blank; an unavailable evidence file is incomplete.
The existing `executed` column remains the raw passed-plus-failed assertion count.
Job summaries show the lane gate and collection counts before percentages.

For charts, add a second tab with `=QUERY(metrics!A:T, "select A, J where B = 'unit-coverage'")`
style pulls and chart those ranges. Native Sheets charts update as rows arrive.
Columns are appended at the end as the schema grows, so existing ranges keep
their meaning — widen the range, don't reorder.

Coverage percentages are only comparable while `coverage.include` in
`server/vitest.config.ts` stays the same; widening or narrowing it changes
the denominator and steps the totals on that day.

### Partial runs

`pass_pct` over a run that never reached most of its tests is arithmetic, not
information: on 2026-08-21 `infrastructure-full` executed 5 of its 354 tests and
recorded **100%**. The recorder marks a run `partial` when any
signal shows in the vitest JSON report:

- an assertion left in `pending` — vitest maps a test still in `run`/`queued`
  state there when the process is cut short, while an intentional `describe.skip`
  maps to `skipped` and `it.todo` to `todo`;
- fewer than half the collected tests executed (`MIN_EXECUTED_RATIO` in the
  recorder), which is what a dead bootstrap looks like;
- a suite failed without a failed assertion, indicating collection, setup or
  teardown failure. Successful sibling assertions cannot make that lifecycle
  successful;
- an execution manifest explicitly reports incomplete required execution.

The integration metrics steps set `TEST_METRICS_EXECUTION` to the runner's
execution evidence. Missing, unsupported, failed, or wrong-revision evidence
suppresses the percentage even if the raw Vitest assertions passed. This is a
reporting safeguard; the execution gate remains responsible for independently
reconciling the required identities and raw results.

Missing or malformed requested test reports also produce a partial row, with
blank test counts and pass percentage. A coverage report does not hide a
missing test report. Intentional coverage-only invocations omit
`TEST_METRICS_RESULTS` and retain blank execution status. Recording still
depends on the metrics step running; workflow cancellation before that step
requires an external reconciliation job to record the missing run.

`complete` describes this legacy report check, not release readiness. It does
not prove that every required test was discovered or that intentional skips
are acceptable. Required execution reconciliation must establish those facts.

Partial rows keep their raw counts but leave `pass_pct` blank, so no average or
trendline silently absorbs them. Three rows predate the check and still carry a
pass rate: 2026-08-12 and 2026-08-13 `integration-full` (377/1,587 and
111/1,564 executed) and 2026-08-21 `infrastructure-full` (5/354).

### Coverage methodology break, 2026-07-31

Coverage rows before and after **2026-07-31 17:46 UTC** are not comparable, and
nothing in the sheet marks the seam:

- `experimentalAstAwareRemapping: true` (commit `67b268ca55`) moved the line
  denominator from ~679k to ~216k, a 3.15x change with no code change behind it.
  Jul 30–31 interleave both regimes as branches rebased through.
- The `**/*.generated.ts` coverage exclusion (commit `0c46063429`) dropped the
  generated MCP registry — `server/src/lib/mcp` falls 58,903 lines to 13. That
  file had been inflating headline coverage by roughly 7 points; its removal is
  a correction, not a regression.

Any trendline crossing that date is wrong. Compare within one regime.

## Per-directory coverage

The `unit-coverage` run also writes a breakdown to the `coverage_by_dir` tab:
one row per source directory per run, with covered/total line counts alongside
the percentages. Directories group at four path segments under
`server/src/lib` (each subtree there is a whole subsystem), three elsewhere
under `server/src`, and two for everything else — so `packages/billing`,
`shared/workflow`, and `server/src/lib/actions` are each one row.

Coverage measures `server/src/**`, `packages/*/src/**`, and `shared/**`
(`coverage.include` in `server/vitest.config.ts`; the patterns are absolute
because `allowExternal` switches matching to absolute paths). Read the rows
with two caveats:

- **Check `files_measured` against `files_total`.** The v8 provider's
  untested-file discovery never leaves `server/`, so package and shared files
  the suite never loads are missing from the report and their percentages read
  optimistic. `files_total` counts the directory's source files on disk;
  a gap between the two columns is unmeasured code, and a `0/N` row is a
  directory the suite never touches. `server/src` rows always measure
  completely.
- Directory percentages come from the server unit suite alone. A directory
  covered mainly by integration tests will read low here.

The same two counts roll up onto the `metrics` row as `files_measured` /
`files_total` (about 4,100 of 5,600 files at the time of writing), so the
headline percentage cannot be read as covering the whole tree without opening
the detail tab.

## One-time setup

1. In Google Cloud Console, create a service account (any project) and enable
   the **Google Sheets API** for that project. Create a JSON key for the
   account.
2. Create the spreadsheet and share it with the service account's
   `client_email` as an Editor.
3. In the GitHub repo, add:
   - secret `TEST_METRICS_GOOGLE_SA_KEY`: the key file's JSON content (raw or
     base64, both work)
   - repository variable `TEST_METRICS_SHEET_ID`: the id from the sheet URL
     (`docs.google.com/spreadsheets/d/<this part>/edit`)

Nothing else. The next recorded run creates the `metrics` tab and header row
if they are missing.

## Running it by hand

The script reads a vitest JSON report and an optional coverage summary:

```bash
cd server && npx vitest run src/test/unit \
  --coverage.enabled=true --coverage.reporter=json-summary \
  --reporter=default --reporter=json --outputFile.json=./test-results.json

TEST_METRICS_SUITE=unit-coverage \
TEST_METRICS_RESULTS=server/test-results.json \
TEST_METRICS_COVERAGE=server/coverage/coverage-summary.json \
node scripts/record-test-metrics.mjs --dry-run
```

`--dry-run` prints the row instead of sending it. To send for real, also set
`GOOGLE_SA_KEY` and `TEST_METRICS_SHEET_ID`.
