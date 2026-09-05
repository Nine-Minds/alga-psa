# Ad-hoc Prepaid Hour Blocks (Non-recurring, Stackable) — Implementation Plan

**Card:** 29.8.18 (release v1.5) · **Branch:** `feature/ad-hoc-prepaid-hour-blocks-non-recurring-stackab`
**Date:** 2026-08-13

## Goal

Sell one-time hour blocks outside recurring contract-line buckets: a client buys e.g.
a 10-hour block at any time, it burns down over months (no per-period reset), blocks
stack and burn FIFO, optional expiration, buy another when empty. This is the
most-requested prepaid shape for clients without recurring contracts.

## Settled design decisions (from the design session)

1. **Anchoring:** hour blocks are a **new client-level ledger modeled on
   `credit_tracking`** — minutes-denominated, purchase-minted, FIFO by expiration,
   derived balance. NOT contract/bucket machinery: buckets
   (`contract_line_service_bucket_config` + `bucket_usage`) are contract-bound and
   period-bound (allowance resets per billing period, single-period non-compounding
   rollover, overage-only invoicing) and are structurally wrong for multi-month
   burn-down.
2. **Purchase:** prepayment-style invoice — finalizing the invoice mints the block
   (mirrors `createPrepaymentInvoice` → `finalizeInvoiceWithKnex` issuing
   `credit_tracking`). Priced as **hours × per-hour rate anchored to a service-catalog
   service, rate editable per purchase** (block-discount norm: catalog $150/hr, block
   sold at $135/hr). The block stores both `total_minutes` and the purchase price.
   A **direct grant** path (no invoice — `grantCredit` analog) also ships in v1 for
   comped hours and PSA migrations.
3. **Burn model:** blocks catch **billable time not matched to any contract line** —
   contracts always win. Burn happens **in real time on time-entry save** with a
   nightly reconcile (the bucket-overlay pattern). **FIFO by expiration then purchase
   date** across a client's blocks; one entry can span blocks. When blocks run dry,
   the remainder is ordinary unbilled time invoiced at catalog rates through the
   existing non-contract path — **no special overage rate**. Consumed hours appear on
   invoices as **zero-dollar informational lines**.
4. **Service scoping:** a block carries an **optional list of catalog services**;
   empty scope = covers all labor. An entry burns only from blocks whose scope
   includes its service; unmatched time stays normal billable.
5. **Lifecycle ops (v1):** edit expiration, manually expire, adjust remaining hours
   (reason required), void before any burn. Auto-expiration job + expiring-soon
   notification. OUT: client-to-client transfer, first-class refunds (expire + credit
   note covers it).
6. **UI (all behind `release-v1-5-feature`):** MSP client detail gets an Hour Blocks
   section (credits-page UX); no tenant-wide roll-up in v1; time-entry dialog
   untouched; client portal extends `PrepaidHoursCard` and the billing overview.

## Current state (verified in code)

- **Buckets** are an overlay: `contract_line_service_configuration` rows with
  `configuration_type = 'Bucket'` on an Hourly/Usage line, config in
  `contract_line_service_bucket_config` (`total_minutes`, `overage_rate`,
  `allow_rollover`), consumption in `bucket_usage` keyed to a derived billing period.
  Burn-on-save lives in `packages/scheduling/src/actions/timeEntryCrudActions.ts`
  (~:663–720 create, ~:1030–1080 update) via
  `shared/billingClients/bucketUsageService.ts`
  (`findOrCreateCurrentBucketUsageRecord`, `updateBucketUsageMinutes`), reconciled
  nightly by `packages/jobs/src/lib/handlers/reconcileBucketUsageHandler.ts`.
