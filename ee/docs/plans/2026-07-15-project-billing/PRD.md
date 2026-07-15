# PRD — Project Billing

**Date:** 2026-07-15
**Status:** Approved (converged via brainstorming session; design doc: `docs/plans/2026-07-15-project-billing-design.md`)
**Mockups:** `docs/plans/2026-07-15-project-billing-mockups/` (chosen: `option-3-view.html`)

## 1. Problem statement

AlgaPSA projects have no billing model of their own. Project task time bills through Hourly/Bucket contract lines identically to ticket time; `project_materials` become product charges; `projects.budgeted_hours` is display-only. MSPs cannot:

- Sell a project at a **fixed price** and invoice on **milestones** or a payment schedule
- Take an upfront **deposit** and reconcile it against later invoices
- Enforce a **not-to-exceed budget** on T&M projects (notify or write down)
- Vary **rates per phase** within a project
- Generate a **standalone invoice** for a project outside the recurring billing cycle
- See project **budget vs actual** in currency, or true fixed-price margin

## 2. User value / personas

- **MSP owner / billing admin:** sells one-off projects (migrations, deployments) at fixed prices; needs the money side automated and guarded (review queue, allocation validation, caps) without inventing fake contracts.
- **Project manager:** marks phases complete, watches burn vs budget, gets notified at thresholds; sees which milestones are ready to bill.
- **Client (portal):** optionally sees the payment schedule and what has been invoiced.

## 3. Goals

1. Fixed-price projects with a payment schedule (milestones + deposits); entries triggered by phase completion, date, or manually.
2. T&M projects with a shared hard budget cap that writes down all project labor and material charges, with configurable notification thresholds.
3. Deposits with two treatments: client credit earmarked to the project, or deduct-from-final-milestone.
4. Per-phase rate/service overrides for T&M projects.
5. Per-project invoice mode: charges ride the client's recurring invoice, or standalone project invoices.
6. Review queue: ready entries require human approval before billing (Invoicing Hub tab).
7. Project billing is standalone; a contract link is optional (rate cards / terms).
8. Budget vs actual + delivery economics on the project screen.
9. Profitability report shows true fixed-price margin (schedule revenue vs cost).
10. Client portal read-only billing summary (per-project opt-in).
11. Project charges flow through existing QBO/Xero export with project reference metadata.

## 4. Non-goals

- No milestone-triggered *automatic* billing without review (review queue is mandatory in v1).
- No new contract line type; contracts are unchanged.
- No revenue recognition / WIP accounting.
- No percent-complete automatic progress billing computation (schedule entries are explicit).
- No changes to ticket billing or existing contract-line behavior — projects without a billing config bill **exactly** as today (passthrough guarantee).
- No production-readiness extras (metrics, feature flags, perf hardening) beyond what exists by convention.

## 5. Architecture (approved)

Project billing becomes a **first-class charge source in the BillingEngine** (`packages/billing/src/lib/billing/billingEngine.ts`) — the same pattern as materials/buckets/licenses. Projects own their config; the engine gains milestone/deposit calculators and project-charge modifications (fixed-price exclusion, phase overrides, and cap write-downs across T&M labor and materials). Everything downstream (tax, credits, invoice persistence, recurring runs, accounting export) is unchanged because project billing still emits charges into `invoiceGeneration.ts`.

Rejected alternatives (see design doc §Approach): hidden auto-managed contracts; parallel project-billing subsystem.

## 6. Data model

Four new tenant-scoped tables (migrations in `server/migrations/`, registered in `packages/db/src/lib/tenantTableMetadata.ts`):

