# Vitest environment hygiene — 14-day baseline

Measured 2026-09-28 over `production-regression.yml` runs created on or after
2026-09-14, so a follow-up card can measure the drop against the same query.

## How to reproduce

```
gh run list --workflow production-regression.yml --limit 1000 --created ">=2026-09-14" \
  --json databaseId,conclusion,createdAt
# for every failed run: gh api repos/Nine-Minds/alga-psa/actions/runs/<id>/jobs --paginate
# for every failed "unit / Server unit shard N" job: gh api repos/Nine-Minds/alga-psa/actions/jobs/<id>/logs
```

## Counts

| Measure | Count |
| --- | --- |
| production-regression runs in the window | 622 (251 success, 150 failure, 218 cancelled, 3 in flight) |
| failed runs inspected | 150 |
| `unit / Server unit shard *` jobs inside those runs | 456 (344 success, 112 failure) |
| failed shard jobs | 112, spread over 56 runs |
| failed shard jobs carrying one of the three signatures | 17 |
| `window is not defined` occurrences | 45 |
| `document is not defined` occurrences | 7 |
| `Cannot read properties of undefined` occurrences | 27 |

Signature jobs by day: 2026-09-18 ×1, 09-19 ×6, 09-24 ×1, 09-25 ×4, 09-26 ×5.

The three signatures are therefore **15% of failed shard jobs** (17 of 112) and
the single largest recurring cause after genuine assertion failures.

## What the logs actually say

Every `window is not defined` is an **unhandled rejection after teardown**, not
a missing environment: the file has its jsdom docblock, the environment is torn
down when the file finishes, and a `setState` from an in-flight promise then
touches `window` through react-dom's `resolveUpdatePriority`. Vitest prints
"This error was caught after test environment was torn down."

`document is not defined` is the plain case: `packages/ui/src/lib/clipboard.test.ts`
ran under `environment: 'node'` because a `.ts` file outside a `components/`
directory matched no jsdom rule and had no docblock.

| File | Signature | Signature jobs | Fixed by |
| --- | --- | --- | --- |
| `packages/tickets/src/components/TicketingDashboardContainer.sort.contract.test.tsx` | window, post-teardown | 4 (20 occurrences) | `d71211ff3d` test(tickets): exercise real saved-view hook in dashboard contracts |
| `packages/tickets/src/components/ticket/__tests__/TicketInfo.liveEditing.test.tsx` | window, post-teardown | 3 (15) | `e4706c7f91` fix(tickets): cancel superseded category fetches |
| `packages/billing/tests/BillingSettings.creditDrawdown.test.tsx` | window, post-teardown | 5 (5) | `aee6b92a55` Fix document locale register and isolate browser regression tests |
| `server/src/test/unit/components/integrations/IntegrationsSettingsPage.telephony.test.tsx` | window, post-teardown | 1 (5) | `cae067f1e5` Stub the email provider panel where the settings page imports it |
| `packages/ui/src/lib/clipboard.test.ts` | document | 1 (7) | `d0ddfda5bc` test(ui): run copyTextToClipboard tests under jsdom |
| `server/src/test/unit/billing/usageContractSemantics.ui.test.tsx` | undefined props | 2 (18) | `a98d30c735` clean up 1_6 ff |

Nine of the 27 `Cannot read properties of undefined` occurrences (one job,
`105833233760`) are unrelated: a knex mock in
`packages/clients/src/actions/interactionActions.scheduleAssignees.test.ts`
returns `undefined` from `.first()`. They are counted above because the card's
query counts them, and noted here so the follow-up does not chase them.

Each culprit was fixed one file at a time, after it had already flaked. Nothing
stopped the next one from landing.

## React test inventory at the baseline

Server unit lane (the `src/test/unit ../packages ../shared
../ee/packages/workflows/src/actions` selection, `SKIP_DB_TESTS=1`): 3086 files
collected, of which **476 value-import** `react`, `react-dom`,
`@testing-library/react` or `next/navigation`.

- 452 carried an `@vitest-environment jsdom` docblock.
- **24 carried no docblock at all** and ran under node:

