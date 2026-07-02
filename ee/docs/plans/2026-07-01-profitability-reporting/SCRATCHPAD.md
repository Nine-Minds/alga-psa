# Scratchpad — Real Profitability Reporting

## Key decisions (rationale in PRD §6)

- **D1 query-time rate join, no snapshot column.** Chosen over stamping `cost_amount` on `time_entries` because effective dating gives identical historical results, works retroactively for tenants that configure rates late, and avoids hooks in every time-entry write path + a backfill job. Revisit if finance demands immutable-after-invoice cost.
- **D2 tenant default = `user_cost_rates` row with `user_id IS NULL`.** One table, one resolution rule.
- **D4 cost on actual duration (end−start), revenue on `billable_duration`.** This is what makes EHR honest for fixed/bucket agreements.
- **D9 remove `contracts.profitability` from ReportRegistry** rather than fixing it — it's surfaced nowhere, and two implementations of margin math will drift.

## Codebase anchors (verified during gap analysis, 2026-07-01)

- Stub #1 (live UI): `packages/billing/src/actions/contractReportActions.ts:534-597` — `totalCost = totalHours * 5000` cents.
- Stub #2 (registry, unsurfaced): `packages/reporting/src/lib/reports/definitions/contracts/profitability.ts` — `billable_duration * 833.33`; broken join `invoices.client_id = time_entries.user_id` (~line 89).
- Canonical revenue SQL: `packages/reporting/src/lib/reports/definitions/contracts/revenue.ts:76-118` (fixed-detail `allocated_amount` else `MAX(net_amount)` pattern, `client_contract_id IS NOT NULL`).
- Entry→item link gap: `packages/billing/src/services/invoiceService.ts:192-214` `linkAndMarkSourceBillingRecord` inserts only `(invoice_id, entry_id)` into `invoice_time_entries`; `ITimeBasedCharge.entryId` is in memory at that point (`packages/types/src/interfaces/billing.interfaces.ts:28`).
- Agreement resolution for time: `packages/billing/src/lib/billing/billingEngine.ts` — `getEligibleContractLineIdsForServiceAtDate` (~:977), deterministic single-match write of `time_entries.contract_line_id` (~:1094), time-charge query (~:3018-3352).
- Materials: `ticket_materials`/`project_materials` (`server/migrations/20260101093000_create_ticket_project_materials.cjs`); billed via `calculateMaterialCharges` (`billingEngine.ts:4008`).
- `service_catalog.cost` + `cost_currency`: `20260101090000` / `20260107190000` migrations — product COGS only.
- Terminology: `client_id` (not company), `board_id` (not channel), `contract_lines` (not billing_plans), `invoice_charges` (physical; `invoice_items` is a compat view — write new queries against `invoice_charges`).
- Mixed units hazard: invoice-side tables are integer cents; some contract-config tables are decimal dollars. Report must only read cents tables.
- `ticket_entity_links` (`entity_type='contract'`) is workflow-only — 0 refs in billing engine. Do NOT use for attribution.
- Permissions precedent: contract report actions gate on `hasPermission(user, 'billing', 'read')`; reports RBAC seed `server/migrations/20260511120000_add_reports_rbac_permissions.cjs`.
- Scheduling (if rollups ever needed): `IJobRunner` abstraction via `JobRunnerFactory` (`server/src/lib/jobs/JobRunnerFactory.ts`) — Temporal in EE (refuses pg-boss), pg-boss in CE. Never wire pg-boss directly.

## Implementation risks / gotchas

