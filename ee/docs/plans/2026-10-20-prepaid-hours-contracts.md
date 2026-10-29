# Prepaid hours on contracts: block fee in advance, overage in arrears — design of record

- **Card:** 60482d29 · **PSA ticket:** alga-2026-0002684 · **Design session:** 2026-10-23 (card opened 2026-10-20)
- **Stacked on:** card 788d772d, shared contract charge resolution (`ee/docs/plans/2026-10-20-shared-contract-charge-resolution/`).
- **Inputs:**
  - the card brief;
  - the ticket's internal notes "Internal analysis (1 of 2)" and "(2 of 2)";
  - the parent card's PRD and scratchpad;
  - `docs/plans/2026-10-13-prepaid-block-invoicing-plan.md` (card 737bde61, merged to `main` as PR #3731 on 2026-10-20 and follow-up PR #3815 on 2026-10-22).
- **Status:** design of record. No product code is written in this step.

Code references:
- **Worktree base:** paths without a qualifier are the parent branch head `a47e08b616` (based on `main` `a62fafbcb5`).
- **`main`:** paths marked **(main)** are on `origin/main` `e9da92a7f5`. They are not yet in this worktree (see R1).
- **Line numbers** go stale on rebase. Function names are the durable reference.

---

## 1. The need, in product terms

A standard MSP block-hours agreement, like a ConnectWise prepaid agreement, has three parts:

| Charge | Example | When it bills |
|---|---|---|
| Service desk fee | $1,500/month fixed | in advance (already works) |
| Prepaid block | 10 h/month at $1,500 | in advance, every billing period |
| Overage | hours over the block at $150/h | in arrears, on the next invoice |

The first invoice is dated 1 Nov: $1,500 fee + $1,500 Nov block = **$3,000**. With 14 h logged in November, the 1 Dec invoice is $1,500 fee + $1,500 Dec block + 4 h × $150 Nov overage = **$3,600**. The simulator must show the same numbers for the saved contract without manual edits. The block's hours and price are configured in one place.

## 2. What exists, and what changed since the card was written

The card brief was written against `main` `a62fafbcb5`. Since then `main` has gained a **Prepaid Block contract line** (PR #3731, plan `docs/plans/2026-10-13-prepaid-block-invoicing-plan.md`). This changes the right answer to the brief's merge question.

### 2.1 Prepaid Block line (main)

**Storage:**
- An Hourly line plus one row in `contract_line_prepaid_blocks`:
  - `block_minutes`, `block_price` (minor units, contract currency), `sold_as_service_id`, `expiry_months`;
  - triggers `trigger_on_exhaustion`, `trigger_threshold_percent`, `trigger_on_expiry`, `trigger_on_renewal`;
  - `replenishment_tier`.
- Template and preset twins: `contract_template_line_prepaid_blocks`, `contract_line_preset_prepaid_blocks`.
- Migrations (main): `server/migrations/20261013163910_create_prepaid_block_tables.cjs`, `20261013163920_prepaid_block_hour_block_extensions.cjs`.

**How a block is issued:**
- Each block is a row in `hour_blocks` with `source_type = 'contract'` and `contract_line_id` set.
- Issuance is consumption- or date-driven through `contract_line_block_issuances` (trigger kinds: `contract_start`, `exhaustion`, `threshold`, `expiry`, `renewal`, `manual`).
- The fee is a `prepaid_block` charge (`IPrepaidBlockCharge`), loaded by `BillingEngine.loadPrepaidBlockIssuanceCharges` (main) from `schedule:{tenant}:prepaid_block:{issuanceId}` selections.

**Draw-down and overage:**
- Draw-down goes through the hour-block ledger (`shared/billingClients/hourBlockService.ts`: FIFO by `expiration_date`, `hour_block_time_allocations`).
- Overage is the line's own hourly rate, billed in arrears by the hourly loader after subtracting block-allocated minutes.
- $0 consumption lines come from `calculateContractLineHourBlockCharges` (main).

**What is already in place:**
- Bucket pools are refused on a block line, and the reverse (`bucketPoolActions.ts`).
- UI: wizard, contract line panel, template wizard, template detail and presets (`PrepaidBlockConfigFields.tsx`, `PrepaidBlockPanel.tsx`, `PrepaidBlockLinesEditor.tsx`, `TemplatePrepaidBlockPanel.tsx` (main)).
- Reporting: the hour-block grid on Contract Reports, with `hourly_rate` and `currency_code` per block (`getHourBlockUsageReport`, main).
- Client portal cards: `HourBlocksCard.tsx`, `PrepaidHoursCard.tsx`.
- Simulation: a separate per-line branch, `simulatePrepaidBlockLine` with `prepaidBlockTimeline.ts` (main). It runs **outside** the shared resolver.
- That plan's out-of-scope list says **"Priced bucket pools (rejected)"** and **"Rollover of unused block hours: none"**.

### 2.2 Why the Prepaid Block line does not yet meet this card's acceptance

| Gap | Effect on the example |
|---|---|
| No **per-period** issuance. Blocks are issued on consumption (exhaustion/threshold) or on an anniversary of the *invoice date* (`expiry` trigger, scheduled only when the previous block is finalized: `scheduleExpiryIssuanceForActivatedBlock`, main). | **Exhaustion trigger on:** the 14 h in November issue a second block, the 4 h draw it, and 1 Dec is $3,000 with no overage. **Exhaustion off, expiry on (1 month):** the Dec block's due date follows the Nov invoice's *date* and its finalize. Dating the invoice 3 Nov moves every later block to the 3rd, and an unfinalized Nov invoice issues no Dec block. |
| No block validity start. A block is drawable by any of its line's time up to `expiration_date`. | A Dec block can absorb late-entered November time (nightly `reconcileLineAllocations`), which turns billable Nov overage into prepaid hours. |
| No rollover. | The brief's rollover/expiry rule is missing. |
| The fee and the draw-down are outside the shared resolver: engine (`loadPrepaidBlockIssuanceCharges`, `calculateContractLineHourBlockCharges`, the allocation subtraction in `loadTimeBasedObligation`) and simulator (`simulatePrepaidBlockLine`) each carry their own rules. | Exactly the drift the parent card exists to end. There are no parity cases. |
| Reports and portal show hours. The dollar value of remaining hours is not shown (portal) or not derived (report has rate and currency only). | Brief scope 3. |

### 2.3 Contract bucket pools (unchanged by this card)

`contract_line_buckets` and `bucket_usage` are a **per-period included allowance with no price**. Overage is billed at the pool's `overage_rate` (`computeBucketCharges`, always arrears). The included hours are paid for by whatever fixed fee the MSP sets. `allow_rollover` carries one period of unused base allowance (`findOrCreateCurrentBucketUsageRecord`, `computeBucketPeriodState`).

## 3. Decisions

### D1. Merge with hour_blocks: yes. Extend the Prepaid Block line; do not price bucket pools.

The brief asks us to decide between merging with hour_blocks and keeping the two separate. **Decision: merge.** The priced prepaid-hours item is the Prepaid Block line on the hour-block ledger, extended with a per-period issue mode (D2). `contract_line_buckets` gets **no price columns**.

Rationale:
1. **One prepaid ledger.**
   - `main` already moved contract prepaid hours onto `hour_blocks`.
   - Pricing `contract_line_buckets` would create a third prepaid concept: ad-hoc blocks, contract blocks, priced pools.
   - Each would have its own draw-down, expiry, reports, portal cards and cancellation story.
   - The reasons the ticket gives for the three-line workaround breaking (block size, rollover value, cancellation) are all ledger properties. The hour-block ledger already has them: `remaining_minutes`, `hourly_rate` as value per hour, expiry, audit, forfeiture at contract end.
2. **The price belongs to what is prepaid.**
   - A block is a purchase: it has a price, an invoice line, a remaining balance and a value.
   - A bucket pool is an allowance included in some other fee.
   - Merging the two would make every pool answer "what did these hours cost?", which unpriced pools cannot do.
3. **The decision is already ratified.** The merged plan rejected priced bucket pools three days ago, with captain sign-off on its open decisions. Reversing that would leave two shipped designs for one need.
4. **What each concept is now:**
   - **Bucket pool:** "N hours included in the fee, overage at R". Unpriced; unchanged.
   - **Prepaid Block line:** "N hours sold for P, overage at the line's hourly rate". Issued either per period (new) or on consumption (existing).
   - **Ad-hoc block:** a one-off purchase outside contracts. Unchanged.

**Existing contract pools are not migrated.** Their data, behaviour and invoices stay byte-identical. That satisfies "migrate existing contract pools without changing what they bill today" trivially. Automatic conversion would have to invent a price, so it is a non-goal (§5). The "Sell block" note shown in bucket editors (`SellHourBlockNote.tsx`) is reworded to point to a Prepaid Block line billed every period.

### D2. New issue mode on the block config: `cadence` ("every billing period")

`contract_line_prepaid_blocks.issue_mode`:
- **`consumption` (default, existing rows):** today's trigger-driven behaviour, unchanged.
- **`cadence`:** one block per service period of the line's cadence, billed **in advance**. It is valid for that period plus `rollover_periods` more periods.

In cadence mode the consumption triggers do not apply. A CHECK enforces `trigger_on_exhaustion = false`, `trigger_threshold_percent IS NULL`, `trigger_on_expiry = false`, `trigger_on_renewal = false` and `expiry_months IS NULL`.
- Expiry comes from the period and the rollover rule (D5).
- The issuance sync (`syncPrepaidBlockIssuancesForContractLine`, main) creates no issuances for cadence lines. It cancels open ones when a line switches mode.

The block is one config row, so changing the block size or price is one edit. It applies from the next unbilled period (D9).

### D3. Cadence blocks are recurring service periods, not issuances

The block fee for period P is a `recurring_service_periods` row with:
- `obligation_id` = the contract line;
- `charge_family = 'prepaid_block'`;
- `due_position = 'advance'`;
- `cadence_owner` = the line's.

Why this, and why the merged plan's D2 objections do not apply to cadence blocks:
- **"The engine allows one due period per line per window."** This card changes that interface (D4). It is the "change the interface rather than work around it" the brief requires.
- **"Cadence regeneration retires future rows per line, destroying dated block obligations."** Cadence blocks are *meant* to follow the cadence. Regeneration regenerating them is the correct behaviour (D4.3).
- **"A block is a dated one-off obligation."** That is true for consumption blocks, which stay issuances. A cadence block is a recurring obligation, the same shape as an advance fixed fee.
- **What we get for free:**
  - client and contract cadence;
  - first and last partial periods with `coverageRatio`;
  - due-work listing;
  - invoice-window grouping with the fixed advance fee;
  - duplicate-claim protection (`linkRecurringServicePeriodToInvoiceDetail`);
  - the service-periods UI;
  - repair tooling.

  Re-deriving any of these in `contract_line_block_issuances` would be the duplicate layer the leverage rules warn against.

**Block fee timing is always advance.** "Prepaid" means paid before use. "Timing per charge" is met as follows:
- The fee charge is advance by rule.
- The overage charge (the line's hourly time) is arrears by rule (`resolveEffectiveBillingTiming`).
- Neither inherits the other's timing from the line.

Because block lines are Hourly lines, which a DB CHECK forbids from being advance, the fee schedule key `schedule:{tenant}:{lineId}:{cadenceOwner}:advance` can never collide with the line's own `…:arrears` key. **No schedule-key format change.** An arrears block fee is a non-goal. If it is ever wanted, the key must first become family-aware (R6).

### D4. Interface change in the parent's shared layer: due timing per (obligation, charge stream), not per line

The parent left `TimingRequest.duePosition: 'line' | 'advance' | 'arrears'` as the hook (`chargeResolution/types.ts`). Both sources reject non-`line` values. A due *position* alone cannot identify the record: what is due is a specific persisted period of a specific stream. Changes:

**1. Port** (`packages/billing/src/lib/billing/chargeResolution/types.ts`)
- Replace `duePosition` with `stream: 'line' | 'prepaid_block'`.
- `TimingRequest = { policy, stream }`.
- `resolveTiming` returns the due period of that stream for the source's invoice window, or `not-due`.
- The due position is a property of the stream, decided once by materialization (`resolveEffectiveBillingTiming` for `line`; `'advance'` for `prepaid_block`). It is never decided by a family.

**2. Engine selection**
- `RecurringChargeTimingSelections` (billingEngine, today `Record<lineId, timing>`) becomes keyed by `(lineId, stream)`.
- `loadPersistedRecurringTimingSelections` and `buildRecurringTimingSelectionsFromPersistedRecords` group by `(obligation_id, charge_family → stream)`. The "multiple persisted due periods matched one runtime obligation" guard stays, but per stream.
- A line is processed when **any** of its streams is due in the window. The 1 Nov invoice has the block stream due and no hourly stream due.
- `DatabaseChargeSource` receives the per-stream map. The `recurringTimingSelection` input becomes `recurringTimingSelections: Partial<Record<Stream, ResolvedBillingTiming>>`.

**3. Materialization**
- Each materializer asks one function, `contractLineRecurringStreams(line, blockConfig)` (new, next to `resolveEffectiveBillingTiming` in `shared/billingClients/contractLineTimingRule.ts`), for the streams to generate:
  - `[{family: lineFamily, duePosition: effectiveTiming}]`;
  - plus `{family:'prepaid_block', duePosition:'advance'}` when `issue_mode = 'cadence'`.
- Every materialize, regenerate or retire path loops over streams:
  - `clientCadenceScheduleRegeneration.ts`;
  - `contractCadenceServicePeriodMaterialization.ts`;
  - `clientCadenceWindowMaterialization.ts`;
  - `recurrenceStorageModel.ts`;
  - `recurringServicePeriodSync.ts` (`syncRecurringServicePeriodsForContractLine`, `retireFutureClientCadenceRowsForLine`).
- `resolveRecurringChargeFamily` stays the line family; it is no longer the only family per line.
- **Leverage:** there are three copies of `resolveRecurringChargeFamily` (main plan D1). Fold them into `contractLineRecurringStreams` in the same change, and mark any copy left behind `// LEVERAGE: pattern line-recurring-streams`.

**4. Simulator**
- `generateLineServicePeriods` (`ee/server/src/lib/billing/simulator/hypotheticalPeriods.ts`) generates per stream, through the same `contractLineRecurringStreams`.
- `loadSimulationCalculationInput` builds **one `ScenarioChargeSource` per (line, invoice window)**, carrying the map of stream → timing. Today it builds one per (line, service period record).
- The engine already works per (line, window). This removes the last structural difference between the two callers.

**5. Registry** (`chargeResolution/registry.ts`)
- Every existing entry gets `stream: 'line'`. Behaviour is unchanged and must be proven by the parent's parity suite plus its invoice-line dump (`CHARGE_RESOLUTION_DUMP`), which must stay byte-identical.

### D5. Block validity window and rollover

`hour_blocks` gains `valid_from date NULL`:
- Null = no lower bound (all existing rows).
- Cadence blocks set it to the service period start.

The burn rule becomes `(valid_from IS NULL OR valid_from <= workDate) AND (expiration_date IS NULL OR expiration_date >= workDate)`. It sits beside the existing expiration predicate in `shared/billingClients/hourBlockService.ts` (main ~:569; also `getAvailableHourBlockMinutes*` ~:1147/:1181). It covers allocation, reconcile and availability. This guarantees November time never draws the December block, even when entered late or re-drawn by the nightly reconcile.

**Rollover:** `contract_line_prepaid_blocks.rollover_periods smallint NOT NULL DEFAULT 0`, CHECK `0 ≤ n ≤ 12`, and `= 0` unless `issue_mode = 'cadence'`.
- A cadence block's `expiration_date` = the last day of its service period advanced by `rollover_periods` periods of the line's cadence. Compute it with the same cadence helpers the materializer uses, not with month arithmetic.
- FIFO by `expiration_date` (existing) draws carried hours before the current block.
- Unused minutes expire through the existing `expiredHourBlocksHandler` (`auto_expiration` audit).
- `rollover_periods = 0` is "use it or lose it". `1` matches the bucket pool's one-period rollover.

**Product question picked:** rollover is expressed as "carry unused hours for N more periods", with no cap on the hours carried. The hours carried are bounded by the block size anyway, and N counts periods, not months, so quarterly cadences read correctly.

### D6. Proration of partial periods

The ticket's analysis left open how a mid-period start prorates the block. **Picked:** cadence blocks follow the line's `enable_proration`, the same switch the fixed fee uses.
- **Proration on:** a partial first or last period issues a block with `round(block_minutes × coverageRatio)` minutes at `settle(block_price × coverageRatio)`. Use the same rounding helper as fixed proration (`computeFixedCharges.ts` settlement helpers), so the block and the service desk fee prorate identically. The block's `hourly_rate` (value per hour) is unchanged.
- **Proration off:** the full block is issued for the partial period.

Hours and price always scale together, so value per hour never changes.

### D7. Charge families in the shared resolver

All prepaid-block rules move into the resolver, once. The resolver is fed by both sources.

**1. New registry family `prepaidBlock`**
- Order: after `fixed`, before `hourly`. The block is a fee and invoices read fee-first.
- Timing `{policy: 'recurring', stream: 'prepaid_block'}`.
- It also covers **consumption-mode issuances** selected in the window: the port gets `prepaidBlockIssuances()`. This retires `loadPrepaidBlockIssuanceCharges`' private path and `simulatePrepaidBlockLine`'s fee path.
- Facts: `kind: 'prepaidBlock'` with `blockMinutes`, `blockPrice`, `soldAsService` (tax rate id, name), `coverageRatio`, `servicePeriodRecordId | issuanceId`, `currencyCode`, `prorate`.
- Compute module: `compute/computePrepaidBlockCharges.ts`, emitting the existing `IPrepaidBlockCharge` (`type: 'prepaid_block'`, `quantity` = hours, `rate` = price ÷ hours, `total` = price, `billingTiming: 'advance'`), plus `servicePeriodStart/End` and `servicePeriodRecordId` for cadence blocks.

**2. Draw-down as a resolver demand on hourly**
- `PooledTimeExclusion` generalises to a **`PrepaidCoverage`** demand: pooled services (bucket pools) plus block-covered minutes.
- **Database source:** subtracts `hour_block_time_allocations` minutes for active or expired blocks, and holds entries drawn by pending blocks. These are main's existing rules in `loadTimeBasedObligation`, moved behind the demand. They are not re-implemented.
- **Scenario source:** subtracts the simulated draw (D7.4).

**3. $0 consumption lines**
- These are the `hour_block` charges from `calculateContractLineHourBlockCharges` (main).
- They become a resolver family `hourBlockDraw` with stream `line` (arrears window).
- The database source supplies burn rows. The scenario source supplies simulated draws. Both use `computeHourBlockCharges` (already pure).

**4. Scenario block state**
- `ScenarioChargeSource` threads simulated blocks in `ScenarioRunState`, next to `poolStates`.
- Generalise `prepaidBlockTimeline.ts` (main) into a ledger model: issue (cadence period or consumption trigger), validity window, FIFO by expiry, rollover, expiry. Keep the threshold and anniversary helpers it already shares with the live code.
- Assumed hours per period draw in date order inside the period.
- **Known approximation:** the simulator has no per-entry dates or rounding. This is the same known gap the parent recorded as `per-entry-vs-aggregated-hours`. Parity cases use whole-hour entries.

**5. Rule of record**
- After this card, `grep` finds no prepaid-block charge selection in `billingEngine.ts` or `ee/server/src/lib/billing/simulator/` outside the two sources' data-supply methods.
- Adding the family touches the parent's four points: registry entry, facts `kind`, `calculateContractChargeImpl` case, compute module.
- It also touches a fifth, honestly declared: the port's data methods.

### D8. Posting, invoice and billing-run touch points

| Area | Change |
|---|---|
| `invoiceService.persistInvoiceCharges` (`prepaid_block` branch, main) | Cadence charge: insert the `invoice_charges` row plus an `invoice_charge_details` row carrying `service_period_start/end` and `billing_timing = 'advance'`. Create the block through the existing helper (`createPendingHourBlockForInvoiceCharge`, main `pendingHourBlockService.ts`) with `valid_from`, `expiration_date` (D5), `service_period_record_id`, `hourly_rate = round(price ÷ hours)`, `purchase_amount = price`, and currency = `contracts.currency_code`. Claim the period through `linkRecurringServicePeriodToInvoiceDetail` (record id is per stream, so it does not collide with the hourly claim). Then `reconcileLineAllocations`. |
| `hour_blocks` | Add `valid_from date NULL` and `service_period_record_id uuid NULL` (soft reference, like `issuance_id`; Citus colocation differs). Widen the `source_type = 'contract'` CHECK to allow either `issuance_id` or `service_period_record_id`. |
| Finalize / unfinalize / delete / void (`invoiceModification.ts`, `voidInvoiceActions.ts`, main) | Unchanged rules. Activation on finalize (`activateHourBlocksForFinalizedInvoice`). `scheduleExpiryIssuanceForActivatedBlock` returns `not_configured` for cadence lines. Deleting or voiding a draft voids the pending block, releases its allocations, and returns the period to an unbilled state through the existing unclaim path (`releaseRecurringServicePeriodInvoiceLinkageForInvoice`, `invoiceModification.ts`, main). **No issuance is re-due.** |
| Duplicate guard (`BillingEngine.hasExistingServicePeriodCharge`) | Extend the `charge_family = 'fixed'` predicate to `('fixed','prepaid_block')` per stream. Mirror it in `pricing/isPeriodAlreadyInvoiced.ts`. |
| Due work (`billingAndTax.getAvailableRecurringDueWork`, `AutomaticInvoices.tsx`) | The block stream lists as an ordinary advance period with an amount. It groups with the fixed advance fee in the same window (`groupDueServicePeriodsForInvoiceCandidates`). Show the charge family label "Prepaid block". |
| Arrears-only repair (`server/migrations/20261013120000_hourly_usage_lines_bill_in_arrears.cjs` is history; `packages/billing/src/actions/arrearsOnlyLineRepair.ts` and `repairAllRecurringServicePeriodsForTenant` are live) | **Must exclude `charge_family = 'prepaid_block'`.** They supersede *any* advance row of an Hourly line today, so they would destroy every cadence block period. Covered by a test. |
| Invoice wording | Fee line: `"{line name} — prepaid block, {hours} h"`, with the service period shown by the period columns. Overage: time charges on a block line get the description suffix "(over prepaid block)". $0 consumption lines stay as they are. All wording is translated, in `features/billing` / invoice locale keys. Templates already expose `servicePeriodStart/End` and `billingTiming` on items (`invoice-template-ast/collectionDescriptors.ts`). The standard templates need no layout change. |
| Contract end / cancellation | Main's rule stands (captain decision 2): remaining block minutes are forfeited at the assignment end (`contract_end_expiration`). Materialization clips periods to the line and assignment bounds, so no cadence block is issued past the end. **No automatic credit for unused hours** (non-goal). The value is shown (D10), so a credit memo is one manual step on an amount Alga reports. |

### D9. Editing a live config

- **Block size or price edit:** applies to periods not yet billed. Billed periods keep their block. The `hour_blocks` row snapshots minutes, price and rate.
- **Mode switch `consumption` → `cadence`:**
  - cancels scheduled issuances;
  - leaves live blocks running to their own expiry;
  - materializes the stream from the next unbilled period.
- **Mode switch `cadence` → `consumption`:** retires future unbilled block periods, then schedules a `contract_start`-style issuance only if no live cadence block covers today.
- All switches run under the existing config lock, then the issuance lock, then block locks in `block_id` order (main plan R6).

### D10. Value of remaining hours (reports, portal)

Value = `remaining_minutes / 60 × hourly_rate` (minor units, block currency). It is computed in the action, never in the client, so currencies with zero or three decimal places round once. It is formatted with `formatCurrencyFromMinorUnits` and `useFormatters()`.
- **Contract Reports hour-block grid** (`ContractReports.tsx`, `getHourBlockUsageReport`, main): add a "Remaining value" column and "Valid from" next to "Expires". The column is shown by default.
- **Client billing dashboard (MSP)** (`ClientContractLineDashboard.tsx`) and the hour-blocks section (`HourBlocksSection.tsx`, `HourBlockDetailDrawer.tsx`): show remaining hours and value per block.
- **Client portal:**
  - `getClientHourBlocks` (`client-portal-actions/client-billing.ts`) returns `hourly_rate`, `currency_code`, `valid_from`;
  - `HourBlocksCard.tsx` and `PrepaidHoursCard.tsx` show "{{hours}} h left · {{value}}".
  - Portal visibility of money follows the existing billing-permission gate on the billing tab.

### D11. Authoring UI and templates

- **`PrepaidBlockConfigFields.tsx`** (main), shared by the wizard (`HourlyServicesStep`/`PrepaidBlockLinesEditor`), the contract line panel (`PrepaidBlockPanel`), the template wizard and template detail (`TemplatePrepaidBlockPanel`) and presets:
  - **"Issue blocks":** `CustomSelect` with "Every billing period" or "When the current block runs out or expires".
  - **Cadence mode:** "Unused hours" select ("Expire at the end of the period", "Carry over 1 period", … up to 12). The trigger fields are hidden. A read-only note says "Billed in advance each period. Hours over the block bill at the line's hourly rate on the next invoice."
  - Block hours, price (`CurrencyInput`, contract currency, minor units via `toMinorUnits`, never ×100) and sold-as service are unchanged and stay the single place they are set.
  - Every new control has a kebab-case `id`.
- **`ReviewContractStep` / `TemplateReviewContractStep`:** summary line, e.g. "10 h every month for $1,500, unused hours expire, overage $150/h".
- **Templates and presets:** add `issue_mode` and `rollover_periods` to `contract_template_line_prepaid_blocks` and `contract_line_preset_prepaid_blocks`. Copy them in the existing clone paths (template → contract, preset → line, line → template snapshot).
- **API schemas** (`server/src/lib/api/schemas/contractLineSchemas.ts` and the block-config schema, main): add the two fields.
- **Locale keys:** add under the existing `msp/contracts` prepaid-block keys and `features/billing`. Run `node scripts/validate-translations.cjs`, and check the pseudo-locale `xx`.

### D12. Simulator inputs

- `ScenarioPrepaidBlockConfig` (`packages/types/src/interfaces/contractSimulation.interfaces.ts`, main) gains `issue_mode` and `rollover_periods`.
- `snapshotContractToScenario` reads them for live lines and templates. `draftContractToScenario` reads them for wizard drafts.
- An unedited snapshot of a saved contract simulates cadence blocks with no manual overlay. That is the brief's acceptance.

## 4. Data model and migrations

All tables are tenant-scoped with composite keys, and Citus-safe in the style of the main migrations above. Migrations are created with `cd server && npx knex migrate:make <name> --knexfile knexfile.cjs --env migration`, timestamped after the newest on the rebased base.

| Migration | Content |
|---|---|
| `…_prepaid_block_cadence_mode.cjs` | `contract_line_prepaid_blocks`, `contract_template_line_prepaid_blocks`, `contract_line_preset_prepaid_blocks`: add `issue_mode text NOT NULL DEFAULT 'consumption'` with CHECK in (`consumption`,`cadence`), and `rollover_periods smallint NOT NULL DEFAULT 0` with CHECK `0..12`. Add the cadence CHECK (D2) and `rollover_periods = 0 OR issue_mode = 'cadence'`. Defaults keep every existing row's behaviour. |
| `…_hour_blocks_validity_and_period_link.cjs` | `hour_blocks`: add `valid_from date NULL` and `service_period_record_id uuid NULL`. Add CHECK `valid_from IS NULL OR expiration_date IS NULL OR valid_from <= expiration_date`. Replace the contract-source CHECK so `source_type='contract'` requires `issuance_id IS NOT NULL OR service_period_record_id IS NOT NULL`. Add index `(tenant, contract_line_id, valid_from)`. |
| `…_recurring_service_periods_prepaid_block_family.cjs` | Widen `recurring_service_periods_charge_family_check` to add `'prepaid_block'` (13 chars, fits `varchar(20)`). Add it to `RecurringChargeFamily` (`packages/types/src/interfaces/recurringTiming.interfaces.ts`). |

- **No data backfill.** No change to `contract_line_buckets`, `bucket_usage` or any existing invoice.
- **`down()`** drops the columns and the CHECK value. It refuses while any cadence config or `prepaid_block` period row exists, with an actionable message.

## 5. Non-goals

- Price columns on `contract_line_buckets`, or converting existing pools to blocks.
- An arrears block fee (D3).
- Automatic credit of unused prepaid hours at cancellation or contract end (D8). The value is shown instead.
- Cadence blocks on Usage lines, and `usage_tracking` draw-down (time entries only, as for every block).
- After-hours or burn multipliers on blocks.
- More than one block config per line (main's 1:1 stays).
- Changes to ad-hoc block rules or consumption-mode triggers beyond the mode switch.
- Renewal-specific behaviour for cadence blocks. They keep issuing while the assignment is active. Main's renewal re-ownership applies unchanged to live blocks.
- A cap on carried hours beyond `rollover_periods`.

## 6. Risks

- **R1. The base is stale and the parent conflicts with main.**
  - The parent branch (788d772d, at Human Review) is based on `a62fafbcb5`. Main has since changed `billingEngine.ts` (+417 lines), `loadSimulationCalculationInput.ts` (+284, the prepaid-block per-line branch the parent's rewrite removed) and the simulator snapshot/draft code.
  - **Implementation must not start until this branch sits on a parent that is rebased onto current main.**
  - If the parent's rebase keeps main's prepaid-block engine and simulator paths as out-of-resolver special cases, moving them into the resolver (D7) is this card's first work item, gated by the parity suite.
- **R2. Re-keying timing selections has a wide blast radius.** `RecurringChargeTimingSelections` is used by preview, generation, compatibility adapters and project runs. Mitigation: the parent's invoice-line dump across its 42 suites must be byte-identical before any cadence config exists.
- **R3. Advance rows on Hourly lines.** Live repair code treats any advance row on an Hourly line as corrupt (D8 row "Arrears-only repair"). A missed exclusion silently supersedes every cadence block period. Mitigation: a DB test that runs the tenant repair against a cadence line.
- **R4. Pending-block hold.**
  - The Dec block is pending until the 1 Dec invoice is finalized. Dec time drawn meanwhile is held (main rule), which is correct but visible.
  - A never-finalized draft holds time indefinitely. Main's mitigation (the stale pending-block warning) applies.
- **R5. Price ÷ hours rounding.**
  - `invoice_charges.unit_price` is integer minor units, so 10 h at $1,500 is exact but 7 h at $1,000 is not.
  - Main already treats `total_price` as authoritative.
  - Proration (D6) adds a second rounding. Use the fixed-fee settlement helper so the block and the fixed fee round identically. Parity tests include an indivisible case.
- **R6. Future arrears fee.** Allowing it later needs a family-aware schedule key: `parseRecurringServicePeriodScheduleKey` rejects extra segments today.
- **R7. Simulator approximation.** Whole-hour, per-period assumptions cannot reproduce per-entry rounding or late entry. This is the known gap the parent documented, so parity fixtures use whole-hour entries.
- **R8. Late time entry across periods.** `valid_from` (D5) is the guard. Without it, nightly reconcile moves billable overage onto the next block. Covered by a DB test.

## 7. Decisions later steps must honour

1. No price on `contract_line_buckets`. Prepaid hours live on the hour-block ledger via the Prepaid Block line. Existing pools are not touched or migrated.
2. Cadence blocks are `recurring_service_periods` rows (`charge_family = 'prepaid_block'`, `due_position = 'advance'`, `obligation_id` = line). Consumption blocks stay issuances.
3. Timing is resolved per `(line, stream)` through the port. `TimingRequest.duePosition` is replaced by `stream`. Engine and simulator build one source per (line, invoice window). A line is due when any stream is due.
4. One function, `contractLineRecurringStreams`, decides a line's streams for every materializer and for the simulator.
5. The prepaid-block fee, the block draw-down exclusion and the $0 draw lines are resolver families or demands. No prepaid-block selection logic stays in `billingEngine.ts` or the simulator outside source data methods.
6. Block fee timing is always advance. Overage is the line's hourly time, always arrears.
7. `hour_blocks.valid_from` bounds draw-down from below for cadence blocks. Rollover is `rollover_periods` of the line's cadence. Expiry uses the existing job.
8. Partial periods follow the line's `enable_proration`, scaling hours and price together with the fixed-fee rounding helper.
9. Contract end forfeits remaining minutes (main rule). There is no automatic credit. Value is shown in reports and portal.
10. Currency is always the contract currency, in minor units, with `CurrencyInput` / `formatCurrencyFromMinorUnits` / `toMinorUnits`. No `'USD'` defaults and no ×100.
11. The parent's existing invoice output must be byte-identical before the new family is exercised.
12. Plan artifacts and tests stay customer-neutral. The ticket number is the only pointer.

## 8. Acceptance (definition of done)

1. A contract starting 1 Nov with:
   - a Fixed advance line at $1,500;
   - a Prepaid Block line in cadence mode with 10 h at $1,500, overage (line hourly rate) $150/h, monthly, and `rollover_periods = 0`.

   The 1 Nov invoice is **$3,000**: a fixed fee line, and a prepaid-block line dated 1–30 Nov.
2. 14 h logged in November on the block line's services. The 1 Dec invoice is **$3,600**: Dec fee $1,500 + Dec block $1,500 + **4 h × $150 = $600** marked "(over prepaid block)", plus a $0 line showing 10 h drawn from the Nov block.
3. The simulator, on the **unedited** snapshot of that saved contract, shows the same two invoices line for line (parity suite).
4. Changing the block to 12 h / $1,800 in the one config form changes the next unbilled period's block and nothing billed.
5. Existing bucket-pool contracts, consumption-mode Prepaid Block lines and ad-hoc blocks invoice byte-identically to before (parent's dump plus main's prepaid-block acceptance suite `server/src/test/unit/billing/prepaidBlockAcceptance.db.test.ts`, main).
6. The hour-block grid and the client portal show remaining hours and value for cadence blocks.

## 9. Implementation checklist (features)

1. Rebase gate (R1). Port main's prepaid-block engine and simulator paths into the resolver, `consumption` mode only, with parity green.
2. Port change: `TimingRequest.stream`; per-stream selections in `BillingEngine`; `DatabaseChargeSource` and `ScenarioChargeSource` resolve streams. Registry entries use `stream: 'line'`.
3. Simulator: one source per (line, window); per-stream period generation.
4. `contractLineRecurringStreams` plus all materializers, regeneration and retire paths. Fold the `resolveRecurringChargeFamily` copies.
5. Migrations (§4) and type updates (`RecurringChargeFamily`, `IHourBlock`, block-config types, scenario types).
6. `prepaidBlock` family, facts kind, `calculateContractChargeImpl` case, and `computePrepaidBlockCharges.ts` (cadence and issuance, proration).
7. `PrepaidCoverage` demand on hourly (database subtraction moved from `loadTimeBasedObligation`; scenario simulated draw). `hourBlockDraw` family.
8. Scenario ledger model generalised from `prepaidBlockTimeline.ts` (cadence issue, validity, rollover, FIFO, expiry).
9. Posting: the cadence branch in `persistInvoiceCharges`, block creation with `valid_from` and expiry, period claim, reconcile.
10. Burn rule `valid_from` in `hourBlockService` (allocate, reconcile, availability).
11. Duplicate guard and `isPeriodAlreadyInvoiced` for `prepaid_block`.
12. Arrears-only repair exclusion for `prepaid_block`.
13. Issuance sync: no issuances for cadence lines; mode-switch handling (D9).
14. Due-work label and grouping for block periods.
15. Invoice wording (fee line, overage suffix) with locale keys.
16. Block config UI (`issue_mode`, rollover) across wizard, line panel, template wizard and detail, presets, review steps. API schemas.
17. Template, preset and line clone paths carry the new fields.
18. Simulator snapshot and draft read the new fields.
19. Reports: remaining value and valid-from columns.
20. MSP client dashboard and hour-blocks section: value.
21. Portal action and cards: value.
22. `SellHourBlockNote` copy points to cadence blocks.

## 10. Test plan

**Parity cases**, added to the parent's `ee/server/src/__tests__/integration/contractChargeResolutionParity.integration.test.ts`: engine dry run vs simulator, line by line.
1. Cadence block, **advance fee**: the first window bills the block for its own period; the hourly stream is not due.
2. **Draw-down:** 8 h in the period gives no overage and no plain hourly charge, plus a $0 draw line.
3. **Arrears overage:** 14 h gives 4 h at the line rate in the next window, alongside the next period's block.
4. **Rollover:** with `rollover_periods = 1`, 6 h then 13 h gives no overage (4 h carried plus 9 h); with 0, 3 h overage.
5. **Acceptance:** fixed $1,500 plus block, 1 Nov / 1 Dec totals $3,000 / $3,600 on an unedited snapshot.
6. Mid-period start with `enable_proration`: prorated hours and price equal the prorated fixed fee's ratio, including an indivisible price.
7. Consumption-mode block (main behaviour) after the port: unchanged.

The engine side persists and finalizes the first window's invoice before dry-running the second, so the first block is active.

**Unit tests:**
- `computePrepaidBlockCharges` (proration rounding, indivisible prices, currency digits);
- `contractLineRecurringStreams`;
- the resolver's stream timing (`resolveContractLineCharges.test.ts`: a line due only on its block stream);
- validity and FIFO in the scenario ledger model.

**DB tests:**
- materialization creates both streams and regeneration keeps both;
- the arrears-only repair leaves `prepaid_block` rows alone;
- a late November entry never draws the December block (including nightly reconcile);
- the duplicate guard;
- mode switches;
- void and delete of a draft holding a cadence block;
- contract-end forfeiture of cadence blocks.

**Migration test:** defaults leave existing configs and blocks unchanged; `down()` refuses with live cadence data.

**UI tests:**
- the config fields (mode, rollover, hidden triggers, currency input in a non-2-decimal currency);
- the review summary;
- the report value column;
- the portal card value.

**Regression:** the parent's dump across its suites stays byte-identical, and main's prepaid-block acceptance suite stays green.
