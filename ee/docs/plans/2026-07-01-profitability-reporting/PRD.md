# PRD: Real Profitability Reporting

**Status:** Draft
**Date:** 2026-07-01
**Plan folder:** `ee/docs/plans/2026-07-01-profitability-reporting/`

## 1. Problem Statement

MSP operators cannot see whether a client, agreement, ticket, or project actually makes money. Alga PSA has a "Profitability" report today (billing dashboard → Reports → Profitability tab), but it is a placeholder:

- Labor cost is hardcoded at $50/hr (`packages/billing/src/actions/contractReportActions.ts` computes `totalHours * 5000` cents; `packages/reporting/src/lib/reports/definitions/contracts/profitability.ts` uses `billable_duration * 833.33` cents/min).
- The definition-driven variant contains a semantically broken join (`invoices.client_id = time_entries.user_id`).
- Output is a single tenant-wide aggregate, not per-client or per-agreement.

The underlying cause is a data-model gap: **the system has no internal labor-cost concept at all** — no per-user or per-role cost rate exists anywhere. The only cost primitive is `service_catalog.cost` (product COGS, used for quote markup).

This PRD covers building a real profitability capability: a labor cost model, the attribution fixes needed to connect revenue to tickets, and a rebuilt report delivering per-client margin, per-agreement margin, effective hourly rate, and ticket-level cost/margin analysis.

## 2. Goals

1. **Labor cost model:** effective-dated internal cost rates per user, with a tenant-wide default, managed through a permission-gated UI.
2. **Per-client profitability:** revenue, labor cost, material cost, gross margin ($ and %), and effective hourly rate per client over a selectable date range.
3. **Per-agreement profitability:** the same metrics per `client_contracts` row (the agreement grain), with per-contract-line breakdown.
4. **Ticket cost analysis:** per-ticket labor cost, material cost, attributable revenue, and margin, with drill-down from client/agreement views.
5. **Attribution fix:** persist the time-entry → invoice-line-item association so hourly revenue is exactly attributable to tickets.
6. **Replace both existing profitability stubs** so there is one correct implementation.

## 3. Non-Goals

- **Expense / vendor-bill module.** Subcontractor, travel, and other non-labor/non-product actual costs are out of scope. Material cost uses the existing `service_catalog.cost` static unit cost.
- **Pre-aggregation / rollup infrastructure.** V1 computes everything on demand. If performance later requires nightly rollups, they must go through the `IJobRunner` abstraction (Temporal in EE, pg-boss in CE) — explicitly deferred.
- **Per-technician profitability / utilization dashboards.** The cost model enables these later; not in v1.
- **Payroll integration or salary import.** Cost rates are manually entered, fully-burdened hourly figures.
- **Multi-currency cost rates.** Cost rates are entered in the tenant default currency. Revenue in other currencies is normalized (see §7.6).
- **Forecasting / budgeting.**
- **Backfilling `contract_line_id` on historical unresolved time entries.** Unattributed time is surfaced, not silently fixed.

## 4. Users and Primary Flows

**Personas:** MSP owner / finance manager (primary), service manager (secondary).

**Flow A — set up cost rates:** Finance manager opens Billing → Settings → Cost Rates, sets a tenant default cost rate, then overrides per technician with effective-dated entries (e.g. "Alice: $62/hr from 2026-01-01"). Rates are entered as fully-burdened (wage + benefits + overhead).

**Flow B — review client profitability:** Owner opens Billing → Reports → Profitability, selects a date range, sees a summary (total revenue, labor cost, material cost, margin, margin %, effective hourly rate) and a per-client table. Sorts by margin % ascending to find losing clients.

**Flow C — review agreement profitability:** Owner drills into a client to see per-agreement rows (each active `client_contract` in range), each with revenue / cost / margin / EHR, and expands an agreement to see per-contract-line detail. Bucket and fixed agreements with low effective hourly rates stand out.

**Flow D — ticket cost analysis:** Service manager drills into an agreement (or client) to a ticket-level table: hours, labor cost, material cost, attributed revenue, margin per ticket. Identifies the tickets that consumed a fixed agreement's profitability.

## 5. Current-State Summary (verified in codebase)

