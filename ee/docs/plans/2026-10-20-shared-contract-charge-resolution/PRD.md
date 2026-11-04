# PRD — Shared contract charge resolution (billing engine + simulator)

- Slug: `shared-contract-charge-resolution`
- Date: 2026-10-20
- Ticket: alga-2026-0002684 (internal analysis, "Simulator root cause")
- Status: Draft implementation. **No approved design-session plan existed on the branch**; this plan is built from the card brief and the dossier decisions. Prior art: `2026-07-30-billing-contract-simulator`, `2026-08-21-contract-simulator-billing-consolidation`, commit 2edef17604 (simulator bucket double charge).

## Problem

Pricing is shared: `billingEngine` and `simulateContractScenario` both call `calculateContractBilling`, and share `calculateContractBucketPeriodState` / `computeBucketCharges`. The step *before* pricing — deciding which unpriced charges (obligations) a contract line produces for a service period — is implemented twice:

- Engine: per-family DB loaders (`loadFixedPriceObligation`, `loadTimeBasedObligation`, `loadUsageBasedObligation`, `loadBucketObligation`, `loadRecurringQuantityObligation`), `resolveBucketForLine` removing pooled hours from the hourly query, `configuration_type` filtering inside the loaders.
- Simulator: `snapshotContractToScenario` + `loadSimulationCalculationInput`, which sorts services by `configuration_type`; only `Bucket`-typed services get bucket pricing. A pool carried on an Hourly/Usage config as `pool_id` is never priced; templates using `contract_template_line_buckets` only simulate when a legacy `contract_template_line_service_bucket_config` row exists.

Result: a saved contract with an hourly line and a 10-hour pool simulates every hour as plain hourly (no draw-down, no overage), while invoices apply the pool.

## Goals

1. Exactly one function decides the unpriced charges for a (contract line, service period): fixed, hourly, usage, bucket/pool, product, license, plus the time excluded because a pool covers it.
2. The resolver reads everything through a **source port** with two implementations: database (engine, live contracts) and scenario (simulator: saved contracts, templates, drafts). Rules live in the resolver; sources only supply data.
3. Real invoice output unchanged.
4. A future priced-pool charge type (card 60482d29) is added in one place.

## Non-goals

No priced pool, no change to hour_blocks, no UI change, no change to pricing/compute math, no tax/rounding change.

## Design

