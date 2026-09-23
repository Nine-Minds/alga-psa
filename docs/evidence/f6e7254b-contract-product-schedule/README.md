# f6e7254b — recurring contract product quantity & price scheduling evidence

Validated on 2026-09-23 against the live development server from this worktree at
`http://localhost:3029` (compose project `alga-psa-local-test`, PostgreSQL `server`).

Implementation commits: `166b961fdf` (feature) and the Draft Implementation repair
commit that fixes the domain-facts price passthrough and product monthly valuation
(see "Repairs against the first draft" below).

## Scenario

Deterministic product contract seeded directly in the dev DB (UI authoring of the
contract shape is out of scope for this smoke):

- Client: Amys Bird Sanctuary LLC.
- Fixed monthly contract `SMOKE Product Schedule`, start `2026-09-01`.
- Three recurring catalog products: Users 20 × $100, Endpoints 30 × $50,
  Locations 2 × $200 (baseline $3,900/month), each a `Fixed` service
  configuration with catalog `service_prices` in USD and wizard-style
  `base_rate = 0`.

Seeded IDs:

- `contract_id=9e3c4a4c-4b32-46c6-a792-7640438d482f`
- `line_id=002d16a5-767d-4ac8-b514-1d2e558df37a`
- Users `config_id=d8150176-b333-466c-906c-e5353622e43a`
- Endpoints `config_id=0c82fd15-873b-446c-b1ad-0f3f818966cb`
- Locations `config_id=279485d7-ad2c-476a-984a-762dfa44a58c`

## Navigation

`/msp/billing?tab=contracts&subtab=client-contracts&contractId=<id>` → **Contract
Lines** tab → expand `SMOKE Product Schedule Line` → **Schedule recurring change
& history** on each product.

## Live-product results

| Step | Action | Observed | Result |
| --- | --- | --- | --- |
| Panel render | Expand the Endpoints product schedule panel | Panel shows boundary `2026-10-01`, quantity 30, source "Use catalog price", rate disabled, `In force for periods from 2026-10-01: 30 × N/A (catalog price)` | Pass |
| Schedule increase | Endpoints → quantity `35`, boundary `2026-10-01`, save | `Scheduled: 35 effective 2026-10-01`; `In force … 35 × N/A (catalog price)`; Scheduled-periods row `2026-10-01 / 35 / Catalog / v1`; DB row on service `6bfde3c1…` = 35/catalog/v1 | Pass |
| Replace pending | Users → quantity `25`, same boundary `2026-10-01`, save (from first draft run) | Version bumps to `v2`; `Superseded pending edits (1)` shows the prior `23 / v1` | Pass |
| Billed guard | Seed a `billed` recurring service period covering `2026-10-01`; save Endpoints quantity `40` at that boundary | `That effective date falls inside an already-billed or finalizing service period…`; canonical DB revision stayed `35 / v1` | Pass |
| Rate override | Users → boundary `2026-11-01`; source "Override unit price"; quantity `23`, rate `110.00`; save (first draft run) | `In force … 23 × $110.00 (explicit override)`; row `2026-11-01 / 23 / $110.00 / v1` | Pass |
| Zero stop | Locations → boundary `2026-12-01`, quantity `0`, catalog; save | Stop help shown; `In force … 0 × N/A (catalog price)`; `Scheduled: 0 effective 2026-12-01`; DB row `2026-12-01 / 0 / Catalog / v1` | Pass |

Fresh screenshots taken against the final implementation:

- `05-endpoints-baseline.png` — untouched Endpoints panel (baseline inheritance).
- `06-endpoints-35-scheduled.png` — 30 → 35 increase scheduled at the next boundary.
- `07-billed-rejected.png` — billed-period rejection with the canonical revision unchanged.
- `08-zero-stop.png` — zero stop with stop help and `0 × N/A (catalog price)`.

Earlier captures (`01`–`04`) come from the first-draft run and remain accurate for
the panel surface, which the repair did not change.

## Repairs against the first draft (Draft Implementation run)

The first draft scheduled and displayed revisions correctly, but two wiring gaps
meant a scheduled product revision did not reach the invoice or the monthly
overview. Both are fixed and covered by integration tests below:

1. **Domain facts dropped `effective_pricing`.** `loadRecurringQuantityObligation`
   selected the effective revision, but `normalizeResolvedContractCharge`
   (`packages/billing/src/lib/billing/domain/calculateContractCharge.ts`) rebuilt the
   product/license service facts without the selected quantity/price, so
   `computeRecurringQuantityCharges` always saw `null` and billed the catalog
   baseline. `effectivePricing` now travels through the facts round-trip
   (`domain/contracts.ts` type + both mapping directions).
2. **Product monthly valuation lost siblings.** In
   `shared/billingClients/contractMonthlyValue.ts`, once one product on a line had a
   revision the other products fell into the bundle branch, whose `base_rate = 0`
   wizard placeholder valued them at zero. A revision-managed line now values all
   catalog-product members with the product rate chain (contract override, else
   catalog), while untouched lines keep their legacy valuation.

## DB-backed verification

`contract_line_unit_pricing_revisions` after the final UI run:

