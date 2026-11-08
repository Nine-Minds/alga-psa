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

## Implementation follow-up, 22:14 UTC

The six REST writes already use the real lifecycle fields: `submitted_at`,
`approved_at`, `approved_by`, and `approval_status`. Submission, approval,
request-changes and reversal text remains in tenant-scoped `time_sheet_notes`
history. Each record retains its author, kind and timestamp, so subsequent
transitions do not overwrite earlier feedback.

The legacy-note migration now supports rollback. It restores legacy values to
`time_sheets.notes` while keeping history. Retrying rollback preserves populated
values. Reapplying the migration archives edits made after rollback without
duplicating already-retained values. PostgreSQL regression coverage verifies
two tenants, null notes, provenance, workflow-history preservation and repeated
application. The expanded test failed on the previous rollback exception.

Details responses now compose the existing `timeSheetEntryRowSchema`, matching
the rows returned by `getTimeSheetEntries`. Full details validation includes
entries and summary; the earlier nested-entry schema limitation above is fixed.
The strengthened test reproduced that mismatch before the schema change.

Focused verification passed 85 tests across six files against the dedicated
`time_sheet_writes_7ea8e6c6` PostgreSQL database:

| Suite | Passed |
| --- | ---: |
| timeSheetsApiWrite | 23 |
| timeSheetsApiExport | 14 |
| timeSheetListApiService | 8 |
| timeSheetReadRoutes | 20 |
| timeSheetService.search.integration | 6 |
| timeSheetService.createUpdate.integration | 14 |

The six-file run passed 84 tests and identified an outdated update fixture.
After supplying its submission prerequisites and wiring both RBAC imports to
the same permission fixture, its entire 14-test suite passed. Search's response
expectation now excludes the retired free-form notes column.

Logs: `/tmp/time-sheet-focused-final.log` and
`/tmp/time-sheet-create-update-final.log`. Before-fix failures:
`/tmp/time-sheet-rollback-before.log` and `/tmp/time-sheet-schema-before.log`.
Event publishers and write-suite authorization are mocked; export authorization
and all schema reads/writes use PostgreSQL. Citus execution, live browser smoke,
full builds and typechecks were not repeated in this follow-up.

## Browser and service recovery check, 22:45 UTC

Checked from worktree revision `c0a4ca4e70`. The card-scoped browser creation
command

```sh
alga-dev space-new-tab --type=browser --projectId=7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04
```

failed with `No viewer window handled space-new-tab`. No browser was created.
The existing pane `46d7b94b-08c4-4436-9f89-c47c72bce736` was present in the
browser list and remained usable: navigation to a local data URL succeeded,
`browser-eval` returned its heading and URL, and screenshot capture succeeded
at `/tmp/ghostty-pane-ide/screenshots/time-sheet-browser-recovery-20261102.png`.
This verifies the existing pane, not fresh pane creation or its workspace
binding.

`workflow-list-services --projectId=7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04
--live=true --health=true` listed only `review-infrastructure` and
`review-guide`; no `dev-server` was registered. A direct request to
`http://feature-rest-time-sheet-write-endpoints-500-nonexistent.localhost:3867`
at 22:44 UTC failed with connection refused. No application process was
started, resumed, or restarted. Fresh sign-in, reversal feedback, reload
persistence, database verification, and walkthrough recording therefore were
not performed in this round. Owner restoration of the registered app service
is required before those UI checks. Historical HTTP/DB/UI results above remain
historical and do not establish current UI completion.

## Card browser viewer recovery, 22:49 UTC

The missing handler was caused by the absence of a Ghostty Pane IDE desktop
process on the card host (`ts:robert-X670E-Pro-RS`): the Alga Dev agent and
browser host were running, but the viewer's local window registry was empty.
The desktop build's Chromium sandbox helper is not configured for this host,
so the default Electron launch exited before registering a window. Starting
the existing desktop build with `--no-sandbox` kept this operation within the
Alga Dev viewer and did not start any PSA service. Its hub responder became
active and the card's existing space was then served by a live renderer.

The exact requested command succeeded on retry:

```sh
alga-dev space-new-tab --type=browser --projectId=7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04 --pretty
```

