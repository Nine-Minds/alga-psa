# Test Metrics Sheet

CI appends one row per test run to a shared Google Sheet, so you can watch
pass rates and coverage move over time instead of opening individual Actions
runs. `scripts/record-test-metrics.mjs` does the recording. It never fails a
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

Red runs still record. The metrics steps use `if: always()`, because a drop in
pass rate is the signal the sheet exists to show.

## Column schema

Rows land on the `metrics` tab. The script writes the header row on first use.

| Column | Meaning |
|---|---|
| `timestamp_utc` | ISO timestamp when the row was recorded |
| `suite` | label from the table above |
| `branch`, `commit` | ref name and short SHA of the tested commit |
| `passed`, `failed`, `skipped`, `todo`, `total` | test counts from the vitest JSON report |
| `pass_pct` | `passed / (passed + failed)` × 100; skipped tests do not count against it |
| `lines_pct`, `statements_pct`, `branches_pct`, `functions_pct` | coverage totals; blank for suites that run without coverage |
| `duration_s` | wall-clock test time |
| `run_url` | link back to the Actions run |

For charts, add a second tab with `=QUERY(metrics!A:P, "select A, J where B = 'unit-coverage'")`
style pulls and chart those ranges. Native Sheets charts update as rows arrive.

Coverage percentages are only comparable while `coverage.include` in
`server/vitest.config.ts` stays the same; widening or narrowing it changes
the denominator and steps the totals on that day.

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