- ~~item_id availability at link site~~ RESOLVED (review round 1): `persistInvoiceCharges` inserts the `invoice_charges` row (with generated `item_id`) *before* calling `linkAndMarkSourceBillingRecord` (`invoiceService.ts:1023-1063`). Safe to persist.
- Citus: `user_cost_rates` distribution via **guarded inline `create_distributed_table` in the same CE migration** (convention example: `server/migrations/20251110223310_create_appointment_requests.cjs`) — NOT a separate ee/server/migrations file (D12/F003). App-level overlap check because exclusion constraints aren't Citus-friendly.
- ~~work_date NULL fallback~~ RESOLVED (review round 5): `work_date` is NOT NULL since `20260521120000_enforce_time_entry_work_date_not_null.cjs` (with `work_timezone`); that migration also added `(tenant, user_id, work_date)` and `(tenant, work_date)` indexes — exactly what the labor-cost CTE needs. No COALESCE fallback. `end_time` is likewise NOT NULL since the initial schema — the only duration guard needed is clamping `end_time <= start_time` rows to 0.
- Citus FK hazard: `users` is distributed (`ee/server/migrations/citus/20250805000006_distribute_users.cjs`); an FK from a not-yet-distributed table to it fails. `user_cost_rates` therefore has NO FKs (convention: `20251110223310_create_appointment_requests.cjs`, incl. `exports.config = { transaction: false }`); integrity in the model layer.
- Overlap check must take `pg_advisory_xact_lock(hashtext(tenant || coalesce(user_id::text,'default')))` before check-then-write — plain READ COMMITTED check races; resolution SQL is single-row deterministic as a second line of defense.
- Rounding: per-entry cent rounding then summation vs sum-then-round can differ by cents; pick per-entry rounding and use largest-remainder for allocations (T034, T057).
- ~~Fixed-charge service period source~~ RESOLVED (review round 2): `invoice_charge_details.service_period_start/end` written at generation (`invoiceService.ts` ~925, ~1075); fallback `invoices.billing_period_start/end` (nullable — terminal rule: agreement residual). The "recurring service period" step is redundant/dead (`linkRecurringServicePeriodToInvoiceDetail` returns early unless the period values already exist).
- ~~invoice_time_entries PK shape~~ RESOLVED (review round 1): PK is `(invoice_time_entry_id, tenant)` (`20250512135501_update_constrains_and_fks.cjs:110`); nullable `item_id` is backfill-safe; invoice deletion already wipes link rows wholesale (`invoiceModification.ts:1246`).
- ~~Legacy time-charge pool identification~~ RESOLVED (round 7, production audit): legacy hourly invoices (NULL `item_id`) stay at **agreement level** — production has exactly 2 invoices with `invoice_time_entries` rows (1 tenant), so the pool heuristic was cut (F035/T056/T092 rewritten). D7's defensive N:1 apportionment for *new* link rows remains.
- **`client_contract_lines` is DROPPED** (`20251207140000_drop_redundant_client_contract_tables.cjs`; "deprecated" note at `billingEngine.ts:4640`) — round-1–6 critics and the PRD all missed this. Agreement attribution for time entries is `time_entries.contract_line_id → contract_lines → contracts → client_contracts` on `contract_id` (fetchDiscounts pattern). Verified in production: `client_contracts.contract_id` currently unique per tenant, 0 NULLs.
- Bucket calculator emits OVERAGE charges only; bucket base fee arrives via the fixed-charge path (`billingEngine.ts:4307,4338-4366`; calculators all run per line `:795-833`).

## Commands

- Migrations: `npm run migrate` (CE; inline-guarded Citus DDL runs in the same migration — see citus-migration-fixer agent if it breaks).
- i18n check: `generate-pseudo-locales.cjs` + `validate-translations.cjs` (single consolidated run).
- Build: `npm run build`; single package: `npx nx build billing`.

## Implementation log

### 2026-07-02 — Cost-rate settings UI batch

- F013 implemented: added a `cost-rates` section to `BillingSettings.tsx` alongside general/quoting/tax/payments, rendering the new `CostRatesSettings` panel under Billing Settings.
- F014 implemented: `CostRatesSettings` includes an add/edit dialog with default-vs-user selection, cents-aware hourly cost input, and effective-from/effective-to date inputs.
- F015 implemented: internal users render with current effective rate and expandable per-user rate history, including row-level edit/delete controls.
- F016 implemented: editing or deleting a rate first calls `checkCostRateWorkedTimeImpact`; if worked time intersects the existing effective range, the UI shows a confirmation warning before mutating historical cost data.
- F017 implemented: tenants with no cost-rate rows see an explicit empty state prompting setup of the tenant default rate.
- F018 implemented: interactive controls use kebab-case IDs in the local UI API, and all Cost Rates text/format strings are routed through `msp/billing-settings` locale keys across language packs.
- T018 implemented: added action coverage for `checkCostRateWorkedTimeImpact`, verifying the model-layer worked-time indicator is returned and tenant/user/range arguments are passed through.
- T020 implemented: component test verifies the default banner, internal user list, current rate, and history controls render from mocked `listCostRates` data.
- T021 implemented: component test verifies entering `62.50` persists `6250` cents to `upsertCostRate`.
- T022 implemented: component test verifies an edit covering worked time shows the warning dialog and defers `upsertCostRate` until confirmation.
- T023 implemented: component test verifies the empty state appears when there are no rate rows and exposes the Set Default action.
- T024 implemented: component test and locale updates cover the Cost Rates screen's translated labels and accessible controls; note that the built UI package used in Vitest does not expose every Button/Input `id` as a DOM id, so tests interact by accessible names/input types while the component still supplies kebab-case IDs to the local UI API.
- Commands run: `cd server && npx vitest run ../packages/billing/src/components/settings/billing/CostRatesSettings.test.tsx ../packages/billing/src/actions/costRateActions.test.ts --coverage.enabled=false`; `npm -w @alga-psa/billing run typecheck`.

