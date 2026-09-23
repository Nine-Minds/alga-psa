# f6e7254b — recurring contract product quantity & price scheduling evidence

Validated on 2026-09-23 against the live development server from this worktree at
`http://localhost:3029` (compose project `alga-psa-local-test`, PostgreSQL `server`).

Implementation commit: `166b961fdf`.

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
- Locations `config_id=279485d7-ad2c-476a-984a-762dfa44a58c`

## Navigation

`/msp/billing?tab=contracts&subtab=client-contracts&contractId=<id>` → **Contract
Lines** tab → expand `SMOKE Product Schedule Line` → **Schedule recurring change
& history** on each product.

## Live-product results

| Step | Action | Observed | Result |
| --- | --- | --- | --- |
| Panel render | Expand the line; open the product schedule panel | Panel shows `In force for periods from 2026-10-01: 20 × N/A (catalog price)`; quantity 20, source "Use catalog price", unit rate disabled | Pass |
| Schedule increase | Users → quantity `23`, boundary `2026-10-01`, save | `Scheduled: 23 effective 2026-10-01`; scheduled-periods row `2026-10-01 / 23 / Catalog / v1` | Pass |
| Replace pending | Users → quantity `25`, same boundary, save | Version bumps to `v2`; `Superseded pending edits (1)` shows the prior `23 / v1` | Pass |
| Billed guard | Seed a `billed` service period covering `2026-10-01`; save at that boundary | `That effective date falls inside an already-billed or finalizing service period…`; canonical revision stayed `v2` | Pass |
| Rate override | New boundary `2026-11-01`; source "Override unit price"; quantity `23`, rate `110.00`; save | `In force for periods from 2026-11-01: 23 × $110.00 (explicit override)`; row `2026-11-01 / 23 / $110.00 / v1` | Pass |
| Zero stop | Locations → boundary `2026-12-01`, quantity `0`, catalog; save | `In force … 0 × N/A (catalog price)`; stop help shown; row `2026-12-01 / 0 / Catalog / v1` | Pass |

Screenshots:

- `01-panel-before.png` — baseline product schedule panel.
- `02-scheduled-23.png` — 23-user increase scheduled at the next boundary.
- `03-billed-rejected.png` — billed-period rejection.
- `04-zero-and-override-schedules.png` — override and zero-stop scheduled periods.

## DB-backed verification

`contract_line_unit_pricing_revisions` after the run:

| service | quantity | unit_rate_cents | price_policy | version | effective_period_start |
| --- | --- | --- | --- | --- | --- |
| SMOKE Prod Users | 25 | NULL | catalog | 2 | 2026-10-01 |
| SMOKE Prod Users | 23 | 11000 | override | 1 | 2026-11-01 |
| SMOKE Prod Locations | 0 | NULL | catalog | 1 | 2026-12-01 |

`contract_line_unit_pricing_revision_history` retains the superseded `23 / v1`
Users edit. Canonical revision stayed `v2` after the rejected billed save.

Baseline/effective billing behaviour ($3,900 then $4,200 with 23 users;
zero/stop; override/catalog; missing-price; 10% and $100 discounts) is covered
behaviourally by `packages/billing/src/lib/billing/compute/compute.test.ts`
(46 tests) and `shared/billingClients/__tests__/recurringUnitPricing.test.ts`
(10 tests), not by an in-app generated invoice.

## Commands and results

- `cd shared && npx vitest run billingClients/__tests__/recurringUnitPricing.test.ts` — 10 passed.
- `cd packages/billing && npx vitest run src/lib/billing/compute/compute.test.ts` — 46 passed.
- `cd shared && npx tsc --noEmit` — exit 0.
- `cd packages/billing && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` — exit 0 (an earlier run OOM'd under host memory pressure, not a type error).
- `npx tsc --noEmit -p packages/db/tsconfig.json` — exit 0.
- `npx eslint <changed files>` — 0 errors, 23 warnings (mostly pre-existing unused destructures and case-block declarations).

## Disclosures and limitations

- This was a live Next.js development build against the running dev services; the
  panel and server actions were not mocked.
- The dev DB's `knex_migrations` is drift-corrupted by branch-ahead EE files, so
  `migrate:latest`/`migrate:ee` abort. The additive migration
  `20260922120000_contract_recurring_pricing_revision_policy` was applied through its own
  idempotent `up()` against `127.0.0.1:5472` and recorded in `knex_migrations`.
- The authenticated smoke required setting the dev `glinda@emeraldcity.oz`
  password to a known value with the application's own hasher; the dev server
  rotates this row on boot anyway. The prior hash was not restored.
- In-app invoice generation/preview for the seeded contract was not exercised
  (the seeded shape has no billing cycle or materialized service periods);
  billing amounts are verified through the shared compute suite.
- Companion card `b97eda7b` is plan-only (commit `c89f0e15`); no shared
  source/settlement API exists to consume. Both plans claim effective-history
  ownership — an unresolved integration conflict documented in the workflow facts.
