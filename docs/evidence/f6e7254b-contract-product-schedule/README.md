# f6e7254b — recurring contract product quantity & price scheduling evidence

Validated on 2026-09-23 against the live development server from this worktree at
`http://localhost:3029` (compose project `alga-psa-local-test`, PostgreSQL `server`).

Implementation history:

- `166b961fdf` — feature: schedule recurring product quantity and price revisions.
- `288cda16f5` — repair: carry `effective_pricing` through the domain facts and value
  revision-managed product lines in monthly valuation.
- `da32cd04a2` — follow-up repair: unify the valuation rate chain on
  `resolveFixedLineRate`, keep a catalog-policy revision from re-reading a stale
  configuration rate, and preserve original edit attribution in revision history.
- Final Draft Implementation run (this change, uncommitted at capture): add the
  preview↔generation stale-pricing lock (`RECURRING_PRICING_STALE`), persist
  `effective_pricing` provenance on `invoice_charge_details`, refuse configuration
  deletion when it would erase invoice/revision provenance, and surface the resolved
  catalog rate, covered dates, baseline and invoice delta in the scheduling panel.
  Includes a focused `recurringPricingIdentity` unit suite and a coded-refusal
  assertion in the integration suite. Committed locally; not pushed.

## Scenario

Deterministic product contract seeded directly in the dev DB (UI authoring of the
contract shape is out of scope for this smoke):

- Client: Amys Bird Sanctuary LLC.
- Fixed monthly contract `SMOKE Product Schedule`, start `2026-09-01`.
- Three recurring catalog products: Users 20 × $100, Endpoints 30 × $50,
  Locations 2 × $200 (baseline $3,900/month), each a `Fixed` service
  configuration with catalog `service_prices` in USD and wizard-style
  `base_rate = 0` (`item_kind = 'product'`, `pricing_basis = 'bundle'`).

Seeded IDs:

- `contract_id=9e3c4a4c-4b32-46c6-a792-7640438d482f`
- `line_id=002d16a5-767d-4ac8-b514-1d2e558df37a`
- Users `config_id=d8150176-b333-466c-906c-e5353622e43a`
- Endpoints `config_id=0c82fd15-873b-446c-b1ad-0f3f818966cb`
- Locations `config_id=279485d7-ad2c-476a-984a-762dfa44a58c`

## Navigation

`/msp/billing?tab=contracts&subtab=client-contracts&contractId=<id>` → **Contract
Lines** tab → expand `SMOKE Product Schedule Line` → each product exposes a
collapsed **Schedule recurring change & history** disclosure.

## Live-product results (this run)

| Step | Action | Observed | Result |
| --- | --- | --- | --- |
| Panel render | Expand the line and open the Users schedule disclosure | Boundary defaults to the next unbilled service-period boundary; form pre-fills the effective quantity/rate/source at that boundary (`23 × $110.00`, explicit override, inherited from the `2026-11-01` revision) | Pass |
| Schedule increase | Users → boundary `2027-01-01`, quantity `27`, price source `Override unit price`, rate `110.00`, Save | Green `Scheduled: 27 effective 2027-01-01.`; notice `A scheduled change is already in force from 2027-01-01 … (version 1)`; Scheduled-periods row `2027-01-01 / 27 / $110.00 / v1`; button flips to `Replace scheduled change` | Pass |
| Billed guard | Seed a `billed` recurring service period `2027-02-01 → 2027-03-01`; Users → boundary `2027-02-01`, quantity `27`, Save | Red `That effective date falls inside an already-billed or finalizing service period. Choose the next unbilled service-period boundary instead.`; canonical DB revisions unchanged (no `2027-02-01` row). Synthetic period removed after capture | Pass |
| History | Open `Superseded pending edits (1)` on the Users panel | Shows the superseded `2026-10-01 / 23` edit with the replacing actor | Pass |

Fresh screenshots against this build:

- `11-final-schedule-panel-2027.png` — Users panel: in force `27 × $110.00`
  from `2027-01-01`, scheduled-periods table `2026-10-01 / 25 / Catalog / v2`,
  `2026-11-01 / 23 / $110.00 / v1`, `2027-01-01 / 27 / $110.00 / v1`, and the
  superseded-pending-edits disclosure.