- **Credits** are dollar-denominated: `credit_tracking` (`amount`,
  `remaining_amount`, `expiration_date`, `is_expired`, `currency_code`), minted on
  prepayment-invoice finalize (`packages/billing/src/actions/invoiceModification.ts`
  `finalizeInvoiceWithKnex`, issuance ~:797), FIFO application ordered by
  `expiration_date ASC NULLS LAST, created_at ASC`
  (`packages/billing/src/actions/creditActions.ts` `applyCreditToInvoiceInternal`
  :670), balance derived (`packages/billing/src/lib/creditBalance.ts`), expiration job
  `packages/jobs/src/lib/handlers/expiredCreditsHandler.ts` + expiring-soon
  notifications.
- **Non-contract time** is billed by
  `BillingEngine.calculateUnresolvedNonContractCharges`
  (`packages/billing/src/lib/billing/billingEngine.ts:1956`): approved, billable,
  uninvoiced entries with `contract_line_id IS NULL` (and not implicitly assignable),
  priced at catalog/default rates.
- **No hour-block prior art exists**: no purchase-mints-hours entity, no FIFO stack of
  hour pools, no one-time `billing_frequency`. Closest structural analog for a
  non-recurring invoice-linked record is `project_billing_schedule_entries`.
- **Flag plumbing exists**: `useFeatureFlag` (`packages/ui/src/hooks/useFeatureFlag.tsx`)
  client-side, `isFeatureFlagEnabled` (`packages/core/src/lib/features.ts`)
  server-side; `release-v1-5-feature` call sites already exist in the client portal
  (`PrepaidHoursCard.tsx:30`, `BucketUsageChart.tsx:24`, `CreditsSummaryCard.tsx:78`).

## Data model (new tables, all tenant-scoped with RLS, composite PK with `tenant`)

### `hour_blocks`

| column | type | notes |
|---|---|---|
| `tenant`, `block_id` | uuid | composite PK |
| `client_id` | uuid | owning client |
| `service_id` | uuid | catalog service the block is *sold as* (tax/GL/invoice description) — distinct from burn scope |
| `total_minutes` | integer | purchased size |
| `remaining_minutes` | integer | draw-down balance, maintained transactionally (credit `remaining_amount` analog) |
| `hourly_rate` | integer | cents/hour agreed at purchase |
| `purchase_amount` | integer | cents; `hours × hourly_rate` at creation (0 for grants unless a value is recorded) |
| `currency_code` | string | from client billing settings, credit pattern |
| `status` | string | `'pending' \| 'active' \| 'expired' \| 'voided'` |
| `purchased_at` | timestamp | set on activation (invoice finalize / grant) |
| `expiration_date` | date, nullable | optional |
| `source_invoice_id` | uuid, nullable | null ⇒ direct grant |
| `voided_at` / `voided_by` / `void_reason` | | void audit |
| `created_by`, `notes`, timestamps | | |

Status semantics: `pending` = draft purchase invoice not yet finalized (not burnable,
not in balance). `expired` blocks **keep** `remaining_minutes` as-is for display
("expired with 3.5 hrs unused") — deliberate deviation from `credit_tracking`'s
zeroing, since balance/eligibility queries filter on status anyway; the expired amount
is also recorded in the audit row. Exhausted is derived (`remaining_minutes = 0`),
not a status.

### `hour_block_service_scopes`

`(tenant, block_id, service_id)` — zero rows for a block ⇒ all-labor scope.

### `hour_block_time_allocations`

`(tenant, allocation_id, block_id, time_entry_id, minutes, created_at)`, unique on
`(tenant, block_id, time_entry_id)`. The burn ledger: source of truth for reconcile,
invoice info lines, portal burn history, and the "has any burn" void check.

### `hour_block_audit`

`(tenant, audit_id, block_id, type, minutes_delta, reason, created_by, created_at,
metadata)` with `type ∈ purchase | grant | adjustment | expiration_date_change |
manual_expiration | auto_expiration | void`. Lifecycle ops only — burns are already
fully represented by allocations; do not duplicate them here.

