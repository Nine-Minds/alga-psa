# Bucket Overlays Migration Plan

This plan transitions “Bucket” from a standalone plan type into an overlay on top of Hourly and Usage contract lines. The outcome is a simpler UX, clearer billing semantics, and reduced disambiguation complexity while preserving bucket usage tracking and overage billing.

This is a clean cutover and redesign without any requirement to preserve backward compatibility or legacy behavior.

The plan is phased to minimize risk and to keep tests green throughout. Each phase lists: goals, tasks, code touchpoints, acceptance criteria, and rollout notes.

---

## Phase 1 — Foundations

Goals
- Align interfaces and test utilities on the new overlay model.

Tasks
- Confirm current tables used by buckets (no schema change now):
  - `plan_service_configuration` (with `configuration_type = 'Bucket'`)
  - `plan_service_bucket_config` (stores per-line bucket config: total_minutes/units, overage_rate, allow_rollover, billing_period, etc.)
  - `bucket_usage` (per period usage results, minutes/units used and overage)
- Establish coding conventions for overlay editor reuse and per-line validation.

Schema verification (2025-02-14)
- `plan_service_bucket_config` exists with `(tenant, config_id)` PK, FK back to `plan_service_configuration`, and bucket fields: `total_minutes`, `billing_period`, `overage_rate`, `allow_rollover`, timestamps.
- `contract_line_service_configuration` exists with `(tenant, config_id)` PK but currently lacks FKs to `contract_lines` and `service_catalog`, and has no supporting indexes on `contract_line_id` / `service_id`.
- `contract_line_service_bucket_config` mirrors the plan table structure (`total_minutes`, `billing_period`, `overage_rate`, `allow_rollover`, timestamps) but is missing the `(tenant, config_id)` FK back to `contract_line_service_configuration`.
- Recommended follow-up migrations for Phase 2+: add `(tenant, contract_line_id)` FK + index, `(tenant, service_id)` FK + index, and unique `(tenant, contract_line_id, service_id)` constraint on `contract_line_service_configuration`; add `(tenant, config_id)` FK on `contract_line_service_bucket_config`; audit `bucket_usage` to ensure it will link to contract-line overlays post-cutover.

Acceptance
- Documentation notes captured in this plan; team aligned on scope.

Rollout
- N/A

---

## Phase 2 — Test Helpers & Unit Tests First

Goals
- Migrate shared test helpers to create “bucket overlays” on Hourly/Usage lines instead of a dedicated `Bucket` plan type.

Tasks
- Update helper in `server/test-utils/billingTestHelpers.ts`:
  - Replace `createBucketPlanAssignment(...)` with `createBucketOverlayForPlan(...)` that:
    - Ensures an Hourly or Usage plan exists (create if needed).
    - Inserts `plan_services` entries for target services (if missing).
    - Upserts `plan_service_configuration` with `configuration_type = 'Bucket'` for each service.
    - Inserts `plan_service_bucket_config` with: `total_minutes` (for hours) or units as “minutes” generic quantity for usage, `overage_rate`, `allow_rollover`, `billing_period`.
  - Remove the old function usage across the suite; do not maintain a shim.
- Update/adjust unit tests that explicitly assert `plan_type = 'Bucket'`:
  - `server/src/test/unit/contractLineDisambiguation.test.ts`: remove bucket-plan special cases; add overlay preference tests (prefer lines with active bucket balance).
  - `server/src/test/unit/timeEntryBillingPlanSelection.test.tsx`: mock overlay presence (not plan type) and assert default selection preference.
  - `server/src/test/unit/billingPlanSelection.test.ts`: same as above.