- `12-billed-date-rejected.png` — billed-period rejection with the canonical
  scheduled-periods table unchanged.

Earlier captures `01`–`08` remain from the first-draft and first-repair runs and
describe the same panel surface; `11`/`12` supersede the earlier top-of-page
`09`/`10` captures.

### Tested revision (exact DB state)

Tests the revision created in this run on the Users product:

| service | quantity | unit_rate_cents | price_policy | version | effective_period_start |
| --- | --- | --- | --- | --- | --- |
| SMOKE Prod Users | 25 | NULL | catalog | 2 | 2026-10-01 |
| SMOKE Prod Users | 23 | 11000 | override | 1 | 2026-11-01 |
| SMOKE Prod Users | 27 | 11000 | override | 1 | 2027-01-01 |
| **SMOKE Prod Users** | **30** | **12000** | **override** | **1** | **2027-02-01** |
| **SMOKE Prod Users** | **31** | **12000** | **override** | **1** | **2027-03-01** |
| SMOKE Prod Endpoints | 35 | NULL | catalog | 1 | 2026-10-01 |
| SMOKE Prod Locations | 0 | NULL | catalog | 1 | 2026-12-01 |

The two bold Users rows were created live through the panel in the final run
(`created_by = 77206cb5…`, the review-2515 account). `SMOKE Prod Users` rows at
`2026-10-01/23`, `2026-11-01/23` and the superseded edit are carried from the
prior run; the `2026-10-01/23` superseded value remains in
`contract_line_unit_pricing_revision_history` (superseded by `acdb0685…`).

`contract_line_unit_pricing_revision_history` keeps the superseded `2026-10-01 / 23`
Users edit. The `2027-01-01` revision was created fresh, so it has no history row.

## Final-run UI smoke (this change)

Fresh capture at `http://localhost:3029` as the tenant `6d178771-…` review account
(`review-2515@example.test`), on the working tree including this change. New
screenshots supersede the earlier `01`–`12` set for the current panel surface:

- `22-final-contract-lines-tab.png`, `23-final-line-expanded.png` — the contract line
  and its three recurring products each expose **Schedule recurring change & history**.
- `24-final-users-panel.png` — default boundary `2026-10-01`, effective
  `25 × $100.00 (catalog price)`, coverage `2026-10-01 to next boundary (USD)`, the
  resolved `service_prices` identity/effective date, baseline `20 × N/A`, and the
  boundary-only policy note.
- `25-final-plan-30x120-2027-02-01.png` — scheduling `30` at `2027-02-01` with an
  explicit `$120.00` override: the panel shows the in-force `27 × $110.00`, coverage
  and a `+$630.00 to $3,600.00` delta (before discounts/tax). `30 × 120 − 27 × 110`
  matches.
- `26-final-scheduled-2027-02-01.png` — save succeeds (`Scheduled: 30 effective
  2027-02-01.`); the Scheduled-periods table gains `2027-02-01 / 30 / $120.00 / v1`
  with the real actor, and the button flips to **Replace scheduled change**. The DB
  row confirms `quantity=30, unit_rate_cents=12000, price_policy=override, version=1,
  created_by=77206cb5…`.
- `27-final-billed-rejected.png` — with an issued-invoice detail for the config
  present, an attempted save at the covered boundary is refused by the server with
  *"That effective date falls inside an already-billed or finalizing service period.
  Choose the next unbilled service-period boundary instead."* (the synthetic
  `invoice_charge_details` row inserted only to trigger the guard was deleted after
  capture; verified count 0).
- `28-final-superseded-history.png` — the **Superseded pending edits** disclosure
  shows the prior `2026-10-01 / 23 / Catalog` value and superseding actor.
- `29-final-stale-two-tab.png` — two tabs both loaded an empty boundary
  (`2027-03-01`, `expected_version = null`); tab B created `31`, then tab A's save was
  refused: *"Another change was created at this effective date by someone else.
  Reload the period and review the newer values before saving."* Tab A's table does
  not yet show the rival row, i.e. it is genuinely stale.

## Final-run completion (this change)