| service | quantity | unit_rate_cents | price_policy | version | effective_period_start |
| --- | --- | --- | --- | --- | --- |
| SMOKE Prod Endpoints | 35 | NULL | catalog | 1 | 2026-10-01 |
| SMOKE Prod Users | 25 | NULL | catalog | 2 | 2026-10-01 |
| SMOKE Prod Users | 23 | 11000 | override | 1 | 2026-11-01 |
| SMOKE Prod Locations | 0 | NULL | catalog | 1 | 2026-12-01 |

`contract_line_unit_pricing_revision_history` retains the superseded `23 / v1`
Users edit. Canonical revision stayed `v2` after the rejected billed save; the
synthetic billed period used for the guard was removed after capture.

## Behavioral invoice validation (real generation)

`server/src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts`
gained a `recurring products (parity with unit services)` block that drives the real
server actions and the billing engine against PostgreSQL and asserts persisted
invoices:

- 20/30/2 bills **$3,900** (subtotal 390000); scheduling Users to 23 at
  `2023-02-01` yields preview **and** invoice subtotal **$4,200** (420000) from that
  period on, the earlier invoice row stays 390000, and `getContractOverview`
  reports 420000.
- Decrease (18 → 370000), zero stop (Users 0 → 190000), and later resumption
  (20 → 390000) each invoice correctly in their own periods.
- Explicit override (`23 × $110` → 443000) and a catalog-policy revision that keeps
  following a later catalog price change (`23 × $110 + 30 × $60 + 2 × $200` → 473000).
- Pending-boundary replacement bumps `version` and appends superseded history; a
  stale `expected_version` is rejected and the canonical row is unchanged.
- A change inside an already-billed period is rejected; the exactly-on-boundary
  next period is accepted.
- Repeated generation of the same window creates no second invoice.
- A future revision on Users does not reprice an older, later-billed February
  period (legacy/delayed-period protection).

Discount/tax behavior on effective revision subtotals is covered behaviorally in
`packages/billing/src/lib/billing/compute/compute.test.ts` (10% → 351000/378000;
$100 fixed → 380000/410000 over the 390000/420000 gross subtotals) and the shared
resolver in `shared/billingClients/__tests__/recurringUnitPricing.test.ts`.

## Commands and results

- `cd shared && npx vitest run billingClients/__tests__/recurringUnitPricing.test.ts` — 10 passed.
- `cd packages/billing && npx vitest run src/lib/billing/compute/compute.test.ts` — 46 passed.
- `cd packages/billing && npx vitest run tests/contractBilling.domain.test.ts src/lib/billing/compute/productionGolden.test.ts` — 14 passed.
- `cd server && npx vitest run src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts` — 75 passed (7 new product tests).
- `cd server && npx vitest run src/test/infrastructure/billing/invoices/contractRecurringValueReporting.test.ts` — 6 passed.
- `cd server && npx vitest run src/test/unit/billingEngine.test.ts src/test/unit/billing/billingEngine.timing.test.ts` — 53 passed.
- `cd shared && npx tsc --noEmit` — exit 0.
- `cd packages/billing && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` — exit 0.
- `npx tsc --noEmit -p packages/db/tsconfig.json` — exit 0.
- `cd packages/types && npx tsc --noEmit` — exit 0.
- `cd server && npx tsc --noEmit -p tsconfig.json` — **not completed locally**: OOM
  under host memory pressure at 8 GiB (pre-existing; `server/tsconfig.json` excludes
  `src/test/**`, so the new tests are outside this check anyway).
- `npx eslint <changed files>` — 0 errors (only pre-existing warnings: non-null
  assertions, `any`, and case-block `no-redeclare`).

## Disclosures and limitations

- This was a live Next.js development build against the running dev services; the
  panel and server actions were not mocked. The fresh screenshots were captured
  after the repair commit was loaded by the dev server.
- The seeded smoke contract has no billing cycle or materialized service periods,
  so **in-app** invoice generation on that contract was not exercised (as in the
  first draft). After-invoicing behavior, preview↔invoice parity and repeated
  generation are validated through the real server actions and billing engine in
  the integration suite above instead.
- The dev DB's `knex_migrations` is drift-corrupted by branch-ahead EE files, so
  `migrate:latest`/`migrate:ee` abort. The additive migration
  `20260922120000_contract_recurring_pricing_revision_policy` was applied through its own
  idempotent `up()` against `127.0.0.1:5472` and recorded in `knex_migrations`. It was
  verified present, not re-run.
- Companion card `b97eda7b` is plan-only; no shared source/settlement API exists to
  consume. Both plans claim effective-history ownership — an unresolved integration
  conflict. This card exposes resolved source/effective-period/quantity/rate facts
  through the canonical revision store and resolver; it does not claim companion
  adjustment functionality.
- Monthly valuation resolves catalog-policy rates from the legacy untagged
  `service_catalog.default_rate` (matching the pre-existing unit-service valuation),
  not the currency-specific `service_prices` row the invoice engine uses. This is a
  pre-existing valuation limitation called out by the code's `LEVERAGE` note; for the
  single-currency example it is consistent.
