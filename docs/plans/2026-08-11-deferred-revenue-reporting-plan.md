# Deferred revenue / prepaid liability reporting plan

Card 29.8.22 (Alga project task 721fbc5d-b781-4966-8194-5a0c42e1bd42).

## Problem

MSPs that collect money before delivering service carry a liability: client credit
balances (prepayment invoices, credit notes, manual grants) and unburned prepaid
bucket hours. There is no rollup answering "what is our total outstanding prepaid
liability across clients?" for month-end close. Credit *applications* sync to QBO as
zero-dollar payments (`creditApplicationApplier`), but credits sourced from
prepayment invoices are explicitly non-syncable (`resolveNonCreditMemoSource` raises
an export error for them), so Alga is the sole system of record for exactly this
liability. Accountants currently have nothing to tie out at close.

## Goals

- A per-client, per-month liability rollforward: opening balance, movement during
  the month (issued / applied / expired / adjustments), closing balance — split into
  a credits component and a prepaid-hours component, with a tenant-level total.
- Value unburned bucket minutes pro-rata against the fee actually billed for the
  bucket period, so the hours liability never exceeds cash received and ties to
  invoices.
- Per-client drill-down detail sufficient to prove any number: individual credits
  (remaining amount, expiration, source — flagging prepayment-sourced credits that
  never reach QBO) and individual bucket lines (remaining minutes, period, value).
- CSV download of the rollforward plus a printable view.
- All new UI gated behind the `release-v1.5-feature` feature flag; flag off
  preserves existing UI and behavior exactly.

## Non-goals

- No FX conversion: amounts are grouped and totaled per `currency_code`, never
  summed across currencies.
- No persisted snapshot tables and no schema migrations — every number is derived
  live from the existing ledgers.
- No QBO journal-entry export or sync changes; the report only *annotates* sync
  reachability.
- No client-portal exposure; internal MSP users only.
- No change to credit or bucket mechanics (issuance, application, expiration,
  rollover).

## Settled design decisions

1. **Scope: both components.** Credits and prepaid hours from v1.
2. **Hours valuation: pro-rata of the billed fee.** An unburned minute is worth
   `period fee ÷ included minutes`. Not the effective service rate (would overstate
   liability vs cash received) and not `overage_rate` (semantically the price of
   hours *beyond* the bucket).
3. **Time model: month rollforward.** A month picker; the report reconstructs any
   historical month from the ledgers.
4. **Placement: reports hub.** New page `/msp/reports/deferred-revenue` plus a card
   in the `/msp/reports` catalog (billing category). Not a billing-dashboard tab.
5. **Export: CSV + print.** Client-side CSV blob download of the per-client
   rollforward; `PrintButton`/`PrintableTable` for the print view.
6. **Drill-down: expandable client rows.** Component-level detail inline, no
   separate per-client page.

### Stated assumptions (decidable without further product input)

- **Consumption basis** for hours: mid-period remaining minutes count as liability
  even on non-rollover buckets (the card's "unburned prepaid hours valued at rate").
  Forfeiture is recognized only when a period actually ends.
- Rolled-over minutes are valued at the *current* period's per-minute rate (rollover
  carries at most one period, so drift is bounded and the simplification is
  defensible).
- Credit `credit_adjustment` and `credit_transfer` transactions appear in a single
  "adjustments" movement column (transfers net to zero at tenant level but move
  liability between clients).
- Zero-balance clients (no credits, no active buckets, no movement in the month) are
  omitted from the table.

## Data layer

New hand-written server action module in
`packages/reporting/src/actions/report-actions/` (the pattern the shipped report UIs
use; the declarative `ReportDefinition` framework cannot express a ledger
rollforward). One entry action, e.g. `getDeferredRevenueReport({ month })`, plus a
detail action for the expanded row if payload size warrants splitting. Follow the
existing report-action conventions (auth: internal user + permission check, error
shapes from `reportingActionErrors.ts`).

### Credits rollforward (per client, per currency)

Source: the `transactions` ledger joined to `credit_tracking`. Movement mapping for
month M:

| Column | Transaction types |
|---|---|
| Issued | `credit_issuance`, `credit_issuance_from_negative_invoice`, `prepayment` issuance rows |
| Applied | `credit_application` |
| Expired | `credit_expiration` |
| Adjustments | `credit_adjustment`, `credit_transfer` |

Opening = signed sum of all credit-affecting transactions dated before the start of
M; Closing = Opening + month movement. The implementer must verify the sign
conventions of each type against `creditActions.ts` / `expiredCreditsHandler.ts`
rather than assuming.

**Tie-out invariant:** for the current month, per-client Closing must equal
`availableCreditByClientQuery` from `packages/billing/src/lib/creditBalance.ts`.
Enforced in tests, and cheap enough to assert at runtime in dev.

### Hours rollforward (per client, per contract line)

Sources: `bucket_usage` period rows, `contract_line_service_bucket_config`
(`total_minutes`, `allow_rollover`), and `computeBucketPeriodState()` from
`packages/billing/src/lib/billing/compute/computeBucketCharges.ts` for
remaining-quantity semantics.