- **Preview↔generation stale-pricing lock.** `billingEngine` emits a
  `recurringPricingSource` on each revision-priced charge; `recurringPricingIdentity`
  binds it to the obligation key and compares the reviewed sources to the recomputed
  ones. `previewInvoice` returns `expectedRecurringPricingSources`; generation refuses
  with the coded `RECURRING_PRICING_STALE` when a revision/version/policy/rate/catalog
  identity or quantity changed. The code is wired through
  `invoiceGeneration.constants` → `manualInvoiceErrorMessageKey` →
  `recurringBillingRunActions`' failure mapping and the `msp/invoicing` locale, so it
  reaches both interactive and automated runs as an actionable keyed error.
- **Persisted provenance.** `invoice_charge_details.effective_pricing` (jsonb,
  additive nullable) stores the revision id/version/policy, resolved rate and
  catalog-price identity on generated details; migration
  `20260923010000_invoice_charge_details_recurring_pricing_provenance.cjs` was applied
  to the dev DB and recorded in `knex_migrations` (batch 51) without touching the
  drifted ledger beyond that.
- **Deletion guard.** `configurationDeletionGuard` plus the configuration model/config
  service refuse to delete a config referenced by `invoice_charge_details` or carrying
  scheduled revisions; the operator stops the item with a zero revision instead.
- **Panel display.** Resolved catalog rate/identity, covered dates, baseline row,
  invoice delta, protected-period notice, discard-dirty confirmation, history load
  error, status/actor columns and superseded-pending disclosure.
- **Tests.** `recurringPricingIdentity.test.ts` (10) is new; the integration block
  gains a coded `RECURRING_PRICING_STALE` assertion, plus cases for catalog-inheritance
  billing, all-zero no-charge stability, percentage/fixed discounts with tax, deletion
  guards, inline-editor conflict, provenance persistence and catalog-stale refusal.

## Follow-up repair in this run

The prior run (commit `288cda16f5`) fixed invoice/valuation parity; this run closes
three residual gaps found by review and makes the valuation chain single-sourced:

1. **Valuation re-derived the rate chain.** `shared/billingClients/contractMonthlyValue.ts`
   still implemented its own `base_rate → custom_rate → default_rate` chain, so a
   currency-tagged `service_prices` row was invisible to overview/report valuation.
   Unit-valued members now call the same `resolveMemberRate` the invoice engine and
   the deferred-revenue loader use (currency + effective date aware). Untouched lines
   keep their legacy bundle valuation, because a line only becomes revision-managed
   once an applicable revision exists.
2. **Catalog-policy revisions revived a stale configuration rate.** A product with a
   catalog-policy revision but a leftover `contract_line_service_configuration.custom_rate`
   displayed that stale rate in `getContractOverview`. The overview now reports a null
   unit rate for an effective catalog policy instead of the frozen column.
3. **Original edit attribution was lost on replacement.** Replacing a pending revision
   overwrote the canonical row's author. The history audit now carries
   `original_created_by/at` and `original_updated_by/at`, and the canonical row keeps
   the original `created_by`/`created_at` while the superseding actor lands on
   `updated_by` and in history (migration
   `20260923000000_contract_recurring_pricing_history_attribution.cjs`, additive and
   nullable). `expected_version` semantics were also made explicit in the shared
   scheduler and action: `undefined` = legacy unconditional upsert, `null` = "I saw an
   empty boundary, so reject if another editor created one", number = compare-and-set.

`RecurringUnitSchedulePanel.tsx` continues to send `expected_version` only for a
revision stored at the exact selected boundary.

## Behavioral validation

Real server actions + billing engine against PostgreSQL (not source-string tests):

