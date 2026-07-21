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
- Un-finalize must preserve entry linkage and cap usage because the draft invoice and its charges still exist; hard delete must release both in the same transaction (T023).
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

## Wave 3b report

### Files created

- `packages/billing/src/actions/projectBillingConfigActions.ts`
- `packages/billing/src/actions/projectBillingScheduleActions.ts`
- `packages/client-portal/src/actions/client-portal-actions/client-project-billing.ts`

### Files updated

- `packages/billing/src/actions/index.ts`
- `packages/projects/src/actions/projectActions.ts`
- `packages/client-portal/src/actions/client-portal-actions/index.ts`
- `ee/docs/plans/2026-07-15-project-billing/features.json` (F045–F059 and F152–F154 only)
- `ee/docs/plans/2026-07-15-project-billing/SCRATCHPAD.md`

### Decisions

- `@alga-psa/projects` has no dependency on `@alga-psa/billing`. Phase completion/readiness and project-close cancellation therefore use tenant-scoped SQL inside the existing project transaction instead of adding a projects → billing feature dependency. The readiness updates retain the service's optimistic `status = 'pending'` predicate; reopen similarly changes only `status = 'ready'` rows.
- The cancellation hook lives in `updateProject`, immediately after the new project status is resolved. A transition from non-closed to any `statuses.is_closed = true` status cancels pending/ready/approved schedule entries atomically. The returned project gains optional `deposit_reconciliation_needed`; its value compares authoritative linked `invoice_charges.total_price` for invoiced deposits and milestones, with schedule values only as a legacy fallback.
- Billing mutations mirror invoice generation RBAC exactly: `invoice:create` OR `invoice:generate`. Overview/queue reads use `billing:read`. Phase complete/reopen use only `project:update`, so project managers do not need billing permissions.
- Config currency resolution mirrors `billingCurrencyActions`: active contract currency, then `clients.default_currency_code`, then the tenant billing default. Economics reuse the profitability report's cost rules: actual elapsed time at effective user/default cost rates, and actual inventory COGS with catalog-cost fallback.
- A `total_price` edit remains non-blocking and returns a serialized `allocation_warning` extra field when the updated schedule is not balanced, while preserving the locked `Promise<IProjectBillingConfig>` signature. Final-entry approval is the point that blocks an imbalanced schedule; earlier approvals return their contracted warning.
- A phase-triggered entry whose FK was nulled by phase deletion is exposed and handled as a manual trigger while retaining `phase_deleted: true`, allowing `markEntryReady` to provide the required fallback behavior.
- The client portal summary lives in the client-portal action layer, verifies a client user through contact → client ownership in the project query, and returns a disabled summary unless the raw JSONB `show_billing` value is exactly true. It imports only the billing service's pure authoritative allocation math.

### Surprises and incompletes

- The Wave 1 schedule table has no hold-reason column. `holdScheduleEntry` and bulk hold require a non-empty reason, but cannot persist it; no schema was expanded in this wave.
- The locked update-config return type has no warning property. The runtime object includes `allocation_warning`, but the property is intentionally not added to `IProjectBillingConfig` or `CONTRACTS.md`.
- F143 remains `implemented: false`: its backend action is complete, but the feature description includes the client portal UI, which belongs to the portal UI lane. F144/F145 (typed/default config and toggle UI) were not changed.
- `packages/billing` typecheck reports only the documented pre-existing `quoteActions.ts(32)` TS2307 for `@alga-psa/opportunities/lib/quoteLifecycleHooks`. `packages/client-portal` inherits that same error and has its own pre-existing import of the same missing module in `client-billing.ts`; neither package reports a Wave 3b error. `packages/projects` typechecks cleanly.

### Verification

- `cd packages/projects && npx tsc --noEmit -p .` — pass.
- `cd packages/billing && npx tsc --noEmit -p .` — no new errors; one documented baseline TS2307.
- `cd packages/client-portal && npx tsc --noEmit -p .` — no new errors; only the inherited/documented TS2307 occurrences.
- `cd packages/projects && npx vitest run src/actions/projectActionsTenantScoped.contract.test.ts src/actions/projectAuthorization.contract.test.ts src/actions/projectPhaseStatusActions.contract.test.ts` — 3 files / 13 tests passed.