### 2026-07-02 — Invoice time-entry item link batch

- F019 implemented: `linkAndMarkSourceBillingRecord` now receives the persisted `invoice_charges.item_id` from `persistInvoiceCharges` and stores it on new `invoice_time_entries.item_id` rows for time charges.
- F020 implemented: targeted persistence coverage verifies the current engine path writes one invoice charge and one item-linked `invoice_time_entries` row per time entry; this preserves the 1:1 invariant and gives report queries exact item IDs.
- F021 implemented: non-time charges continue through the existing source-link paths without creating `invoice_time_entries` rows, and manual invoice charge persistence remains outside the time-entry link path.
- T025 implemented: unit test verifies a one-entry time invoice writes an `invoice_time_entries` row whose `item_id` equals the generated `invoice_charges.item_id`.
- T026 implemented: unit test verifies three time entries create three invoice charge rows, three distinct item IDs, and three source-link rows with matching item IDs.
- T027 implemented: manual invoice persistence test verifies manual invoice charges create no `invoice_time_entries` rows and do not error.
- T028 not yet implemented: attempted `cd server && npx vitest run src/test/infrastructure/billing/invoices/fixedPriceAndTimeBasedPlans.test.ts --coverage.enabled=false`; it emitted no progress for roughly five minutes and was stopped with Ctrl-C. Targeted invoice-service tests passed, but the broad integration regression remains unchecked.
- Commands run: `cd server && npx vitest run src/test/unit/billing/invoiceService.fixedPersistence.test.ts src/test/unit/billing/invoiceService.manualPeriodPolicy.test.ts src/test/unit/billing/invoiceService.recurringDetails.static.test.ts --coverage.enabled=false`; `npm -w @alga-psa/billing run typecheck`.

## Implementation log

- 2026-07-02 batch 1 (schema + cost-rate model/actions):
  - Added `server/migrations/20260702120000_create_user_cost_rates.cjs` with tenant-first `(tenant, rate_id)` PK, nullable plain-UUID `user_id`, cents/hour `cost_rate`, inclusive effective dates, audit columns, nonnegative/range CHECKs, `(tenant, user_id, effective_from)` index, no FKs, guarded inline `create_distributed_table`, and `exports.config = { transaction: false }`.
  - Added `server/migrations/20260702120100_add_item_id_to_invoice_time_entries.cjs` with nullable `invoice_time_entries.item_id` plus `(tenant, item_id)` index.
  - Registered `user_cost_rates` in both tenant metadata sources: `packages/db/src/lib/tenantTableMetadata.ts` and `server/migrations/utils/tenantDb.cjs`.
  - Added `IUserCostRate` to `packages/types/src/interfaces/billing.interfaces.ts`.
  - Added `packages/billing/src/models/userCostRate.ts`: tenant-scoped list/listByUser/get/resolve/upsert/delete, typed validation errors, model-layer internal-user validation, advisory transaction lock before overlap checks, inclusive overlap predicate, deterministic `ORDER BY user_id IS NULL, effective_from DESC, rate_id LIMIT 1` resolution helper, and worked-time intersection helper.
  - Added `packages/billing/src/actions/costRateActions.ts`: `listCostRates` (`billing.read`), `upsertCostRate`/`deleteCostRate` (`billing.update`), internal-user listing, current-rate derivation, and `covers_worked_time` return values for warning UI.
  - Tests added:
    - `server/src/test/unit/migrations/profitabilityCostRatesMigration.test.ts`
    - `packages/billing/src/models/userCostRate.test.ts`
    - `packages/billing/src/actions/costRateActions.test.ts`
  - Checks run:
    - `cd server && npx vitest run ../packages/billing/src/models/userCostRate.test.ts ../packages/billing/src/actions/costRateActions.test.ts src/test/unit/migrations/profitabilityCostRatesMigration.test.ts --coverage.enabled=false` ✅
    - `npm -w @alga-psa/billing run typecheck` ✅
  - Checklist updated: F001-F012 implemented. Tests marked true where covered by this batch: T001-T004, T010-T011, T013-T017, T019, T099. T005-T009/T012/T018 remain open for deeper DB or concurrency fixtures.

