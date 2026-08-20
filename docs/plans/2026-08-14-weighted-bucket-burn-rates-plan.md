# Weighted Burn Rates for Bucket Hours — Implementation Plan

**Card:** 29.8.23 (release v1.5) · **Branch:** `feature/weighted-burn-rates-for-bucket-hours`
**Status:** approved design, ready for implementation
**Feature flag:** all new/changed UI behind `release-v1-5-feature`; flag off ⇒ existing UI and behavior preserved.

## Goal

Let bucket (block-hours) contracts burn at configurable multipliers by work type — e.g. emergency
work consumes 2x, after-hours work 1.5x from the prepaid pool. Today `bucket_usage` draws down 1:1
and a bucket is welded to exactly one (contract line, service) pair, which makes differential burn
against a shared pool inexpressible. This card therefore does two inseparable things:

1. **Model correction:** buckets become line-owned shared pools with member services.
2. **Feature:** per-member burn multipliers plus an after-hours rule, combined max-wins, weighted
   minutes as the unit of account end to end (including overage billing).

## Settled design decisions

- Multipliers keyed by **both** service (per-member multiplier) and **after-hours** (schedule rule).
  When several rules match one span, **max wins** — premiums never compound.
- **After-hours** = outside an existing SLA `business_hours_schedules` schedule. Weekends and
  holidays are just after-hours (days with no enabled hours), not a separate tier. Reuse
  `isWithinBusinessHours` (`packages/sla/src/services/businessHoursCalculator.ts`). A rule requires
  an explicit schedule pick (preselect the tenant default when one exists); it cannot be enabled
  without a schedule. (Prod: 6 of 9 bucket tenants have no default schedule.)
- **Weighted minutes are the single unit of account.** Weighted burn depletes the pool AND flows
  into overage: 1 real emergency hour at 2x past the cap = 2 overage hours at the overage rate.
- **Proration at the boundary:** an entry straddling the schedule edge is split by wall-clock
  overlap; `billable_duration` is apportioned by the in/out fractions. Zero-length span with
  positive billable duration classifies by `start_time`. Evaluate in the schedule's timezone.
- **Cardinality:** a contract line holds 0..n buckets; a bucket holds 0..n member services; a
  service belongs to **at most one bucket per line** (deterministic draw). Zero-member buckets are
  allowed-but-dormant: removing the last member never cascade-deletes the pool or its history; UI
  requires ≥1 member at creation (member-scoped buckets) and badges dormant pools.
- **Bucket scope is explicit:** a bucket is either **member-scoped** (burns only for member
  services) or **covers-all-line-services** (catch-all; at most one per line). Draw resolution for
  an entry: explicit membership on any line bucket wins (most specific), else the line's catch-all
  bucket, else no bucket — plain hourly billing as today. Inside a catch-all bucket, member rows
  act as **multiplier overrides** (non-members burn at 1x; the after-hours rule still applies).
  Emptiness never implies catch-all — removing the last member must not silently change coverage.
- Buckets stay **hour-denominated** (no re-platforming onto dollar credits).
- Migration: each existing `contract_line_service_bucket_config` becomes its own single-member pool
  at 1x — behavior-identical, no merging. (Prod: 44 configs / 9 tenants; 5 lines carry multiple
  configs — 2, 2, 5, 8, 10 — hence multi-pool lines; only 4 `bucket_usage` rows exist.)
- The dead hourly-config fields `enable_after_hours_rate` / `after_hours_multiplier` are used by
  zero production rows; leave them untouched by this card (cleanup is out of scope).

## 1. Schema (new knex migrations under `server/migrations/`)

Follow the Citus conventions of neighboring migrations (distribute by `tenant`, colocate with
`contract_lines`; see `server/migrations/utils/` helpers used by `20251008000001_rename_billing_to_contracts.cjs`).

### New tables

**`contract_line_buckets`** — the pool.
- `tenant` uuid NOT NULL, `bucket_id` uuid NOT NULL default gen_random_uuid(), PK `(tenant, bucket_id)`
- `contract_line_id` uuid NOT NULL, FK → `contract_lines`
- `bucket_name` text NULL (display label; migration leaves it NULL and UI falls back to the member service name)
- `total_minutes` integer NOT NULL
- `overage_rate` numeric(10,2) NOT NULL default 0 (minor units, same semantics as today)
- `allow_rollover` boolean NOT NULL default false
- `billing_period` text NOT NULL default 'monthly' (carried over; runtime period still derives from
  `contract_lines.billing_frequency`, same as today)