## Wave 3a report

### Files updated

- `packages/billing/src/lib/billing/billingEngine.ts`
- `packages/billing/src/actions/invoiceGeneration.ts`
- `packages/billing/src/actions/invoiceModification.ts`
- `packages/billing/src/actions/creditActions.ts`
- `packages/billing/src/actions/invoiceQueries.ts`
- `packages/billing/src/lib/adapters/invoiceAdapters.ts`
- `packages/billing/src/lib/adapters/invoiceAdapters.server.ts`
- `packages/types/src/lib/invoice-renderer/types.ts`
- `ee/docs/plans/2026-07-15-project-billing/features.json` (F067–F079 and F085–F092 only)
- `ee/docs/plans/2026-07-15-project-billing/SCRATCHPAD.md`

### Decisions

- Project billing is gated by a client-scoped `project_billing_configs` lookup. When it returns no rows, the engine retains the legacy calculator call shapes and returns the pre-feature result object without project fields. Fixed-price filters, phase joins, cap processing, and project grouping activate only with a matching config.
- Schedule charge amounts come from `computeEntryAmounts`; `deduct_final` uses `computeDepositReconciliation`. Recurring runs accept only recurring-mode configs, while `calculateProjectBilling` targets one standalone project and optionally one supplied entry-id set. Standalone T&M also selects all of that project's uninvoiced approved time and materials without date-window truncation.
- Project T&M phase overrides resolve an exact service override before the phase-wide null-service override. The selected override replaces the rate and, when configured, the emitted service identity/tax source. Fixed-price project time is excluded from both contract-associated and unresolved calculators.
- Cap previews remain read-only. Persistence re-evaluates each project cap after `getForUpdate` in the invoice transaction, handles hard-cap straddles with `computeCapWriteDown`, atomically records billed/write-down deltas and notify-only threshold crossings, and stores reversible invoice metadata. Unfinalize preserves the invoice's schedule/material linkage and cap consumption; hard delete releases those sources and reverses the cap deltas.
- Milestone/deposit invoice charges and the optimistic approved-to-invoiced entry transition share the existing invoice persistence transaction. `generateProjectInvoice` reuses `createInvoiceFromBillingResult` and only adds `invoices.project_id` for its standalone path.
- Credit-treatment deposits issue normal client-credit ledger/tracking records at finalization with project earmarks in transaction metadata. The existing credit application path prefers matching earmarked credit for a later standalone invoice carrying that project id.
- Recurring preview grouping mirrors contract grouping with synthetic `Project: <name>` bundle headers. Rendering enrichment supplies invoice-level project name/number and per-line project category/phase for the designer action path and the server-side PDF path; the internal PDF lookup id is non-enumerable so ordinary render payloads do not change.

### Verification

- `npx tsc --noEmit -p packages/types/tsconfig.json --pretty false` — pass.
- `npx tsc --noEmit -p packages/billing/tsconfig.json --pretty false` — no new errors; only the documented baseline `quoteActions.ts(32)` TS2307 for `@alga-psa/opportunities/lib/quoteLifecycleHooks`.
- From `server/`, the consolidated focused Vitest run covering billing-engine timing/end-exclusive/unresolved/product/license behavior, persisted recurring selection/execution, invoice generation preview/finalization/selection, invoice deletion guards, credit application/finalization/service-period behavior, and the invoice adapter — 17 files / 115 tests passed.
- `git diff --check` — pass.

## Wave 5 report

### Events, notifications, and readiness