- `server/src/test/unit/billingEngine.test.ts`: replace “calculateBucketPlanCharges” expectations with overlay consumption assertions (time/usage paths).
- `server/src/test/unit/bucketUsageService.test.ts`: confirm logic still works with overlays.
- Progress (2025-02-14):
  - Helper rewritten as `createBucketOverlayForPlan` and wired to both contract-line and legacy plan tables; usage helper now records `contract_line_id`.
  - Invoice infrastructure test (`usageBucketAndFinalization`) migrated to build overlays on top of fixed lines and seed usage via overlay helper.
  - Selector/disambiguation unit tests now mock `has_bucket_overlay` metadata instead of `contract_line_type === 'Bucket'`; pending updates to the production disambiguation logic and remaining billing engine/unit suites.
  - Billing engine unit coverage updated to treat overlays as the source for bucket charges (`calculateBucketPlanCharges` test now stubs overlay rows and bucket usage, and `calculateBilling` aggregates the overlay charge).
  - UI/service layers now consume overlay metadata: contract-line selectors prefer overlays, usage/time-entry actions update bucket usage when overlays exist (rather than relying on `contract_line_type`), and API imports point at `contractLineDisambiguation`.
- Follow-up work to finish ripping out bucket plans
  1. **Contract wizard + Playwright flows**
     - Update `contractWizardActions` so bucket configuration toggles add overlays to the existing fixed contract line (never create a `contract_line_type = 'Bucket'` row).
     - Remove bucket-plan assertions from the Playwright suite (`ee/server/src/__tests__/integration/contract-wizard-happy-path.playwright.test.ts`) and replace them with overlay verifications (`contract_line_service_configuration` + `contract_line_service_bucket_config` joins).
     - Adjust wizard helpers/seeders to account for overlay toggles and ensure monthly-fee behaviour still covered.
     - Drop `bucket_contract_lines` from test cleanup lists once the wizard no longer creates them.
  2. **Reporting/analytics surfaces**
     - Switch `getRemainingBucketUnits`, client-portal billing metrics, and account dashboards to join `contract_line_service_configuration` + bucket overlays (remove `.where(plan_type = 'Bucket')` or `contract_line_type === 'Bucket'` filters).
     - Update any UI components (e.g. `BucketContractLineConfiguration`) that guard on plan type so they inspect overlay metadata instead.
  3. **Service APIs & helpers**
     - Finish migrating remaining server actions and utilities that still query `contract_line_type` (search codebase for `'Bucket'` checks) – specifically `ContractLineServiceConfigurationService`, report actions, constants, and interfaces in `billing.interfaces.ts`.
     - Update TypeScript enums/interfaces to drop `'Bucket'` from `contract_line_type` once overlay consumers are in place.
  4. **Database/tests cleanup**
     - Remove dependencies on the `bucket_contract_lines` table from tests; plan a follow-up migration to archive/drop the table after the data migration script (Phase 8) runs.
     - Sweep remaining tests/integration helpers that reference legacy plan tables (e.g. `bundle_billing_plans` lookups) and ensure they validate overlays instead.

Acceptance
- Unit tests compile and run; bucket assertions are overlay-based.

Rollout
- N/A

---

## Phase 3 — Contract Wizard: Per-Line Bucket Overlays

Goals
- Replace the separate “Bucket Services” step with per-line overlays inside Hourly and Usage steps.

Tasks
- Remove the dedicated wizard step (UI only change):
  - `server/src/components/billing-dashboard/contracts/ContractWizard.tsx`
    - Update `STEPS` to drop “Bucket Services” and adjust navigation/validation.
    - Update `validateStep` logic to stop validating the removed step.
- Introduce per-line bucket overlay in:
  - `FixedFeeServicesStep.tsx` and `HourlyServicesStep.tsx`: Add a toggle and fields per service for included hours (stored as minutes), overage rate (cents), and rollover support.
  - `UsageBasedServicesStep.tsx`: Provide the same overlay toggle with included units (stored as generic minutes), overage rate, and rollover toggle.
- Create a reusable `BucketOverlayFields` component that renders the shared overlay inputs and automation hooks; reuse it across the fixed, hourly, and usage steps.
- Update the review step to summarize overlays under each line item.

Acceptance
- Wizard lets users add bucket overlays per Hourly/Usage line with proper validation.
- No separate bucket step shown when the flag is ON.

Rollout
- N/A

---

## Phase 4 — Wizard Submission & Persistence

Goals
- Persist per-line overlays instead of creating a `Bucket` plan.

Tasks
- Update `ContractWizardData` and the submission payload to capture a `bucket_overlay` object per fixed/hourly/usage service with fields:
  - `{ total_minutes?: number, overage_rate?: number, allow_rollover?: boolean, billing_period?: 'monthly' | 'weekly' }`
