# Scratchpad — Project Billing

## Key artifacts

- Design doc (approved): `docs/plans/2026-07-15-project-billing-design.md`
- Mockups: `docs/plans/2026-07-15-project-billing-mockups/` — **option-3-view.html is the chosen direction** (billing as third ViewSwitcher view) + option 1's metadata-row billed bar
- Branch: `feature/project-billing` (design work committed on worktree branch `worktree-project-billing-design`)

## Decisions (and rationale)

- **Engine-first architecture (Approach A):** project billing is a first-class charge source in `billingEngine.ts`, NOT a hidden contract nor a parallel subsystem. Requirements (fixed-price time exclusion, caps, overrides) force engine changes anyway; same pattern as materials/buckets/licenses. Everything downstream (tax/credits/invoicing/export) unchanged.
- **Standalone, contract optional:** a project bills without a contract; `contract_id` on the config is only rate-card/terms inheritance.
- **Review queue is mandatory** (no auto-bill on readiness) — matches existing approval-gated culture (time approval, recurring blockers).
- **Milestones = payment schedule entries**, optionally linked to phases — NOT "phases are milestones" (payment terms decoupled from WBS; 50/25/25 shouldn't force 3 phases).
- **Cap behavior configurable per project:** notify-only vs hard cap (write-down, never negative billing).
- **Phase completion is explicit** (`project_phases.completed_at` + PM action) — phases only have a freeform `status` string today; do NOT infer completion from it. Task statuses have `is_closed` via `project_status_mappings`; use all-tasks-closed only as a nudge.
- **UI = third view, not a tab:** the project screen has NO tabs (ProjectInfo header over ProjectDetail board). ViewSwitcher (`@alga-psa/ui/components/ViewSwitcher`, pref `PROJECT_VIEW_MODE_SETTING`, currently `'kanban' | 'list'`) gains `'billing'`, RBAC-gated.
- Rounding: percentage entries computed in cents; remainder assigned to final entry so schedule sums exactly (T005/F035).

## Codebase discoveries

- `billingEngine.ts` is ~4,400 lines; charge calculators are per-type methods called from `calculateBilling()` per client. Time query already joins `project_tasks → project_phases → projects` AND `tickets` (around line 3156).
- `getClientIdForWorkItem` in `packages/billing/src/lib/contractLineDisambiguation.ts:347` resolves project_task → client.
- Bucket pattern to mirror for cap usage: `bucket_usage` table + `packages/billing/src/services/bucketUsageService.ts`, FOR UPDATE locking during invoice persistence.
- Materials precedent for cross-package UI: `packages/projects/src/components/ProjectMaterialsDrawer.tsx` calls billing/inventory actions; materials marked `is_billed` + `billed_invoice_id` in `invoiceGeneration.ts` (~line 2379).
- Charge type union: `packages/types/src/interfaces/billing.interfaces.ts:60` `type ChargeType = 'fixed' | 'time' | 'usage' | 'bucket' | 'product' | 'license'`.
- Project header: `packages/projects/src/components/ProjectInfo.tsx` (line 1: back nav + number + h1 + tags + outline buttons incl. Materials; line 2: Client/Contact/Budget-hours bar). Billed bar goes here.
- Phases panel: `packages/projects/src/components/ProjectPhases.tsx` (styles module); $ badges go on phase rows.
- ViewSwitcher usage: `ProjectDetail.tsx` ~lines 242-266 (`ProjectViewMode`, user-pref persisted, default 'kanban').
- Test conventions: colocated `*.contract.test.ts` next to actions (see `packages/projects/src/actions/`); Playwright + integration suites have dedicated skills (`integration-testing`, `playwright-testing`).
- `docs/billing/billing.md` is the billing vocabulary doc — contracts → contract lines → client contract lines. Vocabulary shifted away from "billing plans"; don't reintroduce.
- Existing notification precedent: `milestoneCompleted` email template family under `server/migrations/utils/templates/email/projects/`.
- ~835 migrations in `server/migrations/*.cjs`; EE citus parity migrations live in `ee/server/migrations/citus/`.

## Gotchas

- **Passthrough guarantee is the #1 regression risk:** projects without configs must bill byte-identically (T021 golden test). Keep all engine changes behind "config exists" joins/guards.
- `billing_model` immutable once any entry invoiced; `total_price` edits must re-validate the schedule.
- Currency on config must match client billing currency (multi-currency service prices exist — `service_prices`).
- Deposit-as-credit must reuse `creditActions` (expiration/reconciliation already handled there); do not hand-roll credit rows.
- Un-finalize must revert entry status AND cap usage in the same transaction (T023).
- Recurring runs must not pick up standalone-mode entries (F069) — easy to miss in the client-scoped engine query.

## Open questions

- Stale-ready warning threshold: default 7 days (make tenant-configurable only if asked).
- Milestone badges for T&M phases: v1 only shows badges where schedule entries link phases.

## Runbook

- Dev stack: `alga-env-dev` / `alga-dev-env-manager` skills (worktree-built images).
- Plan validation: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-07-15-project-billing/`.

## Wave 1 report

### Files created

- `server/migrations/20260715090000_create_project_billing_configs.cjs`
- `server/migrations/20260715090001_create_project_billing_schedule_entries.cjs`
- `server/migrations/20260715090002_create_project_phase_rate_overrides.cjs`
- `server/migrations/20260715090003_create_project_billing_cap_usage.cjs`
- `server/migrations/20260715090004_add_completed_at_to_project_phases.cjs`
- `server/migrations/20260715090005_add_project_id_to_invoices.cjs`
- `ee/server/migrations/citus/20260715090006_distribute_project_billing_tables.cjs`
- `packages/types/src/interfaces/projectBilling.interfaces.ts`
- `packages/billing/src/schemas/projectBillingSchemas.ts`

### Convention discoveries

- Tenant tables use composite `(tenant, entity_id)` primary keys and tenant-inclusive foreign keys. No new RLS policies are added by current migrations; tenant enforcement for application queries comes from `packages/db/src/lib/tenantTableMetadata.ts`.
- Citus parity migrations under `ee/server/migrations/citus/` are non-transactional, guard non-Citus/read-replica environments, colocate on `tenant`, and tolerate already-distributed tables. The project billing parity migration temporarily removes the two new child-to-config FKs while all four tables enter the colocation group, then restores them.
- Billing Zod schemas are colocated in `packages/billing/src/schemas/` and exported through that package's `./schemas` entry point; `packages/validation` currently contains only shared primitives rather than billing entity schemas.
- Billing tables use `display_order` for ordered line-like records. Nullable service-scope uniqueness is represented by a `COALESCE` expression index so the one all-services override (`service_id IS NULL`) is also unique.
- Current billing charge tax fields use nullable `tax_region` text values rather than a direct FK; the project config follows that persisted charge/quote convention.

### Verification and gotchas

- All seven new `.cjs` migration files load with `node -e "require(...)"`.
- `cd packages/types && npx tsc --noEmit -p .` passes.
- `cd packages/db && npx tsc --noEmit -p .` passes after tenant metadata registration.
- The new project billing schema file passes a focused TypeScript compile and representative Zod parse checks. A full `packages/billing` typecheck remains blocked by a pre-existing unrelated missing module import in `src/actions/quoteActions.ts`: `@alga-psa/opportunities/lib/quoteLifecycleHooks`.
- F019 remains `implemented: false`: `IProjectPhase.completed_at` is complete in this wave, but the UI-owned `ProjectViewMode` change was intentionally not made.

## Wave 2 report

### Files created

- `packages/billing/src/models/projectBillingModelUtils.ts`
- `packages/billing/src/models/projectBillingConfig.ts`
- `packages/billing/src/models/projectBillingScheduleEntry.ts`
- `packages/billing/src/models/projectPhaseRateOverride.ts`
- `packages/billing/src/models/projectBillingCapUsage.ts`
- `packages/billing/src/services/projectBillingService.ts`

### Files updated

- `packages/billing/src/models/index.ts`
- `packages/billing/src/services/index.ts`
- `ee/docs/plans/2026-07-15-project-billing/features.json` (F023–F028 and F035–F041 only)
- `ee/docs/plans/2026-07-15-project-billing/SCRATCHPAD.md`

### Decisions

- Model methods resolve tenant context through `tenantDb` and accept an optional caller-provided Knex connection/transaction. Cap locking and ledger mutations require a real transaction; `getForUpdate` issues `FOR UPDATE` and `increment` performs arithmetic in SQL.
- PostgreSQL `bigint`, `numeric`, and JSON values are normalized at the model boundary so all returned money/percentage/threshold fields match the numeric TypeScript contracts.
- `computeEntryAmounts` uses scaled integer/`bigint` arithmetic. Canceled entries do not participate in allocation, and the final non-canceled entry absorbs only a cent-rounding remainder when the underlying active allocations equal the configured total. Material gaps remain visible to `validateAllocation`; its `delta` is `total_price - allocated`, and it blocks when exactly one non-canceled entry remains unapproved.
- The ready queue is stably ordered by `ready_at`, then creation/id, and resolves authoritative entry amounts from each config's full ordered schedule. The rollup follows `CONTRACTS.md`: fixed-price remaining excludes invoiced/ready/approved amounts, while T&M invoiced/remaining comes from cap usage.
- The all-services phase override remains keyed by the Wave 1 expression unique index: `(tenant, phase_id, COALESCE(service_id, zero-uuid))`. CRUD addresses rows by `rate_override_id`; `listByProject` tenant-joins through phases so a null `service_id` needs no sentinel in application data.
- Phase readiness verifies `project_phases.completed_at` before flipping matching pending rows. Date readiness compares the stored date through the supplied UTC calendar date. Both use a status predicate in the update and return only rows actually flipped; event publication and job registration remain intentionally separate later-wave work.
- `deduct_final` reconciliation counts only previously invoiced deposits that precede the final non-canceled milestone and caps the reduction at that milestone's computed amount. `credit` returns zero reduction.

### Verification, surprises, and incomplete items

- A focused strict TypeScript project containing all Wave 2 files passes.
- Five temporary Vitest smoke cases passed for allocation/remainder math, canceled entries, final-entry blocking, cap straddles/threshold dedupe, and deposit reconciliation; the temporary test file was removed because the plan's permanent test lane remains separate.
- `cd packages/billing && npx tsc --noEmit -p .` reaches the same pre-existing Wave 1 blocker: `src/actions/quoteActions.ts` cannot resolve `@alga-psa/opportunities/lib/quoteLifecycleHooks`. No Wave 2 TypeScript errors were reported, and the focused compile confirms the new files independently.
- `packages/billing/src/services/bucketUsageService.ts` is currently empty, so there was no service implementation to copy. The locking implementation follows the repository's active Knex `.forUpdate()` patterns and the PRD's required transaction boundary instead.
- No engine, invoice-generation, action, event, scheduled-job registration, or UI files were touched. Those remain assigned to later waves.

## Orchestrator notes (verification baselines)

- `packages/billing` typecheck has exactly ONE pre-existing error (also present on main / parent checkout): `quoteActions.ts(32)` TS2307 `@alga-psa/opportunities/lib/quoteLifecycleHooks`. Wave verification = "no NEW errors vs this baseline", not zero errors.
- `packages/projects` typecheck baseline: clean (0 errors).
- Wave 1 review fix: composite (tenant, X) FKs in the new migrations were rewritten to version-guarded column-targeted `ON DELETE SET NULL (col)` — bare SET NULL on composite FKs nulls the tenant column (repo-wide fix precedent: 20260611150000). `IProjectPhase.completed_at` made optional (`?:`) so existing construction sites don't break.