- `after_hours_multiplier` numeric(6,3) NULL — the after-hours rule's multiplier
- `business_hours_schedule_id` uuid NULL, FK → `business_hours_schedules` — the rule's schedule
- `covers_all_services` boolean NOT NULL default false — catch-all scope
- CHECK: `after_hours_multiplier IS NULL OR business_hours_schedule_id IS NOT NULL` (rule inert
  without a schedule); CHECK multipliers `> 0`
- Partial UNIQUE index on `(tenant, contract_line_id) WHERE covers_all_services` — at most one
  catch-all bucket per line
- `created_at` / `updated_at`

**`contract_line_bucket_services`** — membership + per-service multiplier.
- `tenant`, `bucket_id` FK → `contract_line_buckets`, `service_id` FK → `service_catalog`
- `contract_line_id` uuid NOT NULL (denormalized from the bucket to enforce the per-line rule)
- `burn_multiplier` numeric(6,3) NOT NULL default 1.0, CHECK `> 0`
- PK `(tenant, bucket_id, service_id)`; UNIQUE `(tenant, contract_line_id, service_id)` — one
  bucket per (line, service), the successor of the alga0002175 invariant documented in
  `shared/billingClients/bucketUsageService.ts:19-27`. (In a catch-all bucket, member rows are
  multiplier overrides; the uniqueness rule applies identically.)

### `bucket_usage` rekeying

- Add `bucket_id` uuid NULL, FK → `contract_line_buckets`; backfill (see migration below); then NOT NULL.
- Change `minutes_used` and `overage_minutes` from bigint to **numeric(12,2)** (weighted minutes are
  fractional; `rolled_over_minutes` is already numeric(10,2)). 4 prod rows — trivial rewrite.
- New UNIQUE `(tenant, bucket_id, period_start)` — kills the duplicate-period hazard and the
  write-under-one-line/read-under-another mismatch (write path ignores `contract_line_id` at
  `shared/billingClients/bucketUsageService.ts:385-392` while the invoice read filters on it at
  `packages/billing/src/lib/billing/billingEngine.ts:4603-4610`).
- Keep `client_id`, `service_catalog_id`, `contract_line_id` columns as denormalized reporting
  context (populated, no longer part of the lookup key).

### Backfill migration (same batch, after table creation)

For every `contract_line_service_bucket_config` row (join `contract_line_service_configuration` on
`configuration_type='Bucket'` for `contract_line_id` + `service_id`):
1. Insert one `contract_line_buckets` row copying `total_minutes`, `overage_rate`, `allow_rollover`,
   `billing_period`; no after-hours rule; `covers_all_services = false` (member-scoped — migrated
   pools must never widen coverage).
2. Insert one `contract_line_bucket_services` row for the config's service at multiplier 1.0.
3. Map that config's `bucket_usage` rows (match on client via the line's contract + `service_catalog_id`)
   to the new `bucket_id`.

Leave `contract_line_service_bucket_config` and the `configuration_type='Bucket'` configuration rows
**in place, frozen** (nothing writes them after this card). A later cleanup migration (out of scope
here, mirroring the repo's rename→cleanup pattern) drops them. Down-migration: drop the new tables
and the `bucket_usage.bucket_id` column; the frozen legacy tables still describe the old world.

## 2. Burn engine (`shared/billingClients/bucketUsageService.ts` + a new weighted calculator)

**New pure module** `shared/billingClients/weightedBurn.ts`:
- `computeWeightedMinutes({ startTime, endTime, billableDuration }, memberMultiplier, afterHoursRule | null): { weightedMinutes, segments }`
  - Split the wall-clock span into in-hours / out-of-hours segments against the rule's schedule
    (schedule timezone), apportion `billableDuration` by segment fractions, per-segment multiplier
    `= max(memberMultiplier, isAfterHours ? afterHoursMultiplier : 0-elided)`, sum, round the total
    to 2 decimals. Zero-length span ⇒ single segment classified by `startTime`.
  - Schedule evaluation: reuse the SLA calculator. `packages/sla` currently owns it; export a pure
    segmentation helper from `packages/sla` (e.g. `segmentSpanByBusinessHours(schedule, holidays, start, end)`)
    and have `shared/billingClients` consume it via the existing package graph. If the dependency
    direction is wrong for `shared/`, invert: put the segmentation primitive in `shared/` and have
    `packages/sla` re-export it. Do not fork the business-hours math.
- Usage-tracking draws (`usage_tracking`) have no time span: they burn at `memberMultiplier` only,
  no after-hours proration.

**`bucketUsageService.ts` rewrite (same file, same exported surface where possible):**
- `calculatePeriod` (`:117-334`): resolve the bucket by the scope rule — from `(client, service,
  date)` find the active line as today, then the `contract_line_bucket_services` row for that
  (line, service); if none, the line's `covers_all_services` bucket; if neither, no bucket (entry
  bills hourly, as today for non-bucketed services). The resolved multiplier is the member row's
  `burn_multiplier` when one exists, else 1.0 under a catch-all. Period derivation logic
  (recurring_service_periods preferred, frequency fallback) is unchanged.