- Modify `server/src/lib/actions/contractWizardActions.ts`:
  - Remove creation of a dedicated `Bucket` plan.
  - After creating each contract-line service configuration, upsert a matching `contract_line_service_configuration` + `contract_line_service_bucket_config` row when `bucket_overlay` is provided, using a shared helper to insert/update the overlay metadata.
- Monthly fee handling (decision):
  - Option A (preferred for now): bill the “bucket monthly fee” by adding/allocating a Fixed Fee line scoped to that service (documented on the plan). No schema change needed; engine already handles fixed fees.
  - Option B (future): add `monthly_fee` to `plan_service_bucket_config` (requires migration and engine update). Leave as a future enhancement.

Acceptance
- New contracts with overlays persist correctly and no `Bucket` plan is created.

Rollout
- N/A

---

## Phase 5 — Billing Engine: Consume Overlays

Goals
- Calculate included minutes/units and overage from overlay configs during invoice generation; eliminate reliance on a `Bucket` plan type.

Tasks
- In `server/src/lib/billing/billingEngine.ts`:
  - Remove/retire `calculateBucketPlanCharges` (or convert into an internal helper that aggregates overlay consumption per line).
  - For time-based charges:
    - Fetch applicable overlay configs for the Hourly line’s plan/service during the billing period.
    - Compute available included minutes from `plan_service_bucket_config` minus previously used (`bucket_usage`) for that period.
    - Allocate billable time first against remaining bucket minutes; compute overage minutes and bill at `overage_rate`.
  - For usage-based charges:
    - Same pattern using “units” (represented as minutes in `total_minutes` for parity).
  - Write/update `bucket_usage` for the period with new consumption and overage.
  - Ensure tax logic remains consistent; overage lines should apply the service’s tax config.

Acceptance
- Engine produces correct totals for lines with bucket overlays (included + overage).
- Infrastructure invoice tests pass with overlays.

Rollout
- N/A

---

## Phase 6 — Plan Disambiguation Update

Goals
- Simplify plan selection by preferring plans with active overlays (balance available), removing bucket plan special-cases.

Tasks
- In `server/src/lib/utils/contractLineDisambiguation.ts`:
  - `determineDefaultBillingPlan(clientId, serviceId)`:
    - If a single eligible plan → select it.
    - If multiple: prefer the plan where the overlay exists and has remaining balance in the entry’s period (requires a helper to query overlay and usage balance).
    - Otherwise, return null and require explicit selection.
  - `getEligibleBillingPlansForUI`: include an overlay marker and, if feasible, a quick “has_balance” boolean for UX hints.
- Update unit tests to reflect new rules.

Acceptance
- Disambiguation chooses the overlay plan when sensible; tests cover tie cases.

Rollout
- N/A

---

## Phase 7 — Time Entry Plan Selector Defaults

Goals
- Keep the selector optional, default intelligently to overlay-backed plan with balance.

Tasks
- In `server/src/components/time-management/time-entry/time-sheet/TimeEntryEditForm.tsx`:
  - When multiple plans are eligible, default to the one with an active overlay and remaining balance (fall back to previous heuristics if unknown).
  - Show the selector only when >1 eligible plans.
  - Tooltip copy to reflect overlay preference.

Acceptance
- UI defaults match disambiguation; selector appears only when needed.

Rollout
- N/A

---

## Phase 8 — Integration & Invoice Tests

Goals
- Ensure end-to-end generation with overlays passes and equals legacy behavior for equivalent configurations.

Tasks
- Update integration/infrastructure tests to use `createBucketOverlayForPlan`:
  - `usageBucketAndFinalization.test.ts`
  - `prepaymentInvoice.test.ts`
  - Invoice subtotal/tax/consistency/edge-case tests that reference bucket tables.
- Keep assertions on `bucket_usage` updates and invoice line item correctness (included vs overage).

Acceptance
- Tests pass with overlays; no regressions in totals or tax.

Rollout
- N/A

---

## Phase 9 — Cleanup

Goals
- Remove `Bucket` from `plan_type` usages in code after the feature is stable and migration is complete.

