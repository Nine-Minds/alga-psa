# Retire the cycle-id `generateInvoice` action and move tests onto the selector path

- Card: 30f9f0cc ("Retire unused cycle-id generateInvoice action; move tests onto the selector path")
- PSA ticket: alga-2026-0002692 (internal)
- Follow-up to: card 7138245c / alga-2026-0002499 / PR #3556 (merged 2026-10-11, `bea32d4ed4`). Regression matrix R11 of that card is "the cycle-id generation path is unchanged".
- Base: `main` (PR #3556 is merged, so nothing to stack on). Line numbers below are at `d6dc22c273`.

## 1. What the code does today

`packages/billing/src/actions/invoiceGeneration.ts`

| Symbol | Line | Notes |
|---|---|---|
| `type RecurringBridgeMetadata` / `resolveRecurringInvoiceBridgeId` | 654–660 | `{ billingCycleId }`. Stamps `invoices.billing_cycle_id` and feeds the cycle billing-profile fallback in the core. |
| `resolveCanonicalSelectorInputsForClientWindow` | 1262–1360 | Selects every `recurring_service_periods` row for client + invoice window where `lifecycle_state NOT IN ('archived','superseded')`. **It includes `billed` rows.** |
| `previewRecurringUnitRevisionInvoiceImpact` (caller at 2213) | ~2170–2240 | **Second caller** of `resolveCanonicalSelectorInputsForClientWindow`. |
| `previewInvoice(billing_cycle_id)` | 2941 | Cycle-id preview twin. Out of scope, see §7. |
| `generateProjectInvoice` | 3043 | Unrelated. Used as a section marker by a contract test (see §3.4). |
| **`generateInvoice(billing_cycle_id, options)`** | **3243–3328** | The target. Loads `client_billing_cycles`, derives the window (period dates, or `effective_date` + `getNextBillingDate`), calls `resolveCanonicalSelectorInputsForClientWindow`, normalizes, then calls `generateInvoiceForNormalizedSelectionInputs(..., bridgeMetadata: { billingCycleId })`. |
| `generateInvoiceForSelectionInput` | 3330 | Production: API `InvoiceService.generateRecurringInvoice` (`server/src/lib/api/services/InvoiceService.ts:1982`), job handler (`server/src/lib/jobs/handlers/generateInvoiceHandler.ts:32`), recurring runs (`recurringBillingRunActions.ts:242,252`). |
| `generateInvoiceForNormalizedSelectionInputs` | 3376 | Shared core. Duplicate guard at 3416–3427 rejects the whole request if *any* selector already has an invoice. |
| `generateInvoiceForSelectionInputs` | 3682 | Production: grouped Automatic Invoices runs (`recurringBillingRunActions.ts:589,594,704,714`), passing `{ billingCycleId: group.billingCycleId }` as bridge metadata. |

Production member selection, as used by Automatic Invoices:

- `getAvailableRecurringDueWork` (`packages/billing/src/actions/billingAndTax.ts:1845`) reads persisted rows via `fetchPersistedRecurringDueWorkDbRows` (`:379`). That function filters `lifecycle_state IN DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES` (`generated`, `edited`, `locked`) **and `invoice_charge_detail_id IS NULL`** (`:411–412`), so it returns only unbilled obligations.
- `buildRecurringDueWorkInvoiceCandidates` (`:1220`) → `groupDueServicePeriodsForInvoiceCandidates` (`shared/billingClients/recurringTiming.ts:239`). These group by **client + invoice window** (`windowKey`, `:262`). Contract, PO, currency, tax source and export shape become `splitReasons`, not separate candidates. That gives one candidate per client cycle window.
- `AutomaticInvoices.tsx` submits a combinable candidate's members as one grouped target `{ selectorInputs, billingCycleId }` → `generateGroupedInvoicesAsRecurringBillingRun` → `generateInvoiceForSelectionInputs`.

The defect: for a second contract that starts mid-cycle in a cycle another contract already billed, `generateInvoice` resolves the billed obligation as well. The duplicate guard then rejects the whole request with `duplicateRecurringInvoice`. The due-work path never offers the billed member, so it bills only the new contract's prorated period.

Callers verified at `d6dc22c273`:

- No production caller exists.
- `actions/index.ts:49–54` re-exports only `createSeparateProjectProductInvoices` / `getSeparateProjectProductInvoiceReview` from `invoiceGeneration`.
- `AutomaticInvoices.tsx:3449` and `AutomaticInvoices.i18n.test.ts:159` refer only to the i18n key `automaticInvoices.actions.generateInvoice`.
- `packages/billing/src/models/invoice.ts` `Invoice.generateInvoice` (and `packages/billing/tests/invoice.test.ts`) is unrelated.
- The sales-order `generateInvoice` (`packages/inventory/...`, `server/src/app/msp/inventory/sales-orders/page.tsx`, inventory locale keys) is unrelated.

## 2. Key decisions

1. **The helper calls the real due-work action.** It does not reimplement a "filter out billed rows" query. `generateInvoiceForCycle` calls `getAvailableRecurringDueWork` itself, so tests exercise exactly the reader Automatic Invoices uses. A parallel SQL predicate in test-utils would drift. Tests already run with authenticated `withAuth` mocks (generateInvoice is also `withAuth`), so no new mocking is needed. `billing:read` is required; every affected suite uses `permissionCheck: () => true` or equivalent (checked: no affected test denies permissions around a generateInvoice call).
2. **One request per cycle, combined.** The helper submits all members of the matching candidate in one `generateInvoiceForSelectionInputs` call, which is the Automatic Invoices "combinable parent group" path. It does not reproduce the UI's per-child fan-out for incompatible candidates. That matches today's `generateInvoice` granularity (one invoice per cycle), so call shape and invoice counts stay the same. Tests that need fan-out semantics already use `generateGroupedInvoicesAsRecurringBillingRun`.
3. **`canGenerate` / `blockedReason` are ignored when picking members.** The core re-validates materialization, approvals and month-end close, and tests assert the core's coded errors (e.g. `TIME_APPROVAL_REQUIRED`). Filtering on UI flags would hide those errors behind a generic "nothing due".
4. **Bridge metadata stays.** The helper passes `{ billingCycleId }` exactly as production grouped runs do (`recurringBillingRunActions.ts:592,712`). `invoices.billing_cycle_id` stamping and the cycle billing-profile fallback (`getCycleBillingProfileId`, invoiceGeneration.ts:3463) are unchanged. `RecurringBridgeMetadata` / `resolveRecurringInvoiceBridgeId` have production users and are **not** removed.
5. **`resolveCanonicalSelectorInputsForClientWindow` stays.** It has a second production caller (`previewRecurringUnitRevisionInvoiceImpact`, :2213). Only the docstring changes, because it currently describes itself as the "legacy billing-cycle bridge". The fact that it includes billed obligations in that preview is recorded as a follow-up (§7), not fixed here.
6. **"Nothing due" is a distinct, loud result.** If the cycle's client+window has no unbilled due-work members, the helper returns `{ actionError: 'No unbilled recurring work is due for billing cycle <id> (<client>, <start>→<end>).', code: 'NO_DUE_RECURRING_WORK' }`. It does not fall back to billed members, which would re-create the trap inside test-land. Tests that regenerate a billed cycle and assert "no new invoice" keep passing because they only check that no `invoice_id` exists and that invoice counts are unchanged. `unwrapInvoiceResult` throws on it, which is the right failure when a fixture forgot to materialize or is in a non-due lifecycle state.
7. **The duplicate-guard path is tested where production reaches it.** Production hits the duplicate guard through a stale/double-submitted selector input, not through a cycle id. Any test that asserts the duplicate *error* (rather than "no new invoice") is rewritten to re-submit the captured selector inputs through `generateInvoiceForSelectionInputs`, the same way `billingInvoiceTiming.integration.test.ts:3508` and `:5408` already do.
8. **Mocked unit tests go straight to the selection action.** The three module-mocked unit suites cannot run the due-work reader over a query-builder fake, so they skip the helper. They call `generateInvoiceForSelectionInputs([buildClientCadenceDueSelectionInput(...)], {}, { billingCycleId: 'cycle-1' })`, which is the code path production uses.
9. **Historical plan docs are not rewritten.** `docs/plans/**` and `ee/docs/plans/**` are dated, frozen records. Only living docs are updated. The acceptance grep is scoped accordingly (§6). **Flag for XO:** this narrows the card's literal acceptance line "`git grep -w generateInvoice` shows only…". Unscoped, that grep also matches ~25 historical plan files and this plan.

## 3. Changes

### 3.1 New test helper: `server/test-utils/billingTestHelpers.ts`

Add it next to `unwrapInvoiceResult` (~line 1170):

```ts
export async function generateInvoiceForCycle(
  billingCycleId: string,
  options: IInvoiceGenerationRequestOptions = {},
): Promise<InvoiceViewModel | null | InvoiceGenerationActionError>
```

Steps:

1. Read `client_billing_cycles` by `billing_cycle_id`. Use the same tenant connection pattern the helpers already use: `createTenantKnex()` from `@alga-psa/db`, imported dynamically like `materializeRecurringServicePeriods` does. Missing row → `{ actionError: 'Billing cycle not found' }`.
2. Derive the window with today's rule (old 3268–3283): `period_start_date`/`period_end_date` → `toISODate(toPlainDate(...))`. Otherwise `effective_date` + `getNextBillingDate(client_id, start)` (unwrap the helper result). Otherwise `{ actionError: 'Invalid billing cycle dates' }`.
3. Page through `getAvailableRecurringDueWork({ page, pageSize: 500 })` until `page > totalPages`. Pass **no** `dateRange`: it filters on `rsp.service_period_start` (`billingAndTax.ts:440–443`), which would drop arrears members whose service period precedes the invoice window. Keep candidates where `clientId === cycle.client_id && windowStart === start && windowEnd === end` (normalize both sides to date-only). A `permissionError` result is returned as-is.
4. Collect `members[].selectorInput`, de-duplicated by `executionIdentityKey` (mirrors `AutomaticInvoices.tsx` `buildRecurringInvoiceParentGroups`).
5. Empty → `NO_DUE_RECURRING_WORK` actionError (decision 6).
6. `return generateInvoiceForSelectionInputs(selectorInputs, options, { billingCycleId })`.

Comment edits in the same file:

- Line 1151 comment ("generateInvoice resolves its billing window through recurring_service_periods"): reword to say that recurring generation and `generateInvoiceForCycle` select members from `recurring_service_periods`.
- Lines 1171–1173 comment and the `'generateInvoice returned no invoice'` message (1180): reword to "invoice generation returned no invoice". The `null` case still means a suppressed zero-dollar invoice.

### 3.2 Regression test (new)

`server/src/test/infrastructure/billing/invoices/clientCadenceGenerationGuard.test.ts` already has the fixture vocabulary for this scenario (`seedCycles`, `createFixedPlanAssignment`, `activePeriods`, contract A/B, 3100 → 1700 proration, lines 168–259). Add:

`it('second contract starting mid-cycle in an already-billed cycle bills its own prorated draft through the cycle helper, with no duplicate error')`

1. Seed cycles 2026-03-01→04-01 and 04-01→05-01. Create contract A (advance, 3100, start 2026-01-01, `materializeServicePeriods: true`).
2. `unwrapInvoiceResult(await generateInvoiceForCycle(marchCycleId))` → invoice A (subtotal 3100). **Bill A for real**, not with `insertBilledPeriod`, so the duplicate guard has a real invoice linkage to trip on. Capture A's selector inputs from due-work before generating, for step 6.
3. Create contract B (advance, 3100, start 2026-03-15, prorated, materialized). Assert B's first period has invoice window 03-01→04-01.
4. `generateInvoiceForCycle(marchCycleId)` → succeeds, `subtotal === 1700`, a different `invoice_id`, `billing_cycle_id === marchCycleId`. Its charges reference only B's contract line.
5. Two invoices exist for the client. A's March period still links to invoice A.
6. Control showing the guard is intact: `generateInvoiceForSelectionInputs(aSelectorInputs)` resolves to an actionError matching `/already exists/` (`duplicateRecurringInvoice`).
7. Third `generateInvoiceForCycle(marchCycleId)` → `code: 'NO_DUE_RECURRING_WORK'`, and still two invoices.

Arrears variant: optional, in the same describe block. B's partial period lands in April's window together with A's April arrears period, so it adds little over the existing arrears test. Add it only if the advance case passes trivially.

### 3.3 Repoint test call sites (mechanical)

For each file, replace the import (`import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration'`, or the dynamic `await import(...)` destructure) with `generateInvoiceForCycle` from the relative `test-utils/billingTestHelpers` path, then rename the calls. Keep any other names imported from `invoiceGeneration` in that file. Call shape: `generateInvoice(id)` → `generateInvoiceForCycle(id)`, and `generateInvoice(id, opts)` → `generateInvoiceForCycle(id, opts)`.

Real-Postgres / infrastructure (`grep -cw generateInvoice` count):

- `server/src/test/infrastructure/billing/invoices/`:
  - contractQuantityUsageSemantics (101)
  - invoiceNumberGeneration_part2 (20)
  - invoiceNumberGeneration_part1 (7)
  - multiCurrency (6)
  - fixedPriceAndTimeBasedPlans (6)
  - errorHandling (6)
  - contractInvoiceManualCredit (6)
  - usageRecordDrivenBilling (5)
  - billingInvoiceGeneration_subtotal (5)
  - billingInvoiceGeneration_edgeCases (5)
  - usageBucketAndFinalization (4)
  - prepaymentInvoice (1)
  - billingInvoiceGeneration_tax (1)
- `server/src/test/infrastructure/billing/`:
  - pricingSchedules/pricingScheduleRateOverrides (7)
  - catalogPricing/catalogPriceResolution (5)
  - credits/creditExpirationEffects (1)
  - credits/creditExpirationPriority (1)
- `server/src/test/integration/`:
  - billingInvoiceTiming (24)
  - invoiceTicketProduction (11)
  - contractServicesPerSeatWizard (10)
  - billing/fixedFeeZeroCatalogPrice (7)
  - clientMerge (6)
  - contractServicesPerSeatDisplay (5)
  - billing/contractPurchaseOrderSupport (5)
  - billing/billingProfileAttribution (5)
  - journeys/ticketTimeApprovalToBilling (4)
  - contractServicesPerSeatTemplate (4)
  - contractServicesPerSeatApi (4)
  - billing/goldenOutput/goldenOutputBaseline (4)
  - journeys/invoiceRenderToDelivery (3)
  - journeys/invoiceLifecycleToPayment (3)
  - journeys/contractWizardToInvoice (3)
  - invoiceTicketImmutable (3)
  - contractServicesPerSeatRateReview (3)
  - contractServicesPerSeatQuote (3)
  - contractServicesPerSeatPreset (3)
- `server/src/test/unit/billing/taxRateCaps.db.test.ts` (2; real DB, dynamic import at :311)
- `server/src/test/visual/invoiceTemplateGolden.test.ts` (3; module-level `let` typed as `typeof ...generateInvoice` at :44 → retype to `typeof generateInvoiceForCycle`)

Counts include imports and comments. Reword comments that say "generateInvoice" to name the helper, or "recurring generation" when the comment describes production behavior.

Duplicate-assertion triage (decision 7). Read each site; the expected outcome is "no change needed" unless the test asserts the error *text*:

- `invoiceTicketImmutable.integration.test.ts:223` asserts `invoice_id` undefined → passes with `NO_DUE_RECURRING_WORK`.
- `contractQuantityUsageSemantics.test.ts` ~2339, ~2370, ~3029 (repeat generation) → check each. 2327/2371 assert only `'actionError' in result`.
- `errorHandling.test.ts:357` is a comment pointing at `invoiceGeneration.duplicate.test.ts`. Leave it.

### 3.4 Unit (module-mocked) suites

- `server/src/test/unit/billing/invoiceGeneration.zeroDollarFinalization.test.ts:408,431,445,482` and `invoiceGeneration.emptyResult.test.ts:282,297`: switch to `generateInvoiceForSelectionInputs([buildClientCadenceDueSelectionInput({ clientId: 'client-1', scheduleKey, periodKey, windowStart: '2025-02-01', windowEnd: '2025-03-01' })], {}, { billingCycleId: 'cycle-1' })`. Use the keys of the fake `recurring_service_periods` row each file already builds (`buildClientCadenceServicePeriodRow`). The `client_billing_cycles` fake rows stay because the core still reads the cycle for the billing-profile fallback. Assertions are unchanged; `T210/T273` checks `selectorInputs: [expect.objectContaining(...)]`.
- `invoiceGeneration.selectorInputGenerate.test.ts:481,661–674` T047 ("compatibility billing-cycle wrapper … routes through the selector-input pipeline") tests the deleted wrapper. Rewrite it as **T047b**: `generateInvoiceForSelectionInputs([...], {}, { billingCycleId: 'cycle-1' })` stamps `billing_cycle_id: 'cycle-1'` on the invoice. That bridge contract still matters. Drop `generateInvoice` from the import at :481.
- `server/src/test/unit/billing/projectBillingInvoiceLifecycle.contract.test.ts:43` uses `"export const generateInvoice"` as the **end marker** of the `generateProjectInvoice` section. Change it to `"export const getSeparateProjectProductInvoiceReview"` (the next export, currently :3170). The assertions only need the `generateProjectInvoice` body.

### 3.5 Production deletion: `packages/billing/src/actions/invoiceGeneration.ts`

- Delete `export const generateInvoice = withAuth(...)` (3243–3328).
- After deletion, verify that each import used only by that block still has another user. Candidates: `getNextBillingDate`, `unwrapBillingHelperResult`. `tsc`/eslint `no-unused-vars` will flag any that lost their last user; remove those.
- Keep `resolveCanonicalSelectorInputsForClientWindow` (decision 5). Rewrite its docstring (1262–1271): it resolves every live obligation in a client invoice window **including billed ones**, for whole-window previews. Generation must select members through due-work.
- Keep `RecurringBridgeMetadata` / `resolveRecurringInvoiceBridgeId` (decision 4).
- Rename the log prefix `[generateInvoice] PO overage detected` (3603) to `[generateInvoiceForNormalizedSelectionInputs]`. The literal must not survive the acceptance grep, and the old prefix names a function that no longer exists.

### 3.6 Stale comments and living docs

- `server/migrations/20260818050000_add_billing_profile_to_cycles_and_invoices.cjs:9`: comment only, no behavior change, safe to edit in an applied migration. Replace "`generateInvoice(cycleId)` keeps its shape entirely — it simply runs once per profile-cycle" with wording about recurring generation per profile-cycle (bridge `billingCycleId` → `getCycleBillingProfileId`).
- `server/src/test/integration/journeys/README.md:19`: "`generateInvoice` for the cycle" → "`generateInvoiceForCycle` (test helper over due-work + `generateInvoiceForSelectionInputs`)".
- `docs/reference/testing-standards.md:687,719`: update the example to use `generateInvoiceForCycle(billingCycleId)` from `server/test-utils/billingTestHelpers`. The example also has a stale import path and passes a company id; correct both while there.
- `docs/billing/billing_cycles.md:128,136,229`: it describes a long-gone `generateInvoice(clientId, billingPeriod)` in `invoiceActions.ts`. Rewrite these three spots to describe due-work → `generateInvoiceForSelectionInput(s)`.
- **Not edited**: `docs/plans/**`, `ee/docs/plans/**` (historical). Also `server/src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts:431`: it asserts that the frozen `PASS0_RECURRING_TIMING_APPENDIX.md` contains `generateInvoice(...)` as the historical parity-harness description. That is an assertion about a frozen document, not a caller.

## 4. Ordering (commits)

1. Add `generateInvoiceForCycle` and the regression test (§3.1, §3.2). Run the guard suite: the new test must pass. As a sanity check before step 4, temporarily calling the old `generateInvoice` in step 4 of the test should show the duplicate error. Record that in the PR body; do not commit it.
2. Repoint infrastructure/integration/visual/taxRateCaps call sites (§3.3). One commit, or split infrastructure vs integration to keep diffs reviewable.
3. Rework the mocked unit suites and the contract-test marker (§3.4).
4. Delete the production export and fix imports, docstring and log prefix (§3.5). This must come after 2–3 so every commit compiles.
5. Update comments and living docs (§3.6).

## 5. Migration / back-compat

- No schema, API, i18n or UI change.
- The removed export had no action ID: no client import and no barrel re-export, so no deployed client can be calling it. Removing it changes no network surface.
- REST `generateRecurringInvoice`, the job handler and recurring runs are untouched. `invoices.billing_cycle_id` stamping is unchanged for production paths, which already pass bridge metadata.
- EE: no references (checked `ee/` code; only `ee/docs/plans` text).

## 6. Verification / acceptance

- Scoped acceptance grep, which must list only the model's `Invoice.generateInvoice` and its test, the sales-order function/components/page/tests, `inventory.json` locale keys, the `automaticInvoices.actions.generateInvoice` i18n key and its test, and the frozen-appendix contract test:
  `git grep -nw generateInvoice -- ':!docs/plans' ':!ee/docs/plans'`
- `npx tsc --noEmit -p packages/billing` and `-p server` (or the repo's typecheck target): green.
- Unit suites: `invoiceGeneration.*.test.ts`, `projectBillingInvoiceLifecycle.contract.test.ts`, `servicePeriodFirstBillingPlan.contract.test.ts`, `packages/billing/tests/**`.
- Real-Postgres: every file in §3.3, plus `clientCadenceGenerationGuard.test.ts` and `clientCadenceContractBoundary.regeneration.test.ts`. Run against the `alga-psa-local-test` stack.
- Golden output (`goldenOutputBaseline.integration.test.ts`, `invoiceTemplateGolden.test.ts`): byte-identical. No baseline updates are allowed in this card. A golden diff means the helper's member selection differs from the old one on a fixture, and that must be explained, not re-baselined.
- CI green.

## 7. Out of scope (follow-ups to file)

- **`previewInvoice(billing_cycle_id)`** (`invoiceGeneration.ts:2941`) has the same profile: no production caller (the REST `InvoiceService.previewInvoice` is a separate method) and 8 test files. It is the preview twin of this trap. Propose an identical retire card.
- **`previewRecurringUnitRevisionInvoiceImpact`** (:2213) previews the whole client window through `resolveCanonicalSelectorInputsForClientWindow`, billed obligations included. Check whether its before/after preview double-counts already-billed contracts in a multi-contract cycle.
- `Invoice.generateInvoice` (model) and the sales-order `generateInvoice`: explicitly untouched.

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A fixture leaves `rsp` rows in a non-due state (not `generated`/`edited`/`locked`), or with `invoice_charge_detail_id` set, that old `generateInvoice` still picked up | Medium | `NO_DUE_RECURRING_WORK` makes it loud and names the cycle. Fix the fixture so it matches what production would see. Never widen the helper. |
| A test relied on old `generateInvoice` re-including a billed obligation (asserting the duplicate error after a partial bill) | Low | Triage per decision 7: re-submit captured selector inputs through `generateInvoiceForSelectionInputs`. |
| Pagination or unrelated tenant data hides the candidate | Low | Exhaust all pages. Most suites run per-test tenants. |
| A suite partially mocks `@alga-psa/db` / `resolveEffectiveTimeZone`, which `getAvailableRecurringDueWork` needs and old `generateInvoice` did not | Low–medium | Find these in the step-2 run; add the missing passthrough mock in that suite. |
| Golden outputs shift | Low | Treat any shift as a finding (§6). |
| Runtime: the due-work reader per call (contractQuantityUsageSemantics makes ~100 calls) | Low | It is tenant-scoped and small per test. If the suite timeout bites, raise that suite's timeout. Do not add a bypass. |

`// LEVERAGE:` note to drop in the helper: `getAvailableRecurringDueWork` has no client/invoice-window filter, so "due work for this client window" has to be done by paging and filtering. If a second caller appears (a REST "generate for cycle" or the preview follow-up), the reader should accept `{ clientId, invoiceWindow }` directly.