- Added typed `PROJECT_MILESTONE_READY` and `PROJECT_BUDGET_THRESHOLD_REACHED` schemas and routed both through the event bus email and internal-notification channels.
- Milestone-ready publication now occurs after successful pending-to-ready transitions from explicit phase completion, the daily date-readiness job, and manual `markEntryReady`. Amounts use the authoritative cents/remainder allocation and payloads identify the readiness trigger.
- Budget-threshold publication occurs after invoice persistence and only for crossings newly written to the locked cap-usage row's `notified_thresholds`, preserving the existing database dedupe boundary.
- Added localized email and in-app templates, settings categories/subtypes, subscriber registration, and a migration for existing installations. Recipients follow project conventions: project manager plus client account manager, deduplicated.
- Registered `project-date-readiness` in both job systems and converged a daily 00:15 per-tenant singleton schedule. The handler runs in tenant context, calls `evaluateDateReadiness`, and publishes events for only the entries flipped by that evaluation.
- Recurring due-work candidates now carry additive warning objects when their client has any schedule entries that have remained `ready` for more than seven days. The warning does not alter `canGenerate`, blocker counts, or blocked reasons.

### Profitability and accounting

- Fixed-price project revenue now recognizes invoiced milestone/deposit schedule charges and excludes rated time/material lines from revenue while retaining their existing labor/material cost facts. Deduct-final deposits use the already-reduced final invoice charge, so deposits are not counted twice.
- Added additive `write_downs` metrics at summary, client, agreement, and agreement-line grains from persisted, non-rolled-back T&M cap deltas; revenue and margin math remain unchanged by this informational field.
- Project milestone/deposit charges receive dedicated service-catalog items so existing accounting item mapping/readiness applies. Export previews and stored line payload metadata now include charge type, project id/number/name, and schedule entry id.
- Verified deposit credits use the standard `credit_issuance` and credit-tracking flow. The QBO credit applier now detects project-deposit-backed positive invoices and follows the existing non-CreditMemo exception treatment instead of incorrectly using the invoice mapping as a CreditMemo.

### Verification

- Focused Vitest: 6 files / 61 tests passed (profitability, accounting export/readiness, credit application, recurring warning, and event schemas).
- `packages/projects` and `packages/event-schemas` TypeScript checks pass; `packages/event-bus` also checked cleanly during the wave.
- `packages/billing` TypeScript reports no new errors: only the documented baseline `quoteActions.ts(32)` TS2307 for `@alga-psa/opportunities/lib/quoteLifecycleHooks` remains.
- New notification migration/template CommonJS files pass `node --check`; `git diff --check` passes.
- Wave 5 changed no React components. Concurrent UI-lane edits remain separate in the shared worktree.

## Wave 6 report

### Test coverage added

- Added `server/src/test/unit/billing/projectBillingService.test.ts` with exhaustive allocation/remainder, cap straddle/exact/zero, threshold boundary/dedupe, and both deposit-reconciliation treatment cases (T005/T016/T017/T020).
- Added `server/src/test/unit/billing/projectBillingDateReadiness.test.ts` for before/on/after-date readiness behavior (T009).
- Added `packages/billing/src/actions/projectBillingActions.contract.test.ts` for config CRUD, currency and duplicate validation, immutable invoiced state, allocation gates, lifecycle/optimistic guards, deleted-phase fallback, event publication, and billing RBAC (T002–T007/T010/T026/T027).
- Added `packages/projects/src/actions/projectBillingLifecycle.contract.test.ts` for phase complete/reopen behavior, phase-delete FK fallback, project cancellation, and project-only phase RBAC (T008/T010/T025/T027).
- Added `server/src/test/unit/billing/projectBillingEngine.test.ts` for recurring/standalone selection, T&M inclusion, fixed-price exclusion, rate overrides, multi-run caps, deposits, taxes, and the no-config byte-identical golden output (T011–T017/T020–T022).
- Added `server/src/test/unit/billing/projectBillingInvoiceLifecycle.contract.test.ts` for standalone invoice transaction stamping, project-earmarked deposit credits/application preference, and the unfinalize-preserve/hard-delete-release lifecycle (T012/T019/T023).
- Added `server/src/test/unit/billing/projectBillingInvoiceRenderer.test.ts` for standalone project template variables and line metadata (T038).
- Added `server/src/test/unit/notifications/projectBillingNotifications.contract.test.ts` for localized email/in-app milestone-ready notification routing (T026).
- Extended the existing recurring warning, profitability, accounting export, and credit application suites for T024/T036/T037.
- Added `server/src/test/integration/billing/projectBillingSchema.integration.test.ts` with seven real-DB cases covering migrated schema/metadata, JSONB/date-only persistence, enum/unique/XOR constraints, raw illegal transition rejection, durable hold/release audit state, and two concurrent cap consumers (T001/T004/T007/T018/T039). The suite now passes against a freshly migrated local test database.
- Added `ee/server/src/__tests__/integration/project-billing.playwright.test.ts` with eight headed Playwright cases using the repository tenant/auth/permission helpers and component-provided automation ids (T028–T035).