Revenue side (usable as-is):
- Agreement grain: `client_contracts` (client + contract + date range); plan types on `contract_lines` (`Fixed | Hourly | Usage | Bucket`).
- `invoice_charges` carries `client_contract_id` (added `20251016120000`). It does **not** carry `contract_line_id` — no such column exists on invoice_charges. Per-contract-line revenue attribution goes through `invoice_charge_details.config_id` → `contract_line_service_configuration.contract_line_id` (fixed/recurring charges with detail rows) or `invoice_time_entries.item_id` → `time_entries.contract_line_id` (hourly, new link). Fixed-fee charges have per-service allocation in `invoice_charge_fixed_details` (`allocated_amount`).
- Canonical revenue SQL pattern: `packages/reporting/src/lib/reports/definitions/contracts/revenue.ts:76-118`.
- Discounts are negative `invoice_charges` rows; `net_amount` is pre-tax net.
- Multi-currency: `invoices.currency_code` + `exchange_rate_basis_points` (rate ×10,000 to base currency).

Cost side (missing):
- No cost rate anywhere. `users.rate` is legacy billing rate (not on `IUser`); `user_type_rates` and `service_prices` are revenue rates; `service_catalog.cost` + `cost_currency` is product COGS only.
- `time_entries`: `billable_duration` (minutes), actual duration derivable from `end_time − start_time`, `work_date`, `service_id`, `contract_line_id` (nullable), polymorphic `work_item_id`/`work_item_type` (`'ticket' | 'project_task' | ...`), `approval_status`.

Attribution:
- `invoice_time_entries` links invoice ↔ time entry at **invoice grain only** (no `item_id`); the billing engine has the per-entry charge in memory (`ITimeBasedCharge.entryId` in `packages/billing/src/services/invoiceService.ts` `linkAndMarkSourceBillingRecord`) but does not persist the entry → line-item association.
- Ticket → agreement is derived per time entry via `service_id` → eligible `contract_line_id` (`billingEngine.ts` `getEligibleContractLineIdsForServiceAtDate` / deterministic single-match write). Ambiguous matches leave `contract_line_id` NULL.
- `ticket_materials` / `project_materials` carry `ticket_id`/`project_id`, `service_id`, `quantity`, `rate` (cents), `billed_invoice_id` — the cleanest per-ticket revenue/cost primitive already present.
- `ticket_entity_links` (`entity_type='contract'`) is workflow-only; **not** authoritative for billing attribution.

## 6. Design Decisions

### D1 — Cost rates are resolved at query time via effective dating (no snapshot column on time entries)

New table `user_cost_rates` holds effective-dated rates. Reports join `time_entries.work_date` into the rate effective range at query time (`work_date` is NOT NULL since `20260521120000_enforce_time_entry_work_date_not_null.cjs` and timezone-resolved at write time via `work_timezone` — no fallback needed; that migration also added `(tenant, user_id, work_date)` and `(tenant, work_date)` indexes, exactly what the labor-cost CTE wants).

Rationale:
- Identical results to snapshot-at-work-date, but retroactively correct: an admin who sets up cost rates *after* months of time entries immediately gets correct historical reports — no backfill job, no stamping hooks in every time-entry write path (UI, API, imports), no migration on the large `time_entries` table.
- Historical stability is preserved by effective dating itself: the rate applied to March hours is the rate row covering March, regardless of when the report runs.
- Tradeoff accepted: editing a historical rate row rewrites history. This is treated as a feature (corrections) — the management UI warns when editing a rate row whose range covers already-worked time.

### D2 — Tenant default rate is a `user_cost_rates` row with `user_id = NULL`

One table for both defaults and overrides. Resolution: the user-specific row covering the work date wins; else the tenant-default row covering the date; else cost is NULL and the entry is reported as "uncosted" (surfaced in the report, never silently treated as zero). The resolution SQL is **deterministic even against bad data**: a LATERAL single-row pick (`ORDER BY user_id IS NULL, effective_from DESC, rate_id LIMIT 1` — the trailing `rate_id` tiebreak makes same-specificity, same-`effective_from` overlaps resolve identically on every run), so if overlapping rate rows ever exist (race, import), an entry still costs against exactly one rate — never double-counted.