Location: `packages/billing/src/lib/billing/chargeResolution/`
- `types.ts` — `ContractChargeSource` (port), `TimingRequest`, `PoolDefinition`, `PoolPeriodState`, `ResolvedLineCharges`.
- `registry.ts` — `CHARGE_FAMILY_REGISTRY`, fixed order: fixed → hourly → usage → bucket → product → license.
- `poolCoverage.ts` — pure rule: which services a line's pools cover (explicit member first, then catch-all limited to the line's configured services — identical to `resolveBucketForLine`).
- `resolveContractLineCharges.ts` — the resolver.
- `databaseChargeSource.ts` — DB source (the engine's loader logic, moved).
- Scenario source: `ee/server/src/lib/billing/simulator/scenarioChargeSource.ts`.

Port rules (decisions):
- `poolPeriodState(line, pool, timing)` is a **source-supplied value**. The resolver never computes pool state. DB source: live `bucket_usage` + contributions. Scenario source: simulated state (assumed hours, rollover threaded in memory via `calculateContractBucketPeriodState`).
- `resolveTiming(line, request: TimingRequest)` is per demand. `TimingRequest = { policy, duePosition }`; `policy` names the existing timing resolver (`fixed-recurring`, `service-driven`, `recurring`), `duePosition` is `line` (current behaviour) | `advance` | `arrears`. Nothing requests a non-`line` position yet; sources reject it explicitly (60482d29 will implement it: fee in advance, overage in arrears on one line).
- Pool exclusion is expressed as a demand argument to `hourly(...)`: `PooledTimeExclusion { serviceIds, attributedOnly: true }`. Today's engine rule is preserved: only time explicitly attributed to the line is hidden; unassigned rows keep their existing attribution path.
- Usage is **not** excluded by pools (the engine never did); preserved.
- Neither side selects charges by `configuration_type` in code. The resolver alone decides pool exclusion and which families a line emits. The remaining `configuration_type` mentions are all in engine-owned data loaders (see next section).

### Remaining `configuration_type` reads in engine loaders — kept, as data supply

Four sites remain in `billingEngine.ts`: the fixed-price loaders' `clsc.configuration_type = 'Fixed'` joins (~3750, ~3945) and the hourly/usage loaders' guards that the stored base config is `Hourly` / `Usage` (~5341, ~5717). They were kept in the engine loaders (not moved into `DatabaseChargeSource`) because each one only chooses *which satellite table row to read* for a service that the resolver has already asked that family about (`contract_line_service_fixed_config` vs `_hourly_configs` vs `_usage_config`): the discriminator says which detail table holds the rate/rounding data, exactly like a join key. None of them decides whether a family is emitted for a line, whether a service is pooled, or whether hours are excluded:
- Pool exclusion is a resolver decision: `DatabaseChargeSource.pools()` supplies the pool rows (`contract_line_buckets` / `contract_line_bucket_services`) and the resolver passes `PooledTimeExclusion` to `hourly(...)`; the hourly loader receives the excluded service ids and filters time entries on them.
- A `Bucket`-typed (legacy) service has no Hourly satellite row, so its hourly loader read is empty with or without the guard, and its hours are covered by the pool either way. A pooled Hourly-typed service is excluded by the resolver, not by the guard. Routing of a pooled or Bucket-typed service therefore does not depend on these reads; parity fixtures cover both shapes (`typed-config`, `pool-only`) with identical engine/simulator output.
Moving them would be a pure relocation of SQL with no behavioural change; it is deliberately left out of this change to keep the engine diff reviewable. `grep -n configuration_type packages/billing/src/lib/billing/billingEngine.ts` shows exactly these four.

### Pool line identity (decision 4) — settled

`IClientContractLine.client_contract_line_id` is populated by the engine's line query as `cl.contract_line_id AS client_contract_line_id` (billingEngine ~3275), and every other constructor in the billing packages does the same (`contractLineDisambiguation`, `getEligibleContractLinesForServiceAtDate`). `contract_line_buckets.contract_line_id` stores `contract_lines.contract_line_id`. Therefore `loadBucketObligation`'s `"clb.contract_line_id": contractLine.client_contract_line_id` compares two identical values: **the mismatch is naming only and changes no live pool charge today.** The port/DB source address pool lines by `contractLineId` (the `contract_lines` id); `clientContractLineId` stays an alias carrying the same value for obligation ids (`bucket:<lineId>:<bucketId>`, unchanged) so invoice line identity is unchanged. If a future caller ever supplies a distinct `client_contract_lines` id, the previous code would have silently found no pool; the new code does not depend on it.

## Adding a charge family (decision 6)

Exactly four touch points: (1) one `CHARGE_FAMILY_REGISTRY` entry, (2) one `kind` in `ResolvedContractBillingChargeFacts`, (3) one case in `calculateContractChargeImpl`, (4) one compute module. Walk-through for a hypothetical **priced pool** (prepaid hours block: fee in advance, overage in arrears):
1. Registry: `{ family: 'pricedPool', demands: ctx => ctx.pools.filter(p => p.blockPrice != null).flatMap(...) }` — asks `resolveTiming(line, {policy:'recurring', duePosition:'advance'})` for the fee obligation and reuses the existing bucket demand with `duePosition:'arrears'` for the overage. State comes from the already-existing `poolPeriodState`.
2. Facts: `kind: 'pricedPool'` with block price, included minutes, timing.
3. `calculateContractChargeImpl`: `case 'pricedPool'` delegating to
4. `computePricedPoolCharges.ts`.
The engine and simulator need no edit: they call `resolveContractLineCharges` and `calculateContractBilling`. Honest caveat: block price is new *data*; each source maps one more field into `PoolDefinition` (DB source reads the new column, scenario source copies it). That is data supply in the sources, not engine/simulator logic, and not a fifth code touch point of the resolver.

## Acceptance

- Parity suite (live contracts, DB-backed): simulator charges == engine dry run, line by line, for fixed advance/arrears, hourly, usage, hourly+pool (rollover, overage), weighted/after-hours pool, products, licenses, pricing schedules, discounts. Recorded red for pool fixtures at a62fafbcb5; green after.
- Acceptance scenario: saved contract, one Hourly line + 10-hour pool, 14 assumed hours → 4 overage hours, no plain hourly charge for the pooled service.
- Template using `contract_template_line_buckets` simulates its pool.
- Existing billing integration tests pass on both a62fafbcb5 and HEAD (same per-suite counts); the full ordered invoice-line diff across those suites (bucket/pool, fixed-advance, product/license, discount, timing) is empty. Edits to existing tests are limited to mocks and source-string assertions (projectBillingEngine.test.ts, productionGolden.test.ts); no expected amount or line order changed.
- No code selects charges by `configuration_type`; the four remaining engine-loader reads are data-supply (rationale above).
- Simulator stays read-only (no BillingEngine, numbering, TaxService).

## Risks

Engine loader move (large mechanical diff); pooled-hour exclusion; scenario rollover/weighted modelling vs `bucket_usage`; proration/timing differences between sources. See SCRATCHPAD.
