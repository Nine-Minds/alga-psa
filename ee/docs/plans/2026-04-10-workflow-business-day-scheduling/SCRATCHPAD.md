# Scratchpad — Workflow Business-Day Scheduling

- Plan slug: `workflow-business-day-scheduling`
- Created: `2026-04-10`

## What This Is

Working notes for adding business-day and non-business-day filtering to recurring workflow schedules by reusing the tenant SLA business-hours schedules and holidays model.

## Decisions

- (2026-04-10) V1 applies only to recurring workflow schedules; one-time schedules will not support business/non-business-day filtering.
- (2026-04-10) Filtered recurring schedules default to the tenant default business-hours schedule, with an optional per-schedule business-hours override.
- (2026-04-10) Disallowed cron occurrences are skipped rather than deferred to the next allowed day.
- (2026-04-10) Save-time validation must fail if a filtered recurring schedule cannot resolve an effective business-hours schedule.
- (2026-04-10) Holidays are treated as non-business days for workflow filtering, including when the selected business-hours schedule is marked 24x7.
- (2026-04-10) Runtime eligibility should be evaluated against the intended scheduled local occurrence date/time, not the worker’s actual execution timestamp.
- (2026-04-10) Scheduler metadata belongs in `tenant_workflow_schedule` columns, not in workflow payload JSON.

## Discoveries / Constraints

- (2026-04-10) Workflow schedule persistence currently lives in `tenant_workflow_schedule` and its TS model mirror is `shared/workflow/persistence/workflowScheduleStateModel.ts`.
- (2026-04-10) Recurring and one-time schedule lifecycle orchestration lives in `ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts`; current recurring behavior is pg-boss-based and should remain intact for V1.
- (2026-04-10) Raw cron preview currently comes from `ee/packages/workflows/src/lib/computeNextFireAt.ts` and does not understand business/non-business-day eligibility.
- (2026-04-10) Schedule CRUD validation currently lives in `ee/packages/workflows/src/actions/workflow-schedule-v2-actions.ts` and `workflow-schedule-v2-schemas.ts`.
- (2026-04-10) The recurring schedule editor lives in `ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`.
- (2026-04-10) SLA already resolves tenant calendars using `business_hours_schedules`, `business_hours_entries`, and `holidays`, including global holidays (`schedule_id IS NULL`) plus schedule-specific holidays.
- (2026-04-10) `packages/sla/src/services/slaService.ts` already demonstrates the desired global-plus-specific holiday resolution pattern and default-schedule fallback shape.
- (2026-04-10) `packages/sla/src/services/businessHoursCalculator.ts` is geared toward minute-level SLA calculations; workflow day filtering needs date classification semantics that differ slightly, especially for 24x7 schedules where holidays must still count as non-business days.
- (2026-04-10) `shared/workflow/persistence/workflowScheduleStateModel.ts#getByWorkflowId` still returns only the oldest schedule row for a workflow; that existing limitation is outside the scope of this feature unless it blocks UI/API work.
- (2026-04-10) Current branch/worktree naming mentions company calendar scheduling, but repo search found no matching workflow scheduling/calendar feature in this branch yet; this work should be anchored in the workflow schedule + SLA business-hours subsystems.

## Proposed Implementation Shape

1. Add `day_type_filter` and `business_hours_schedule_id` columns to `tenant_workflow_schedule` in an EE migration.
2. Extend workflow schedule persistence types/helpers and schedule action schemas/responses.
3. Add a shared workflow-side helper to resolve the effective business-hours schedule, load holidays, classify dates, and optionally search ahead for the next eligible run.
4. Update create/update validation to enforce recurring-only usage and require a resolvable business-hours schedule for non-`any` filters.
5. Update the recurring workflow fire handler to skip disallowed occurrences and record skip/error bookkeeping cleanly.
6. Update the workflow schedule dialog to expose the new controls and surface validation messages.
7. Add targeted unit/integration/runtime/UI tests.

## Commands / Runbooks

- Inspect workflow schedule persistence model:
  - `read shared/workflow/persistence/workflowScheduleStateModel.ts`
- Inspect workflow schedule action validation:
  - `read ee/packages/workflows/src/actions/workflow-schedule-v2-actions.ts`
  - `read ee/packages/workflows/src/actions/workflow-schedule-v2-schemas.ts`
- Inspect workflow schedule lifecycle and next-fire helper:
  - `read ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts`
  - `read ee/packages/workflows/src/lib/computeNextFireAt.ts`
- Inspect recurring schedule dialog:
  - `read ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`
- Inspect SLA business-hours resolution patterns:
  - `read packages/sla/src/actions/businessHoursActions.ts`
  - `read packages/sla/src/services/slaService.ts`
  - `read packages/sla/src/services/businessHoursCalculator.ts`
- Validate the plan folder:
  - `python3 scripts/validate_plan.py ee/docs/plans/2026-04-10-workflow-business-day-scheduling`

## Links / References

- Workflow schedule background in this conversation identified the main workflow scheduling surfaces:
  - `tenant_workflow_schedule`
  - `ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts`
  - `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`
  - `server/src/lib/jobs/reconcileWorkflowSchedulePgBossHandlers.ts`
  - `ee/packages/workflows/src/actions/workflow-schedule-v2-actions.ts`
  - `ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`