### D3 — Rates are fully-burdened; no separate burden multiplier

Users enter one number per user (e.g. $62/hr including benefits/overhead). A multiplier can be added later without schema changes to reports.

### D4 — Cost accrues on actual duration, not billable duration

`cost_minutes = greatest(0, extract(epoch from (end_time − start_time))/60)` (`end_time` is NOT NULL by schema; the guard is against zero/negative-duration rows, which are clamped to 0 and counted in a `zeroDurationEntryCount` warning). Non-billable and written-down time still costs money; this is exactly what makes effective-hourly-rate honest. `billable_duration` remains the revenue-side driver.

**Approval status:** cost includes time entries at **any** `approval_status` — the work happened whether or not the timesheet is approved (the billing engine bills only APPROVED entries; cost is real regardless). Because unapproved entries are still editable/deletable, reports surface an `unapprovedMinutes` count so finance can gauge how much of the cost figure is still volatile.

### D5 — Revenue is recognized by invoice date; cost by work date

The date-range filter applies `invoices.invoice_date` to revenue and `time_entries.work_date` to cost. Work performed in March but invoiced in April shows cost in March and revenue in April. This timing caveat is documented in the UI (info tooltip). A matched "accrual" view is deferred.

### D6 — Unattributed buckets keep totals honest

- Agreement-level "Unattributed" row per client collects everything with no agreement mapping: time entries with NULL `contract_line_id`, time entries whose assignment row has NULL `client_contract_id` (§7.4), and material cost (D13).
- Tenant-level "No client" row: time whose work item has no client linkage — `ad_hoc`, `non_billable_category`, and NULL work items — plus legacy NULL-client tickets where the NOT NULL constraint was never enforced (see §7.4 client-attribution chain).
- Time entries with no resolvable cost rate → counted in hours, flagged "uncosted", excluded from cost sums, with a visible count so finance knows the number is incomplete.
- Revenue on invoices/charges with NULL `client_contract_id` → client-level only (appears in per-client totals, in an "Ad-hoc / manual" agreement row).

### D7 — Persist the entry → invoice-charge link

Add nullable `item_id` to `invoice_time_entries`, populated at invoice generation from the in-memory `entryId` on each time-based charge. Feasibility verified: `persistInvoiceCharges` inserts the `invoice_charges` row (with its generated `item_id`) *before* calling `linkAndMarkSourceBillingRecord` for the same charge, so the id is available at the write site.

Generation is strictly **1 time entry : 1 charge** in the current engine (`calculateTimeBasedCharges` emits one `ITimeBasedCharge` per entry; consolidation exists only for fixed charges, which never call `linkAndMarkSourceBillingRecord`). New link rows are therefore exact 1:1. Apportionment by `billable_duration` applies only to the **legacy path** — pre-existing invoices whose link rows have NULL `item_id` (D8). Report queries nonetheless tolerate N link rows sharing an `item_id` defensively (no double counting) in case future engine changes introduce consolidation.

### D8 — Ticket-level revenue allocation rules by contract-line type