- `findOrCreateCurrentBucketUsageRecord` (`:351-585`): look up / insert by `(tenant, bucket_id,
  period_start, period_end)`. Rollover computation unchanged in shape, reading pool totals from
  `contract_line_buckets`.
- `updateBucketUsageMinutes` (`:595-659`): accept a **numeric weighted delta**; the accumulator math
  (`overage = max(0, used − (total + rollover))`) is unchanged — it just operates on weighted
  numerics now.
- `reconcileBucketUsageRecord` (`:670-773`): rewrite to recompute from source records **through the
  same weighted calculator** with the bucket's *current* config (re-weighting on reconcile is the
  intended behavior for in-flight periods). This function's current query is broken anyway — it
  filters `time_entries` on `client_id` / `is_billable` / `entry_date`, none of which exist
  (`:721-731`) — so rebuild the query on real columns: entries whose `(contract_line_id, service_id)`
  is a member of the bucket and whose `start_time` falls in the period, summing weighted
  `billable_duration`; plus `usage_tracking` quantities at member multiplier.
- Update the file-header invariant comment (`:1-27`) to describe the new cardinality.

**Callers:**
- `packages/scheduling/src/actions/timeEntryCrudActions.ts:663-720` (create/update) and
  `:1035-1075` (delete): gate on the **scope-resolution rule** (membership, else line catch-all)
  instead of a `configuration_type='Bucket'` config; compute the delta as `newWeighted −
  oldWeighted` (each side through the calculator with that entry's own span), negative weighted on
  delete.
- `packages/billing/src/actions/usageActions.ts:118-150, 250-270, 325-345`: same scope-resolution
  gate; quantity × resolved multiplier.
- `packages/jobs/src/lib/handlers/reconcileBucketUsageHandler.ts`: unchanged shape, now iterating
  by bucket.

## 3. Billing / invoicing

- `packages/billing/src/lib/billing/billingEngine.ts:4525-4646` (`calculateBucketPlanCharges`):
  iterate the line's `contract_line_buckets` (instead of per-service Bucket configs), load
  `bucket_usage` by `bucket_id` + period. One charge per bucket per period, as today one-per-config.
- `packages/billing/src/lib/billing/compute/computeBucketCharges.ts`: math is already
  weighted-agnostic (`overage = max(0, consumed − available)`); accept numeric minutes, keep
  hours-based overage billing (`overage/60 × rate`). Extend the explanation strings (`:283-308`) so
  that when any multiplier ≠ 1 contributed, the line description says weighted hours, e.g.
  "14.5 weighted hrs used (12 hrs included + 2.5 hrs overage @ $150/hr)".
- `packages/billing/src/actions/invoiceGeneration.ts` and `billingAndTax.ts` bucket branches:
  follow the field changes only; no behavioral change beyond numeric minutes.

## 4. Actions / API layer

- `packages/billing/src/actions/bucketOverlayActions.ts` becomes the **compat layer**: same exported
  functions and shapes (`getBucketOverlay`, `upsertBucketOverlay[InTransaction]`, `deleteBucketOverlay`),
  reimplemented against the new tables as "the single-member 1x pool for this (line, service)".
  Upsert on a (line, service) already in a multi-member pool must refuse rather than silently split
  the pool (only reachable with the flag on, via new UI, then old UI — an edge worth a clear error).
- New actions module `bucketPoolActions.ts` (flag-on UI): CRUD for pools, scope
  (member-scoped/catch-all) set, member add/remove with multiplier, after-hours rule set/clear,
  per-line listing. Enforce the one-bucket-per-(line,service) invariant, the one-catch-all-per-line
  invariant, and the ≥1-member-at-creation rule (member-scoped pools) here.
- `packages/billing/src/actions/contractWizardActions.ts:1326-1408` and
  `contractLinePresetActions.ts`: route through the compat layer (flag off) — no output change; the
  wizard's flag-on path uses `bucketPoolActions`.
- API schemas (`financialSchemas.ts` etc.): add pool/member/rule shapes; keep legacy bucket-config
  shapes serving from the compat layer.
- `server/src/lib/utils/contractLineDisambiguation.ts:145-180` and
  `packages/scheduling/src/lib/contractLineDisambiguation.{ts,shared.ts}`: eligibility joins move
  from `bucket_config.service_id` to the scope-resolution rule (membership or line catch-all);
  tie-break "prefer the line with a bucket for this service" is unchanged in spirit.

## 5. UI (all changes behind `release-v1-5-feature`; use `alga-feature-flags` patterns)

**Flag off:** every existing component (`BucketOverlayFields.tsx`, `ServiceBucketConfigForm.tsx`,
`BucketServiceConfigPanel.tsx`, wizard steps, `ContractLineDialog`) renders exactly as today,
backed by the compat actions. Since migrated data is single-member 1x pools, what these screens
show and save is byte-for-byte the old behavior.

**Flag on:**
- Wizard (`HourlyServicesStep.tsx`, `UsageBasedServicesStep.tsx`) and `ContractLineDialog.tsx`: the
  per-service "bucket of hours" toggle is replaced by a line-level **bucket pools** editor: create a
  pool (name, total hours, overage rate, rollover), choose its scope — "all services on this line"
  (catch-all, default for a new pool; disabled if the line already has one) or "selected services
  only" — attach member services with a multiplier column (default 1.0; under a catch-all the member
  list is presented as multiplier overrides), optional after-hours rule (schedule select — preselect
  tenant default, required to enable — plus multiplier). Services already in another pool on the
  line are shown disabled. Dormant (zero-member, member-scoped) pools get a warning badge: "no
  services attached — nothing burns from this pool".
