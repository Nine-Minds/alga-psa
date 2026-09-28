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

## After this card

The default lane's 3609 files now split 699 jsdom / 2910 node, with the same
3609 collected and no file collected twice. 195 of the 699 previously ran under
node without a docblock; 455 already had a jsdom docblock; 199 files inside the
globs carry an explicit `@vitest-environment node` docblock and keep running on
node, because the docblock still wins over the project (verified on vitest 3.2.7
and 4.1.11, both directions).

The follow-up card should re-run the query above and compare the "failed shard
jobs carrying one of the three signatures" row against 17 of 112.