Tasks
- Remove bucket plan special-cases across code and tests so overlays are the sole bucket source:
  - `server/src/lib/actions/contractWizardActions.ts`: collapse the “bucket plan” branch so the wizard only ever mutates the fixed/usage line and appends overlay configuration rows; purge any fallbacks that still create a `contract_line_type = 'Bucket'`.
  - `ee/server/src/__tests__/integration/contract-wizard-happy-path.playwright.test.ts`: update assertions/helper flows to verify overlay persistence (`contract_line_service_configuration` + `contract_line_service_bucket_config`) and stop expecting a bucket contract line or plan type string.
  - Reporting and analytics callers (`server/src/lib/actions/client-portal-actions/client-billing-metrics.ts`, `server/src/lib/actions/report-actions/getRemainingBucketUnits.ts`, CSV/BI exports) need to replace `contract_line_type === 'Bucket'` filters with overlay joins and expose overlay metadata to the UI.
  - Billing/usage helpers (`server/src/lib/utils/contractLineDisambiguation.ts`, `server/src/lib/services/contractLineServiceConfigurationService.ts`, `server/src/lib/billing/billingEngine.ts`, `server/src/lib/services/bucketUsageService.ts`) should look up overlays via `contract_line_service_configuration` and never branch on plan type.
  - Test + seed utilities (`server/test-utils/billingTestHelpers.ts`, infrastructure invoice suites, nightly cleanup scripts) must drop `bucket_contract_lines` cleanup and rely solely on overlay tables.
- Update enum/documentation to drop `Bucket` as a plan type once callers above run overlay-only logic (e.g. `server/src/interfaces/billing.interfaces.ts`, `server/src/constants/billing.ts`, API surface types).
- Delete legacy UI step/components that are no longer referenced (wizard bucket step, bucket-plan filters, etc.).
- Add guardrails: introduce an automated check (`rg "contract_line_type.*Bucket"`) in CI or lint scripts so new plan-type branches cannot be reintroduced.

Acceptance
- Repository compiles and tests green without any `plan_type='Bucket'` coupling.

Rollout
- N/A

Verification
- `rg "contract_line_type.*'Bucket'"` and `rg "plan_type.*Bucket"` return no results in TypeScript/TSX sources (excluding documentation).
- Playwright contract wizard regression passes while persisting overlays.
- Billing smoke tests confirm bucket invoices derive from overlay rows only.

---

## Phase 10 — Documentation & Rollout

Goals
- Provide clear internal and customer-facing docs on overlays.

Tasks
- Internal docs:
  - Architecture overview (overlay model, configs, usage ledger).
  - Disambiguation rules, defaulting, and reporting by `billing_plan_id`.
- Customer-facing docs (if applicable):
  - “Bucket of Hours/Units” under Hourly/Usage lines; effective rate; overage; rollover.
- Release notes and upgrade guidance for existing tenants.

Acceptance
- Docs published and linked in relevant UI tooltips.

Rollout
- N/A

---

## Appendix — Implementation Notes

- Table references (no schema changes required for MVP):
  - `plan_service_configuration` (ensure per plan/service `configuration_type = 'Bucket'` exists)
  - `plan_service_bucket_config` (uses `total_minutes` for hours or usage units; `overage_rate`, `allow_rollover`, `billing_period`)
  - `bucket_usage` (minutes/units used + overage per period)
- Monthly fee for buckets:
  - MVP: bill via Fixed Fee lines (per plan or per service allocation); engine already handles fixed charges.
  - Future: add `monthly_fee` to `plan_service_bucket_config` if we want it stored alongside the overlay.
- Plan disambiguation/UI:
  - `getEligibleBillingPlansForUI` may include overlay hints: `{ has_overlay: boolean, has_balance?: boolean }` to aid defaults and UX copy.
- Reporting:
  - Keep `billing_plan_id` on time entries/usage for plan-level reporting; overlays don’t change that contract.

---

## Success Criteria

- Users configure bucket hours/units directly on Hourly/Usage lines.
- Time entries/usage automatically consume included amounts; overage is billed correctly.
- Default plan selection prefers overlay-backed lines when appropriate.
- All tests pass; migrations maintain historical accuracy; no regressions in invoice totals or taxes.