**Balance is derived**: a `getAvailableHourBlockMinutes(clientId, serviceId?)` helper
(analog of `creditBalance.ts`) sums `remaining_minutes` over `status = 'active'`
non-expired blocks, optionally filtered by scope.

Migrations follow the house pattern (composite PKs with `tenant`, RLS policies per
`20241015134100_add_rls_policies.cjs`, Citus-safe distribution on `tenant`).

## Work items

### 1. Migrations + types + models

- New migration(s) creating the four tables above with RLS.
- Interfaces in `packages/types/src/interfaces/` (e.g.
  `hourBlock.interfaces.ts`): `IHourBlock`, `IHourBlockAllocation`, status/audit-type
  unions.
- Thin knex models in `packages/billing/src/models/` following
  `contractLineServiceBucketConfig.ts` conventions.

### 2. Burn engine — `shared/billingClients/hourBlockService.ts`

Canonical service (same placement rationale as `bucketUsageService.ts`: both
scheduling and billing import it; add the same do-not-fork header note).

- `isEntryEligibleForBlockBurn(trx, entry)`: billable, has `service_id`, resolves to a
  client, **and** not contract-covered — `contract_line_id` null AND the service is
  not uniquely assignable to an active contract line for that client (reuse the
  disambiguation logic behind `getUniquelyAssignableServiceIdsForLine` /
  `packages/billing/src/lib/contractLineDisambiguation.ts`; extract/share rather than
  re-derive).
- `allocateTimeEntry(trx, entry)`: select eligible blocks (`active`, not expired at
  the entry's date, scope empty or containing `entry.service_id`,
  `remaining_minutes > 0`) ordered `expiration_date ASC NULLS LAST, purchased_at ASC`;
  walk the list allocating `min(remaining, needed)` until the entry's
  `billable_duration` minutes are covered or blocks run out; write allocations and
  decrement `remaining_minutes` in the same transaction. Uncovered remainder simply
  stays unallocated (normal billable time).
- `reverseTimeEntryAllocations(trx, timeEntryId)`: delete allocations, restore
  `remaining_minutes`.
- On time-entry **update**, reverse then re-allocate (clean FIFO, no delta
  bookkeeping); on **delete**, reverse.
- `reconcileClientAllocations(trx, tenant, clientId)`: recompute allocations for
  entries with allocations or eligibility drift (e.g. a contract signed after burn,
  approval changes, edited durations); used by the nightly job.

Hook points in `packages/scheduling/src/actions/timeEntryCrudActions.ts`, directly
alongside the existing bucket-overlay burn calls (create ~:663–720, update
~:1030–1080, and the delete path). Bucket check runs first; block burn applies only
when the entry is not contract-covered, so the two never both fire for one entry.
Burn-on-save is not gated on approval status (bucket parity); the reconcile job and
the billing engine's approval gates keep invoicing correct.

Nightly reconcile: new handler
`packages/jobs/src/lib/handlers/reconcileHourBlockAllocationsHandler.ts`, registered
in `packages/jobs/src/lib/maintenanceJobFanout.ts` next to
`reconcileBucketUsageHandler`.

**Time entries only in v1** — `usage_tracking` records do not burn blocks.

### 3. Purchase, grant, and lifecycle server actions

New `packages/billing/src/actions/hourBlockActions.ts` (permission pattern copied
from `creditActions.ts`):

- `createHourBlockPurchaseInvoice({clientId, serviceId, hours, hourlyRate,
  expirationDate?, scopeServiceIds?, notes?})`: inserts a `pending` `hour_blocks` row
  and a draft invoice with one line (`service_id`, `quantity = hours`,
  `rate = hourlyRate`) through the manual-invoice item machinery
  (`manualInvoiceActions.ts` conventions) so tax rides the service's tax settings;
  links via `source_invoice_id`.
