# Fix the invoicing "Fix all" button and phantom materialization gaps

**Branch:** `fix/invoice-fixup-button`
**Date:** 2026-07-06
**Status:** Approved design, ready for implementation

## Problem

On Billing → Invoicing → Generate, the Nine Minds tenant
(`55f6a1b8-8ad9-42c7-ba39-a508dcaecd37`) shows a "These billing schedules need
to be rebuilt" banner with several entries for client AI Med Consult. Clicking
**Fix all** pops a dialog saying "Invoice generated successfully!" (a
non-sequitur), repairs nothing, and the banner never clears. There is no way to
resolve the entries from the UI.

## Verified root cause (production evidence, 2026-07-06)

All findings below were confirmed by readonly queries against the production
database through the `sebastian` pod, and against prod image `74addab7`
(2026-07-05), which contains current `main` — this is not a stale deploy.

The client under the banner is AI Med Consult
(`client_id 261c8ac2-df9a-42e4-91e6-e9b726ff0450`), whose contract
"Software Development Services" has a single client-cadence line
(`contract_line_id 64151f41-ebdb-40c9-bdfc-8da88bee999e`, Hourly,
monthly/arrears, contract start 2025-08-01).

The `recurring_service_periods` ledger for that line:

| service period | lifecycle_state | linked invoice |
|---|---|---|
| 2026-01 … 2026-05 (5 rows) | `billed` | INV001460, 1469, 1485, 1522, 1552 — all `sent` |
| 2026-06 | `superseded` (2026-06-24), **no replacement row** | none |

Five interlocking defects, one root cause:

1. **The invoice↔billing-cycle bridge is dead.** Since the recurring due-work
   cutover, invoice generation stopped stamping `invoices.billing_cycle_id`:
   in prod, *every* auto-generated invoice from April 2026 onward has
   `billing_cycle_id = NULL` (February/March invoices were linked). Two code
   paths still trust that linkage:
   - `buildAvailableBillingPeriodsBaseQuery`
     (`packages/billing/src/actions/billingAndTax.ts:276`) treats a
     `client_billing_cycles` row as "available" while no invoice references its
     `billing_cycle_id` → every cycle since August 2025 stays in the candidate
     pool forever.
   - `loadLastInvoicedClientBillingBoundary`
     (`shared/billingClients/clientCadenceScheduleRegeneration.ts:260`) →
     returns `null` for this client.

2. **Gap detection ignores billed rows.** `getAvailableRecurringDueWork`
   (`packages/billing/src/actions/billingAndTax.ts`, filter near line 1481)
   clears a detected gap only when a matching row exists among *due-state*
   rows (`fetchPersistedRecurringDueWorkDbRows` filters
   `whereIn('rsp.lifecycle_state', dueStates)` and
   `whereNull('rsp.invoice_charge_detail_id')`). Billed rows never clear a
   gap, so already-invoiced months (Jan–May 2026) are reported as "needs
   rebuild" forever.

3. **"Fix all" is a guaranteed no-op.** With the billed boundary `null`,
   `computeClientCadenceRegeneration`
   (`shared/billingClients/clientCadenceScheduleRegeneration.ts:437`) anchors
   `regenerationStart` at the obligation start (2025-08-01), and
   `materializeClientCadenceServicePeriods` generates only
   `asOf + 180 days` → Aug 2025–Jan 2026. `backfillRecurringServicePeriods`
   then skips all of those as historical (per-obligation billed boundary is
   2026-06-01), leaving zero future candidates → zero changes → "success".

4. **The same defect destroys data on contract-line saves.**
   `regenerateRecurringServicePeriods`
   (`shared/billingClients/regenerateRecurringServicePeriods.ts`, the
   `if (!candidate)` branch near line 177) supersedes any existing future row
   with no matching candidate. `syncRecurringServicePeriodsForContractLine`
   (`packages/billing/src/actions/recurringServicePeriodSync.ts`) runs this
   regeneration on every contract-line save. On 2026-06-24 a line save
   superseded the June 2026 row and — because the candidate window ended in
   January — inserted nothing. **June 2026 will silently never bill in the
   July arrears window. This is active revenue loss, not just a cosmetic
   banner.**

