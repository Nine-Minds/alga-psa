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
  - `server/src/test/unit/planDisambiguation.test.ts`: remove bucket-plan special cases; add overlay preference tests (prefer lines with active bucket balance).
  - `server/src/test/unit/timeEntryBillingPlanSelection.test.tsx`: mock overlay presence (not plan type) and assert default selection preference.
  - `server/src/test/unit/billingPlanSelection.test.ts`: same as above.
  - `server/src/test/unit/billingEngine.test.ts`: replace “calculateBucketPlanCharges” expectations with overlay consumption assertions (time/usage paths).
  - `server/src/test/unit/bucketUsageService.test.ts`: confirm logic still works with overlays.

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
  - `HourlyServicesStep.tsx`: Add a toggle and fields per service:
    - Included hours per period (store as minutes), Monthly fee (cents, optional), Overage rate (cents), Rollover toggle, Expiration policy (optional)
  - `UsageBasedServicesStep.tsx`: Similar per service:
    - Included units per period, Monthly fee (cents, optional), Overage rate (cents), Rollover toggle, Expiration policy (optional)
- Extract a reusable `BucketOverlayEditor` component from the current `BucketHoursStep.tsx`:
  - Props: mode: `'hours' | 'usage'`, current value, onChange, unit label derivation, copy blocks/tooltips (reuse).
  - Use this editor within each service row in Hourly/Usage steps.
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
- Update `ContractWizardData` and submission payload to include `bucket` object per hourly/usage service line with fields:
  - Hours: `{ included_minutes: number, monthly_fee_cents?: number, overage_rate_cents: number, allow_rollover?: boolean, expiration_policy?: 'none'|'eom'|'n_months', expiration_months?: number }`
  - Usage: `{ included_units: number, monthly_fee_cents?: number, overage_rate_cents: number, allow_rollover?: boolean, expiration_policy?: 'none'|'eom'|'n_months', expiration_months?: number }`
- Modify `server/src/lib/actions/contractWizardActions.ts`:
  - Remove creation of a dedicated `Bucket` plan.
  - After inserting Hourly/Usage plan lines, if a service has `bucket`:
    - Ensure a `plan_service_configuration` row (or upsert) for `configuration_type='Bucket'` tied to the same plan_id + service_id.
    - Insert into `plan_service_bucket_config`:
      - Hours: `total_minutes = included_minutes`
      - Usage: `total_minutes = included_units` (generic quantity convention)
      - `billing_period = 'monthly'`, `overage_rate = overage_rate_cents`, `allow_rollover`
      - Optional: If monthly fee must be billed, see decision below.
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
- In `server/src/lib/utils/planDisambiguation.ts`:
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
- Remove bucket plan special-cases across code and tests.
- Update enum/documentation to drop `Bucket` as a plan type.
- Delete legacy UI step/components that are no longer referenced.

Acceptance
- Repository compiles and tests green without any `plan_type='Bucket'` coupling.

Rollout
- N/A

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