- **Finalize hook** in `finalizeInvoiceWithKnex`
  (`packages/billing/src/actions/invoiceModification.ts`, beside the prepayment
  branch at ~:797): pending blocks referencing the invoice flip to `active`,
  `purchased_at = finalize time`, audit `purchase` row.
- **Draft-invoice deletion/cancel** voids the linked pending block.
- `grantHourBlock({clientId, serviceId, hours, expirationDate?, scopeServiceIds?,
  reason})`: mints an `active` block immediately, `source_invoice_id` null, audit
  `grant` row.
- `adjustHourBlockRemaining(blockId, minutesDelta, reason)` — reason required, clamps
  at ≥ 0, audit row.
- `updateHourBlockExpiration(blockId, newDate | null)` — audit row.
- `manuallyExpireHourBlock(blockId, reason)` — status → `expired`, audit row.
- `voidHourBlock(blockId, reason)` — only when **zero allocation rows have ever
  existed** for the block and status is `pending` or `active`; status → `voided`.
- `listHourBlocks(clientId)`, `getHourBlockDetail(blockId)` (incl. allocations join
  for burn history), `getAvailableHourBlockMinutes(clientId)`.

### 4. Billing engine changes

- **Exclude burned minutes from non-contract billing**:
  `calculateUnresolvedNonContractCharges` (`billingEngine.ts:1956`) joins
  `hour_block_time_allocations` per entry and bills only
  `billable_duration − allocated_minutes`. Fully covered entries produce no hourly
  charge.
- **Zero-dollar informational lines**: a new charge family (e.g.
  `calculateHourBlockUsageCharges`, pure compute in
  `packages/billing/src/lib/billing/compute/computeHourBlockCharges.ts`) emits one
  `total: 0` line per block with burn in the invoice window — description in the
  bucket style: `"Prepaid hour block (Svc) — 4.0 hrs consumed, 12.5 hrs remaining"`.
  These lines carry the covered entry ids so `invoiceService` marks fully-covered
  entries `invoiced = true` and links `invoice_time_entries` (partially covered
  entries are already marked by their hourly remainder charge). This prevents
  covered time from lingering forever as "unbilled".
- Wire into the parallel dispatch at `calculateBillingForPreparedPeriod`
  (~:1362–1425) and into `invoiceGeneration.ts` charge-detail/description handling
  (`isBucketCharge`-style predicate, quantity/unit-price accessors).
- Burned time never double-bills: an allocated minute is by construction not billed
  hourly, and contract-covered entries are by construction never allocated.

### 5. Expiration job + notifications

- `packages/jobs/src/lib/handlers/expiredHourBlocksHandler.ts`: `active` blocks with
  `expiration_date < today` → status `expired`, audit `auto_expiration` row
  (mirrors `expiredCreditsHandler`).
- Expiring-soon notification mirroring `expiringCreditsNotificationHandler` /
  `creditExpiringSubscriber`, reusing the credit notification lead-time settings
  pattern (`client_billing_settings`) — v1 uses the tenant defaults; no new settings
  UI.

### 6. MSP UI — client Hour Blocks section (flag-gated)

New `packages/billing/src/components/hour-blocks/`:

- `HourBlocksSection.tsx` — table (block, sold-as service, scope chips, hrs
  remaining/total with a slim meter, dollar value remaining, status badge,
  expiration, source invoice link) + "Sell block" and "Grant block" buttons; per-row
  action menu (adjust / edit expiration / expire / void, void disabled after any
  burn). Detail view/drawer shows burn history from allocations (entry date, who,
  minutes, work item).
- Dialogs: `SellHourBlockDialog.tsx` (service picker → rate defaults from catalog and
  stays editable, hours, optional expiration, optional scope multi-select, live
  `hours × rate` total; submits → draft invoice toast linking to the invoice),
  `GrantHourBlockDialog.tsx`, `AdjustHourBlockDialog.tsx`,
  `EditExpirationDialog.tsx`, void confirm.