### Bugs found and fixed

- `updateProjectBillingConfig` always passed `currency: undefined` into the Zod update object. Because the key survived parsing, ordinary updates such as total-price or cap edits incorrectly entered currency validation. The action now includes `currency` only when callers supplied it; the contract suite retains the regression case.
- The schedule-entry migration enforced valid status values but not valid status transitions, so raw SQL/model updates could skip directly from `pending` to `invoiced`. Added `20260715090006_guard_project_billing_schedule_status_transitions.cjs`, preserving the legitimate ready/hold/approve/invoice/unfinalize/cancel paths and rejecting other transitions with `P0001`. The real-DB suite verifies both illegal-transition rejection and the durable ready/held/ready path.
- Live smoke testing found that un-finalizing changed linked schedule entries from `invoiced` to unlinked `approved` while leaving the draft invoice and charge intact. Re-finalizing that draft could not reconstruct the link, so the milestone became billable again. `unfinalizeInvoice` now preserves linkage and cap usage; only `hardDeleteInvoice` calls the release helper. A live unfinalize/refinalize cycle retained both linkage IDs and the applied project credit.

### Verification

- Server focused Vitest: 6 files / 39 tests passed.
- Billing focused Vitest: 5 files / 61 tests passed.
- Projects focused Vitest: 1 file / 5 tests passed.
- Total newly written or directly extended non-Playwright verification: 12 files / 105 tests passed.
- Focused TypeScript compile for `project-billing.playwright.test.ts`: pass (8 specs). The specs were not executed against a full headed stack.
- `packages/projects` TypeScript: clean.
- `packages/billing` TypeScript: no new errors; only the documented baseline `quoteActions.ts(32)` TS2307 remains.
- Full `ee/server` TypeScript reached the 4 GiB Node heap limit; the focused Playwright config compiled cleanly with an 8 GiB limit.
- The new transition migration passes `node --check`.

### Infeasible or pending locally

- A Playwright `--list` discovery attempt with web-server startup disabled stopped before test discovery because the workspace package export for `@alga-psa/core/secrets` is unavailable to the unbuilt runtime. The focused TypeScript check passes, but T028–T035 still need a full headed-stack execution.
- `tests.json` marks all 39 planned tests implemented. The headed Playwright file remains an automation asset; its critical project-billing journeys were exercised manually against the live worktree server during the production-readiness smoke pass below.

## Orchestrator close-out (post Wave 6)

- The three DB-gated tests (T001/T018/T039) were verified against a throwaway `ankane/pgvector` container (port 55432, `DB_*` env overrides): all 843 migrations apply cleanly and the 5-test schema/concurrency suite passes, including the FOR UPDATE double-spend test. Container removed afterwards.
- Fixture fix during that run: the schema integration test inserted projects with random `status` uuids, violating `projects_status_tenant_foreign`; it now creates a `statuses` row (status_type 'project') first.
- Playwright specs (T028–T035) are written and typechecked but have not run against a live stack — first stack run should execute `ee/server/src/__tests__/integration/project-billing.playwright.test.ts`.
- Final state: 108/108 features, 39/39 tests implemented; all package typechecks at documented baselines.
- Post-wave-6 regression sweep (full `server/src/test/unit/billing/` directory, 726+ tests) caught what focused runs missed: (1) `persistProjectScheduleCharges` ran the export-service bootstrap (advisory lock + catalog queries) on every invoice even with zero project charges — passthrough violation, now early-returns; (2) the stale-ready warning query used groupBy/countDistinct outside the due-work harness builder subset — now a plain row fetch with JS counting; (3) `recurringDueWorkReader.static.test.ts` pinned the pre-warning pagination source line — pin updated to the warned-candidates line plus derivation assertions. Final: 728/728 across 165 files.

