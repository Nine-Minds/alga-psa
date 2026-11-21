# PR #4154: delegated time-sheet read authorization

## Calendar-date sorting verification

The calendar-date sorting correction is `d5fdb48ecc490fe1fae63dbafdcbc6c6ae500c06`. Delegated period sorts normalize local-midnight database `Date` objects and `YYYY-MM-DD` strings through `formatDbDate` before comparison. Timestamp sorts still compare instants, and authorization still runs before filtering and pagination.

The registered `calendar-date-test-source` supplies mixed Date/string period values and an unauthorized subject without filtering them. Its two regression cases cover both period fields, ascending and descending pages, equal-date ID ordering, scoped totals, and date-filtered totals. Both cases failed before the correction. They now pass in UTC and `Pacific/Auckland`.

The focused run passed 76 tests across seven files, including 39 real-Postgres service tests, three approval integration tests, 19 route tests, and 15 list-query tests. Server typecheck passed with a 12 GiB heap. The first full test attempt was interrupted when the shared `test_database` disappeared; the successful rerun used `TEST_DB_NAME=test_timesheet_security_takeover`.

Logs are preserved under `/home/robert/.alga-xo/reviews/c0f1312d-timesheet-security/evidence/takeover-d5fdb48ecc/`: `calendar-red.log`, `tests-isolated-pass.log`, `calendar-auckland-pass.log`, and `typecheck-pass.log`. The production build for this revision is being verified separately; its final result will be recorded before publication. No app server was started, and no current live smoke is claimed.

## Draft Implementation repair

No task-specific plan was attached. This focused repair was made on the existing PR branch, starting at `13c032cf7d`, after confirming that handled non-native `TimeSheetService` reads returned before the native owner/delegate/read-all predicate and received no shared subject scope.

The service resolves one immutable `TimeSheetReadScope` from the authenticated actor, tenant, `time_sheet:read_all`, and the existing approve-plus-managed-subject delegation policy. Native predicates use that resolver. Registered sources expose an unpaged raw sheet collection through `collectTimeSheetReadRows`; `collectScopedTimeSheetRows` validates row identities and applies tenant and authorized-subject filtering centrally before service filters, pagination, counts, exports, or aggregation. It also validates and scopes nested entry/comment rows by tenant and parent sheet, then derives per-sheet summaries and totals from those scoped entries. Direct provider read handlers are bypassed. A source without the raw collection fails closed before any legacy handler can run. Caller filters only narrow the already scoped collection.

The service surfaces covered are `list` (also used for exports), `getById`, `getWithDetails`, `search`, `getStatistics`, `getTimeSheetEntries`, `getTimeSheetSummary`, and `getTimeSheetComments`. Details and nested data retain the existing not-found/empty behavior for inaccessible sheets. Lifecycle behavior, strict generic update, self-approval protection, and reversal behavior were left intact.

## Behavioral verification

`server/src/test/integration/api/timeSheetService.createUpdate.integration.test.ts` registers a test non-native source through `registerTimeSource`, selects it through the capability selector, and invokes the real `TimeSheetService` boundary. The registered `test-time-source` deliberately returns mixed-owner and mixed-tenant sheets, nested entries, and comments without receiving or applying authorization. The real `TimeSheetService` boundary and existing delegation policy resolve the scope; the shared adapter filters the provider data. RBAC uses a deterministic fixture, and managed relationships are stored in real Postgres.

The regression covers:

- Owner access and ordinary-reader isolation.
- Managed-subject access for an authorized approver and denial for unrelated subjects.
- `read_all` within the actor tenant, with foreign-tenant denial.
- Omitted, explicit foreign, and conflicting user filters.
- By-ID/details, entries, summary, comments, search, list/export contents, pagination totals, and statistics aggregates.
- Fail-closed behavior for a legacy direct reader without the raw collection; its handler is asserted not to run.
- Foreign-tenant nested entries/comments attached to an authorized sheet are removed, and aggregates are derived only from the remaining scoped entries.
- Provider registry cleanup after each test.
- Delegated sorting maps API fields to the registered collection shape (`period_start` / `period_end`), sorts before pagination, and reports the filtered total.
- Nullable `submitted_at` and `approved_at` values remain last for ascending and descending sorts.
- Submission and approval ranges compare full instants, including timezone offsets, and exclude null timestamps for either bound; period ranges retain calendar-date semantics.
- Unsupported created/updated range filters reject even when the registered collection has no rows.

