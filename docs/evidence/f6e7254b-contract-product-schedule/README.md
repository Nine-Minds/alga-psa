# f6e7254b — recurring contract product quantity & price scheduling evidence

Validated on 2026-09-23 against the live development server from this worktree at
`http://localhost:3029` (compose project `alga-psa-local-test`, PostgreSQL `server`).

Implementation history:

- `166b961fdf` — feature: schedule recurring product quantity and price revisions.
- `288cda16f5` — repair: carry `effective_pricing` through the domain facts and value
  revision-managed product lines in monthly valuation.
- Follow-up repair (this run, Draft Implementation re-run after the prior run failed):
  unify the valuation rate chain on `resolveFixedLineRate`, keep a catalog-policy
  revision from re-reading a stale configuration rate, and preserve original edit
  attribution in revision history. Committed locally; not pushed.

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
| **SMOKE Prod Users** | **27** | **11000** | **override** | **1** | **2027-01-01** |
| SMOKE Prod Endpoints | 35 | NULL | catalog | 1 | 2026-10-01 |
| SMOKE Prod Locations | 0 | NULL | catalog | 1 | 2026-12-01 |

`contract_line_unit_pricing_revision_history` keeps the superseded `2026-10-01 / 23`
Users edit. The `2027-01-01` revision was created fresh, so it has no history row.

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
  — **77 passed**. The `recurring products (parity with unit services)` block covers:
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
  not reprice an older, later-billed period.
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

- `cd shared && npx vitest run billingClients/__tests__/recurringUnitPricing.test.ts` — passed.
- `cd packages/billing && npx vitest run src/lib/billing/compute/compute.test.ts` — passed.
- `cd server && TEST_DB_NAME=test_db_pcs_sched REQUIRE_DB=1 npx vitest run src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts` — 77 passed.
- `cd server && TEST_DB_NAME=test_db_pcs_sched REQUIRE_DB=1 npx vitest run src/test/infrastructure/billing/invoices/contractRecurringValueReporting.test.ts` — 7 passed.
- `cd shared && npx tsc --noEmit` — exit 0.
- `cd packages/types && npx tsc --noEmit` — exit 0.
- `npx tsc --noEmit -p packages/db/tsconfig.json` — exit 0.
- `cd packages/billing && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` — exit 0.
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

### Companion integration gaps (explicit, not claimed complete)

- Companion plan `docs/plans/2026-09-22-contract-invoice-adjustments-plan.md` at commit
  `c89f0e15` is **not present** in this checkout (`git cat-file -t c89f0e15` → not a
  valid object; no branch contains it). No implemented source/settlement API exists to
  consume. This card therefore cannot verify companion adjustment sources with fixtures
  and does not claim companion adjustment handling.
- Both plans claim effective-history ownership. This card's position: the revision
  store above is the effective-history authority; the companion should consume
  resolved facts and own invoice allocation/settlement identities.
- Baseline policy is boundary-only: a `20 → 23` change at the next boundary moves this
  period by $0 and the next recurring subtotal by +$300 (gross `3,900 → 4,200`), with
  no mid-period proration, true-up or credit. No automatic adjustment charge is emitted
  by this card.
- Discount/tax interaction is validated only through the existing shared compute
  pipeline (10% and $100 fixed over the gross subtotals) — not through a companion
  settlement flow, which does not exist here.

## Disclosures and limitations

- Live Next.js development server against the running dev services; the panel and
  server actions were not mocked. Next dev recompiles workspace packages on request, so
  the captured UI reflects the working tree including this run's changes.
- The seeded smoke contract has no billing cycle or materialized service periods, so
  **in-app** invoice generation on that contract was not exercised. After-invoicing
  behavior, preview↔invoice parity and repeated generation are validated through real
  actions and the billing engine in the integration suites above.
- The dev DB's `knex_migrations` is drift-corrupted by branch-ahead EE files, so
  `migrate:latest`/`migrate:ee` abort. Both additive migrations
  (`20260922120000_contract_recurring_pricing_revision_policy` and
  `20260923000000_contract_recurring_pricing_history_attribution`) are recorded as
  applied and their columns verified present; they were not re-run.
- Monthly valuation now uses the invoice engine's currency-tagged `service_prices`
  chain. The previous untagged `service_catalog.default_rate` fallback remains only as
  the resolver's last resort for the tenant default currency when no `service_prices`
  row exists.
