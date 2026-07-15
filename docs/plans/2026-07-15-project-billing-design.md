# Project Billing — Design

**Date:** 2026-07-15
**Status:** Approved
**Branch:** `feature/project-billing`

## Problem

AlgaPSA projects today have no billing model of their own. Project task time bills through Hourly/Bucket contract lines identically to ticket time; `project_materials` become product charges; `projects.budgeted_hours` is display-only. MSPs cannot sell a fixed-price project, invoice on milestones, take deposits, enforce a not-to-exceed budget, or vary rates by phase.

## Requirements (agreed)

| Decision | Choice |
|---|---|
| Billing models | Fixed-price + milestone schedule; T&M with budget cap; deposit / progress billing; per-phase rate overrides |
| Milestones | Payment schedule entries, each optionally linked to a phase, date-triggered, or manual |
| Invoicing | Per project: roll into the client's recurring invoice **or** standalone project invoices |
| Contracts | Projects bill standalone; contract link is optional (rate cards / terms inheritance) |
| Cap behavior | Per project: notify-only (thresholds) or hard cap (write-down past the cap) |
| Billing gate | Review queue — ready entries are approved by a person before billing |
| V1 adjacents | Budget vs actual on project, profitability integration, client portal visibility, QBO/Xero export |

## Approach

**Project billing becomes a first-class charge source in the BillingEngine** (`packages/billing/src/lib/billing/billingEngine.ts`) — the same integration pattern used when materials, buckets, and licenses were added. Projects own their billing configuration; the engine gains milestone/deposit calculators and time-charge modifications (exclusion, overrides, caps). Everything downstream — tax, credits, invoice persistence, recurring runs, accounting export — works unchanged because project billing still produces charges into `invoiceGeneration.ts`.

Alternatives rejected:

- **Hidden auto-managed contract per project** — contract line types (Fixed/Hourly/Usage/Bucket) cannot express milestones, deposits, caps, or phase overrides; snapshot-semantics contracts would be bent to model something that evolves weekly; ghost contracts pollute contract lists/reports.
- **Parallel project-billing subsystem** — duplicates tax distribution, credit application, invoice persistence, and transactions; drifts from the main pipeline; and the engine still needs changes for exclusion/caps/overrides anyway, so both costs are paid.

## 1. Data model

Four new tenant-scoped tables (migrations in `server/migrations/`, registered in `packages/db/src/lib/tenantTableMetadata.ts`):

### `project_billing_configs`

One row per billable project. Absence = project bills exactly as today (passthrough guarantee).

- `project_id` FK
- `billing_model` `'fixed_price' | 'time_and_materials'` — immutable once any schedule entry is invoiced
- `total_price` (cents), `currency` — fixed-price; currency must match client billing currency
- `invoice_mode` `'recurring' | 'standalone'`
- `contract_id` nullable — optional rate-card/terms inheritance
- `cap_amount` (cents) nullable, `cap_behavior` `'notify' | 'hard_cap'`, `cap_notify_thresholds` (e.g. `[75, 90, 100]`) — T&M
- `deposit_treatment` `'credit' | 'deduct_final'`
- Taxability configuration for milestone/deposit charges

### `project_billing_schedule_entries`

The payment schedule (milestones and deposits).

- `entry_type` `'milestone' | 'deposit'`, `description`
- `amount` (cents) **or** `percentage` of `total_price` — exactly one
- `trigger_type` `'phase' | 'date' | 'manual'`, `phase_id` nullable FK, `trigger_date` nullable
- `status`: `pending → ready → approved → invoiced` (+ `canceled`); `ready_at`, `approved_by`, `invoice_id`, `invoice_charge_id`
- Guardrail: entries must sum to `total_price` — validated at approval time (block final entry), warning in UI

### `project_phase_rate_overrides`

Per-phase T&M overrides: `phase_id` FK, `service_id` nullable (null = all services in phase), `rate` (cents) nullable, `override_service_id` nullable (re-map to a different catalog service).

### `project_billing_cap_usage`

Running cap consumption per config, mirroring the `bucket_usage` pattern: `billed_amount`, `written_down_amount`, `notified_thresholds`; updated transactionally during invoice generation (row locked `FOR UPDATE`).