| Actor class | Scope | Observed provider result |
| --- | --- | --- |
| Owner / ordinary reader | Own sheet only | Own details and nested rows pass; foreign IDs and omitted, foreign, or conflicting filters cannot widen access. |
| Authorized delegate (`time_sheet:approve` plus managed relationship) | Self and managed subjects | Managed reads pass; unrelated subject IDs and filters stay hidden. |
| `time_sheet:read_all` | All subjects in the actor tenant | Three in-tenant sheets and their aggregate are visible; another tenant remains hidden. |
| Provider without raw collection | No handled reads | The service rejects it before its legacy direct reader runs. |

Mutation evidence removes both tenant and subject filtering from the shared collection adapter. The registered provider regression then returns an unrelated sheet in the ordinary reader’s first page and fails. Restoring the adapter makes the focused regression pass. See `evidence/scoped-collection-adapter-b32ef96-mutation-red.log` and `evidence/scoped-collection-adapter-b32ef96-restored-pass.log`.

The list-sorting and range-filter behavioral regressions use the same registered provider collection and assert returned IDs, filtered totals, ordering across pagination, timestamp boundary behavior, timezone-offset equivalence, null exclusion, and rejection against an empty collection.

## Repair round: nested subject validation

At the starting revision `d5fdb48ecc490fe1fae63dbafdcbc6c6ae500c06`, the shared adapter already fixed tenant, authorized sheet subjects, parent-sheet links, and aggregates before service filtering or pagination. Review found that a nested entry linked to an authorized sheet could still carry a different `user_id`; the adapter retained that entry and included it in derived totals. The repair now requires entry child `user_id` to match the sheet owner, in addition to tenant and `time_sheet_id`. Native entry and summary queries also constrain records to the authorized sheet owner. Comment authors are allowed to differ from the sheet owner, while comments remain constrained to the authorized tenant and parent sheet.

The registered-source regression includes a same-tenant, same-sheet entry attributed to an unrelated subject. It verifies that list totals, entries, and summaries exclude it; a native-path regression independently verifies that entry reads and summaries exclude mismatched owners. The export route is invoked directly and verifies owner-only, managed-subject, and tenant-scoped `read_all` results against mixed-owner/mixed-tenant provider rows. The final focused database lane passed 44 tests across five suites with `TEST_DB_NAME=test_timesheet_security_takeover`; the route and sort lane passed 34 tests across two database-free suites. A temporary mutation bypassing the child-subject predicate made the owner total 601 hours instead of 1 and failed; restoring it passed. Logs: `/home/robert/.alga-xo/reviews/c0f1312d-timesheet-security/evidence/takeover-d5fdb48ecc/child-subject-mutation-fail.log`, `child-subject-restored-pass.log`, `focused-database-final.log`, and `focused-database-free-pass.log`.

Standalone server typecheck passed with a 12 GiB heap. The repository community build (`npm run build`) completed Next.js compilation and page generation but exited 1 at Next.js 16.4.2 `SecurityFatalError`; this remains a failed build. The full log is `/home/robert/.alga-xo/reviews/c0f1312d-timesheet-security/evidence/takeover-d5fdb48ecc/community-build.log`. No dependency upgrade was run. The app server remained stopped, and no fresh browser or live smoke result is claimed.

## Commands and results