- **Hourly (new invoices):** exact via `invoice_time_entries.item_id` (1:1 per D7).
- **Hourly (legacy, NULL `item_id`):** apportion the invoice's *time-based* charges across its linked entries by `billable_duration`. `invoice_charges` has **no charge-type column**, so the time-based pool must be identified normatively (a wrong pool silently corrupts historical ticket revenue): charges on invoices that have `invoice_time_entries` rows, with `is_manual = false`, `is_discount = false`, no `invoice_charge_fixed_details` rows, and `service_id IN` (the linked entries' service_ids); where a `recurring_service_periods` linkage exists, prefer its `charge_family = 'hourly'` → `invoice_charge_id` mapping. Known bound on this heuristic: fixed charges predating `invoice_charge_fixed_details` (added 2025-04) that share a `service_id` with the invoice's linked entries can pass the filter and pollute the apportionment — rare (same service billed both fixed and hourly on one invoice), and the result is tagged `allocated` anyway; accepted.
- **Usage, product, and license charges:** remain at agreement level in the ticket view — `usage_tracking` has no ticket linkage, so usage revenue cannot be ticket-allocated even in principle. Ticket-level revenue is knowingly partial for usage-heavy agreements (the agreement and client rollups remain complete).
- **Fixed:** allocate each fixed charge's `allocated_amount` (or `net_amount`) across tickets proportionally by **actual hours** worked against the charge's contract line within the charge's **allocation window**, resolved by fallback chain: (1) `invoice_charge_details.service_period_start/end` on the charge's detail rows; (2) `invoices.billing_period_start/end` (the invoice window — an approximation, so rows using it are tagged `allocated (approximate)`). (A "linked recurring service period" step would be redundant: `linkRecurringServicePeriodToInvoiceDetail` only has data when the detail period was already written.) **Terminal rule:** if the detail period is absent and the invoice window is NULL (manual/prepayment/legacy invoices), the charge joins the detail-less case below. The charge → contract-line mapping uses `invoice_charge_details.config_id` → `contract_line_service_configuration.contract_line_id`; fixed charges **without** detail rows (or without any resolvable window) are attributable at agreement level only — surfaced as an agreement-level residual so reconciliation holds.
- **Bucket:** the engine emits only **overage** charges under the bucket calculator (`calculateBucketPlanCharges`); the bucket line's **base fee arrives via the fixed-charge path** (every calculator runs per line) and is allocated under the Fixed rule above. Overage charges are allocated proportional-by-hours in the window (same fallback chain), tagged `allocated`.
- **Materials:** exact via `ticket_materials.billed_invoice_id` (revenue = `quantity × rate`; cost = `quantity × service_catalog.cost`).
- Ticket rows display an attribution-quality tag: `exact` vs `allocated`.

### D9 — Replace both stubs; server actions are the canonical implementation

New actions in `packages/billing/src/actions/profitabilityReportActions.ts` replace `getProfitabilityReport` in `contractReportActions.ts`. The broken `contracts.profitability` `ReportDefinition` is removed from the `ReportRegistry` (it is not surfaced in any UI; keeping it would create a second, wrong source of truth).

### D10 — Currency normalization

All report amounts are presented in the tenant default currency. Invoice-side amounts in other currencies convert via `invoices.exchange_rate_basis_points`. `exchange_rate_basis_points` is **nullable**: a foreign-currency invoice with a NULL rate is excluded from converted totals and counted in a visible "unconverted revenue" warning (never silently converted 1:1). Cost rates and `service_catalog.cost` are assumed tenant-currency (v1 constraint; `ticket_materials.currency_code` ≠ tenant currency rows are flagged, not converted). Caveat for the flag rule: `ticket_materials.currency_code` is NOT NULL DEFAULT `'USD'`, so on a non-USD tenant, rows written without an explicit currency default to USD — verify the write paths stamp tenant currency before treating the flag as meaningful, and don't blindly flag the default-vs-tenant-currency case.

### D11 — Revenue-countable invoice statuses

`sent`, `paid`, `partially_applied`, `overdue`, plus legacy statuses `open` and `completed` — these are not in the current `InvoiceStatus` type but exist on older rows, and every existing revenue filter includes them (`revenue.ts:102`); dropping them would shrink reported revenue on old tenants versus today's reports. Excluded: `draft`, `cancelled`, `pending`, `prepayment`. Credits reduce cash, not earned revenue — `credit_applied` is ignored for margin.

### D12 — Editions and gating

Tables and actions ship in core (`server/migrations/`, `packages/billing`) like the rest of the contracts/billing system; the report UI follows the existing gating of the ContractReports tabs (product/tier boundary via `enforceServerProductRoute` + catalog tier checks). Citus distribution for `user_cost_rates` uses the current convention for new tables: **guarded inline `create_distributed_table` DDL in the same CE migration** (no-op on vanilla PG; example: `server/migrations/20251110223310_create_appointment_requests.cjs`), not a separate `ee/server/migrations/citus/` file.

### D13 — Materials timing, status basis, and uncosted materials

