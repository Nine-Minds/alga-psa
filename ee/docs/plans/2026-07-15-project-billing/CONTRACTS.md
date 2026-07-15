# Project Billing — Locked Contracts (actions ⇄ UI)

This file is the interface contract between the backend actions lane and the UI lanes.
Backend implements these signatures exactly; UI imports and calls them exactly.
If a signature must change, update this file in the same commit and note it in SCRATCHPAD.md.

All money values are **integer cents**. All ids are uuids. All actions are server actions
('use server') with tenant scoping + RBAC enforced server-side, returning plain serializable objects.
Errors follow the repo's existing action error conventions (throw / return shape used by
`packages/billing/src/actions/contractActions.ts` — match it).

## Types (from `@alga-psa/types` after Wave 1)

`IProjectBillingConfig`, `IProjectBillingScheduleEntry`, `IProjectPhaseRateOverride`,
`IProjectBillingCapUsage` — see `packages/types/src/interfaces/projectBilling.interfaces.ts`.

Derived view types (exported from `packages/billing/src/actions/projectBillingConfigActions.ts`):

```ts
interface ProjectBillingRollup {
  total_price: number | null;        // fixed-price only
  invoiced_amount: number;           // sum of invoiced entries (fixed) or billed_amount (T&M)
  ready_amount: number;              // sum of ready entries
  approved_amount: number;           // approved-not-yet-invoiced
  remaining_amount: number;          // total - invoiced - ready - approved (fixed); cap remaining (T&M)
  allocated_pct: number | null;      // % of total_price covered by non-canceled entries
}

interface ProjectBillingEconomics {
  hours_logged: number;              // decimal hours on the project
  labor_cost: number;                // cents, at cost rates
  materials_cost: number;            // cents
  projected_margin_pct: number | null;
}

interface ScheduleEntryView extends IProjectBillingScheduleEntry {
  computed_amount: number;           // resolved cents (amount or pct × total, remainder-safe)
  phase_name: string | null;
  invoice_number: string | null;
  phase_deleted: boolean;            // linked phase removed → treated as manual
}

interface ProjectBillingOverview {
  config: IProjectBillingConfig | null;   // null = billing not enabled
  entries: ScheduleEntryView[];
  rollup: ProjectBillingRollup | null;
  cap_usage: IProjectBillingCapUsage | null;
  economics: ProjectBillingEconomics;
  overrides: (IProjectPhaseRateOverride & { phase_name: string; service_name: string | null; override_service_name: string | null })[];
}

interface ReadyQueueRow {
  entry: ScheduleEntryView;
  project_id: string;
  project_name: string;
  project_number: string;
  client_id: string;
  client_name: string;
  invoice_mode: 'recurring' | 'standalone';
  days_waiting: number;
}
```

## `packages/billing/src/actions/projectBillingConfigActions.ts`

```ts
getProjectBillingOverview(projectId: string): Promise<ProjectBillingOverview>
createProjectBillingConfig(input: {
  project_id: string;
  billing_model: 'fixed_price' | 'time_and_materials';
  total_price?: number; currency?: string;
  invoice_mode: 'recurring' | 'standalone';
  contract_id?: string | null;
  cap_amount?: number | null; cap_behavior?: 'notify' | 'hard_cap';
  cap_notify_thresholds?: number[];
  deposit_treatment?: 'credit' | 'deduct_final';
  is_taxable?: boolean;
}): Promise<IProjectBillingConfig>
updateProjectBillingConfig(configId: string, updates: Partial<...same fields minus project_id>): Promise<IProjectBillingConfig>
deleteProjectBillingConfig(configId: string): Promise<void>
upsertPhaseRateOverride(input: { phase_id: string; service_id?: string | null; rate?: number | null; override_service_id?: string | null }): Promise<IProjectPhaseRateOverride>
deletePhaseRateOverride(overrideId: string): Promise<void>
```

## `packages/billing/src/actions/projectBillingScheduleActions.ts`

```ts
createScheduleEntry(configId: string, input: {
  entry_type: 'milestone' | 'deposit';
  description: string;
  amount?: number; percentage?: number;         // exactly one
  trigger_type: 'phase' | 'date' | 'manual';
  phase_id?: string | null; trigger_date?: string | null;
}): Promise<ScheduleEntryView>
updateScheduleEntry(entryId: string, updates: Partial<...same input>): Promise<ScheduleEntryView>
deleteScheduleEntry(entryId: string): Promise<void>                    // pending/canceled only
markEntryReady(entryId: string): Promise<ScheduleEntryView>            // manual pending → ready
approveScheduleEntry(entryId: string): Promise<{ entry: ScheduleEntryView; allocation_warning: string | null }>
approveAndInvoiceNow(entryId: string): Promise<{ entry: ScheduleEntryView; invoice_id: string }>  // standalone-mode only
holdScheduleEntry(entryId: string, reason: string): Promise<ScheduleEntryView>   // ready → pending
cancelScheduleEntry(entryId: string): Promise<ScheduleEntryView>
bulkApproveEntries(entryIds: string[]): Promise<{ approved: string[]; failed: { id: string; error: string }[] }>
bulkHoldEntries(entryIds: string[], reason: string): Promise<{ held: string[]; failed: { id: string; error: string }[] }>
listReadyScheduleEntries(): Promise<ReadyQueueRow[]>                   // tenant-wide review queue
getReadyEntryCount(): Promise<number>                                  // hub tab badge
```

## Phase completion (`packages/projects/src/actions/projectActions.ts` or new file)

```ts
markPhaseComplete(phaseId: string): Promise<{ phase: IProjectPhase; ready_entries: { entry_id: string; description: string }[] }>
reopenPhase(phaseId: string): Promise<IProjectPhase>   // clears completed_at; ready(not approved) linked entries → pending
```

Behavior is fixed; *location* of the billing-readiness flip may live in billing and be invoked
from projects, or be inlined SQL — resolve by actual package dependency direction and record
the choice in SCRATCHPAD.md.

## Client portal (`packages/client-portal` server action, read-only)

```ts
getClientProjectBillingSummary(projectId: string): Promise<{
  enabled: boolean;                    // false unless client_portal_config.show_billing
  total_price: number | null;
  invoiced_to_date: number;
  entries: { description: string; computed_amount: number; status: 'upcoming' | 'invoiced'; invoiced_at: string | null }[];
} | null>
```

Statuses are collapsed for clients: pending/ready/approved → 'upcoming'; canceled entries omitted.

## RBAC

- Read overview: existing billing read permission (same as viewing invoices/contracts).
- Config CRUD, schedule CRUD, approve/hold/cancel/mark-ready, bulk ops: existing billing
  invoice-generation permission set (mirror `generateInvoice` action's check).
- `markPhaseComplete` / `reopenPhase`: project update permission (NOT billing).
- UI additionally hides the Billing view + hub tab without the read permission
  (`useFeaturePermissions`-style hook or the pattern used by existing billing components).

## UI conventions the backend must not break

- All list-returning actions return arrays sorted stably (schedule entries by sort order, queue by ready_at asc).
- `ScheduleEntryView.computed_amount` is authoritative — UI never recomputes percentages.
- Actions revalidate paths per repo convention so the project screen refreshes after mutations.