**Period fee** (the valuation numerator), in order of preference:

1. The billed invoice item for that bucket line and service period: `invoice_items`
   joined through `invoice_item_details.config_id` to the bucket line's
   `contract_line_service_configuration`, on a finalized invoice covering the
   period.
2. If not yet billed, the configured base fee for the line via the billing engine's
   rate-resolution order (custom_rate → pricing schedule → catalog default), clearly
   marked in the detail row as "not yet billed".

Per-minute rate = period fee ÷ (included minutes). Rollover minutes add to remaining
quantity but not to the denominator.

Movement for month M:

- **Issued** — value of allowances for bucket periods *starting* in M (their period
  fee).
- **Applied (burned)** — minutes consumed during M × per-minute rate. For periods
  fully inside M (the default monthly cadence) this is the period's `minutes_used`.
  For periods spanning month boundaries, derive in-month burn from the same dated
  sources `reconcileBucketUsageHandler` uses (time entries / usage records dated in
  M for that line+service).
- **Expired** — at each period end inside M: unused minutes that do not roll
  (non-rollover buckets), plus rollover minutes that lapse because rollover does not
  compound. Valued at that period's per-minute rate.
- **Opening / Closing** — remaining quantity valued as of the month boundaries.

Cap applied-value so a period's recognized revenue never exceeds its fee (overage
minutes are billed separately as overage and are not part of the prepaid liability).

### Report payload shape

Per client: `{ clientId, clientName, currencyCode, credits: {opening, issued,
applied, expired, adjustments, closing}, hours: {opening, issued, applied, expired,
closing}, total: {...} }` plus lazy/expanded detail: credit rows (from
`credit_tracking` + source classification per `classifyInvoiceCreditHandling` /
`resolveNonCreditMemoSource` logic — flag `qboReachable: false` for
prepayment-sourced and project-deposit credits) and bucket rows (line, service,
period, included/rollover/used/remaining minutes, per-minute rate, value, fee
source).

## UI

- **Page:** `server/src/app/msp/reports/deferred-revenue/page.tsx` — server
  component that checks `featureFlags.isEnabled('release-v1.5-feature', …)` and the
  user's permission; flag off → `notFound()`. Renders a client component from
  `packages/reporting/src/components/deferred-revenue/`.
- **Hub card:** add a `billing`-category entry to the `REPORTS` catalog in
  `packages/msp-composition/src/reports/Reports.tsx` (`kind: 'link'`, href to the
  new page), rendered only when the `release-v1.5-feature` flag is on
  (`useFeatureFlag`, `defaultValue: false`).
- **Report component:** month picker (default: previous month — the close month);
  summary stat row (total liability per currency, split credits vs hours, delta vs
  prior month); per-client table with movement columns and expandable detail rows;
  CSV download button (client-side blob of the flat rollforward, one row per
  client×currency, plus component columns); `PrintButton` + `PrintableTable`
  print view. Follow the dataviz/UI conventions of the existing report components in
  `packages/billing/src/components/billing-dashboard/reports/`.
- **Permissions:** internal users only, gated on the same permission resource the
  billing reports use (`hasPermission` with the `report` resource, mirroring
  `executeReport.ts`); server action enforces it independently of the page.

## Implementation steps

1. Build the credits rollforward query + unit tests against seeded
   `transactions`/`credit_tracking` fixtures, including the `creditBalance.ts`
   tie-out invariant and sign-convention coverage for every transaction type.
2. Build the hours rollforward: period-fee resolution (billed → configured
   fallback), per-minute valuation, issued/burned/expired/boundary math + unit tests
   covering rollover, non-rollover forfeiture, mid-period month boundaries, and the
   fee cap.
3. Compose `getDeferredRevenueReport` (merge components per client×currency, tenant
   totals) with permission enforcement and error shapes.
4. Build the report component: month picker, summary row, rollforward table,
   expandable detail, CSV download, print view.
5. Add the page route with server-side flag + permission gate, and the flag-gated
   reports-hub card.
6. Integration test (database-backed, per `integration-testing` conventions): seed a
   tenant with a prepayment credit, an applied credit, an expired credit, a monthly
   bucket with partial burn, and a rollover bucket spanning a month boundary; assert
   the rollforward for two consecutive months and that closing(M) = opening(M+1).
7. Verify flag-off behavior: no hub card, page 404s, no other UI affected.

## Risks

- **Sign conventions in `transactions`** are the likeliest source of silent error;
  the tie-out invariant against `creditBalance.ts` is the guard.
- **In-month burn for multi-month periods** is the hairiest derivation; if the dated
  sources prove unreliable, the acceptable v1 fallback is attributing a spanning
  period's burn to the month the period ends in, disclosed in the plan/PR.
- **Fee lookup via `invoice_item_details`** depends on charge linkage recently
  reworked (invoice-charge-linkage plan, 2026-08-08); the implementer should confirm
  the join path against a real generated invoice in the dev stack before building on
  it.