5. **The success dialog is wired to the wrong event.**
   `AutomaticInvoices.handleFixAllServicePeriods`
   (`packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`,
   ~line 831) calls `onGenerateSuccess?.()` to refresh the lists, but
   `GenerateTab.handleGenerateSuccess`
   (`packages/billing/src/components/billing-dashboard/invoicing/GenerateTab.tsx:69`)
   also opens the SuccessDialog "Invoice generated successfully!" — the exact
   message the user saw.

## Design decision

**Ledger-canonical, minimal scope.** `recurring_service_periods` reliably
records billing (`invoice_charge_detail_id` is set at generation; verified in
prod), so gap detection and the repair boundary read the ledger and stop
consulting `invoices.billing_cycle_id`. No prod data backfill: once deployed,
clicking Fix all heals the Nine Minds tenant itself.

The "available billing periods" pool keeps its current (broken-bridge)
semantics in this branch — see Out of scope.

## Implementation

### 1. Gap detection clears on any live or billed ledger row

`packages/billing/src/actions/billingAndTax.ts`, in
`getAvailableRecurringDueWork`:

- After computing `rawMaterializationGaps`, query `recurring_service_periods`
  for rows matching the gaps' `(schedule_key, period_key)` pairs with
  `lifecycle_state not in ('superseded', 'archived')` — i.e. including
  `billed` rows. Drop any gap with such a row. Keep the existing
  `executionIdentityKey` filter as well (it covers due rows already in hand).
- Additionally, suppress gaps that the repair cannot and should not touch:
  a gap whose `servicePeriodEnd` is on or before the schedule's ledger billed
  boundary (max `service_period_end` of billed rows for that `schedule_key`)
  is historical. This keeps the banner consistent with what Fix all actually
  does (the backfill skips those periods as historical), so "click Fix all →
  banner clears" is true. Without this rule, pre-ledger months (Aug–Dec 2025
  for AI Med Consult, which have no ledger rows at all) would show as
  unrepairable gaps forever.

### 2. Billed boundary from the ledger

`shared/billingClients/clientCadenceScheduleRegeneration.ts`,
`loadLastInvoicedClientBillingBoundary`:

Replace the `client_billing_cycles` ⋈ `invoices.billing_cycle_id` query with a
ledger read: max `service_period_end` over `recurring_service_periods` rows
where the obligation resolves to the client's client-cadence lines
(`obligation_type = CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE`,
`cadence_owner = 'client'`, join `contract_lines` → `contracts` →
`owner_client_id = clientId`) and the row is billed
(`lifecycle_state = 'billed'` or `invoice_charge_detail_id is not null`).

Callers keep the same semantics (`regenerationStart`,
`previewClientCadenceScheduleChange.billedPeriodsInRange`); only the source of
truth changes. Consider renaming to `loadClientBilledLedgerBoundary` so the
name stops implying the invoice join.

### 3. Generation horizon reaches the present

`shared/billingClients/materializeClientCadenceServicePeriods.ts`: the
generation range end currently derives from
`resolveRecurringServicePeriodGenerationHorizon({ asOf })` → `asOf + 180d`.
Change the horizon anchor to `max(asOf, materializedAt-date)` so coverage
always extends ~180 days past *today* while still starting generation at
`asOf`. `materializedAt` is already an input. Other callers pass `asOf ≈ now`,
for which this is a no-op — verify each caller of
`materializeClientCadenceServicePeriods` when implementing.

This makes the tenant-wide repair (`repairAllClientCadenceServicePeriodsForTenant`),
the per-schedule repair, and the contract-line sync all able to materialize
current periods regardless of how old the regeneration anchor is.

### 4. Supersede guard in `regenerateRecurringServicePeriods`

`shared/billingClients/regenerateRecurringServicePeriods.ts` (and its caller
`backfillRecurringServicePeriods.ts`): thread the generation coverage end
(the materialization `rangeEnd`) into the plan builder. An existing row whose
`servicePeriod.start` is on or after the coverage end is **preserved
untouched** — never superseded via the `!candidate` branch. Superseding is
only legitimate when the candidate set actually covers the row's period.