- `server/src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts`
  — **87 passed** (this run; 77 before the completion cases). The
  `recurring products (parity with unit services)` block covers:
  20/30/2 bills **$3,900** (390000); scheduling Users to 23 at `2023-02-01` yields
  preview **and** generated invoice subtotal **$4,200** (420000) with the earlier
  invoice row unchanged and `getContractOverview` = 420000; decrease (18 → 370000),
  zero stop (Users 0 → 190000) and later resumption (20 → 390000); explicit override
  (`23 × $110` → 443000) and catalog-policy revisions following a later catalog price
  (`→ 473000`); pending-boundary replacement bumps `version` and records history; a
  stale `expected_version` is rejected; two editors both seeing an empty boundary —
  the second create is rejected; the original author is preserved while the replacer
  is recorded; a change inside a billed period is rejected while the next boundary is
  accepted; repeated generation creates no second invoice; and a future revision does
  not reprice an older, later-billed period. The completion cases add: a unit-priced
  service switching to catalog inheritance bills the currency catalog price (not zero)
  and the overview agrees; an all-zero contract reaches a stable no-charge period with
  no duplicate invoice; percentage (10%) and fixed (`$100`) contract discounts plus tax
  are applied and persisted over the revised gross subtotals; provenance is persisted
  on generated details; generation after the reviewed revision changed is refused with
  the coded `RECURRING_PRICING_STALE` message key; generation after the inherited
  catalog price moved is refused; and deletion of a configuration is refused when it
  carries scheduled revisions or issued-invoice provenance.
- `packages/billing/src/lib/billing/recurringPricingIdentity.test.ts` — **10 passed**
  (new). Unit coverage for the preview↔generation source comparison: unchanged
  source accepted; bumped version, switched policy, moved catalog price, changed
  quantity, dropped source and unreviewed-new source all reported stale; legacy
  charges without provenance ignored; obligation key includes config and covered
  window.
- `server/src/test/infrastructure/billing/invoices/contractRecurringValueReporting.test.ts`
  — **7 passed** (new). The added case proves monthly valuation of a revision-managed
  product line: an untouched line stays `0`, scheduling Users to 23 at `2023-02-01`
  values `23 × CAD 11000 + 30 × CAD 6000 = 433000` (the untouched sibling is valued
  too), and a dated CAD catalog change is followed (`→ 456000`).
- `packages/billing/src/lib/billing/compute/compute.test.ts` — **46 passed**; includes
  `feeds effective recurring subtotals through automatic percentage and fixed
  discounts`: 10% → 351000/378000 and $100 fixed → 380000/410000 over the
  390000/420000 gross subtotals.
- `shared/billingClients/__tests__/recurringUnitPricing.test.ts` — **10 passed**.
- `packages/billing/src/lib/billing/pricing/{resolveFixedLineRate,classifyLineRateProvenance}.test.ts`,
  `productionGolden.test.ts`, `tests/contractBilling.domain.test.ts` — **40 passed**.
- `server/src/test/infrastructure/billing/catalogPricing/catalogPriceResolution.test.ts`
  — **22 passed** (fixed path unaffected by the valuation change).
- `packages/reporting/.../deferred-revenue/{compose,credits,hours,fee,loaders.contract}.test.ts`
  — **74 passed**.
- `server/src/test/unit/billingEngine.test.ts` + `billingEngine.timing.test.ts` — **53 passed**.

Commands and results:

- `cd shared && npx vitest run billingClients/__tests__/recurringUnitPricing.test.ts` — 10 passed.
- `cd packages/billing && npx vitest run src/lib/billing/compute/compute.test.ts` — 46 passed.
- `cd packages/billing && npx vitest run src/lib/billing/recurringPricingIdentity.test.ts` — 10 passed.
- `cd server && TEST_DB_NAME=test_db_pcs_sched REQUIRE_DB=1 npx vitest run src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts` — 87 passed.
- `cd server && TEST_DB_NAME=test_db_pcs_sched REQUIRE_DB=1 npx vitest run src/test/infrastructure/billing/invoices/contractRecurringValueReporting.test.ts` — 7 passed.
- `cd shared && npx tsc --noEmit` — exit 0.
- `cd packages/types && npx tsc --noEmit` — exit 0.
- `npx tsc --noEmit -p packages/db/tsconfig.json` — exit 0.
- `cd packages/billing && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p tsconfig.json` — exit 0.
- `npx eslint <changed files>` — 0 errors (pre-existing `any`/non-null-assertion warnings only).
- `server` `tsc --noEmit` was not run: it is a known host-memory OOM and its tsconfig
  excludes `src/test/**`, so the new tests are outside it anyway.

