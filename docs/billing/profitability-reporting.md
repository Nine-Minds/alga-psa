# Profitability Reporting

Profitability reporting lets MSP operators measure actual gross margin per client, per agreement, and per ticket. It replaces a legacy placeholder that used a hardcoded $50/hr labor cost and a broken invoice–time-entry join. The system previously had no internal labor-cost concept; this feature introduces one and builds reporting on top of it.

## Overview

Two capabilities ship together:

1. **Cost rate management** — A new Cost Rates section in Billing Settings stores fully-burdened internal labor cost rates. Rates can be per-user with effective-dated ranges, or a tenant-wide default that applies when no per-user rate is configured.

2. **Profitability report** — A rebuilt Profitability tab in Billing > Reports delivers a four-level drill-down: tenant summary, per-client, per-agreement (with per-contract-line breakdown), and per-ticket. Labor cost is computed from actual hours worked × the effective cost rate on the work date.

## Permissions

| Action | Required permission |
|---|---|
| View profitability report | `billing.read` |
| View cost rates | `billing.read` |
| Create / edit / delete cost rates | `billing.update` |

## Database schema

### `user_cost_rates` table (new)

Created by migration `20260702120000_create_user_cost_rates.cjs`.

| Column | Type | Notes |
|---|---|---|
| `tenant` | text | Partition key (Citus) |
| `rate_id` | uuid | Primary key (with tenant) |
| `user_id` | uuid nullable | NULL for the tenant-wide default rate |
| `cost_rate` | bigint | Cents per hour; CHECK `>= 0` |
| `effective_from` | date | Inclusive start of this rate period |
| `effective_to` | date nullable | Exclusive end; NULL means open-ended |

A covering index on `(tenant, user_id, effective_from)` supports the lateral join used by report queries.

When multiple active rate rows overlap a work date for the same user, the row with the latest `effective_from` wins.

### `invoice_time_entries.item_id` column (new)

Added by migration `20260702120100_add_item_id_to_invoice_time_entries.cjs`.

The nullable `item_id uuid` column records the `invoice_charges` row that a time entry was billed through. `invoiceService.persistInvoiceCharges` writes this value at the point of charge creation, enabling exact per-ticket revenue attribution in the profitability report.

Pre-existing `invoice_time_entries` rows retain `item_id = NULL` and are treated as agreement-level residuals under the "Unattributed" catch-all row in the report.

## Server actions

All actions are in `packages/billing/src/actions/` and re-exported from `index.ts`.

### Cost rate actions (`costRateActions.ts`)

All require authentication (`withAuth`).

| Action | Permission | Description |
|---|---|---|
| `listCostRates()` | `billing.read` | Returns `{ defaultRates, internalUsers, currencyCode }`. `internalUsers` is an array of `{ user, currentRate, rateHistory }`. |
| `upsertCostRate(input)` | `billing.update` | Input: `{ user_id?, cost_rate, effective_from, effective_to?, rate_id? }`. Returns `{ rate, covers_worked_time }`. `covers_worked_time` is true when the range overlaps existing time entries. |
| `deleteCostRate(rateId)` | `billing.update` | Returns `{ deleted_rate, covers_worked_time }`. |
| `checkCostRateWorkedTimeImpact(input)` | `billing.update` | Returns `{ covers_worked_time: boolean }`. Used to show a warning before the user commits an edit that retroactively rewrites historical margin data. |

### Profitability report actions (`profitabilityReportActions.ts`)

All require `billing.read`.

```typescript
getProfitabilitySummary({ startDate, endDate }): Promise<ProfitabilitySummary>
// Tenant-wide totals plus data-quality counters.
// { revenue, laborCost, materialCost, grossMargin, grossMarginPct,
//   effectiveHourlyRate, currencyCode, costRatesConfigured,
//   uncostedHours, unapprovedHours, unconvertedRevenue,
//   uncostedMaterials, currencyMismatches }

getClientProfitability({ startDate, endDate }): Promise<ClientProfitabilityRow[]>
// Per-client: { clientId, clientName, ...ProfitabilityMetricFields }

getAgreementProfitability({ startDate, endDate, clientId? }): Promise<AgreementProfitabilityRow[]>
// Per agreement (client_contracts row), plus ad-hoc and unattributed catch-alls.
// Each row includes: lines: ContractLineProfitabilityRow[]

getTicketProfitability({ startDate, endDate, clientId?, clientContractId? }): Promise<TicketProfitabilityRow[]>
// Per ticket: { ticketId, ticketNumber, title, laborCost, materialCost,
//   revenue, grossMargin, attributionQuality: 'exact' | 'allocated' }
```

## Attribution quality

**Exact** (`attributionQuality: 'exact'`): The `invoice_time_entries.item_id` column links the time entry to a specific invoice charge line. Revenue is measured against the exact charge. Only available for invoices generated after the migration runs.

**Allocated** (`attributionQuality: 'allocated'`): Fixed-fee and bucket charges do not produce per-ticket charge links. Revenue is distributed across tickets proportionally by hours worked within the agreement period. Pre-migration invoices also fall into this bucket.

## Cost rate resolution

For a time entry with `work_date = D` and `user_id = U`:

1. Find rows in `user_cost_rates` where `user_id = U AND effective_from <= D AND (effective_to IS NULL OR effective_to > D)`. If multiple match, pick the latest `effective_from`.
2. If no user-specific rate is found, apply the same query for the tenant default (`user_id IS NULL`).
3. If no default exists, the hours contribute to the `uncostedHours` data-quality counter.

This logic is encapsulated in `buildCostRateResolutionLateralJoin` in `packages/billing/src/models/userCostRate.ts` for reuse in report queries.

## Data-quality warning counters

| Counter | Meaning |
|---|---|
| `uncostedHours` | Hours worked by users with no cost rate covering the work date |
| `unapprovedHours` | Time entries not yet approved; included in cost but may still change |
| `unconvertedRevenue` | Foreign-currency invoice lines with no exchange rate on record |
| `uncostedMaterials` | Ticket materials referencing products with `service_catalog.cost = NULL` |
| `currencyMismatches` | Invoices in currencies that differ from the tenant cost-rate currency |

The report surfaces these as an explicit warning banner rather than silently zeroing affected rows, so operators know when figures are incomplete.

## UI surfaces

- **Settings > Billing > Cost Rates** — lists all internal users, each expandable to their rate history. Add / edit / delete rates through dialogs. When editing a rate that covers already-worked time, a warning dialog explains that the change will rewrite historical margin data for that period.
- **Billing > Reports > Profitability tab** — defaults to the last complete calendar month. Summary card row at the top; per-client table below, each row drills into per-agreement (with expandable per-line breakdown), then per-ticket.
