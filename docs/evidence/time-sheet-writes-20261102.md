# REST time-sheet write verification, 2026-11-02

PR: https://github.com/Nine-Minds/alga-psa/pull/3792

Application revision tested: `f2c860dd1061f439c5050c90fd2a1224bfd2966c`.
This includes main revision `076741fc2869478fe5ba44f70e60c3078c0cf391`.
No approved implementation plan specific to this card was found under `docs/plans/`.

## Registered development server

Card `7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04` serves
`http://feature-rest-time-sheet-write-endpoints-500-nonexistent.localhost:3867`.
Command-free ensure succeeds:

```sh
alga-dev workflow-ensure-service --projectId=7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04 --name=dev-server
```

The saved service is `dev-server:7`, with cwd set to this worktree's `server/`:

```sh
PORT=3867 HOSTNAME=0.0.0.0 NODE_OPTIONS=--max-old-space-size=14336 NX_LOAD_DOT_ENV_FILES=false NODE_ENV=development NEXT_DIST_DIR=.next-dev npx tsx dev-server.ts
```

The prior `npm run dev` command failed in `email-service:build` on the
baseline Gmail and checklist TypeScript errors. The registered command runs
the existing application entry point after the other dependency builds
completed. It does not establish a successful full build.

During Draft Implementation, the board suspends services that the step does
not use. Command-free ensure does not retain them. The board's
`resumeService({ projectId, name: 'dev-server', wantForMs: 14400000 })`
operation retained this service until 2026-11-02 17:14 UTC. To renew through
the IDE, open this card's service controls and use Start on the suspended
service. The CLI currently has no retention option. No unmanaged application
process was started, and no other card's service was changed.

For this run the same board retention API was invoked programmatically.
Its service lookup used a consistent read of the known service record because
initializing a broad JetStream list cache timed out. The retention write still
used the board service's normal compare-and-swap operation. The invocation is
preserved as `retain-service.ts` in the evidence directory.

## Live results

- REST replay: 35 assertions passed, plus two observations of historical route
  issues; the saved summary reports 37 passed and zero failed. Create, update,
  submit, request-changes, approve and reverse-approval persisted their state,
  history and comments. Empty submission and invalid approval returned 409.
- Filtered exports matched exact database ID sets, including 36 total fixture
  rows and 28 QA approved rows. Repeated and comma-separated filters and
  JSON/CSV projections passed. Malformed filters returned 400; missing API
  credentials returned 401.
- Additional guards: 16 passed. A restricted editor could create and submit
  their own sheet, but could not approve, request changes or reverse approval.
  Denials and invalid transitions preserved sheet, entry, note and comment
  rows. Another user's submission was denied. Admin approval succeeded.
- A browser-issued filtered REST export succeeded. The QA user's response to
  changes remained visible after reload and was independently read from
  `time_sheet_comments`.
- The eight time-sheet response checks passed, including details notes,
  comments and summary, excluding the existing nested time-entry mismatch
  described below.
- Four legacy note values remain preserved with `kind=legacy`, null authorship
  and migration-time timestamps. `time_sheets.notes` is absent. The guard run
  verified that those records remained unchanged.

The old replay script assumed the fixture had only two users. It now contains
more users. Two initial export expectations incorrectly compared a two-user
filter with the entire fixture. The corrected script derives the matching
subset; the initial log and summary are retained separately.

The retained replay sheet is `812990e9-32e8-4842-b7bf-538c687b948d`, in Changes
Requested with one hour and visible feedback. Earlier retained review sheets
were preserved. Temporary guard records and credentials were removed; replay
API keys were deactivated.

## Evidence and limits

Host evidence directory:

```text
/home/robert/.alga-reviews/7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04/evidence/takeover-20261102/
```

Start with `production-replay-summary.json`, `guards-summary.json`,
`guard-responses.json`, `time-sheet-schema-results.json`,
`serving-identity.json`, and `ensure-serving-final.json`. Numbered files contain
REST captures and database state. `walkthrough.webm` is a 56-second browser
recording with chapter metadata; the two `time-sheet-takeover-*.png` files show
feedback and the reloaded response. `db-preflight.json` and `ui-comment-db.json`
contain independent database observations. The scripts are retained alongside
the evidence; the replay refuses to delete sheets in an occupied replay period.

Full details validation still fails on pre-existing nested time-entry fields:
missing `tax_percentage` and nullable `created_at`. Those failures are retained
in `wire-schema-results.json`. GET details with a query string still returns
500 from the previously identified path-ID issue. The sibling list route now
returns 200. Neither route behavior was changed in this mitigation.

The previous round's focused behavioral suites passed 55 tests across four
files. Full typecheck and enterprise build remain blocked by errors reproduced
on the exact main baseline: 17 TypeScript diagnostics and three Next client
boundary `export *` errors. Logs remain at `/tmp/alga-{merged,main}-typecheck.log`,
`/tmp/alga-merged-build-14g.log` and `/tmp/alga-main-build-ee-14g.log`.
Startup also logs an absent credential encryption key; the verified REST and UI
flows succeeded, but credential-vault behavior was not tested.