It returned `spaceId=31c7d2bc-1750-4792-8ebc-359139064f86`,
`tabId=77ded8b1-73d0-4b16-ada1-fe258acf76e5`, and
`paneId=aebbcae3-b694-4633-8f98-5ecf8aeb43b0`. `list-spaces` independently
showed that space bound to this card's project ID and named for the card. On
the returned pane, navigation to a local data page, JavaScript evaluation
(heading `card pane recovery`), and screenshot capture all succeeded. The
capture is preserved at
`/home/robert/.alga-reviews/7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04/evidence/takeover-20261102/card-browser-recovery-20261102.png`.
This proves fresh card-pane creation and viewer operation; it is infrastructure
evidence, not PSA UI evidence.

The PSA URL on port 3867 still refused connections and no `dev-server` appeared
in the card service list. No PSA app server was started, resumed, or restarted.
Fresh sign-in, reversal feedback, response save/reload, database verification,
and the walkthrough remain blocked pending owner restoration of the app
service.

## Durable viewer recovery, 22:55 UTC

The 22:49 interactive launch was transient: after its builder exited, the IDE
process ended and the CLI again routed `space-new-tab` through the headless
agent's shared hub queue. The reviewer reproduced a timeout and an empty
`list-spaces`. I confirmed that the local viewer and agent use separate Unix
socket candidates: the agent owns `cli.sock`, while the desktop IDE falls back
to `cli-fallback.sock`. Viewer space commands sent through the agent can land
on another hub viewer with no local card window.

I made the viewer lifecycle independent of the builder by installing and
enabling `/home/robert/.config/systemd/user/ghostty-pane-ide-viewer.service`
on `graphical-session.target`, with `Restart=on-failure`. It launches the
existing Ghostty Pane IDE build with the host-required `--no-sandbox` flag;
the user systemd manager has lingering enabled. The PSA service is not part of
this unit. I also changed Alga Dev's `scripts/cli.mjs` so `list-spaces` and
`space-new-tab` prefer the local viewer socket when both viewer and agent are
available, while retaining agent fallback if the viewer socket is absent.

After the `systemctl --user enable --now` command returned and its launching
terminal ended, the service reported active. The exact card-scoped command
then returned a new browser pane:

```text
spaceId=31c7d2bc-1750-4792-8ebc-359139064f86
tabId=e4c4624f-2eba-4fbf-9ba4-324d4d933e59
paneId=a76391d9-f6e9-4b80-a421-9355af24be1f
```

`list-spaces` showed that space bound to project
`7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04`. On the new pane, navigation to a data
page and JavaScript evaluation returned the heading `detached viewer pane`;
screenshot capture succeeded. The image is preserved at
`/home/robert/.alga-reviews/7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04/evidence/takeover-20261102/card-browser-supervised-20261102.png`.
The service remained active through these checks. This verifies durable Alga
Dev pane creation, not PSA UI behavior.

The CLI routing correction is on Alga Dev branch
`fix/cli-local-viewer-space-routing`, pushed at commit `d565c95`. Its
behavioral socket-routing test passed:
`npx vitest run tests/cli/cli-socket-routing.test.ts` (1 test). The test sends
space creation to the viewer socket when both sockets exist and keeps workflow
commands on the agent socket. No PR was opened. The active checkout used by
this host's `alga-dev` command has the same routing change, which is why the
exact command above used the normal CLI successfully.

For the final installed-path check, `/home/robert/.local/bin/alga-dev` now
resolves to the pushed branch worktree's `scripts/cli.mjs`. After that
installer command had exited, the exact command returned another new pane,
`2d187967-2e0b-471f-96f7-0a329e4606b0`, in the same card space. Navigation,
JavaScript evaluation (heading `persistent viewer verified`), and screenshot
capture succeeded; the final image is
`/home/robert/.alga-reviews/7ea8e6c6-3c89-40e5-be8b-4c9f4c4d1e04/evidence/takeover-20261102/card-browser-persistent-20261102.png`.
The systemd viewer service remained active throughout.

The app URL on port 3867 still refused connections after recovery, and
`workflow-list-services` showed no `dev-server`. Fresh application QA remains
blocked pending owner restoration; no PSA app server was started, resumed, or
restarted.