- **`project_billing_configs`** — one row per billable project: `billing_model` (`fixed_price` | `time_and_materials`, immutable once any entry invoiced), `total_price` cents + `currency` (must match client billing currency), `invoice_mode` (`recurring` | `standalone`), optional `contract_id`, cap fields (`cap_amount`, hard-cap behavior, `cap_notify_thresholds`), `deposit_treatment` (`credit`|`deduct_final`), taxability config.
- **`project_billing_schedule_entries`** — `entry_type` (`milestone`|`deposit`), `description`, `amount` XOR `percentage`, `trigger_type` (`phase`|`date`|`manual`) + `phase_id`/`trigger_date`, `status` lifecycle `pending → ready → approved → invoiced` with durable `ready → held → ready` and `canceled` paths, `ready_at`, hold/approval audit fields, `invoice_id`, `invoice_charge_id`, and `requires_payment_before_work` (explicit advisory-warning policy). Sum must equal `total_price` (validated at approval of final entry; UI warning earlier).
- **`project_phase_rate_overrides`** — `phase_id`, nullable `service_id` (null = all), nullable `rate`, nullable `override_service_id`.
- **`project_billing_cap_usage`** — `billed_amount`, `written_down_amount`, `notified_thresholds`; row locked `FOR UPDATE` during invoice generation (mirrors `bucket_usage`).

Other schema: `project_phases.completed_at` (explicit phase completion), `invoices.project_id` (standalone invoices), and durable schedule hold metadata (`hold_reason`, `held_at`, `held_by`). `ChargeType` gains `'project_milestone' | 'project_deposit'`; project-annotated T&M charges carry cap write-down metadata during generation and persistence.

## 7. Engine & flow

- New calculators in `calculateBilling()`: `calculateProjectMilestoneCharges`, `calculateProjectDepositCharges` (approved entries only; recurring runs pick up `invoice_mode='recurring'`; standalone generation targets one project).
- `calculateTimeBasedCharges` + unresolved-non-contract path: fixed-price exclusion (join to configs) and phase rate/service overrides. Hard-cap processing groups every charge annotated to the project billing config, including labor and materials, with partial-straddle support.
- Deposit treatments: `credit` → client credit created at finalization, earmarked `project_id`; `deduct_final` → final milestone reduced by prior deposits.
- Cap math inside invoice-persistence transaction, cap-usage row `FOR UPDATE`.
- Events: `PROJECT_BUDGET_THRESHOLD_REACHED` (deduped via `notified_thresholds`), `PROJECT_BUDGET_EXCEEDED` (first persisted write-down), `PROJECT_MILESTONE_READY`, project-billing lifecycle/config/payment events; all registered for workflows. Milestone/threshold/exceeded events have email + in-app templates.
- `recurringApprovalBlockers.ts`: warning (not block) for stale `ready` entries.
- New `packages/billing/src/services/projectBillingService.ts` (readiness evaluation, cap math) and `packages/billing/src/actions/projectBillingConfigActions.ts` / `projectBillingScheduleActions.ts`.
- Standalone entry point `generateProjectInvoice(projectId, entryIds)` in `invoiceGeneration.ts`; invoice stamped with `project_id`. Un-finalize preserves schedule linkage and cap consumption while the draft and its charges still exist; hard deletion releases both.

## 8. UX / UI

### Project screen — "Billing" as a third view (chosen mockup: option 3)

- `ProjectViewMode` becomes `'kanban' | 'list' | 'billing'` on the existing `ViewSwitcher` (persisted user preference); Billing option RBAC-gated.
- Billing view replaces the board area; **phases panel stays**. Toolbar shows "Billing" + chips (model, ready count); task search/filters hidden.
- Content in new `packages/projects/src/components/billing/` calling `@alga-psa/billing` actions:
  - Enable-billing setup wizard (model, price/cap, invoice mode, contract link)
  - Fixed-price: schedule table with allocation footer, status chips, invoice links, Approve & invoice / Hold on ready rows
  - T&M: hard-cap config + thresholds; phase rate overrides editor
  - Budget vs actual card (burn bar w/ threshold markers, write-downs)
  - Delivery economics card (hours at cost, cost, projected margin)

### Ambient signals

- `ProjectInfo` metadata row: "Billed: $X of $Y" segmented bar (invoiced/ready), only when billing enabled.
- Phases panel: `$` milestone badges (green invoiced / amber ready / gray pending).
- Phase completion: explicit "Mark phase complete" action (sets `completed_at`); nudge chip when all tasks closed; toast linking to ready entry when a linked milestone flips.
- Schedule entries may explicitly require payment before work. A linked draft or unpaid invoice produces a warning-only banner on the project, task, and time-entry surfaces; it never blocks work.
- Project invoice references open the existing invoice preview in a drawer rather than navigating away.