- Mounted in the client detail billing area
  (`packages/clients/src/components/clients/` — alongside
  `BillingConfiguration.tsx` / `ClientContractLineDashboard.tsx`), gated with
  `useFeatureFlag('release-v1-5-feature', { defaultValue: false })`; flag off or
  loading ⇒ render nothing, page byte-identical to today.
- All strings in `server/public/locales/<locale>/…` for **all** locales (CI-enforced).

### 7. Client portal (flag-gated; both target components are already v1.5-flagged)

- Portal server actions in
  `packages/client-portal/src/actions/client-portal-actions/client-billing.ts`:
  `getClientHourBlocks()` (active blocks, remaining, expiry) and
  `getClientHourBlockBurnHistory()` (recent allocations), both behind
  `getClientIdFromPortalUser()` + `hasClientBillingReadPermission()`.
- `PrepaidHoursCard.tsx`: add hour-block rows next to the bucket rows ("Support hours
  block — 12.5h left", expiring-soon badge). No summing across pools.
- `BillingOverviewTab.tsx`: an "Hour blocks" card listing blocks with remaining
  meters, expiration, and a recent-burn list.

### 8. Tests

- **Unit (hourBlockService)**: FIFO ordering (expiration-then-purchase), entry
  spanning two blocks, scope filtering, exhaustion leaves remainder unallocated,
  reverse+realloc on update/delete, eligibility (contract-covered entries never
  burn; uniquely-assignable service counts as covered), reconcile idempotence.
- **Unit (engine/compute)**: non-contract charges bill only unallocated minutes;
  fully-covered entries produce no hourly charge but are marked invoiced via the
  info line; info-line description math; no charge when no burn in window.
- **Actions**: purchase creates pending block + draft invoice; finalize activates;
  draft deletion voids; grant activates immediately; adjust clamps and requires
  reason; void refused after any allocation; expiration job flips status and writes
  audit.
- **Component/contract tests** (portal `ClientDashboard.contract.test.ts` pattern):
  flag off ⇒ MSP section and portal additions absent, rendered UI unchanged; flag
  on ⇒ surfaces render with correct remaining math.
- Typecheck + existing suites stay green.

## Explicitly out of scope (v1)

- Client-to-client transfer; first-class refunds (manual expire + credit note).
- Tenant-wide `/msp/billing/hour-blocks` roll-up.
- Time-entry dialog burn indicator; any scheduling UI change.
- `usage_tracking` (unit-based) burn — time entries only.
- Client-portal self-service purchase.
- New tenant settings for block expiration defaults (reuse credit notification
  lead-time defaults).

## Verification plan (for Implement/Smoke steps)

1. **Flag off (default)**: client detail billing area and portal are pixel-identical
   to main; block tables exist but nothing reads them in UI.
2. **Sell + burn**: flag on — sell a 10-hr block to a contract-less client (rate
   edited down from catalog), finalize the invoice ⇒ block active; log a 2-hr
   approved billable time entry on that client's ticket ⇒ remaining 8.0 shown in MSP
   section and portal card.
3. **FIFO + spanning**: second block with earlier expiration; a 9-hr entry drains the
   expiring block first and spans into the other.
4. **Exhaustion overflow**: entry exceeding total remaining ⇒ remainder appears in
   invoice generation as normal non-contract hourly charge; generated invoice shows
   the zero-dollar consumed-hours line plus the paid remainder line; no double-bill.
5. **Contract precedence**: same client gains a contract covering the service ⇒ new
   entries follow contract billing, blocks untouched.
6. **Scope**: block scoped to service A; entry on service B does not burn it.
7. **Lifecycle**: adjust (reason), edit expiration, manual expire, void (blocked
   after burn), auto-expiration job flips overdue blocks; audit rows present.
8. **Grant**: comped block appears active with no invoice.

Dev-stack note: needs a contract-less client with a billable catalog service and
approved time entries; create via MSP UI during smoke testing.