## Review log

- 2026-07-01: Plan drafted.
- 2026-07-01 round 1 (critic): 0 blockers, 3 majors, 5 minors, 2 nitpicks. All corrected:
  - MAJOR: `invoice_charges.contract_line_id` does not exist — per-line revenue redefined via `invoice_charge_details.config_id` → `contract_line_service_configuration.contract_line_id` (fixed/recurring) and `item_id` → `time_entries.contract_line_id` (hourly). PRD §5, §7.4, F031, T091.
  - MAJOR: time charges are 1:1 entry:item (no consolidation in engine) — D7/D8/F020/F034 restated; apportionment now legacy-path + defensive only (T026, T055).
  - MAJOR: fixed-allocation window fallback chain defined: `invoice_charge_details.service_period_start/end` → recurring service period → `invoices.billing_period_start/end` tagged approximate; detail-less charges stay at agreement level as residual (D8, F036/F037, T085/T086).
  - MINOR fixes: legacy `open`/`completed` statuses added to D11; Citus DDL inline-guarded in F001 migration (F003); NULL `exchange_rate_basis_points` → exclude + warn (F023, T087); materials revenue basis + uncosted materials (new D13, F026, T088/T089); agreement cost join de-dup rule (F029, T090).
  - NITPICKs: Reports.tsx card description + ContractReports Promise.all adjustment folded into F051; T079 reworded.
  - Positively verified by critic: `persistInvoiceCharges` inserts charges before `linkAndMarkSourceBillingRecord` (item_id available — risk resolved); `invoice_time_entries` PK includes tenant; registry removal safe (nothing executes `contracts.profitability`); time charges carry `client_contract_id` (billingEngine.ts:3371).
- 2026-07-01 round 2 (critic): 0 blockers, 1 major, 5 minors, 3 nitpicks. All corrected:
  - MAJOR: legacy time-charge pool identification rule added (no type column on invoice_charges) — D8, F035, T092.
  - MINORs: bucket = overage-only, base via fixed path (D8, F037, T059); unbilled material cost dated by created_at (D13, F026); scratchpad gotchas de-staled; D8 terminal rule for NULL invoice window (F036, T093); NULL client_contract_id assignments → Unattributed (F029, §7.4, T094).
  - NITPICKs: dead "recurring service period" fallback step dropped from D8; acceptance criterion 5 reworded (allocations + residual); F044 notes DataTable lacks built-in expandable rows.
  - Round-1 corrections all re-verified correct against the codebase (id spaces, fallback columns, de-dup rule, Citus convention, DataTable onRowClick).
- 2026-07-01 round 3 (critic): 0 blockers, 0 majors, 2 minors, 3 nitpicks. All corrected:
  - MINORs: materials have no agreement attribution (engine emits material charges without client_contract_id) — revenue → Ad-hoc row, cost → Unattributed row (D13, F026, T039); Usage/product/license charges stay at agreement level in the ticket view — usage_tracking has no ticket linkage (D8, F033).
  - NITPICKs: billed material cost dated by invoice_date with rationale (D13); §9 risk row updated to two-step fallback; F035 heuristic bound documented (pre-2025-04 fixed charges without detail rows).
  - F035 primitives verified real: recurring_service_periods.charge_family CHECK includes 'hourly' (20260318120000:36,97), invoice linkage columns exist (20260318143000), time→hourly mapping at invoiceService.ts:259. Note: recurring_service_periods only exists since 2026-03 — most legacy invoices predate it; the "where present" phrasing covers that.