## Shared effective-pricing interface (companion handoff)

The canonical revision store and resolver are the shared interface a companion card
can consume without inventing a second scheduling engine:

- **Store:** `contract_line_unit_pricing_revisions` — `(tenant, contract_line_id,
  service_id, config_id, effective_period_start)` unique, `quantity >= 0`,
  `price_policy ∈ {override, catalog}`, nullable `unit_rate_cents` (present iff
  override), `version`, `created_by/at`, `updated_by/at`. Superseded pending edits are
  append-only in `contract_line_unit_pricing_revision_history` (both registered
  tenant-scoped in `packages/db/src/lib/tenantTableMetadata.ts`). The canonical row is
  the single billing source; history never bills.
- **Selector:** `shared/billingClients/recurringUnitPricing.ts` —
  `selectLatestApplicableRevision` / `selectEffectiveRecurringUnitPricing`, keyed by
  boundary (calendar date, latest at/before, version then created tie-break).
  `resolveRecurringUnitKind` is the neutral capability check (product or
  unit-priced Fixed service), so catalog classification does not gate scheduling.
- **Rate resolver:** `shared/billingClients/resolveFixedLineRate.ts#resolveMemberRate`
  returns `{ rateCents, source, sourceId, provenance, revisionId, revisionVersion,
  pricePolicy, catalogPriceId, catalogEffectiveDate }`. That is the pricing provenance
  (revision identity, policy, inherited catalog price identity/effective date) a
  companion needs to fingerprint a source version.
- **Effective facts carried into billing:** each obligation exposes the covered
  service-period start/end, contract assignment/line/service/config identity,
  effective revision id/version, quantity, unprorated unit rate, price policy,
  currency and catalog-price identity; zero is an explicit stop that reaches compute
  as zero and needs no catalog price.
- **Wire provenance (this run):** the resolved facts ride on
  `IBillingCharge.recurringPricingSource` (`IRecurringPricingSource` in
  `packages/types`), are persisted to `invoice_charge_details.effective_pricing`, are
  returned from preview as `IExpectedRecurringPricingSource[]`
  (`{ revisionId, version, pricePolicy, unitRateCents, effectivePeriodStart,
  catalogPriceId, catalogEffectiveDate, clientContractLineId, configId, serviceId,
  servicePeriodStart, servicePeriodEnd, quantity }`), and are compared by
  `packages/billing/src/lib/billing/recurringPricingIdentity.ts`. A companion that
  wanted to fingerprint the same source version can consume that shape.

### Companion integration gaps (explicit, not claimed complete)

Rechecked in this run without merging: the companion card `b97eda7b` now has a
separate worktree at `~/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc`
with commits `c89f0e157f` (plan `docs/plans/2026-09-22-contract-invoice-adjustments-plan.md`),
`a9d4bafb29`, `fc377b32a1`, `90750df0b5`, and its own dev server on `:3185`. It ships
its own settlement implementation (`invoiceAutomaticAdjustments.ts`,
`invoiceAdjustmentEditability.ts`, and migrations
`20260923000000_add_adjustment_provenance_to_invoice_charges.cjs` /
`20260923010000_invoice_adjustment_settlement_support.cjs`).

The concrete interface between the two cards is therefore **only the shared revision
store**, not a shared settlement API:

- The companion consumes contract/obligation identity and invoice-charge metadata; it
  does **not** import or reference `IRecurringPricingSource`,
  `IExpectedRecurringPricingSource`, `recurringPricingSource`,
  `effective_pricing`, `recurringPricingIdentity`, `resolveRecurringUnitDisplayPricing`
  or `RECURRING_PRICING_STALE` (verified by grep in the companion worktree — zero
  matches). Its own provenance lives on `invoice_charges.adjustment_provenance`.
- The shared table both branches touch is `contract_line_unit_pricing_revisions` (from
  main); this card owns the write/read semantics and the pricing provenance types it
  emits, the companion owns adjustment/settlement identities.