## Comprehensive production-readiness smoke pass

### Product decisions and fixes

- Confirmed cap policy: one hard cap applies to every project T&M charge, including labor and materials. Preview and persistence both group all charges annotated with the project billing config; persistence re-caps under `FOR UPDATE`. Tax is reduced proportionally when a charge straddles the cap.
- Added durable `held` state and `hold_reason`/`held_at`/`held_by` columns. Hold preserves `ready_at`; release clears hold audit fields and restores `ready`.
- `cap_notify_thresholds` is explicitly serialized as JSONB on model create/update. Date triggers use strict `YYYY-MM-DD` strings end-to-end and local calendar parsing in the UI.
- Fixed invoice preview serialization by passing the invoice id explicitly instead of attaching a hidden property to the render view model.
- Fixed draft tax-source switching so external-tax fields are cleared and charge/invoice totals plus the client transaction delta are recalculated atomically.
- Failed standalone generation now deletes its preallocated empty invoice header and restores an entry approved by `Approve & invoice now` back to `ready`.
- Community Edition invoice screens now treat accounting-sync status as an unavailable capability instead of throwing a 500.
- Hard deletion now unbills project and ticket materials in the same transaction as schedule/cap rollback. A stale preview request after deletion resolves to the nullable terminal state instead of a 500.
- Standalone T&M generation navigates to the canonical invoice route. Missing project-billing keys were added to every real locale with English fallback values while preserving existing translations; pseudo-locales were regenerated.

### Live verification (2026-07-15)

- Fixed price: edited an August 14 date trigger to August 20 through the date picker, saved/reloaded without a timezone day shift, and verified the database stored `2026-08-20`; fixture restored to pending/August 14 afterward.
- Hold lifecycle: ready→held persisted the exact reason, timestamp, actor, and original `ready_at`; held→ready cleared hold audit fields and retained `ready_at`.
- Threshold editor: saved `[60,85,100]` and restored `[75,90,100]`; PostgreSQL reported a JSONB array both times.
- T&M hard cap: a $5,000 material charge under a $3,000 cap generated a $3,000 invoice with $2,000 written down. External-tax pending→internal finalize succeeded; unfinalize preserved all project linkage. Hard delete then removed the invoice, restored the schedule to approved, unbilled the material, and reset billed/written-down cap usage to zero.
- Repeated the generate/hard-delete cycle after the preview-race fix. Browser network had no 5xx, browser console had no new errors, and server logs showed `hardDeleteInvoice` plus all follow-up actions returning 200.

### Automated verification

- Fresh migrated database: project-billing schema/profitability integration suites, 2 files / 19 tests passed.
- Full server billing-unit directory: 154 files / 613 tests passed (1 todo).
- Billing focused suites: locale smoke, deletion race, CE accounting-sync capability, tax-source recalculation, schema/action contracts, 6 files / 31 tests passed.
- Projects lifecycle contract: 1 file / 5 tests passed.
- `packages/types`, `packages/billing`, and `packages/projects` TypeScript checks pass. Translation validator passes for de/es/fr/it/nl/pl/pt/xx/yy with 0 errors and 0 warnings. The ALGA plan validator and `git diff --check` pass.
- Final fixture audit: the T&M project has no generated invoices, its schedule is approved/unlinked, its material is unbilled, cap usage is zero, and thresholds are restored to `[75,90,100]`; the fixed entry is restored to pending with trigger date `2026-08-14` and no hold/readiness metadata.