- 2026-07-01 round 4 (critic, confirmation pass): **0 blockers, 0 majors, 0 minors, 2 nitpicks** — convergence reached. Both nitpicks applied anyway: D6/F030 widened to name all three Unattributed feeds; unconverted-revenue and uncosted-materials counts added to the summary output (§7.4), F048, and T076. All round-3 corrections verified correct as written.
- 2026-07-02 round 5 (fresh critic, new angles): 0 blockers, 3 majors, 5 minors, 3 nitpicks. All corrected:
  - MAJOR: client-attribution chain for time-entry cost defined per work_item_type (interaction/appointment_request have client linkage; ad_hoc/non_billable_category → "No client") — §7.4, D6, F028, T095.
  - MAJOR: no FKs on user_cost_rates (users is Citus-distributed; FK DDL would fail on EE); bare table → guarded distribute, transaction:false — §7.1, F002, T003 reworked to model-layer integrity, T099.
  - MAJOR: overlap check serialized via pg_advisory_xact_lock; rate resolution made single-row deterministic (LATERAL ORDER BY user_id IS NULL, effective_from DESC LIMIT 1) so overlaps can never double-count — §7.1, D2, F007, F008, T096/T097.
  - MINORs: work_date is NOT NULL since 20260521120000 (fallback dropped; D1, F008, F024, T014 rewritten; useful indexes noted); end_time NOT NULL — "open entries" concept replaced with zero/negative-duration clamp + zeroDurationEntryCount (D4, F024, F048, T036); cost includes all approval statuses with unapprovedMinutes surfaced (D4, F024, F027, T098); default range = last complete month (invoice-date basis makes current-month deep-red; F041, T070); T044 reworded (tickets.client_id NOT NULL on cleanly migrated DBs — No client row driven by clientless work-item types).
  - NITPICKs: F027 field list aligned; ticket_materials.currency_code NOT NULL DEFAULT 'USD' caveat added to D10; created_at range filtering pinned to (AT TIME ZONE 'UTC')::date (§7.4, F026).
- 2026-07-02 round 6 (fresh critic, confirmation): **0 blockers, 0 majors, 0 minors, 2 nitpicks** — convergence re-reached. Critic verified the advisory-lock key SQL (int4→bigint cast, uuid||text concat, xact-scope semantics all valid) and LATERAL ordering (false<true so user-specific wins), and the full client-attribution join chain (project_tasks.phase_id → project_phases.project_id → projects.client_id; ad_hoc → NULL client at workItemActions.ts:542). Both nitpicks applied: rate_id added as final ORDER BY tiebreak (D2, F008); inclusive-inclusive interval semantics + overlap predicate stated normatively in §7.1. Plan is implementation-ready.
- 2026-07-02 round 7 (**production data audit**, read-only queries against hosted prod — pgvector Citus cluster, db `server`): 1 blocker, 2 minors found and corrected; one major simplification taken.
  - BLOCKER: PRD's agreement cost chain joined through `client_contract_lines`, which is **dropped** (see gotcha above). Chain rewritten to `contract_lines → contracts → client_contracts` (§7.4, D6, F029, F030, T046, T090, T094).
  - SIMPLIFICATION: legacy hourly apportionment (F035's pool heuristic) cut — legacy scale is 2 invoices / 22 link rows / 1 tenant; legacy invoices now agreement-level residual (D7, D8, §9, F035, T056, T092).
  - MINOR: invoice status `Unpaid` exists in prod (3 invoices, 2024-09, $225 total) and was missing from D11 — added to countable list (F022, T029). Legacy `open`/`completed` appear on **zero** prod rows (kept for safety; self-hosted installs may differ).
  - MINOR: D6 note added — ~60% of prod time entries have NULL `contract_line_id`, so "Unattributed" is the common case; UI must present it neutrally.
  - Production scale (2026-07-02): 91 tenants, 167 internal users, **42 invoices** (22 draft / 17 sent / 3 Unpaid; top tenant = the 11111111… demo tenant), 163 invoice_charges (56 NULL client_contract_id, 32 manual, 0 discounts), 22 invoice_time_entries (2 invoices, 1 tenant), **410 time_entries** (362 ticket / 25 ad_hoc / 23 project_task; 249 NULL contract_line_id; 199 DRAFT / 30 SUBMITTED / 4 CHANGES_REQUESTED vs 177 APPROVED — unapprovedMinutes matters; 70 with billable_duration=0 — D4 actual-duration costing matters), 45 client_contracts, 112 contract_lines (66 Fixed / 24 Hourly / 22 Usage / **0 Bucket** — F037 has no prod data, kept as engine-driven), 0 NULL service periods on invoice_charge_details, 23/42 invoices NULL billing_period, **all 42 invoices NULL exchange_rate_basis_points** incl. 3 non-USD (AUD+CAD) → D10 unconverted-revenue warning fires on real data, 283/330 service_catalog rows NULL cost → uncosted-materials flag will be common, 6 materials rows (0 billed, 3 non-USD), 45 tickets with NULL client_id (T044's legacy case is real). Perf risk for v1 is nil at this scale.