- Review steps and preset lists: render pools with members/multipliers.
- Displays that read usage — `getRemainingBucketUnits.ts`, `UsageTracking.tsx`,
  `ClientContractLineDashboard.tsx`, client-portal `client-billing-metrics.ts` + charts/meters,
  `ContractInfoBanner.tsx`, `contractReportActions.ts`, the bucket-usage report definition — read by
  bucket and show weighted minutes. These are arithmetic/keying updates, not layout changes, and the
  numbers are identical for 1x pools, so they ship un-flagged; only new visual elements (e.g. a
  "weighted" annotation or multiplier badge on the meters) are flag-gated.

## 6. Tests

- **Unit — weighted calculator** (new, colocated with `weightedBurn.ts` tests in
  `server/src/test/unit/`): fully in-hours, fully after-hours, straddling boundary (prorated),
  overnight span, weekend, holiday, schedule-timezone vs entry-timezone disagreement, DST-transition
  day, zero-length span, `billable_duration ≠ wall-clock`, max-wins vs member multiplier both ways,
  no-rule bucket, multiplier rounding to 2 decimals.
- **Unit — service:** update `server/src/test/unit/bucketUsageService.test.ts` and
  `billing/bucketUsageService.periods.test.ts` to the new keying; add multi-member pool draw,
  cross-service draw from one pool, catch-all resolution (non-member service draws at 1x; member
  override wins; membership on another pool beats the catch-all; no double-draw), weighted rollover
  interaction, reconcile re-weighting after a multiplier change, reconcile matching write-path
  totals exactly.
- **Integration:** `server/src/test/integration/bucketUsageIntegration.test.ts` and
  `bucketUsageOverlayIntegration.test.ts` — migrate to pools; add a weighted end-to-end: two member
  services (1x, 2x) + after-hours rule, entries in/out of hours, assert pool depletion, overage, and
  the invoice amount equals weighted overage hours × rate
  (`server/src/test/infrastructure/billing/invoices/usageBucketAndFinalization.test.ts` pattern).
- **Migration test:** backfill produces one single-member 1x pool per legacy config, remaps usage
  rows, and legacy-shaped reads through the compat layer return identical values.
- Use the `integration-testing` skill conventions (tenant isolation, transaction cleanup).

## 7. Sequencing for the implementing agent

1. Migrations + backfill (+ migration test green).
2. `weightedBurn.ts` calculator + unit tests (pure, no DB).
3. `bucketUsageService.ts` rewrite + service tests.
4. Caller updates (time entries, usage, reconcile job) + integration tests.
5. Billing engine + invoice tests.
6. Compat layer (`bucketOverlayActions`) + wizard/preset routing; verify flag-off UI unchanged.
7. New pool editor UI + display updates behind the flag.
8. Full test suite + typecheck.

## Out of scope

- Dropping the frozen legacy tables and the dead hourly after-hours columns (later cleanup card).
- Dollar-denominated retainers (existing credit machinery remains the answer there).
- Per-user/role multipliers (`user_type_rates` exists if ever needed), stacking/compounding
  policies, per-client business-hours schedules, ticket-priority-keyed rules.
- Cross-line shared pools (pools are line-scoped).