### Other schema changes

- `project_phases.completed_at` timestamp nullable — explicit phase completion, set by PM action; phase-triggered entries flip `pending → ready` when set. Avoids inferring completion from the freeform `status` string.
- `invoices.project_id` nullable — stamps standalone project invoices.
- `ChargeType` union (`packages/types/src/interfaces/billing.interfaces.ts`) gains `'project_milestone' | 'project_deposit'`; charge variants carry `project_id` + `schedule_entry_id`. Time charges gain optional `write_down_amount` + `write_down_reason: 'project_cap'`.

## 2. Billing engine & charge flow

Changes live in `billingEngine.ts` plus a new `packages/billing/src/services/projectBillingService.ts` (readiness evaluation, cap math) keeping the engine calculation-focused.

### New calculators (called from `calculateBilling()` per client, same pattern as `calculateProductCharges`)

- **`calculateProjectMilestoneCharges`** — picks up `approved` schedule entries for the client's projects, respecting `invoice_mode` (recurring runs pick up only `'recurring'` entries; standalone generation targets one project explicitly). Amount = `amount` or `percentage × total_price`. Emits `'project_milestone'` charges.
- **`calculateProjectDepositCharges`** — same mechanics for deposits. `deposit_treatment: 'credit'`: invoice finalization creates a client credit (via `creditActions`) earmarked with `project_id`, drawn down by later project invoices through existing credit application. `'deduct_final'`: the final milestone is reduced by prior deposits at calculation time.

### Changes to `calculateTimeBasedCharges` (and the unresolved-non-contract path)

1. **Fixed-price exclusion** — time entries resolving (`project_tasks → project_phases → projects`) to a `fixed_price` project are excluded from billable time charges; they remain cost inputs for profitability. Implemented as a join to `project_billing_configs` in the existing time query.
2. **Phase rate overrides** — after rating, entries in phases with overrides get rate/service substitution before charge emission.
3. **Cap enforcement** — `hard_cap`: charges computed normally, then written down so cumulative billed (`project_billing_cap_usage.billed_amount` + this run) never exceeds `cap_amount`; partial write-downs supported (a straddling charge bills the remainder). `notify`: no write-down; threshold crossings emit events.

### Concurrency

Cap math runs inside the invoice-persistence transaction in `invoiceGeneration.ts` with the usage row locked (`FOR UPDATE`, same as bucket usage) so parallel runs cannot double-spend the cap.

### Events & blockers

- New event-bus events: `PROJECT_BUDGET_THRESHOLD_REACHED` (deduped via `notified_thresholds`) and `PROJECT_MILESTONE_READY` — wired to notification templates (email + in-app), joining the `milestoneCompleted` template family.
- `recurringApprovalBlockers.ts`: a client with `ready` entries older than N days produces a warning (not a block).

## 3. Invoicing modes & review queue

### Review queue

New "Project Billing" tab in the Invoicing Hub (`packages/billing/src/components/billing-dashboard/InvoicingHub.tsx`): all `ready` entries across projects — project, client, description, amount, readiness trigger, days waiting. Row + bulk actions: **Approve** (`ready → approved`), **Approve & invoice now** (standalone projects: generates immediately), **Hold** (back to `pending`, with reason), **Cancel**. Server actions in `projectBillingScheduleActions.ts`, RBAC via the existing billing permission set gating invoice generation.

### Recurring mode

Approved entries ride the client's next billing-cycle run through `invoiceGeneration.ts` — tax via `TaxService`, credits, transactions — grouped under a project-named section header using existing charge grouping.

### Standalone mode

New entry point `generateProjectInvoice(projectId, entryIds)` in `invoiceGeneration.ts` — same engine and persistence path, scoped to that project's approved entries (plus, for standalone T&M projects, its uninvoiced approved time/materials). Produces a normal `invoices` row with `project_id` set, so finalization, PDF templating, credits, email delivery, and accounting export work unchanged. Invoice designer gains project template variables (name/number, phase).

### Idempotency & rollback

`invoiced` transition + `invoice_charge_id` stamping happen in the invoice-persistence transaction. Un-finalizing/deleting a draft invoice reverts entries to `approved` (mirrors time-entry un-marking).