The collection-enforcement implementation is [`aaac6d4731`](https://github.com/Nine-Minds/alga-psa/commit/aaac6d4731), following the initially published repair commit [`74a14f348ea857a402755d3b70698f98421a41b9`](https://github.com/Nine-Minds/alga-psa/commit/74a14f348ea857a402755d3b70698f98421a41b9).

The delegated list sorting/range repair is [`ceaad14bf1e9379ce071a7a2e0c18b57b1e937b0`](https://github.com/Nine-Minds/alga-psa/commit/ceaad14bf1e9379ce071a7a2e0c18b57b1e937b0). The complete focused suite passed on this revision: 6 files and 59 tests, including the registered mixed-data provider regression, 37 real-Postgres tests, and route/lifecycle regressions.

The offset-aware query-schema follow-up is [`82a6450383bf63c90d64e406736aede732ae6c32`](https://github.com/Nine-Minds/alga-psa/commit/82a6450383bf63c90d64e406736aede732ae6c32). This revision accepts timestamp bounds with explicit UTC offsets at the API schema, and the full focused suite passed: 7 files and 74 tests.

The final timestamp-sort adjustment is [`de71c103c401014f385754da152ceb052168ff77`](https://github.com/Nine-Minds/alga-psa/commit/de71c103c401014f385754da152ceb052168ff77). It compares `Date` objects by epoch value as well as parsing offset-bearing strings. The complete focused suite passed again at this revision (7 files, 74 tests), and server typecheck exited 0.

```sh
cd server
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/test/integration/api/timeSheetService.createUpdate.integration.test.ts src/test/integration/api/timeSheetService.search.integration.test.ts src/test/integration/api/timeSheetService.entriesSummary.integration.test.ts src/test/integration/api/timeSheetService.workflowTenantIsolation.integration.test.ts src/test/integration/T043b.timeSheetApprove.integration.test.ts src/test/unit/api/timeSheetReadRoutes.test.ts src/test/unit/api/timeSheetListSort.test.ts --coverage.enabled=false --maxWorkers=1
```

Result at `de71c103c401014f385754da152ceb052168ff77`: the focused set passed 74 tests across 7 files, including 37 real-Postgres tests, 22 route/lifecycle regressions, the registered mixed-data provider tests, and offset-aware query-schema tests. The registered collection test file has 27 passing tests and covers list sorting/ranges. The registered-collection and missing-collection focused cases passed after the enforcement change. The app server was not started. A mutation removing the adapter tenant and subject checks caused the raw-provider regression to return an unrelated sheet and fail; restoring the adapter passed it. Evidence: `/home/robert/.alga-xo/reviews/c0f1312d-timesheet-security/evidence/scoped-collection-adapter-b32ef96-mutation-red.log` and `scoped-collection-adapter-b32ef96-restored-pass.log`.

The native read-route and lifecycle regression command was:

```sh
cd server
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/test/integration/T043b.timeSheetApprove.integration.test.ts src/test/unit/api/timeSheetReadRoutes.test.ts src/test/unit/api/timeSheetListSort.test.ts --coverage.enabled=false --maxWorkers=1
```

The focused run includes these route, lifecycle, and list-sort schema checks. The server typecheck passed at `de71c103c401014f385754da152ceb052168ff77` with `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -w server` (exit 0).

The last production build attempt at revision `b32ef96dbc879f800ef4d178e8b89b8027756d0c` compiled the production bundle and generated all 74 static pages, then exited 1 at Next.js's `SecurityFatalError` for installed Next.js 16.4.2. Retrying the same command reached the same security stop. The build remains a failure, not a successful build. Evidence is recorded at `/home/robert/.alga-xo/reviews/c0f1312d-timesheet-security/evidence/server-build-b32ef96.log`; this repair round did not rerun the build. The build recommendation was `next upgrade --agent=security`; that separate dependency upgrade is outside this focused repair.

## Smoke and CI limits

The historical UI/API/database smoke evidence above remains historical. This repair did not start or resume the app, so it adds no live smoke certification. Automated behavioral verification is the registered-provider Postgres integration suite described above. External PR CI is recorded separately in the current review guide; a pending CI result does not change this local test result.

## Review first

Inspect [`timeSheetReadCollection.ts`](https://github.com/Nine-Minds/alga-psa/blob/aaac6d4731/packages/scheduling/src/lib/timeSource/timeSheetReadCollection.ts) first for the enforced tenant/subject and nested-row filter and derived aggregates; then [`index.ts`](https://github.com/Nine-Minds/alga-psa/blob/aaac6d4731/packages/scheduling/src/lib/timeSource/index.ts) for fail-closed collection dispatch, `TimeSheetService.ts` for post-scope filtering/pagination, and the registered-provider Postgres regression.