- packages/assets/src/components/panels/HuduDocumentationCard.test.tsx
- packages/assets/src/components/panels/RmmVitalsPanel.test.tsx
- packages/scheduling/tests/schedulingProvider.launchParams.test.ts
- packages/tickets/src/components/ResponseSourceBadge.render.test.tsx
- packages/tickets/src/components/TicketOriginBadge.render.test.tsx
- packages/tickets/src/lib/__tests__/ticketOriginFlowSanity.test.tsx
- packages/ui/src/components/GoogleIcon.test.tsx
- server/src/test/unit/app/auth/client-portal/signin/page.test.ts
- server/src/test/unit/app/auth/msp/signin/page.test.ts
- server/src/test/unit/app/msp/clients/[id]/page.productComposition.test.tsx
- server/src/test/unit/app/msp/collab-test/page.test.tsx
- server/src/test/unit/app/msp/contacts/[id]/page.productComposition.test.tsx
- server/src/test/unit/app/msp/interactions/page.composition.test.tsx
- server/src/test/unit/app/msp/licenses/purchase/layout.test.tsx
- server/src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx
- server/src/test/unit/app/msp/tickets/page.initialBoard.test.tsx
- server/src/test/unit/app/msp/tickets/page.productComposition.test.tsx
- server/src/test/unit/app/serverProductRouteGuardPages.test.tsx
- server/src/test/unit/app/teams/tab/page.delegator.test.tsx
- server/src/test/unit/app/teams/tab/page.test.tsx
- server/src/test/unit/ceAccountStub.unit.test.tsx
- server/src/test/unit/route.test.tsx
- server/src/test/unit/ssoProviderEditionGate.unit.test.tsx
- server/src/test/unit/workflowsCeStubEntry.unit.test.tsx

Twenty-one of the twenty-four are `.tsx` and are now claimed by the first jsdom
glob. The three `.ts` files are named in `JSDOM_EXTRA_FILES`.

## Configuration at the baseline

`server/vitest.config.ts` ran a single `environment: 'node'` with no
`environmentMatchGlobs` and no `projects` — confirmed by reading the file at
`bc54aa89fb` (the merge-base of this branch). The only per-file mechanism was
the docblock.

## The two mechanics the design rests on

Both were probed directly, in a throwaway directory with no `node_modules` (a
plain-object config, so nothing had to resolve), against both installed vitest
majors — `server/node_modules/vitest` 3.2.7, which every server lane runs, and
the root `node_modules/vitest` 4.1.11, which the repo is heading towards.

Three files, assigned `jsdom <- plain (no docblock), pinned-node (docblock:
node)` and `node <- pinned-jsdom (docblock: jsdom)`, each asserting on
`typeof window`:

| File | Project | Docblock | Asserted | 3.2.7 | 4.1.11 |
| --- | --- | --- | --- | --- | --- |
| plain-jsdom | jsdom | — | `window` is an object | pass | pass |
| pinned-node | jsdom | node | `window` is undefined | pass | pass |
| pinned-jsdom | node | jsdom | `window` is an object | pass | pass |

(a) **A per-file docblock still overrides the project's environment, both
directions.** This is what lets the ~199 files that sit inside the jsdom globs
but pin themselves to `@vitest-environment node` keep running on node, and it is
why this card removes no docblocks.

(b) **`list --filesOnly --json` yields each file exactly once** when the
projects' includes tile the set: 3 entries, 3 unique. On the real configs the
same property is enforced per shard by `scripts/run-server-unit-shard.mjs`, which
fails the run unless the shard config's collection equals its assigned partition
byte for byte — a duplicate would break that equality.

## After this card

Measured from `vitest list --filesOnly` on the default lane, `SKIP_DB_TESTS=1`:
**3609 files collected, 3609 unique** — the two projects tile the lane and no
file is collected twice.

| | Files |
| --- | --- |
| jsdom project | 691 |
| — no docblock, so genuinely flipped node → jsdom | **187** |
| — already carried `@vitest-environment jsdom` | 455 |
| — carry `@vitest-environment node`, still run on node | 49 |
| node project | 2918 |
| — carry `@vitest-environment jsdom`, still run on jsdom | 16 |
| explicit node pins in the rule (source-reading suites) | 8 |