## Approved hardening follow-up (2026-07-15)

### Decisions

- Required milestone/deposit payment is warning-only and must be explicitly enabled per schedule entry. It does not reuse `ready` and never blocks task or time-entry actions.
- Technician projections contain only a generic warning unless the user also has billing read access; invoice metadata remains billing-protected.
- Payment satisfaction is derived from the linked invoice status instead of copied onto the project or schedule entry.
- Citus distributed-table lifecycle triggers are rejected. The existing trigger will be removed; status values stay database-constrained and supported transitions move through a centralized atomic expected-source update. Generic schedule updates may not mutate status.
- All capped T&M projects use the shared hard cap. Configured thresholds remain notification points. A dedicated first-overage event is keyed to cumulative written-down amount changing from zero to positive.
- Add workflow-catalog coverage for the existing milestone/threshold events plus budget exceeded, schedule status changed, config changed, and required-payment status changed.
- Invoice references open the existing preview in a reusable drawer. Project generation success no longer navigates away.
- Client-portal project billing requires client billing permission in addition to ownership and `show_billing`; it exposes the configured currency but no invoice details.
- Employee cost remains user-specific/default and effective-dated by the time-entry work date. It is tenant reporting currency; cross-currency project margin is unavailable unless comparable, and the UI must not relabel costs as project currency.
- Project-billing actions return the app-standard structured action/permission results. Unfinalize surfaces safe underlying reasons instead of replacing them with a generic alert.
- The locale pass requires genuine translations, locale-aware currency/date formatting, and regenerated pseudo-locales; English fallback completeness alone is insufficient.

### Design and plan

- Approved design: `docs/plans/2026-07-15-project-billing-hardening-design.md`.
- Added plan features F155–F177 and tests T040–T052; reopened legacy cap/lifecycle/UI tests whose expected behavior changes.

## Approved hardening implementation and comprehensive live smoke (2026-07-15)

### Fixes completed during smoke

- Payment-before-work is an explicit `requires_payment_before_work` schedule-entry flag. The derived warning is non-blocking, generic for users without billing read access, and may include linked-invoice context only for billing-authorized users.
- The time-entry dialog now retains a generic payment warning for the entire dialog lifetime after a flagged project task is selected. Service selection and Save remain enabled; the prior short-lived toast path was removed.
- Added `PROJECT_BILLING_PAYMENT_STATUS_CHANGED` schema/catalog/subscriber coverage for settlement, reversal, and replacement-needed states.
- Fixed `PROJECT_BUDGET_EXCEEDED` email handling: the subscriber previously referenced `uniqueRecipients` before initialization. The branch now runs after recipient/URL/currency setup, with a regression-order contract test.
- Finalized invoice single/bulk unfinalize paths now consume standard structured action results and display the safe underlying reason. The live exported-invoice guard displayed the full accounting-sync guidance instead of a generic alert.
- Finalized invoice i18n contract was updated for the structured bulk error key, and the pseudo locales now include `bulkUnfinalizeInvoiceFailed` interpolation placeholders.

### Live browser/database evidence