Material **revenue** counts only when `billed_invoice_id` references an invoice in a countable status (D11), dated by that invoice's `invoice_date` (consistent with D5). **Billed material cost is dated by the same `invoice_date`** — an intentional deviation from D5's cost-when-incurred principle, so a material's cost and revenue always land in the same period and never fabricate a one-sided margin swing. Unbilled materials contribute **cost only**, dated by `created_at` (the materials tables have no usage-date column — only `created_at`/`updated_at`/`billed_at`), never revenue. `service_catalog.cost` is nullable: a billed material whose service has NULL cost is flagged "uncosted material" and counted, exactly like uncosted labor (D6) — never silently treated as zero cost.

**Agreement attribution:** material charges are emitted by the engine **without** `client_contract_id`, so at agreement grain material *revenue* lands in the client's "Ad-hoc / manual" row and material *cost* (which has no agreement mapping at all) in the client's "Unattributed" row. Client-level totals include both; no contract mapping is to be invented.

## 7. Detailed Requirements

### 7.1 Schema

**`user_cost_rates`** (new, `server/migrations/`):

| column | type | notes |
|---|---|---|
| tenant | uuid | part of PK; distribution column |
| rate_id | uuid | PK with tenant, default gen |
| user_id | uuid, nullable | NULL = tenant default; **plain uuid, no FK** (Citus: `users` is distributed — the cited convention migration creates no FKs to it; referential integrity enforced in the model layer) |
| cost_rate | bigint | **cents per hour**, fully-burdened, ≥ 0 |
| effective_from | date | required |
| effective_to | date, nullable | NULL = open-ended |
| created_at / updated_at / created_by | | audit; `created_by` plain uuid, no FK (same Citus reason) |

Constraints/validation:
- No overlapping ranges per (tenant, user_id) — enforced in the model layer: writers first take `pg_advisory_xact_lock(hashtext(tenant || coalesce(user_id::text, 'default')))` (executes on the Citus coordinator, serializing concurrent writers per scope), then run the overlap check and write in the same transaction. A plain READ COMMITTED check-then-insert would race. Belt-and-braces: rate *resolution* is single-row deterministic anyway (D2), so an overlap that slips through can never double-count cost.
- `effective_to`, when present, must be ≥ `effective_from` (DB CHECK); `cost_rate ≥ 0` (DB CHECK).
- **Interval semantics (normative):** ranges are inclusive of both endpoints; NULL `effective_to` = open-ended. Two ranges overlap iff `a.effective_from <= coalesce(b.effective_to, 'infinity') AND b.effective_from <= coalesce(a.effective_to, 'infinity')`. Adjacent ranges (prev `effective_to` = 03-31, next `effective_from` = 04-01) do not overlap.
- Index on (tenant, user_id, effective_from).
- ⚠️ Citus rules: tenant in PK, tenant in all joins; **migration order matters** — create the bare table (no FKs), then the guarded inline `create_distributed_table` (D12), with `exports.config = { transaction: false }` exactly as the convention migration does (`20251110223310_create_appointment_requests.cjs:115`). No FKs to `users` at all (it is distributed; the FK DDL from a not-yet-distributed table fails on EE).

**`invoice_time_entries.item_id`** (new nullable uuid column, `server/migrations/`): populated for new invoices; composite index (tenant, item_id).

### 7.2 Cost-rate model & actions (`packages/billing`)

- Model: CRUD + `resolveCostRate(userId, date)` + bulk resolution for report queries (SQL join, not per-row lookup).
- Server actions (all `withAuth`): `listCostRates`, `upsertCostRate`, `deleteCostRate` — require `hasPermission(user, 'billing', 'update')` for writes, `'billing', 'read'` for list. Overlap validation with clear error messages.
- Deleting a rate row is allowed (corrections); the UI warns when the row covers dates with existing time entries.

### 7.3 Cost-rate management UI

- New "Cost Rates" section under the billing settings area (alongside existing billing configuration), listing internal users (`user_type='internal'`) with their current rate, default-rate banner, and per-user effective-dated history (add/edit/delete dialog).
- Empty state prompts to set the tenant default first.
- All interactive elements have kebab-case `id`s; all text via `t('...')` (`msp/billing` or the namespace used by sibling billing settings screens).

### 7.4 Report server actions (`packages/billing/src/actions/profitabilityReportActions.ts`)