The 187 are the point of the card: they used to run under `environment: 'node'`
with nothing declaring otherwise. The 49 + 16 are the docblock override doing its
job in both directions, which is why no docblock was added or removed.

Lane collection was checked the same way for every lane this card touched:
server-colocated 80 files green, workspace-unit 22 files green, and the three
flat lanes (api-e2e 22, workspace-runtime 2, workspace-db 74) still resolve with
`projects: undefined` and no duplication.

`--reporter=blob` + `vitest run --merge-reports` was replayed end to end through
the default config, the way `unit-tests.yml` does it: two shard blobs produced
under the shard config, replayed through the default config, both projects'
files attributed correctly. The project names line up, so the merge job keeps
working.

### Sharded runs

Four shards, the CI shard count, `VITEST_SEED=20260610`, 4 workers,
`SKIP_DB_TESTS=1`: **two consecutive all-green runs** (772 + 772 + 771 + 771 =
3086 files each).

One earlier run lost shard 2 to `packages/emulators/qbo/tests/smoke.test.ts`,
which is worth recording because it is *not* an environment failure and should
not be mistaken for one by the follow-up. All nine emulator suites co-scheduled
in that shard resolve to the **node** project before and after this card, so
their environment is unchanged. The suite passes in isolation (twice) and the
error body is `WebSockets...` — the response `@hocuspocus/server` gives a plain
HTTP request, and `server/src/test/unit/hocuspocus/tenantValidation.test.ts` is
co-scheduled in the same shard. It is a port/lifecycle interaction between the
emulator harness and the hocuspocus suite in a recycled fork, pre-existing and
independent of this card. Worth its own card.

The follow-up card should re-run the query above and compare the "failed shard
jobs carrying one of the three signatures" row against 17 of 112.

## Deferred: `restoreMocks`

The card asked for `restoreMocks` alongside `unstubEnvs`/`unstubGlobals`. It is
**not** enabled, because it is not a hygiene switch in this repo — it is a
migration. Measured directly: shard 1 of 4, `restoreMocks: true`, everything else
as shipped.

| | Test files | Tests |
| --- | --- | --- |
| shard 1 as shipped | 772 passed | 4498 passed |
| shard 1 with `restoreMocks: true` | **13 failed**, 759 passed | 62 failed, 4436 passed |

Extrapolated across the four shards that is ~50 suites, against this card's
15-file repair cap. The cause is uniform: these suites give their module mocks an
implementation once — `vi.mock('x', () => ({ f: vi.fn(() => y) }))` at module
scope, or a `beforeAll` that calls `mockImplementation` — and `mockRestore`
strips the implementation after the first test, so test two onwards sees
`undefined`. The fix is per-suite (move the implementation into `beforeEach`),
which is the follow-up card. `vi.restoreAllMocks()` is left out of
`server/src/test/setup.ts` for the same reason; `vi.useRealTimers()`,
`vi.unstubAllGlobals()` and `vi.unstubAllEnvs()` are all in.

The 13 suites shard 1 surfaced, as a starting list for that card:

- packages/billing/src/services/accountingSync/exportReadiness.test.ts
- packages/billing/tests/billingCurrencyActions.defaultCurrencyFallback.test.ts
- packages/billing/tests/invoiceModification.updateDraftInvoiceProperties.test.ts
- packages/billing/tests/quote/quoteDetail.test.tsx
- packages/client-portal/src/components/documents/ClientDocumentsPage.test.tsx
- packages/documents/src/components/ShareLinkDialog.test.tsx
- packages/jobs/src/lib/handlers/rmmDeviceSyncHandler.test.ts
- packages/scheduling/tests/scheduleActions.deleteEntry.teamsRetraction.test.ts
- server/src/test/unit/app/client-portal/request-services/myRequestDetail.page.test.tsx
- server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx
- server/src/test/unit/contacts/contactEmailLookup.contract.test.ts
- server/src/test/unit/documentPermissionUtils.test.ts
- server/src/test/unit/workflowSchemaRegistry.unit.test.ts