- **Ownership conflict, unresolved:** both plans claim effective-history ownership. The
  companion plan states "the companion owns validated effective history and exposes it
  to the existing recurring pricing/timing resolver"; this card treats the revision
  store (`contract_line_unit_pricing_revisions` + append-only history, registered
  tenant-scoped, selected by `recurringUnitPricing.ts`) as that authority. Neither has
  been reconciled with the other; no shared settlement API exists and none is claimed.
  The reviewer should confirm the handoff before either branch integrates.
- Baseline policy is boundary-only: a `20 → 23` change at the next boundary moves this
  period by $0 and the next recurring subtotal by +$300 (gross `3,900 → 4,200`), with
  no mid-period proration, true-up or credit. No automatic adjustment charge is emitted
  by this card.
- Discount/tax interaction is validated only through the existing shared compute
  pipeline (10% and $100 fixed over the gross subtotals) — not through a companion
  settlement flow.

## Disclosures and limitations

- Live Next.js development server against the running dev services; the panel and
  server actions were not mocked. Next dev recompiles workspace packages on request, so
  the captured UI reflects the working tree including this run's changes.
- The seeded smoke contract has no billing cycle or materialized service periods, so
  **in-app** invoice generation on that contract was not exercised. After-invoicing
  behavior, preview↔invoice parity and repeated generation are validated through real
  actions and the billing engine in the integration suites above.
- The dev DB's `knex_migrations` is drift-corrupted by branch-ahead EE files, so
  `migrate:latest`/`migrate:ee` (and even a single-file `MIGRATIONS_DIR`) abort on
  `validateMigrationList`. The two advertised additive migrations
  (`20260922120000_contract_recurring_pricing_revision_policy` and
  `20260923000000_contract_recurring_pricing_history_attribution`) are recorded as
  applied and their columns verified present; they were not re-run. This run's new
  additive migration
  `20260923010000_invoice_charge_details_recurring_pricing_provenance.cjs` was applied
  to the dev DB as `ALTER TABLE invoice_charge_details ADD COLUMN effective_pricing
  jsonb` and recorded in `knex_migrations` at batch 51, matching how the prior two were
  recorded; no other ledger rows were changed.
- The contract Overview tab shows `Est. Monthly Value $0.00` for the smoke contract
  because its revisions are scheduled *after* the overview's `asOf` date (today) and
  the wizard-authored product config carries `base_rate = 0`, so the preserved legacy
  valuation is zero. This is the documented untouched-legacy behavior, not a revision
  regression; the integration suites prove the value becomes `420000` once a revision is
  effective.
- Monthly valuation now uses the invoice engine's currency-tagged `service_prices`
  chain. The previous untagged `service_catalog.default_rate` fallback remains only as
  the resolver's last resort for the tenant default currency when no `service_prices`
  row exists.

## Takeover validation, 2026-09-23

The takeover commit (the commit containing this section) completes the interrupted
working-tree repairs and adds a proposed invoice-impact preview. Review
`companion-handoff.md` first for the settlement integration boundary.

Changes:

- Successful single and grouped previews always return a pricing-source array,
  including `[]`. Creating the first applicable revision after that preview now
  invalidates generation.
- Catalog display pricing resolves the boundary's contract-currency price separately
  from an active override. Positive catalog quantities require a currency price on
  both the server and UI; stopping at zero remains allowed without one.
- **Preview invoice impact** calculates before/after client-window totals through
  the normal billing pipeline inside a rolled-back transaction. No revision,
  revision-history row or invoice survives the proposal preview. Missing service
  periods and calculation errors are shown instead of a guessed total.
- Invoice previews now include the same signed automatic discount lines and net
  totals as generation. Existing tax treatment is preserved. A pending input change
  clears the displayed estimate. Older unbilled boundaries have an explicit warning.
- Product rows no longer describe their recurring quantity/rate as tax allocations.
- Both recurring charge paths normalize catalog source dates before snapshotting.
  Live inspection found the earlier `String(Date).slice(0, 10)` error; the new DB
  assertion requires an ISO catalog effective date.

### Live invoice flow on :3029

An isolated test client was seeded with the existing product catalog members,
20/30/2 baseline quantities, a monthly advance contract starting 2026-08-01,
client billing cycles and service periods generated by the shared materializer.
No invoice or revision was seeded. The client is tax-exempt; discount/tax scenarios
were exercised separately in the real-DB integration tests.

