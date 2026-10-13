# Prepaid Block Contract Line — Implementation Plan

**Card:** 737bde61 "Prepaid Block contract line: invoice hour blocks up front, next block on
exhaustion/expiry (Tom's Help Desk)" · **PSA:** alga-2026-0002695
**Branch:** `feature/prepaid-block-contract-line-invoice-hour-blocks` · **Date:** 2026-10-13
**Builds on:** `docs/plans/2026-08-13-ad-hoc-prepaid-hour-blocks-plan.md` (the hour-block ledger),
`docs/plans/2026-08-11-client-portal-prepaid-balance-plan.md` (portal surfaces).

All line numbers are against `a65fccb78c` (main at branch point).

## Goal

A contract can sell support as prepaid blocks of hours. The block is invoiced up front, time on
the covered services draws it down, and the next block is invoiced when the current one runs out,
expires, or the contract renews — triggered by consumption, not by a billing period. Blocks live in
the existing hour-block ledger (`hour_blocks`, `hour_block_service_scopes`,
`hour_block_time_allocations`, `hour_block_audit`). There is no second ledger and no priced bucket
pools.

## Decisions

### D1. Storage: a block config overlay on an **Hourly** line, not a new `contract_line_type`

A Prepaid Block line is an `Hourly` contract line plus one row in a new
`contract_line_prepaid_blocks` table. The UI presents and labels it everywhere as "Prepaid Block".
This follows the existing precedent: bucket pools are also line-owned overlays on Hourly lines
(`contract_line_buckets`, `server/migrations/20260814090000_create_contract_line_buckets.cjs:267-351`).

Why not a new type:
- **Blast radius and silent failure.** About 401 type-comparison sites in 51 non-test files branch on
  `contract_line_type`, and 59 more hard-code the `'Fixed' | 'Hourly' | 'Usage'` union. Several of
  them silently mis-handle an unknown value instead of failing:
  - `resolveRecurringChargeFamily`, in all three copies, falls back to `'fixed'` for an unknown type
    (`shared/billingClients/clientCadenceScheduleRegeneration.ts:191`,
    `packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts:142`,
    `packages/billing/src/actions/recurringServicePeriodActions.ts:379`). A new type would
    materialize *fixed* recurring periods for the line.
  - The client portal filters lines with `.whereIn('cl.contract_line_type', ['Fixed','Hourly','Usage'])`
    (`packages/client-portal/src/actions/account.ts:626`).
  - The due-work `normalizeChargeType` drops unknown types (`packages/billing/src/actions/billingAndTax.ts:772-784`).
  - The simulator snapshot hard-errors on them (`ee/server/src/lib/billing/simulator/snapshotContractToScenario.ts:556-562`).
  - The API Zod enums reject them (`server/src/lib/api/schemas/contractLineSchemas.ts:23`).
- **The semantics already match Hourly.** Covered services are the line's hourly
  services, so the line's existing `contract_line_services` and `contract_line_service_hourly_configs`
  rows already express them. Time already resolves to the line through the existing disambiguation
  (`packages/scheduling/src/lib/timeEntryWriteCore.ts:232-303`). The **overage rate is the line's
  hourly rate**, and `loadTimeBasedObligation` already bills that in arrears. The only change it
  needs is to subtract block-allocated minutes. Overage therefore reuses rounding, minimum billable
  time, tax, and the invoice line shape unchanged. "Never 0" becomes a validation rule on the block
  line's hourly rates.
- **Constraints the overlay brings.** A block line carries no bucket pools; this is enforced both
  ways in `bucketPoolActions.ts` and the block-config action. A line has at most one block config.
  Every service on a block line is a covered service.

### D2. Issuance is its own small ledger, surfaced as due work via the "unresolved row" precedent

The block cannot be a `recurring_service_periods` row:
- The engine allows exactly one persisted due period per line per invoice window. A second one
  throws "multiple persisted due periods matched one runtime obligation"
  (`packages/billing/src/lib/billing/billingEngine.ts:4788-4798`; selections are keyed by line id
  only).
- The Hourly line's own arrears period already occupies that slot in the window the block is
  invoiced in.
- Cadence regeneration archives or retires future rows per line, e.g.
  `retireFutureClientCadenceRowsForLine` via `recurringServicePeriodSync.ts:58-94`. That would
  destroy dated block obligations.
- A block is a dated one-off obligation, not a recurring service period.

New table `contract_line_block_issuances` (D5) holds "a block is due on date X for line L".
- **Listing on the Invoices screen.** It surfaces through the same mechanism that already puts
  *non-period* work on the due-work list with a real amount: unresolved non-contract rows.
  - `fetchUnresolvedNonContractDueWorkRows` (`billingAndTax.ts:996-1090`) maps each record onto a
    client billing-cycle window.
  - It encodes the record in the selector's schedule key, `schedule:{tenant}:unresolved:{kind}:{recordId}`
    (`billingAndTax.ts:1047`).
  - It sets `amountCents` (`:1081-1085`).
- **Generation.** `calculateBillingForSelectionInputs` parses that key back into a selection
  (`packages/billing/src/actions/invoiceGeneration.ts:1735-1783`). Issuances follow suit:
  `schedule:{tenant}:prepaid_block:{issuanceId}` inside a `client_cadence_window` selector for the
  window that contains the due date.
- **Combining with other in-advance charges.** The issuance groups into the same invoice candidate
  as the contract's other in-advance charges for that window, through
  `groupDueServicePeriodsForInvoiceCandidates` (`shared/billingClients/recurringTiming.ts:239`).
  `assertSameRecurringSelectionWindow` (`invoiceGeneration.ts:1645-1665`) then holds because it
  shares the window.

### D3. Draw-down eligibility splits by block ownership

`hour_blocks` gains `contract_line_id` and `client_contract_id`, with a new `source_type`
value `'contract'`.
- **Contract-issued blocks** are drawn only by time entries whose resolved `contract_line_id` is
  the block's line. The rule is no longer "contracts always win".
- **Ad-hoc blocks** (`contract_line_id IS NULL`) keep today's rule exactly
  (`shared/billingClients/hourBlockService.ts:182-206`). They can never be drawn by contract time,
  and contract blocks can never be drawn by non-contract time or by another line's time.

### D4. Follow-on blocks

- **Usage triggers** (exhaustion, threshold): event-driven through the prepaid alert and
  replenishment engine, with a new alert subject `'prepaid_block'`.
- **Date triggers** (block expiry, renewal): scheduled `contract_line_block_issuances` rows that show
  on the Invoices screen for their date.

**At most one open follow-on per line** means one `scheduled` issuance or one `pending` contract
block at a time. This is enforced by a partial unique index plus a locked check (D5, §5).

### D5. Data model (all tenant-scoped, composite PK with `tenant`, no RLS, registered in `packages/db/src/lib/tenantTableMetadata.ts` and `server/migrations/utils/tenantDb.cjs`)

**`contract_line_prepaid_blocks`** — the line config, 1:1 with the line:

| column | type | notes |
|---|---|---|
| `tenant`, `contract_line_id` | uuid | PK; FK to `contract_lines` |
| `block_minutes` | integer > 0 | block size |
| `block_price` | bigint ≥ 0 | minor units, in the contract currency; defaulted in the UI to hours × the covered service's rate; stored explicitly |
| `sold_as_service_id` | uuid | the catalog service the invoice line is sold as (tax, GL, export mapping); must be one of the line's services; defaults to the first covered service |
| `expiry_months` | smallint null | null = never expires |
| `trigger_on_exhaustion` | bool, default true | |
| `trigger_threshold_percent` | smallint null, 1-99 | |
| `trigger_on_expiry` | bool | defaults true in the UI when `expiry_months` is set; CHECK that it is false when `expiry_months` is null |
| `trigger_on_renewal` | bool, default false | |
| `replenishment_tier` | text CHECK IN ('draft','auto_issue'), default 'draft' | reuses the `PREPAID_REPLENISHMENT_TIERS` values (`shared/billingClients/prepaidBalanceAlertSettings.ts:12`) minus `notify`, which would leave the line with no next block |
| timestamps | | |

**`contract_line_block_issuances`** — the "a block is due" ledger:

| column | notes |
|---|---|
| `tenant`, `issuance_id` | PK |
| `contract_line_id`, `client_contract_id`, `client_id` | owner |
| `trigger_kind` | CHECK IN ('contract_start','exhaustion','threshold','expiry','renewal','manual') |
| `due_date` | date |
| `status` | CHECK IN ('scheduled','invoiced','superseded','cancelled') |
| `source_block_id` | null; the block whose exhaustion or expiry triggered it |
| `block_id`, `invoice_id`, `invoice_charge_id` | set when invoiced |
| `alert_id` | null; set for usage-triggered issuances |
| `block_minutes`, `block_price`, `currency_code` | snapshot taken at invoicing |
| `cancel_reason`, timestamps | |

The open-follow-on invariant is a partial unique index `(tenant, contract_line_id) WHERE status = 'scheduled'`.
Pending-block exclusivity is checked under lock (§5).

**`hour_blocks`** additions:
- `contract_line_id uuid null`, `client_contract_id uuid null`, `issuance_id uuid null`.
- Index `(tenant, contract_line_id, status)`.
- Widen `hour_blocks_source_type_check` to add `'contract'`.
- Add a CHECK that `source_type = 'contract'` holds exactly when `contract_line_id` is not null.
- Add `replenishment_bucket_usage_id`, plus the new columns, to `IHourBlock`
  (`packages/types/src/interfaces/hourBlock.interfaces.ts:21-78`). The field is missing there today.

**`hour_block_audit`**:
- Widen the type CHECK (current list at `server/migrations/20260815120000_link_hour_blocks_to_invoice_lines.cjs:101`)
  with `'contract_end_expiration'`, `'allocation_release'` and `'reassignment'`.
- Expiry at the block's own date keeps using the existing `'auto_expiration'` type. That is the
  "expiration" audit row in the brief.

**`prepaid_balance_alerts`**:
- Widen `alert_type` CHECK (`server/migrations/20260815000000_add_prepaid_balance_alerts.cjs:143`)
  to add `'prepaid_block'`.
- Add `hour_block_id uuid null`. `contract_line_id` already exists (`:128`).

**Templates and presets** carry the config:
- `contract_template_line_prepaid_blocks`, same columns keyed `(tenant, template_line_id)`.
- `contract_line_preset_prepaid_blocks`, keyed `(tenant, preset_id)`.

All migrations are created with `cd server && npx knex migrate:make … --knexfile knexfile.cjs --env migration`.
They are Citus-safe (composite FKs on `tenant`; transaction-free where they add FKs to distributed
tables, as in `20260819150000_add_prepaid_auto_replenishment.cjs`).

### D6. Expiry date semantics

- `expiration_date` = `invoice_date + expiry_months − 1 day`. It is the last usable day, matching the
  burn rule `expiration_date >= workDate` (`hourBlockService.ts:245`).
- The expiry-triggered next block is due on `invoice_date + expiry_months` (the anniversary).
- A pending block's clock starts at its own invoice date. The date is recomputed from the invoice's
  `invoice_date` when the draft's date is edited, and again at finalize
  (`activateHourBlocksForFinalizedInvoice`, `packages/billing/src/services/prepaidReplenishmentSettlement.ts:96-191`).

### D7. Currency

A block's `currency_code` is the contract's `contracts.currency_code`, passed explicitly:
- **Never** the `hour_blocks.currency_code` column default 'USD'
  (`server/migrations/20260813120000_create_hour_block_tables.cjs:122`).
- **Never** `client.default_currency_code || 'USD'`, which is what `hourBlockActions.ts:322,397` do
  today for ad-hoc blocks. That stays out of scope for ad-hoc blocks, but the shared helper takes
  currency as a required argument (§3).
- UI amounts use `formatCurrencyFromMinorUnits` and `toMinorUnits`
  (`packages/core/src/lib/formatters.ts:104-135`) and `CurrencyInput` with the contract currency.
  Never hard-coded ×100; `SellHourBlockDialog.tsx:91-95,143-151` gets that wrong today.

## Open decisions for the captain (confirm before Implement)

1. **What "renewal" means.** In code, auto-renewal never extends `end_date`.
   - `processRenewalQueueHandler` (`packages/jobs/src/lib/handlers/processRenewalQueueHandler.ts:263-300`)
     only rolls `decision_due_date` and `renewal_cycle_*`.
   - `createRenewalDraftForQueueItem` (`packages/billing/src/actions/renewalsQueueActions.ts:546-614`)
     creates a **new, empty** draft contract (no lines copied). It is linked from the source
     assignment only through `client_contracts.created_draft_contract_id`.

   Proposed v1 definition. A renewal event is either:
   - **(a)** the assignment's renewal cycle boundary, i.e. the next `renewal_cycle_start` derived by
     `normalizeClientContract` (`shared/billingClients/clientContracts.ts:226-316`), for contracts that
     continue past it (evergreen, or `end_date` beyond it); or
   - **(b)** activation of a renewal draft whose source assignment has a Prepaid Block line
     (`completeRenewalQueueItemForActivation`, `renewalsQueueActions.ts:784`).

   For (b), the source line's live blocks are **re-owned** by the matching block line on the new
   contract. A line matches when its covered-service sets are equal. The move is recorded with a
   `'reassignment'` audit row. This honours "renewal does not reset or extend blocks", and blocks
   never cross to unrelated contracts. If no matching line exists, the blocks follow rule 2.
   **Confirm (a)+(b) and the re-ownership rule.**
2. **Contract end without renewal.** Proposed: a contract block's remaining minutes are forfeited at
   the end of the assignment's `end_date`, with a `'contract_end_expiration'` audit row. No
   expiry-triggered block is issued past the end date. **Confirm** (brief item 6 asks for this
   confirmation).
3. **Expiry arithmetic** (D6): last usable day = invoice date + N months − 1 day; next block due on
   the anniversary. **Confirm.**
4. **Voided follow-on.** The usage episode stays suppressed until the line gets a new block, which
   reuses `suppressPrepaidReplenishmentForVoidedInvoice`
   (`packages/billing/src/lib/prepaidAutoReplenishment.ts:48-61`). The MSP can issue one on demand
   from the line card ("Issue next block", trigger `manual`). **Confirm** that this, rather than
   re-drafting on the next time entry, is intended.

## Work items (in order)

### 1. Schema, types, models

- Migrations for every D5 change.
- Types:
  - `IContractLinePrepaidBlock` and `IContractLineBlockIssuance`, in a new
    `packages/types/src/interfaces/prepaidBlock.interfaces.ts`.
  - Extend `IHourBlock` and the hour-block audit-type union (`hourBlock.interfaces.ts:11-19`).
  - Extend `PrepaidReplenishmentSubject` (`packages/billing/src/lib/prepaidAutoReplenishment.ts:7`)
    to `'credit' | 'bucket' | 'prepaid_block'`.
  - Extend `RecurringDueWorkChargeType`
    (`packages/types/src/interfaces/recurringTiming.interfaces.ts:498`) with `'PrepaidBlock'`.
- Thin models in `packages/billing/src/models/` (`contractLinePrepaidBlock.ts`,
  `contractLineBlockIssuance.ts`), following `models/hourBlock.ts:12-79`.

### 2. Burn engine — `shared/billingClients/hourBlockService.ts`

The module stays canonical; no fork.

- **Split eligibility.**
  - `isEntryEligibleForBlockBurn` (`:182-206`) becomes a resolver that returns the burn target:
    `{ kind: 'contract', contractLineId } | { kind: 'adhoc' } | null`.
  - **Contract target:** the entry's `contract_line_id` (explicit or saved resolution), or the
    single deterministic line from `getEligibleContractLineCountForServiceAtDate`
    (`:153-174`, extended to return the id). The target must have a `contract_line_prepaid_blocks` row.
  - **Ad-hoc target:** today's rule, unchanged.
- **Block selection.**
  - `selectEligibleBlocks` (`:231-298`) takes the target.
  - Contract target: blocks with `contract_line_id = L`. First `active` blocks (not expired at the
    work date, remaining > 0) in FIFO order, then the line's `pending` block (gap draw, brief item 5).
  - Ad-hoc target: adds `contract_line_id IS NULL` to today's query.
  - Lock order stays canonical `block_id` FOR UPDATE; FIFO sort stays in JS after locking (`:280-295`).
- **Line re-draw.** New `reconcileLineAllocations(trx, tenant, contractLineId)`: reverse and
  re-allocate the line's uninvoiced, approved-or-not entries.
  - Called after a pending block is created, so overflow already logged lands on it
    (Ryan's "3 hrs sit on the pending block").
  - Called after a pending block is voided or deleted, so released minutes fall to overage.
  - Called after a contract block expires.
- **Nightly reconcile.**
  - `selectClientEligibleEntries` (`:429-478`) filters `te.contract_line_id IS NULL` (`:459`).
    Widen it to include entries on block lines.
  - `reconcileClientAllocations` (`:493-552`) works through the new resolver. Invoiced entries
    stay excluded.
  - Job: `packages/jobs/src/lib/handlers/reconcileHourBlockAllocationsHandler.ts:20-83` also visits
    clients that have a pending contract block.
- **Balances.**
  - `getAvailableHourBlockMinutes` (`:559-605`) gains an optional `{ contractLineId }` filter.
    Callers that compute the ad-hoc balance pass `adhocOnly`.
  - `getAvailableHourBlockMinutesForSubjects` (`:614-661`) excludes contract blocks. Bucket subjects
    must not count them.
- **Save hook.** `packages/scheduling/src/lib/timeEntryWriteCore.ts:635-646` currently calls
  `allocateTimeEntry` only when `!contract_line_id`. Change it to call whenever the resolver
  returns a target. It stays in its savepoint and stays best-effort, with nightly reconcile as the
  backstop.
- **Usage event.** After commit, when a contract target was drawn, publish
  `PREPAID_BLOCK_USAGE_CHANGED { tenant, clientId, contractLineId }`. The schema goes in
  `packages/event-schemas/src/schemas/domain/billingEventSchemas.ts`, next to
  `PREPAID_BALANCE_ALERT_SCAN_REQUESTED` (`:316`).
- **Delete path.** `packages/scheduling/src/actions/timeEntryCrudActions.ts:719-729` is unchanged;
  `reverseTimeEntryAllocations` is block-agnostic.

### 3. Shared pending-block creation

Extract from `createHourBlockPurchaseInvoiceInternal` (`packages/billing/src/actions/hourBlockActions.ts:191-283`,
insert at `:256-280`) a helper `createPendingHourBlockForInvoiceCharge(trx, { tenant, clientId,
serviceId, minutes, hourlyRate, purchaseAmount, currencyCode, invoiceId, invoiceChargeId,
expirationDate, scopeServiceIds, sourceType, contractLineId?, clientContractId?, issuanceId?,
replenishmentBucketUsageId?, notes })`.
- Ad-hoc purchase, bucket replenishment, and both new contract paths (§4 recurring generation,
  §6 replenishment) call it.
- Scopes for a contract block are the line's covered services, written to `hour_block_service_scopes`
  for display and the portal. Eligibility keys on `contract_line_id`.
- Add `// LEVERAGE: pattern pending-hour-block-for-invoice-charge` if a fourth caller appears before
  this lands.

### 4. Billing engine and invoice generation

- **Overage subtraction.**
  - `loadTimeBasedObligation` (`packages/billing/src/lib/billing/billingEngine.ts:5189-5566`, entry
    filter `:5396-5438`) subtracts `hour_block_time_allocations` minutes per entry, mirroring the
    `block_allocated_minutes` subquery in `calculateUnresolvedNonContractCharges` (`:2750-2754`,
    `:2854-2864`).
  - Minutes allocated to an **active or expired** block are excluded from pricing.
  - Minutes allocated to a **pending** block are excluded **and the entry is held**: not priced,
    not marked invoiced, not covered by an info line. It surfaces once the block activates, or
    returns to overage if the block is voided. This is the no-unbilled, no-double-billed guarantee
    for the gap.
  - Partially covered entries bill the remainder at the line's hourly rate (overage) through the
    existing `computeTimeBasedCharges.ts:417-445`.
- **Zero-dollar consumption lines for contract blocks.**
  - `calculateHourBlockUsageCharges` (`:3153-3205`) restricts to `te.contract_line_id IS NULL`, and
    runs only when the non-contract selection is included (`:1947`, `:1985-1991`).
  - Add a contract-line variant, run inside the per-line dispatch (`:1812-1910`) for block lines
    in the line's arrears window. It emits the same `IHourBlockCharge`
    (`packages/types/src/interfaces/billing.interfaces.ts:751-764`) with `client_contract_line_id`
    set, built with `aggregateHourBlockBurnRows` and `computeHourBlockCharges` (`compute/computeHourBlockCharges.ts:49-120`).
  - It only covers allocations to active or expired blocks.
  - Fully covered entries are then marked invoiced by the existing `hour_block` branch of
    `linkAndMarkSourceBillingRecord` (`packages/billing/src/services/invoiceService.ts:379-397`).
- **Block charge family.**
  - New charge type `prepaid_block` (`IPrepaidBlockCharge`: `issuance_id`, `serviceId`
    = sold-as service, `quantity` = hours, `rate` = price ÷ hours, `total` = price,
    `billingTiming: 'advance'`, `client_contract_line_id`).
  - New loader `loadPrepaidBlockIssuanceCharges(selection)`, called from `calculateBillingForPreparedPeriod`
    (`:1573-2121`) when the prepaid-block selection (parsed in `invoiceGeneration.ts:1735-1783`)
    is non-empty.
  - Guard `isPrepaidBlockCharge` next to `isHourBlockCharge` (`invoiceGeneration.ts:180-206`).
    Add the async twin in `billingAndTax.ts:1638-1653`, quantity and price helpers (`:251,262`), and
    the description formatter (`:277`).
- **Persistence.**
  - In `persistInvoiceCharges` (`invoiceService.ts:1417-1643`), a `prepaid_block` charge inserts the
    `invoice_charges` row (`:1514-1554`), then calls §3's helper (`source_type 'contract'`,
    expiration per D6 from the invoice's `invoice_date`).
  - The issuance is then marked `invoiced` with `block_id`, `invoice_id` and `invoice_charge_id`,
    under a row lock on the issuance (`status = 'scheduled'`, so a double-generate fails fast).
  - Next, `reconcileLineAllocations` runs.
  - `total_price` is authoritative at `block_price`. `unit_price` is rounded price ÷ hours.
    Verify that invoice validation and the PDF tolerate quantity × unit ≠ total (see Risks).
- **Lifecycle hooks.**
  - **Finalize** already activates pending blocks linked by `source_invoice_charge_id`
    (`invoiceModification.ts:1064-1066`). Extend `activateHourBlocksForFinalizedInvoice` to
    recompute `expiration_date` from the final `invoice_date` (D6). On activation of a contract
    block with `trigger_on_expiry`, schedule the expiry issuance (§6).
  - **Deferral.** Finalize forces `deferPrepaidActivation` whenever an alert links the invoice
    (`:1014-1021,1064-1066,1088`). That would defer a usage-triggered contract block to *payment*,
    which contradicts brief item 2. Exempt alerts with `alert_type = 'prepaid_block'` from the
    forced deferral.
  - **Unfinalize** (`:89-151`, called `:1467`): unchanged rules. An unused active block goes back to
    pending; a used one refuses.
  - **Hard delete** (`voidPendingHourBlocksForDeletedInvoice`, `:335-404`, called `:2139`): before
    voiding a pending contract block, release its allocations (`'allocation_release'` audit), then
    run `reconcileLineAllocations` and mark the issuance `cancelled`.
    - Contract-start, expiry and renewal issuances go back to `scheduled` (re-due) rather than
      `cancelled`, because the date obligation still exists.
    - Usage-triggered issuances are cancelled. Their alert is cleared by the existing
      `clearPrepaidReplenishmentForInvoice` (`:2047`).
  - **Void** (`packages/billing/src/actions/voidInvoiceActions.ts`, which has *no* hour-block
    handling today; replenishment suppression only at `:299`): add the same release-and-void path
    for pending blocks linked to the invoice. This also closes the existing gap where a voided
    bucket-replenishment invoice leaves its block `pending` forever. Voiding an invoice whose block
    is already active follows today's guard behaviour (refuse if used).

### 5. Issuance scheduling and the Invoices screen

- **Sync.** New `syncPrepaidBlockIssuancesForContractLine(trx, tenant, contractLineId)`. It is
  idempotent, runs under a lock on the config row, and is called next to every
  `syncRecurringServicePeriodsForContractLine` call site:
  - `contractLineAction.ts:221,295,356`
  - `contractActions.ts:361,416,451`
  - `contractWizardActions.ts:1889`
  - `contractLinePresetActions.ts:709,973`
  - `billingClientsActions.ts:265,291,318`

  Mark each pairing `// LEVERAGE: pattern line-obligation-sync`. These are the same 13 sites; a
  single "line obligations changed" entry point is the missing layer.

  The sync rules:
  - **First block.** If the line has a config, an assignment is active, the line has never issued
    a block, and there is no open issuance, insert `contract_start` due at
    `max(client_contracts.start_date, line created date)`.
  - **Renewal contracts.** These issue a start block only when `trigger_on_renewal` is on (captain
    decision 1b).
  - **Cancellation.** Cancel `scheduled` issuances when the config is removed, the line is deleted,
    or the contract ends before the due date.
- **Listing.** In `getAvailableRecurringDueWork` (`packages/billing/src/actions/billingAndTax.ts:1845-2048`),
  add `fetchPrepaidBlockIssuanceDueWorkRows`, modelled on `fetchUnresolvedNonContractDueWorkRows`
  (`:996-1090`).
  - **Window.** The client billing cycle containing `due_date` if it is uninvoiced, else the earliest
    uninvoiced cycle after it. The candidate windows come from the same `client_billing_cycles` query
    (`:300-378`). Contract-cadence assignments use the contract cadence window instead.
  - **Row fields.** `chargeType: 'PrepaidBlock'`, `amountCents = block_price`, and a selector with
    schedule key `schedule:{tenant}:prepaid_block:{issuanceId}`.
  - **Type-list changes.** Extend `normalizeChargeType` (`:772-784`) and the UI order list in
    `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx` (around `:1380`; union
    at `:537`).
  - **Locale keys** for the "Prepaid block" chip and row description go in
    `server/public/locales/*/msp/invoicing.json`, for all locales.
- **Selection.**
  - `calculateBillingForSelectionInputs` (`invoiceGeneration.ts:1735-1783`) parses the
    `prepaid_block` key into `prepaidBlockSelection.issuanceIds`.
  - `scopeRecurringTimingSelectionsForSelectorInputs` (`:1567-1643`) ignores these keys, as it does
    the unresolved ones.
  - `claimRecurringServicePeriodsForSelectionInputs` (`invoiceService.ts:148-262`) skips them, as it
    already does unresolved selectors.
- **Preview.** It works without change because `previewGroupedInvoicesForSelectionInputs`
  (`invoiceGeneration.ts:2795`) runs the same calculation. A window holding only a block issuance
  yields the block charge, so "Nothing to bill" (`invoiceGeneration.ts:3651`) cannot fire for it.

### 6. Follow-on triggers

- **Alert subject `prepaid_block`.** In `server/src/lib/eventBus/subscribers/prepaidBalanceAlertEvaluator.ts`:
  - Add `resolvePrepaidBlockSubjects`, modelled on `resolveCurrentBucketSubjects` (`:214-292`).
    It emits one subject per block line with an active assignment, using the line's newest
    active block.
    - capacity = `total_minutes`
    - used = `total − remaining`
    - exhausted when `remaining = 0` **and** the line has unallocated or overflow minutes, or when
      remaining is 0 and `trigger_on_exhaustion` is on
    - threshold when `used×100 ≥ pct×total`
  - Dedupe key: `prepaid_block:{contractLineId}:{blockId}:{exhausted|pct}`. One episode per block,
    so a new block re-arms naturally.
  - Predicates go in `packages/billing/src/lib/prepaidBalanceAlerts.ts` (`:46-112`).
- **Event-driven evaluation.**
  - Replenishment is scan-only today: one daily `prepaid-balance-alert-scan` (`0 9 * * *`,
    `packages/types/src/constants/maintenanceFanoutSchedules.ts:30`). `PREPAID_BALANCE_ALERT_SCAN_REQUESTED`
    has a `clientId` option that no caller uses.
  - Subscribe `PREPAID_BLOCK_USAGE_CHANGED` in `prepaidBalanceAlertSubscriber.ts` (`:24,41-54`). It
    runs evaluate, then replenish, then deliver **scoped to that client**.
  - The daily scan stays as the backstop and picks up block subjects automatically.
- **Replenishment.** In `server/src/lib/eventBus/subscribers/prepaidAutoReplenishment.ts`:
  - The tier for `prepaid_block` alerts comes from the line config's `replenishment_tier`, not the
    contract or client override chain (`:152-155`).
  - The horizon check (`:82-91,164-180`) applies: no follow-on if the assignment ends within the
    horizon and doesn't renew.
  - Under the locked alert (`:128-131`), also lock the line config row and refuse when an open
    issuance or a pending contract block exists for the line. A trigger while one is pending does
    nothing.
  - Otherwise insert an issuance (`exhaustion`|`threshold`, due today, `alert_id`) and call
    `createPrepaidReplenishmentInvoice` (`packages/billing/src/lib/prepaidAutoReplenishment.ts:85-149`)
    with a new `prepaid_block` branch. That branch creates a standalone draft invoice whose single
    line is priced from the line config in the contract currency and is linked to the issuance. It
    calls §3's helper, then `reconcileLineAllocations` (gap draw).
  - `auto_issue` reuses the existing finalize, email and issued path (`:237-269`). Delivery and
    notification reuse `prepaidBalanceAlertDelivery.ts` (template selection `:791-805`). Add a
    "next block drafted / issued" copy variant.
- **Expiry trigger.** When a contract block activates with `trigger_on_expiry`, insert an `expiry`
  issuance due on the anniversary (D6) with `source_block_id`.
  - It is superseded (`status = 'superseded'`) when any newer block for the line is issued before
    the due date. A block exhausted and replaced early doesn't also re-issue at its expiry.
  - It is also superseded if the assignment ends before the due date (captain decision 2).
- **Renewal trigger** (captain decision 1). Two paths:
  - **(a)** `processRenewalQueueHandler` (`:263-300`): when it rolls a cycle for an assignment that
    continues, insert a `renewal` issuance due at the new `renewal_cycle_start` for block lines with
    `trigger_on_renewal`.
  - **(b)** `completeRenewalQueueItemForActivation` (`renewalsQueueActions.ts:784`): re-own the
    source line's live blocks to the matching new line (`'reassignment'` audit) and run the new
    line's sync.
- **Expiry and contract end.**
  - `packages/jobs/src/lib/handlers/expiredHourBlocksHandler.ts:23-107` already expires overdue
    blocks with `auto_expiration` audit rows and keeps the remaining minutes for display. After it
    expires a contract block, call `reconcileLineAllocations` for that line.
  - Add a contract-end pass to the same handler: active or pending contract blocks whose assignment
    `end_date` is past (or whose `is_active` is false, see `shared/billingClients/clientContractStatus.ts:50-78`)
    and which have no reassignment. Mark them `expired`, write a `contract_end_expiration` audit row,
    and cancel scheduled issuances.
  - The expiring-soon notice (`expiringHourBlocksNotificationHandler.ts:23-144`,
    `hourBlockExpiringSubscriber.ts`) covers contract blocks unchanged. Add the contract name to the
    payload.

### 7. Configuration UI

- **Line config action.** `upsertContractLinePrepaidBlock(contractLineId, config)` and
  `removeContractLinePrepaidBlock` in a new `packages/billing/src/actions/prepaidBlockActions.ts`
  (permission pattern from `bucketPoolActions.ts`).
  - Validates: the line is Hourly; there are no pools; `sold_as_service_id` is on the line; every
    covered service's hourly rate is > 0; the price is ≥ 0; `expiry_months` is 1-120.
  - Calls the §5 sync.
  - Reject `createBucketPool` / `addBucketPoolMember` on a block line
    (`bucketPoolActions.ts:210,236,381`).
- **Contract Lines tab** (`packages/billing/src/components/billing-dashboard/contracts/ContractLines.tsx`):
  - **Create Custom.** `CreateCustomContractLineDialog.tsx:46,286`, action
    `contractLinePresetActions.ts:753,771`. Add a "Prepaid Block" line option. It creates an
    `Hourly` line plus the config in one transaction, using a new `prepaid_block` input field on
    `CreateCustomContractLineInput`.
  - **Add from Presets.** `ContractLinePresetPicker.tsx:174-178`,
    `useContractLinePresetSelection.ts:233-251`, `copyPresetToContractLine`
    (`contractLinePresetActions.ts:451`). Presets with a `contract_line_preset_prepaid_blocks` row
    copy it.
  - **Line card.** `ContractLines.tsx:1230-1273`; the Hourly block is at `:1601`. When a block config
    exists:
    - Badge "Prepaid Block". Labels use `useFormatContractLineType`
      (`hooks/useBillingEnumOptions.ts:39,49`) via a derived display kind, not a new type value.
    - New `PrepaidBlockPanel.tsx` showing the config, active block balance (meter), pending block
      (with invoice link), next scheduled issuance, and block history (from a new
      `getContractLinePrepaidBlockSummary` action that joins `hour_blocks`, issuances and invoices).
    - The "Issue next block" button (captain decision 4).
  - **Inline edit.** `handleEditContractLine` `:661`, `handleSaveContractLine` `:822`, plus a
    `PrepaidBlockConfigFields` editor.
  - Hide `BucketPoolEditor` (`:2041`) on block lines.
- **Contract wizard.**
  - `HourlyServicesStep.tsx` (`:350` is where pool drafts mount) gets a "Prepaid block lines" section.
  - The submission type (`contractWizardActions.ts:333-398`) gains
    `prepaid_block_lines: [{ services, block config }]`.
  - `createClientContractFromWizard` (`:1079`; Hourly line creation `:1698-1712`) creates one extra
    Hourly line per entry with its config.
  - `ReviewContractStep` shows it.
- **Templates.**
  - Template wizard: `createContractTemplateFromWizard` (`contractWizardActions.ts:544`),
    `template-wizard/steps/`, and `ContractTemplateDetail.tsx`.
  - Clone: `cloneTemplateLineToContract` (`packages/billing/src/repositories/contractLineRepository.ts:475`,
    "the ONE clone routine") copies `contract_template_line_prepaid_blocks` into
    `contract_line_prepaid_blocks`.
  - The legacy duplicates `shared/billingClients/templateClone.ts:28` and
    `packages/billing/src/lib/billing/utils/templateClone.ts:42` must copy it too, or route to the
    canonical routine. Prefer routing; otherwise mark `// LEVERAGE: pattern template-line-clone`.
  - Contract → template snapshot: `ensureTemplateLineSnapshot` (`contractLineRepository.ts:224`) and
    its copy in `contractLineMappingActions.ts:131`.
- **API.** `server/src/lib/api/schemas/contractLineSchemas.ts` and `services/ContractLineService.ts`
  accept and return an optional `prepaid_block` object on Hourly lines. The type enum is unchanged.
- **Strings.** All strings go in `server/public/locales/<locale>/msp/contracts.json` (and the other
  namespaces touched), for all locales.
- **Element ids.** Every interactive element gets an `id` per the reflection guidelines.

### 8. Display surfaces

- **Billing Dashboard → Hour Blocks.**
  - `listHourBlocks` (`packages/billing/src/actions/hourBlockActions.ts:666-723`) left-joins
    `contract_lines` and `contracts` to return `contract_name` and `contract_line_name`.
  - `HourBlocksSection.tsx` (`packages/billing/src/components/hour-blocks/HourBlocksSection.tsx:100-264`)
    labels contract blocks in the Source column ("Contract: Tom's Help Desk Support").
  - Row actions for contract blocks:
    - Allowed: View, Adjust (audit), Edit expiration (audit).
    - Hidden: Grant and Void. Void runs through the invoice.
  - Server guards in `voidHourBlock` (`:593`) and `grantHourBlock` (`:357`) enforce the same rules.
- **Client portal.**
  - `getClientHourBlocks` and `getClientHourBlockBurnHistory`
    (`packages/client-portal/src/actions/client-portal-actions/client-billing.ts:1373-1508`) already
    read all active blocks. Add the contract name and keep `status = 'active'` (pending blocks are
    not shown to clients).
  - `PrepaidHoursCard.tsx:134-171` and `HourBlocksCard.tsx` render the label.
  - Fix the stale "newest first" comment (`:1369`) while there.
- **Simulate tab** (EE, `contract-simulator` flag, `ContractDetail.tsx:260-265`).
  - `ee/server/src/lib/billing/simulator/loadSimulationCalculationInput.ts` gets a prepaid-block
    branch in the per-line dispatch (`:305-404`). It is threaded per period like
    `bucketStateByService` (`:202`):
    - issue the first block in the start period (advance charge);
    - draw synthetic hourly quantities (`simulateHourlyCharges` `:980-1060`) against the simulated
      balance;
    - when the balance crosses exhaustion or the threshold, emit the next block charge in that
      period;
    - expire the block at its anniversary;
    - price the remainder at the overage rate.
  - `snapshotContractToScenario.ts:556-562` carries the block config.
  - `contractSimulation.interfaces.ts:140` gets a block-line field.
  - `buildSimulatedPeriod` (`:1091-1170`) maps "Prepaid block issued" and "Block draw" lines.
- **Accounting export.** No code change is expected. A block invoice line carries
  `service_id = sold_as_service_id` and exports through `resolveServiceMapping`
  (`packages/billing/src/services/accountingMappingResolver.ts:53-91`), like ad-hoc block lines
  (`hourBlockActions.ts:242`). It is a test item. The $0 consumption lines carry the block's service
  (`computeHourBlockCharges.ts:12`); verify that adapters accept them (QuickBooks
  `quickBooksOnlineAdapter.ts:469-491`, Xero `xeroAdapter.ts:481-502`).

### 9. Tests

- **Unit, burn engine** (`shared/billingClients/__tests__/hourBlockService.db.test.ts`):
  - Contract target only draws its own line's blocks.
  - Contract B time and non-contract time never draw contract A's blocks.
  - Ad-hoc blocks are never drawn by contract time.
  - Pending gap draw after active blocks.
  - Overflow beyond the pending block stays unallocated.
  - `reconcileLineAllocations` idempotence.
  - Release on void.
- **Engine:**
  - `loadTimeBasedObligation` bills only unallocated minutes at the line rate.
  - Pending-allocated entries are held, not invoiced.
  - Contract consumption info line marks covered entries invoiced.
  - The `prepaid_block` charge carries hours × (price ÷ hours) with total = price.
- **DB, lifecycle:**
  - Generate creates a pending block linked to the charge, with expiry from the invoice date.
  - Finalize activates and schedules the expiry issuance.
  - Delete or void releases allocations and re-dues date issuances.
  - Unfinalize refuses when the block is used.
  - Double generation of one issuance fails.
- **Due work:**
  - The block row appears at the start date with its amount and groups with the contract's
    in-advance Fixed rows in the same window.
  - Expiry and renewal rows appear on their dates.
- **Replenishment:**
  - Exhaustion via `PREPAID_BLOCK_USAGE_CHANGED` drafts exactly one follow-on.
  - A second trigger while pending is a no-op.
  - `auto_issue` finalizes and activates at finalize, not at payment.
  - A threshold trigger fires once per block.
  - The horizon suppresses near an end date.
- **Jobs:**
  - Expiry with an `auto_expiration` audit row.
  - Contract-end forfeiture with a `contract_end_expiration` audit row.
  - The expiring-soon notification includes contract blocks.
- **Clone:** template → client contract carries the config through both clone routines; a preset
  copy carries it.
- **UI and contract tests:** wizard submission, the custom-line dialog, the line card panel, the
  Hour Blocks source label, the portal card.
- **Acceptance (Ryan's scenario, DB integration test plus a manual smoke):**
  1. 40 h / Remote Support $110 / $4,400 / 12 months / exhaustion + expiry.
  2. Invoices shows $4,400 on the start date; finalize leaves 40 h active.
  3. Log 38 h: 2 h remain and nothing bills hourly.
  4. Log +5 h: a follow-on is drafted and the MSP notified, with 3 h on the pending block;
     finalize leaves 37 h. If voided instead, the 3 h bill at $110 on the next arrears invoice.
  5. At the anniversary with 10 h unused: notice ahead, `auto_expiration` forfeits 10 h, and a new
     $4,400 row is due.
  6. Time on an uncovered service bills through the contract's other lines.
- Typecheck plus the existing billing, jobs and portal suites stay green.

## Out of scope (separate cards)

- Blocking In Advance on Hourly and Usage lines (server, custom-line dialog, inline edit).
- A warning on "Sell block" when a client contract line already covers the service.
- Pool presentation fixes ("included hours" copy, pools on Fixed lines in the wizard, overage
  default).
- The bucket top-up gap. Bucket-scoped replenishment blocks can never be drawn because bucket time
  is contract-covered (`prepaidAutoReplenishment.ts:144` scopes to the bucket service, while
  `hourBlockService.ts:190,205` rejects contract time). D3 fixes this only for *contract-issued*
  blocks; bucket top-ups keep `contract_line_id` null.
- Priced bucket pools (rejected).
- Rollover of unused block hours (Ryan: none).
- Ad-hoc block currency resolution (`hourBlockActions.ts:322,397` uses
  `client.default_currency_code || 'USD'`). It is noted, but only contract blocks change here.
- Copying lines into renewal drafts (`createRenewalDraftForQueueItem` creates an empty contract);
  this is a general renewal gap.
- `usage_tracking` (unit) draw-down. Time entries only, as for ad-hoc blocks.

## Risks

1. **Ambiguous resolution starves the block.** If a client has two active lines covering the same
   service, entries don't resolve deterministically (`getEligibleContractLineCountForServiceAtDate`
   ≠ 1), so they neither draw the block nor bill on the line until attributed. That is existing
   behaviour, but more visible now. Mitigation: the block config action warns when a covered service
   is also on another active line for the client.
2. **Price vs. unit rate rounding.** `invoice_charges.quantity` and `unit_price` are bigint
   (`server/migrations/202409071803_initial_schema.cjs:619-621`). For prices not divisible by the hour
   count, quantity × unit ≠ total. The manual-invoice path used by ad-hoc blocks
   (`persistManualInvoiceCharges`, `hourBlockActions.ts:238-250`) must be checked for how it
   represents fractional hours and authoritative totals. If quantity cannot hold fractional hours,
   restrict `block_minutes` to whole hours in v1 and say so in the UI.
3. **Activation timing divergence.** Replenishment invoices defer activation to payment
   (`invoiceModification.ts:1014-1021`). The brief requires finalize-activation for contract blocks.
   The exemption must be precise, so bucket and credit behaviour is unchanged. Covered by tests.
4. **Held entries.** Entries allocated to a long-pending block stay uninvoiced. If a draft is
   abandoned (neither finalized nor deleted), that time is never billed. Mitigation: the line card
   and the existing stale-draft surfaces show the pending block's age. Add a recurring-approval
   warning, modelled on `stale_project_billing_ready_entries`
   (`packages/billing/src/actions/recurringApprovalBlockers.ts:25-75`), for pending contract blocks
   older than 14 days that have held allocations.
5. **Window mapping for back-dated contracts.** A contract start in an already-invoiced cycle maps
   the first block to the next uninvoiced window (§5), so the row's window differs from the due
   date. The row shows the due date explicitly.
6. **Lock discipline.**
   - New writers of `hour_blocks` (issuance generation, release, contract-end expiry, reassignment)
     must take `FOR UPDATE` in canonical `block_id` order, per `hourBlockService.ts:217-229`.
   - The issuance and config locks are always taken *before* block locks, to stay deadlock-free
     against the burn path. A lock-discipline test extends `packages/billing/tests/hourBlockLockDiscipline.db.test.ts`.
7. **Event-path cost.** Publishing on every block-drawing save adds a client-scoped
   evaluate/replenish/deliver run. It runs post-commit and asynchronously, and is cheap because it is
   scoped to one client and only block subjects. The daily scan remains the correctness backstop.
8. **Captain decisions 1–2** change trigger and forfeiture behaviour materially. Implement does not
   start on §6 renewal and contract-end before they are confirmed.