This is the invariant that stops contract-line saves silently deleting future
unbilled periods, independent of the horizon math in step 3. With step 3 in
place the situation should no longer arise; the guard makes the engine safe by
construction.

### 5. Fix-all UX honesty

- `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`:
  add an `onRefreshNeeded?: () => void` prop; `handleFixAllServicePeriods`
  calls it instead of `onGenerateSuccess?.()`.
- `packages/billing/src/components/billing-dashboard/invoicing/GenerateTab.tsx`:
  pass a refresh-only callback (bump `internalRefreshTrigger` + propagate the
  parent refresh) that does **not** open the SuccessDialog.
- Result messaging in the gap panel:
  - repaired > 0: keep `materializationGap.fixAllResult`
    ("Rebuilt {{schedules}} schedule(s) across {{clients}} client(s).").
  - repaired == 0: new key `materializationGap.fixAllNoop`, e.g. "All billing
    schedules are already up to date. Anything still listed below needs
    individual review." (final copy at implementation time).
  - error/permission messages unchanged.
- Add the new key to every locale file
  (`server/public/locales/*/msp/invoicing.json`), translated per the repo's
  i18n conventions (including the `xx`/`yy` pseudo-locales).

## Tests

Follow the existing patterns in these files:

- `server/src/test/unit/billing/recurringDueWorkReader.integration.test.ts`:
  - a billed `recurring_service_periods` row clears the materialization gap
    for its schedule/period (reproduces the phantom-gap defect);
  - gaps at or before the schedule's billed ledger boundary are suppressed;
  - a superseded row without replacement still reports a gap (June scenario).
- New coverage for `clientCadenceScheduleRegeneration`
  (alongside `server/src/test/unit/billing/recurringServicePeriodBackfill.domain.test.ts`
  and `shared/__tests__/regenerateRecurringServicePeriods.test.ts`):
  - billed boundary derives from the ledger when `invoices.billing_cycle_id`
    is null everywhere (reproduces the dead-bridge defect);
  - repair on a client whose ledger is billed through month N materializes
    month N+1 … today+180d (reproduces the no-op Fix all);
  - end-to-end repair of the June scenario: billed Jan–May + superseded June
    with no replacement → repair inserts a fresh June row (and forward), and
    a second run is a no-op (idempotence).
- `shared/__tests__/regenerateRecurringServicePeriods.test.ts`:
  - existing rows starting at/after the coverage end are preserved, not
    superseded, when the candidate set ends early (reproduces the data-loss
    defect from contract-line saves).
- `server/src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx`:
  - Fix all does not open the invoice SuccessDialog;
  - the no-op message renders when the repair reports zero changes.

## Production verification runbook (after deploy)

Tenant `55f6a1b8-8ad9-42c7-ba39-a508dcaecd37`, client AI Med Consult,
line `64151f41-ebdb-40c9-bdfc-8da88bee999e`:

1. Billing → Invoicing → Generate. The banner should already have shrunk:
   billed months (Jan–May 2026) and pre-ledger months no longer listed.
2. Click **Fix all** → expect "Rebuilt 1 schedule(s) across 1 client(s)." and
   **no** "Invoice generated successfully!" dialog.
3. Banner disappears after refresh. DB check (readonly): new `generated` rows
   for service periods 2026-06 onward with `source_run_key` prefixed
   `client-schedule-change:`.
4. The June 2026 service period appears as due work in the July window
   (arrears); generate its invoice to recover the missed billing.
5. Regression probe: edit and save the contract line, confirm future rows are
   re-materialized (not superseded-without-replacement).

## Out of scope (documented follow-ups)

- **The dead `invoices.billing_cycle_id` bridge.** Stamping stopped at the
  April 2026 due-work cutover (prod: zero linked auto-invoices since April).
  The "available billing periods" pool therefore never shrinks, which at
  minimum wastes work and may inflate the Ready list's time-entry candidates
  (the "Ready 6" count on this tenant was not audited). Needs its own
  investigation: either retire the bridge everywhere (audit all consumers of
  `invoices.billing_cycle_id`) or restore stamping deliberately.
- Positional pairing of existing rows to candidates in
  `regenerateRecurringServicePeriods` (index-walk assumes aligned periods) —
  fragile but untouched here.