- Client `a45c2805-76b5-4834-a6c0-e28b553448a4`, **SMOKE Takeover Recurring Products**.
- Contract `51d53c43-e59d-4461-80fe-854e00774fa9`.
- Line `d3076f7b-6256-46d7-be20-e63efacc6f45`.
- Users configuration `f082bf04-1f71-4f5a-93c4-91db20fd8ac8`.

From Invoicing → Generate, select the August group and preview. It shows 20 users,
30 endpoints and 2 locations, total **$3,900**. Generate Invoice creates
**INV-000039**, `d8816325-32a7-4a58-b000-ff987b99f6fe`.

Reopen the contract → Contract Lines → expand the line → Users schedule. The shared
earliest-unbilled boundary is September 1. Enter 23 and click **Preview invoice
impact**: the existing invoice pipeline returns **$3,900 → $4,200**. Save the
revision, return to Invoicing, preview September and generate **INV-000040**,
`e2d0a40e-e5be-4fea-baa7-6b76e7d0ddd8`, at **$4,200**. Reopen August through
`/msp/invoices/d8816325-32a7-4a58-b000-ff987b99f6fe`: its customer-facing invoice
still shows Users 20 × $100 and total $3,900. September shows 23 × $100 and $4,200.
These are generated draft invoices; they were not finalized or sent.

On the final code, the next unbilled boundary is October 1. Typing 18 into Users
and clicking Preview invoice impact returns $4,200 → $3,700; typing zero clears
the old estimate and the next preview returns $4,200 → $1,900. Screenshots 39 and
40 capture those proposals. Neither was saved. Text entry used the browser's
editing pipeline; controls were also focused by keyboard. The tool's synthetic
Enter did not activate the preview button, so activation used a pointer click;
full keyboard-only activation is not claimed.

Screenshots 30–38 capture the unavailable-period error, August preview/generation,
proposal preview, saved history, September preview/generation, and both retained
customer invoice displays. `takeover-persisted-results.json` records the invoices,
quantities, covered dates and revision snapshot read back from the dev database.
The snapshot intentionally retains the malformed catalog date on INV-000040 that
revealed the normalization bug; historical invoice data was not rewritten. The
fix is verified by the persisted-provenance integration assertion.

The existing smoke contract's missing-period error is reproducible and actionable.
The newly seeded fixture has actual periods and proves the successful path.
The prior disclosure that no in-app generation was exercised is superseded by
this section. Earlier screenshots remain historical evidence, not final-build proof.

### Environment repair

Live preview initially failed because the dev database lacked
`contract_pricing_schedules.contract_line_id`. Applied the checkout's existing,
additive `20260912140000_add_contract_line_scope_to_pricing_schedules.cjs` via
`migration.up()`, recording the migration if absent. The known migration-ledger
drift was not reset. No new migration was required for the takeover changes.

### Checks

- Full `contractQuantityUsageSemantics.test.ts` and `contractRecurringValueReporting.test.ts`:
  **97 passed** before the final currency/provenance assertions.
- Final recurring-products integration block, including EUR display and ISO provenance: **19 passed** (72 unrelated cases skipped).
- Scheduling UI, pricing-source identity and recurring compute suites: **60 passed**.
- Invoice preview and recurring billing run action suites: **35 passed**; exact
  response assertions now require the reviewed empty pricing-source array.
- Billing package `tsc --noEmit`: passed with a 6 GiB Node heap. A first attempt
  with 4 GiB exhausted the heap. No production Next.js build or server-wide
  typecheck is claimed; the live dev routes compiled and executed.
- Changed-file ESLint: no errors; existing loose-type warnings remain.
- Companion pure evaluator against live persisted charges: **4 discount cases plus deterministic retries passed** (see `takeover-companion-evaluator.json`).
- Translation key validation: all nine non-English/pseudo locales pass. New copy
  uses English fallbacks in the non-English locales; xx/yy use the standard
  pseudo-string transform. Human translation is still needed.

Companion adoption and combined-branch validation remain as described in
`companion-handoff.md`. No push, PR, companion worktree mutation or merge was made.
