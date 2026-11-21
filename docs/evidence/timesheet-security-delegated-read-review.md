# PR #4154: delegated time-sheet read authorization

## Draft Implementation repair

No task-specific plan was attached. This focused repair was made on the existing PR branch, starting at `13c032cf7d`, after confirming that handled non-native `TimeSheetService` reads returned before the native owner/delegate/read-all predicate and received no shared subject scope.

The service now resolves one immutable `TimeSheetReadScope` from the authenticated actor, tenant, `time_sheet:read_all`, and the existing approve-plus-managed-subject delegation policy. Native query predicates use that same resolver. Registered REST sheet reads receive the trusted scope as their final argument. Providers must declare read-scope contract version 1; the registry fails closed for a handled read without that declaration or without the service scope resolver. The provider contract requires applying tenant and subject scope before pagination, counts, exports, or aggregation. Caller filters remain additional narrowing predicates.

The service surfaces covered are `list` (also used for exports), `getById`, `getWithDetails`, `search`, `getStatistics`, `getTimeSheetEntries`, `getTimeSheetSummary`, and `getTimeSheetComments`. Details and nested data retain the existing not-found/empty behavior for inaccessible sheets. Lifecycle behavior, strict generic update, self-approval protection, and reversal behavior were left intact.

## Behavioral verification

`server/src/test/integration/api/timeSheetService.createUpdate.integration.test.ts` registers a test non-native source through `registerTimeSource`, selects it through the capability selector, and invokes the real `TimeSheetService` boundary. The provider fixture applies the service scope before returning rows and counts; authorization uses the existing real delegation helper and a deterministic RBAC fixture, with relationships stored in real Postgres.

The regression covers:

- Owner access and ordinary-reader isolation.
- Managed-subject access for an authorized approver and denial for unrelated subjects.
- `read_all` within the actor tenant, with foreign-tenant denial.
- Omitted, explicit foreign, and conflicting user filters.
- By-ID/details, entries, summary, comments, search, list/export contents, pagination totals, and statistics aggregates.
- Fail-closed behavior for a provider that handles reads without advertising the contract.
- Provider registry cleanup after each test.

| Actor class | Scope | Observed provider result |
| --- | --- | --- |
| Owner / ordinary reader | Own sheet only | Own details and nested rows pass; foreign IDs and omitted, foreign, or conflicting filters cannot widen access. |
| Authorized delegate (`time_sheet:approve` plus managed relationship) | Self and managed subjects | Managed reads pass; unrelated subject IDs and filters stay hidden. |
| `time_sheet:read_all` | All subjects in the actor tenant | Three in-tenant sheets and their aggregate are visible; another tenant remains hidden. |
| Provider without scope v1 | No handled reads | The service rejects the provider before invoking the method. |

Representative mutation evidence: `evidence/delegated-provider-scope-bypass-red.log` changes the resolved subject scope to tenant-wide. The regression fails because the ordinary reader receives a total of three instead of one. Restoring the policy makes it pass.

## Commands and results

Exact tested repair commit: [`74a14f348ea857a402755d3b70698f98421a41b9`](https://github.com/Nine-Minds/alga-psa/commit/74a14f348ea857a402755d3b70698f98421a41b9). This review note is a documentation-only follow-up commit on the same PR branch.

```sh
cd server
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/test/integration/api/timeSheetService.createUpdate.integration.test.ts src/test/integration/api/timeSheetService.search.integration.test.ts src/test/integration/api/timeSheetService.entriesSummary.integration.test.ts src/test/integration/api/timeSheetService.workflowTenantIsolation.integration.test.ts --coverage.enabled=false --maxWorkers=1
```

Result: 4 files passed, 37 tests passed against the configured real Postgres test database. The app server was not started.

The native read-route and lifecycle regression command was:

```sh
cd server
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/test/integration/T043b.timeSheetApprove.integration.test.ts src/test/unit/api/timeSheetReadRoutes.test.ts --coverage.enabled=false --maxWorkers=1
```

Result: 2 files passed, 22 tests passed. The server typecheck passed with `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -w server`; the 8192 MB attempt aborted with V8 heap exhaustion and no diagnostics.

`NODE_OPTIONS=--max-old-space-size=12288 npm run build -w server` compiled the production bundle and generated all 74 static pages, then exited 1 at Next.js's `SecurityFatalError` for installed Next.js 16.4.2. Retrying the same command reached the same security stop. The full retry output is retained at `/home/robert/.alga-xo/reviews/c0f1312d-timesheet-security/evidence/server-build-retry.log`. The build recommendation was `next upgrade --agent=security`; that separate dependency upgrade is outside this focused repair.

## Smoke and CI limits

The historical UI/API/database smoke evidence above remains historical. This repair did not start or resume the app, so it adds no live smoke certification. Automated behavioral verification is the registered-provider Postgres integration suite described above. External PR CI is recorded separately in the current review guide; a pending CI result does not change this local test result.

## Review first

Inspect `packages/scheduling/src/lib/timeSource/index.ts` for mandatory provider enforcement, `packages/scheduling/src/lib/timeSource/timeSource.ts` for the scope contract, `server/src/lib/api/services/TimeSheetService.ts` for the shared resolver and all eight read call sites, then the registered-provider integration regression.