All `withAuth` + `hasPermission(user, 'billing', 'read')` + `createTenantKnex`/`tenantDb`, tenant in every WHERE/JOIN. Inputs: `{ startDate, endDate }` (+ drill-down keys). Outputs are typed interfaces; all money in integer cents of tenant currency; hours in minutes (UI converts).

1. `getProfitabilitySummary({start, end})` → totals: revenue, laborCost, materialCost, margin, marginPct, totalMinutes, effectiveHourlyRate, uncostedMinutes, unattributedMinutes, unapprovedMinutes (D4), zeroDurationEntryCount (D4), uncostedMaterialCount (D13), unconvertedRevenueCount (D10's NULL-basis-points warning).
2. `getClientProfitability({start, end})` → per-client rows (same fields + clientId/name), including "No client" row.
3. `getAgreementProfitability({start, end, clientId?})` → per-`client_contract` rows + "Ad-hoc / manual" + "Unattributed" rows per client; each row optionally expandable to per-`contract_line` detail. Per-line revenue: `invoice_charge_details.config_id` → `contract_line_service_configuration.contract_line_id` for detail-bearing charges; `invoice_time_entries.item_id` → `time_entries.contract_line_id` for hourly; charges resolvable to neither stay at agreement level (line breakdown shows an "unassigned to line" residual so rows still sum to the agreement). Cost/hours: `time_entries.contract_line_id` → `client_contract_lines`, **de-duplicated** — when multiple `client_contract_lines` assignments exist for the same `contract_line_id`, pick the one whose parent `client_contracts` date range covers the entry's `work_date` (mirroring `getEligibleContractLineIdsForServiceAtDate`), tiebreak by latest `start_date` then `client_contract_id`, so each entry's cost lands in exactly one agreement. `client_contract_lines.client_contract_id` is **nullable** (legacy backfill): an entry whose assignment row has NULL `client_contract_id` has a line but no agreement — its cost folds into the client's "Unattributed" row so agreement reconciliation still sums.
4. `getTicketProfitability({start, end, clientId?, clientContractId?})` → per-ticket rows: ticketNumber, title, totalMinutes, billableMinutes, laborCost, materialCost, revenue, margin, attribution (`exact | allocated`), uncosted flag. Includes project-task time? **No** — ticket view is `work_item_type='ticket'` only; project time appears in client/agreement rollups and a per-project breakdown is deferred (non-goal, revisit).

Query composition notes:
- Revenue CTE mirrors `revenue.ts` pattern (fixed-detail `allocated_amount` else `net_amount`, statuses per D11, currency per D10).
- Labor cost CTE: time_entries joined to `user_cost_rates` on tenant + (user match or default) + work-date range, single-row deterministic pick per D2; cost = actual minutes × rate / 60, rounded to cent per entry.
- **Client attribution of time-entry cost, by `work_item_type`** (normative — a naive ticket+project join silently drops interaction time):
  - `ticket` → `tickets.client_id`
  - `project_task` → `project_tasks` → `project_phases` → `projects.client_id`
  - `interaction` → the interaction's `client_id`
  - `appointment_request` → the request's `client_id`
  - `ad_hoc`, `non_billable_category`, NULL work item → "No client" row
  - Any of the above resolving to NULL → "No client" row.
- Material cost/revenue CTE from `ticket_materials` + `project_materials` × `service_catalog.cost`. Unbilled material cost date filtering uses `(created_at AT TIME ZONE 'UTC')::date` so range boundaries are deterministic regardless of session timezone (unlike `work_date`, which is already timezone-resolved at write time).

### 7.5 Report UI (`packages/billing/src/components/billing-dashboard/reports/`)

- Replace the Profitability tab content in `ContractReports.tsx` with the new `ProfitabilityReport` component: date-range picker (default: **last complete month** — with D5's invoice-date basis, a current-month default would show a month of cost against invoices not yet generated and render every client deep-red on first open), summary cards, client table → agreement table → ticket table drill-down (breadcrumb or expandable rows — note the shared `DataTable` supports `onRowClick` but has no built-in expandable sub-rows, so contract-line expansion needs custom row rendering or a nested fetch/table), attribution-quality and uncosted indicators, timing-basis tooltip (D5).
- "Cost rates not configured" empty state links to the Cost Rates settings screen.
- Loading/error states consistent with sibling tabs; DataTable component; no new charting required for v1 (summary cards + tables).
- i18n `msp/reports` (or billing namespace consistent with `ContractReports.tsx`); ids kebab-case.

### 7.6 Invoice generation change

- `invoiceService.linkAndMarkSourceBillingRecord` (and its caller) persists the generated `item_id` per time entry into `invoice_time_entries.item_id`. The mapping is 1:1 (D7); the charge row is already inserted when linking runs, so the id is in hand. Must leave manual invoices and non-time charges untouched (column nullable, no regression).

### 7.7 Cleanup

- Remove `getProfitabilityReport` from `contractReportActions.ts` (or delegate to the new action) and delete the `Profitability` interface there.
- Remove `contracts.profitability` from `packages/reporting` registry + its definition file.

## 8. Permissions

- Report read: `billing.read` (matches existing contract reports).
- Cost-rate management: `billing.update` (writes), `billing.read` (list). Note: listing cost rates exposes compensation-adjacent data to any `billing.read` holder — accepted for v1 (billing readers already see all revenue); revisit if a granular `cost_rates` resource is requested.
- Route-level gating unchanged (`enforceServerProductRoute` on the billing page).

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Query cost on large tenants (time_entries scans, Citus) | Date-range bounded; tenant-scoped everywhere; indexes on `user_cost_rates`; measure before optimizing; rollups via IJobRunner explicitly deferred |
| Mixed units (cents vs decimal dollars in contract config) | Report reads only invoice-side cents tables (`invoice_charges`, details) + new cents columns; never contract-config decimals |
| Legacy-invoice apportionment errors (NULL `item_id` rows) | Deterministic by-billable-duration apportionment + tests; attribution tag shows `allocated` where inexact |
| Fixed-charge allocation window unreliable on old data | Two-step fallback (detail service period → invoice window) with `allocated (approximate)` tag; terminal rule sends window-less charges to the agreement residual (D8) |
| Editing historical rates changes past reports (D1) | UI warning on edits covering worked dates; audit columns record who/when |
| Zero/negative-duration entries | Clamp actual minutes to ≥ 0; counted in `zeroDurationEntryCount` (both `work_date` and `end_time` are NOT NULL by schema — no NULL fallbacks needed) |
| Unapproved time still editable | Cost includes all approval statuses (D4); `unapprovedMinutes` surfaced so finance can see how much of the figure is volatile |

## 10. Acceptance Criteria / Definition of Done

1. A tenant with no cost rates sees an explicit "uncosted" report state, never $0-cost margins presented as real.
2. Setting a tenant default + one user override produces per-client margin where that user's hours cost at the override and everyone else at the default, correctly across an effective-date boundary within the range.
3. Per-agreement rows reconcile: Σ(agreement revenue) + ad-hoc revenue = per-client revenue; Σ(agreement cost) + unattributed cost = per-client cost.
4. For a newly generated invoice from ticket time, ticket-level revenue matches the invoice line amounts exactly (`exact` attribution) and margin = revenue − (minutes × rate/60) − materials.
5. Fixed-fee agreement: ticket allocations **plus any agreement-level residual** sum exactly to the fixed charges in range (no rounding leakage; largest-remainder or equivalent).
6. Effective hourly rate uses actual (not billable) hours and matches hand-computed values in test fixtures.
7. Both old stubs are gone; the Profitability tab renders the new report; `npm run build` passes; new/changed queries carry tenant in all WHERE/JOINs (reviewed).
8. RBAC: user without `billing.read` gets a permission error from every new action; without `billing.update` cannot mutate cost rates.
9. i18n: no hardcoded user-facing strings; both language packs validate.

## 11. Open Questions

1. Should ticket cost analysis eventually include project-task time as a per-project sibling view? (Deferred; data supports it.)
2. Granular RBAC resource for cost rates (vs `billing.*`)? Revisit on customer feedback.
3. CSV export of the report tables — sibling reports don't have it; add later via existing CSV panel pattern?
4. Feature-flag the tab swap (PostHog) or ship directly? Default: ship directly (replacing a stub), flag only if release timing requires.