- Explicit flag: enabled `Payment required before continuing work` on an isolated milestone through the UI and verified database persistence.
- Warning surfaces: billing-authorized project warning included `INV-000005`; task creation and time entry showed warnings while all work controls remained enabled. A restricted client portal user received no project billing section or invoice data.
- Invoice drawer: clicking `INV-000005` opened the reusable `$4,000` invoice preview drawer while retaining the project URL. A fresh regression in the user-designated pane had zero console errors and zero 5xx requests.
- Hard cap: changed the isolated T&M cap to `$50`, approved one hour of time, and generated `INV-000011`. The invoice totaled exactly `$50`; `$5,100` was written down and cap usage persisted `billed_amount=5000`, `written_down_amount=510000`, `notified_thresholds=[75,90,100]`.
- Budget notification: replayed the first-overage event after the subscriber fix. The assigned project owner received the internal notification and the localized email notification log reached `sent`; no handler error remained.
- Unfinalize reason: added a reversible accounting mapping to finalized `INV-000005`, invoked Unfinalize in the browser, and saw `This invoice is synced to an accounting system — it cannot be reopened. Void it and reissue, or issue a credit note for the difference.` The invoice stayed finalized and the mapping was deleted after the assertion.
- Portal RBAC: an isolated client User role (without `billing:read`) saw project details but no Billing navigation/summary/amounts. An isolated Finance role saw the authorized summary and schedule but no `INV-*` identifiers.
- Currency: the Finance portal rendered the same project in EUR (`€10,000` total / `€6,000` invoiced) and zero-decimal JPY (`¥1,000,000` total / `¥600,000` invoiced) with matching schedule amounts. The project was restored to USD immediately after each assertion.
- Economics: live project delivery economics surfaced one uncosted hour rather than inventing a cost. Code/tests retain effective-dated user/default labor-cost selection in tenant reporting currency and suppress cross-currency margin.
- Citus lifecycle: the hardened migration removes the distributed-table lifecycle trigger; the model rejects generic status updates and uses the centralized expected-source atomic transition map. Status-value constraints remain in PostgreSQL.

### Verification and environment notes

- Focused package tests passed for payment-warning behavior, structured action errors, invoice lifecycle, notification routing, event schemas/catalog, finalized-tab i18n, and the 30-case project i18n audit. Scheduling typecheck passed after the persistent warning change.
- All edited locale JSON files parse successfully. The fixed-project currency is restored to USD and the reversible accounting-export mapping is absent.
- The schema integration asset remains present and previously passed on a freshly migrated throwaway database. A rerun in this session was blocked by stale `.env.localtest` wiring: port `5472` currently resolves to the unrelated license-validation PostgreSQL container and cannot authenticate/recreate `test_database`. Live migrated-schema inspection and mutation tests were used instead; do not point destructive test bootstrap at the running `server` database.
- Unrelated observation: a time period created for Jul 13–19 rendered Jul 13–18 on the employee period/timesheet views while approvals showed Jul 13–19. This appears to be a pre-existing date-display issue outside project billing.
- Final focused regression: 14 Vitest files / 115 tests passed. `packages/billing`, `packages/projects`, `packages/scheduling`, and `packages/event-schemas` TypeScript checks passed. All 30 edited real/pseudo locale JSON files parse, the ALGA plan validator passes at 131/131 features and 52/52 tests, and `git diff --check` is clean.

## Approved temporary project-billing UI flag (2026-07-15)

- Approved design: `docs/plans/2026-07-15-project-billing-ui-feature-flag-design.md` (design commit `1aa69b8a38`).
- Flag key: `project-billing-ui`; client-side only, default/fail closed.
- Hide all ambient traces when disabled: project Billing discovery, billed header, phase billing badges/toast, project/task/time warnings, Invoicing Hub trigger/count, client-portal toggle/summary.
- Explicit project and invoicing deep links remain functional. Persisted Billing preference alone is not a bypass and falls back to Kanban.
- Do not add server-side feature-flag evaluation or page wrappers. Backend/API/event/job/invoice behavior and RBAC remain unchanged.
- `CustomTabs` needs a small trigger-visibility seam so a tab can remain URL-addressable while its trigger is absent.
- Added plan features F178–F184 and focused tests T053–T056.

### Implementation and verification

- Added the fail-closed client hook at each ambient discovery seam without adding server-side flag evaluation or route guards.
- Added `CustomTabs.hideTrigger` so an explicit hidden-tab URL can render its content while the tab trigger remains absent.
- Project `?view=billing` and Invoicing Hub `?tab=invoicing&subtab=project-billing` direct access remain functional; a persisted Billing view alone falls back to Kanban while the flag is disabled.
- Focused Vitest coverage passed: 6 files / 29 tests, including dynamic hidden-trigger/direct-content and client-configuration flag-state assertions. TypeScript checks passed for `packages/ui`, `packages/billing`, `packages/projects`, `packages/scheduling`, and `packages/client-portal`.