### Invoicing Hub

- New "Project Billing" review tab: all ready entries across projects (project, client, amount, trigger, days waiting); Approve / Approve & invoice now / Hold / Cancel; bulk actions; billing-permission RBAC.

### Client portal

- Read-only billing summary on project detail (schedule + statuses + invoiced-to-date), gated by client `billing:read`, project ownership, and per-project `client_portal_config.show_billing` (default off). Values use the project currency and ISO minor units.

## 9. Integrations

- **Profitability:** fixed-price revenue = invoiced schedule entries; cost = effective-dated employee rates + materials; write-downs surfaced as a line for T&M. Costs remain in tenant reporting currency, and margin is withheld when revenue/cost currencies are not comparable.
- **Accounting export:** new charge types map through existing item mapping with project reference metadata; deposit-as-credit follows existing credit export treatment.

## 10. Edge cases / error handling

- Schedule ≠ total → block approval of final entry; earlier entries proceed with warning.
- Linked phase deleted → entry falls back to `manual`, flagged.
- Project canceled → un-invoiced entries auto-cancel; prompt for reconciling entry if deposits exceed billed.
- `total_price` edit re-validates schedule; `billing_model` immutable once invoiced.
- Currency mismatch with client billing currency rejected at setup.
- Un-finalize/delete draft invoice reverts entry statuses within the transaction.
- Public project-billing actions return structured action/permission errors for expected failures; unfinalize preserves safe underlying business reasons.
- PostgreSQL and Citus share application-enforced atomic status transitions. The database status-value check remains, but no distributed-table trigger is required.

## 11. Risks

- `billingEngine.ts` is ~4,400 lines and load-bearing — regression risk to existing charge paths. Mitigation: passthrough regression test (projects with no config produce identical output), engine integration suite.
- Cap concurrency under parallel invoice runs. Mitigation: `FOR UPDATE` on cap usage inside the persistence transaction (bucket pattern).
- Deposit-as-credit interacts with existing credit expiration/reconciliation. Mitigation: reuse `creditActions` exclusively; contract tests on both treatments.

## 12. Acceptance criteria / definition of done

1. A fixed-price project with a 4-entry schedule (deposit + 3 milestones, % and $ mixed) can be configured, triggered (phase/date/manual), reviewed, and invoiced in both invoice modes; invoices carry correct tax and totals.
2. Fixed-price project time never produces time charges; it appears in profitability as cost.
3. A hard-capped T&M project bills labor and materials up to exactly the shared cap across multiple invoice runs (a straddling charge is partially written down), emits threshold events once per threshold, and emits one first-overage event when write-down begins.
4. Phase rate overrides change rates/service mapping for entries in that phase only.
5. Deposits work under both treatments and reconcile correctly on the final invoice.
6. Projects without billing configs produce byte-identical billing output vs before the feature.
7. Review queue transitions enforce RBAC and the status lifecycle; un-finalize preserves project linkage and cap consumption, while hard deletion releases them.
8. Client portal shows the correctly formatted schedule only when both the project flag and client billing permission allow it; internal billing details remain hidden without billing permission.
9. An explicitly payment-gated schedule entry produces a warning-only signal for technicians until its linked invoice is paid; invoice details remain permission-gated.
10. Project invoice references open in a drawer, expected action failures return structured results, and unfinalize displays the safe underlying reason.
11. PostgreSQL/Citus lifecycle behavior, multi-currency formatting, real translations, and workflow catalog coverage pass their planned tests.
12. All features in `features.json` implemented; all tests in `tests.json` passing.

## 13. Open questions

- Staleness threshold (N days) for the recurring-blocker warning — default 7, tenant-configurable later if asked.
- Whether milestone badges should appear for T&M projects' phases (no schedule entries) — v1: badges only where schedule entries link phases.

## 14. Approved hardening addendum

The production-readiness follow-up is specified in `docs/plans/2026-07-15-project-billing-hardening-design.md`. Its payment-warning, Citus lifecycle, workflow-event, permission, drawer, currency, i18n, and structured-error decisions are part of this PRD.