## 4. UI

**Mockups:** `docs/plans/2026-07-15-project-billing-mockups/` — three integration options were mocked against the real project screen; **option 3 ("Billing" as a third view) was chosen**, plus option 1's metadata-row billed bar. `option-3-view.html` is the reference.

### Project detail — "Billing" as a third view

The project screen has no tab structure — it is `ProjectInfo` (header) over `ProjectDetail` (filter toolbar + phases panel + board), with a Kanban | List `ViewSwitcher` (`@alga-psa/ui/components/ViewSwitcher`, persisted via the `PROJECT_VIEW_MODE_SETTING` user preference). Billing integrates as a **third view**:

- `ProjectViewMode` becomes `'kanban' | 'list' | 'billing'`; the switcher gains a Billing option (visible per RBAC — users without billing permissions never see it).
- In the billing view the board area is replaced by the billing workspace; the **phases panel stays** for context. The toolbar swaps the phase heading for "Billing" + summary chips (model, ready count); task search/filters hide.
- Content lives in new `packages/projects/src/components/billing/`, calling `@alga-psa/billing` actions (cross-package pattern of `ProjectMaterialsDrawer`).

Billing view content:

- **Setup:** compact "Enable billing" wizard — model, price/cap, invoice mode, optional contract link.
- **Fixed-price:** payment schedule table — entries (amount or %, trigger: phase picker / date / manual), sum-to-total allocation footer, status chips with invoice links, Approve & invoice / Hold row actions on ready entries.
- **T&M:** cap config, thresholds, behavior toggle; phase rate overrides editor.
- **Budget vs actual card** (both models): budget vs consumed (billed + pending approved time at rates for T&M; schedule progress for fixed-price), burn bar with threshold markers, written-down amount. Honors client-portal config flag conventions.
- **Delivery economics card:** hours logged at cost, labor + materials cost, projected margin.

### Ambient billing signals outside the view

- **Metadata row** (`ProjectInfo.tsx`): a "Billed: $X of $Y" segmented bar (invoiced + ready segments) next to the Budget-hours bar, shown only when billing is enabled.
- **Phases panel:** small `$` milestone badges on phases linked to schedule entries (green invoiced / amber ready / gray pending), tying the payment schedule to the WBS.

### Phase completion

"Mark phase complete" action on phase headers (kanban + list). When all tasks in a phase reach `is_closed` statuses, a nudge chip appears. Completing a phase with a linked milestone shows a toast linking to the ready entry.

### Client portal

`packages/client-portal/src/components/projects/`: read-only billing summary (schedule with statuses, invoiced-to-date), gated by per-project `client_portal_config.show_billing` (default off).

### Settings

No new tenant settings beyond notification templates for the two new events.

## 5. Integrations, error handling, testing

### Profitability

`profitabilityReportActions.ts`: fixed-price revenue = invoiced schedule entries (not rated time); cost = time at cost rates + materials. T&M unchanged except write-downs surface as a visible line.

### Accounting export

`project_milestone` / `project_deposit` charges map through the existing item-mapping layer with `project_id`/project number reference metadata. Deposit-as-credit follows existing credit transaction export treatment.

### Error handling & edge cases

- Schedule doesn't sum to total → block approval of the final entry; earlier entries proceed with a warning.
- Linked phase deleted → entry falls back to `manual`, flagged in UI.
- Project canceled → un-invoiced entries auto-cancel; invoiced ones untouched; prompt for a reconciling entry if deposits exceed billed.
- `total_price` edits re-validate the schedule; `billing_model` immutable once any entry is invoiced.
- Config currency must match client billing currency (validated at setup).

### Testing

- **Unit/contract tests** (matching `*.contract.test.ts` conventions): schedule lifecycle, cap write-down math (straddle, exact-hit, multi-run), percentage/amount validation, both deposit treatments, fixed-price time exclusion.
- **Engine integration tests:** recurring pickup of approved recurring entries; standalone scoping; cap lock under parallel runs; un-finalize reversion.
- **Regression:** projects with no `project_billing_configs` row produce byte-identical billing output (golden-path passthrough guarantee).