- SLA/business-hours background in this conversation established:
  - tenant-owned shared business-hours schedules
  - optional schedule-specific and global holidays
  - policy/default fallback rules that can be adapted for workflow scheduling

## Open Questions

- Whether user-facing schedule lists should show only effective next eligible run, both effective and raw cron next tick, or effective only in details. Current plan assumes effective next eligible run is the primary derived field when available.

## Implementation Log

- (2026-04-10) Completed `F001`-`F003` by adding migration `ee/server/migrations/20260410120000_add_workflow_schedule_business_day_fields.cjs`, extending `WorkflowScheduleStateRecord` with `day_type_filter` and `business_hours_schedule_id`, and plumbing migration application in workflow runtime/schedule integration test helpers.
- (2026-04-10) Completed `F004`-`F007` by extending schedule create/update schemas with `dayTypeFilter` + `businessHoursScheduleId`, adding action-side validation for recurring-only filtering and tenant-scoped schedule overrides, and introducing `listWorkflowScheduleBusinessHoursAction` for the UI.
- (2026-04-10) Completed `F008`-`F012` and `F023`-`F025` by adding shared helper `ee/packages/workflows/src/lib/workflowBusinessDayScheduling.ts` to centralize:
  - effective schedule resolution (override first, otherwise tenant default)
  - holiday resolution (global + schedule-specific)
  - day classification rules (holiday precedence over 24x7)
  - occurrence eligibility checks by scheduled occurrence local date in schedule timezone
  - bounded next-eligible cron search for API/UI preview.
- (2026-04-10) Completed `F013`-`F016` by layering filter eligibility checks into `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts` without changing pg-boss recurring registration:
  - eligible occurrence => launch as before
  - ineligible occurrence => `last_run_status='skipped'` and no launch
  - unresolved business-hours schedule at runtime => fail fast (`enabled=false`, `status='failed'`, actionable `last_error`) and no launch.
- (2026-04-10) Completed `F017`-`F020` by updating `WorkflowScheduleDialog.tsx` to add recurring-only `Run on` and calendar-source controls, load tenant business-hours options, show schedule override picker when needed, and surface server validation messages inline.
- (2026-04-10) Completed `F021`-`F022` by preserving default `any` behavior for legacy schedules and adding list/get derived fields (`effective_business_hours_schedule_*`, `next_eligible_fire_at`, `calendar_resolution_error`) while retaining persisted filter/override fields.

## Test Work Log

- (2026-04-10) Added/updated coverage for `T002`, `T003`, `T004` in `ee/server/src/__tests__/unit/workflowScheduleActions.test.ts`.
- (2026-04-10) Added/updated coverage for `T008`-`T011` in `server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts`.
- (2026-04-10) Added/updated coverage for `T006`, `T007`, and part of `T015` in `ee/packages/workflows/src/lib/workflowBusinessDayScheduling.test.ts`.
- (2026-04-10) Added/updated coverage for `T012`, `T013` in `ee/packages/workflows/src/components/automation-hub/Schedules.test.tsx`.
- (2026-04-10) Added/updated integration coverage for `T001`, `T005`, `T014`, and part of `T015` in:
  - `ee/server/src/__tests__/integration/workflow-external-schedules.migration.integration.test.ts`
  - `ee/server/src/__tests__/integration/workflow-external-schedules.actions.integration.test.ts`.

## Verification Commands

- `npm --prefix ee/server run test -- src/__tests__/unit/workflowScheduleActions.test.ts` ✅
- `npm --prefix server run test -- src/test/unit/workflowScheduledRunHandlers.unit.test.ts --coverage.enabled=false` ✅
- `npx vitest run src/lib/workflowBusinessDayScheduling.test.ts --coverage.enabled=false` (from `ee/packages/workflows`) ✅ (run together with Schedules test command; helper suite passed)

## Verification Blockers / Environment Gaps

- `ee/server` integration suites requiring PostgreSQL (`workflow-external-schedules.*.integration.test.ts`) are blocked in this environment by `ECONNREFUSED` to `127.0.0.1:5432` / `::1:5432`.
- Running `Schedules.test.tsx` directly from `ee/packages/workflows` currently picks up cross-package setup that throws `Error: No such built-in module: node:` in this shell context; existing server/workflow unit suites still validate the core behavior changes above.

## Key File Paths

- Migration: `ee/server/migrations/20260410120000_add_workflow_schedule_business_day_fields.cjs`
- Shared helper: `ee/packages/workflows/src/lib/workflowBusinessDayScheduling.ts`
- Schedule actions: `ee/packages/workflows/src/actions/workflow-schedule-v2-actions.ts`
- Lifecycle persistence: `ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts`
- Runtime handler: `server/src/lib/jobs/handlers/workflowScheduledRunHandlers.ts`
- Job runner scheduled occurrence propagation: `server/src/lib/jobs/interfaces/IJobRunner.ts`, `server/src/lib/jobs/runners/PgBossJobRunner.ts`
- UI: `ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`, `ee/packages/workflows/src/components/automation-hub/Schedules.tsx`
