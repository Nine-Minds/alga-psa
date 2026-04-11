# PRD — Workflow Business-Day Scheduling

- Slug: `workflow-business-day-scheduling`
- Date: `2026-04-10`
- Status: Draft

## Summary

Extend Workflow Runtime V2 recurring schedules so admins can constrain cron-based workflow runs to business days or non-business days using the tenant’s existing SLA business-hours schedules and holidays. V1 applies only to recurring workflow schedules, skips disallowed occurrences instead of deferring them, defaults to the tenant’s default business-hours schedule, and allows an optional per-workflow-schedule override.

## Problem

Workflow schedules currently understand only raw time triggers (`schedule` and `recurring`). They cannot express common operational policies like “run this workflow only on business days” or “run this workflow only on non-business days/holidays.” Meanwhile, the product already has a tenant-owned business-hours and holiday system used by SLA calculations. Without reusing that system, customers either over-schedule workflows and tolerate unwanted holiday/weekend runs or create brittle manual workarounds.

## Goals

- Let recurring workflow schedules run on any day, business days only, or non-business days only.
- Reuse the existing tenant business-hours schedules and holidays rather than creating a separate workflow calendar model.
- Default filtered workflow schedules to the tenant’s default business-hours schedule, while allowing an explicit schedule override per workflow schedule.
- Treat holidays as non-business days for workflow day filtering, including when the selected business-hours schedule is marked 24x7.
- Skip disallowed cron occurrences without launching workflow runs or creating catch-up/deferred executions.
- Validate schedule configuration strictly at save time so admins cannot persist a business/non-business filter without an effective business-hours schedule.
- Surface enough schedule state in API/UI so admins can understand why a filtered recurring schedule will or will not run.

## Non-goals

- Adding business/non-business-day filtering to one-time (`schedule`) workflow triggers.
- Replacing pg-boss recurring registration with a custom “next eligible occurrence only” scheduler.
- Creating a new workflow-specific calendar, holiday, or availability subsystem.
- Adding user-selectable “defer to next allowed day” semantics in v1.
- Introducing company-calendar or external calendar integrations as part of this work.
- Adding observability/analytics/feature-flag rollout work unless requested separately.

## Users and Primary Flows

### Primary user

- Workflow admin configuring recurring automations in the Automation Hub / workflow designer.

### Primary flows

1. Create or edit a recurring workflow schedule, choose `Business days only`, leave calendar source at `Tenant default business hours`, and save successfully because the tenant has a default business-hours schedule.
2. Create or edit a recurring workflow schedule, choose `Non-business days only`, select a specific business-hours schedule override, and save successfully.
3. Attempt to save a filtered recurring workflow schedule when neither a specific override nor a tenant default business-hours schedule exists, and receive a validation error that explains the missing calendar configuration.
4. Allow cron to fire normally, but skip workflow launch on disallowed dates such as holidays or weekdays/weekends outside the chosen business-day classification.
5. Review the schedule later in the UI/API and see the configured day filter, chosen calendar source, and latest skip/error state.

## UX / UI Notes

- In the recurring schedule editor, add a `Run on` control with three options:
  - `Any day`
  - `Business days only`
  - `Non-business days only`
- Show the day-filter controls only for recurring schedules.
- When `Business days only` or `Non-business days only` is selected, show calendar-source controls:
  - `Tenant default business hours`
  - `Specific business-hours schedule`
- When `Specific business-hours schedule` is selected, show a select populated from the tenant’s available business-hours schedules.
- Provide inline help text clarifying that holidays are treated as non-business days.
- If the API returns an effective next eligible run for a filtered recurring schedule, display it in schedule details/listing in preference to the raw cron tick when practical.

## Requirements

### Functional Requirements

- `FR-001` Add recurring workflow schedule day-filter support with allowed values `any`, `business`, and `non_business`.
- `FR-002` Persist day-filter configuration as scheduler metadata on `tenant_workflow_schedule`, not inside workflow payload JSON.
- `FR-003` Persist an optional `business_hours_schedule_id` override on `tenant_workflow_schedule`; `null` means use the tenant default business-hours schedule.
- `FR-004` Restrict business/non-business-day filtering to recurring workflow schedules; one-time schedules must reject non-`any` day filters.
- `FR-005` Validate on create/update that a recurring schedule using `business` or `non_business` filtering resolves to an effective business-hours schedule via explicit override or tenant default.
- `FR-006` Validate that any selected `business_hours_schedule_id` belongs to the current tenant.
- `FR-007` Resolve filtered recurring schedules against the selected business-hours schedule plus both global holidays (`schedule_id IS NULL`) and schedule-specific holidays for that schedule.
- `FR-008` Classify holidays as non-business days for workflow filtering even when the chosen business-hours schedule is marked `is_24x7 = true`.
- `FR-009` Classify non-holiday dates as business days only when the chosen business-hours schedule has an enabled entry for the local weekday; otherwise classify them as non-business days.
- `FR-010` Evaluate business/non-business-day eligibility using the scheduled occurrence’s local date in the schedule timezone, not the worker’s wall-clock execution time.
- `FR-011` Preserve existing cron/pg-boss recurring registration behavior; the new filter narrows execution eligibility rather than replacing recurrence scheduling.
- `FR-012` When a recurring cron tick lands on a disallowed day, skip the occurrence without launching a workflow run and without creating a deferred/catch-up execution.
- `FR-013` Record skipped filtered occurrences distinctly from workflow-run failures so operators can tell the difference between policy skips and execution errors.
- `FR-014` When a filtered recurring schedule becomes invalid at runtime because its selected/default business-hours schedule can no longer be resolved, fail fast, mark the schedule with an actionable error state, and do not launch the workflow.
- `FR-015` Extend schedule list/get/create/update API contracts to include day-filter and business-hours schedule override fields.
- `FR-016` Load available business-hours schedules into the recurring schedule dialog so users can choose a specific override.
- `FR-017` In the recurring schedule dialog, show day-filter controls and calendar-source controls only when relevant to the current trigger type and filter selection.
- `FR-018` Surface save-time validation errors in the UI when no effective business-hours schedule exists or the selected override is invalid.
- `FR-019` Preserve legacy schedules that do not use day filtering; existing recurring schedules should behave exactly as before with default `day_type_filter = any`.
- `FR-020` Surface the configured day filter and calendar selection in schedule list/detail responses so the UI can render and edit them accurately.
- `FR-021` Compute and expose an effective next eligible run for filtered recurring schedules in list/detail responses when that value can be derived within a bounded search window.
- `FR-022` Return `null`/no effective next eligible run when no eligible occurrence can be found within the bounded preview window.

### Non-functional Requirements

- `NFR-001` The implementation must reuse the existing tenant business-hours schedules and holidays model rather than introducing a duplicate calendar schema.
- `NFR-002` Existing recurring and one-time workflow schedules without day filters must remain backward-compatible across migration, listing, editing, and runtime execution.
- `NFR-003` Runtime failure handling must be explicit and actionable; no silent fallback to 24x7 semantics when a filtered schedule has no effective business-hours schedule.
- `NFR-004` The search for an effective next eligible run must be bounded (for example by occurrence count and/or time horizon) to avoid unbounded compute on impossible schedules.
- `NFR-005` The business-day classification logic used by validation, preview, and runtime skipping must be centralized so behavior stays consistent across action/UI/handler paths.

## Data / API / Integrations

- Add scheduler metadata columns to `tenant_workflow_schedule`:
  - `day_type_filter` text not null default `'any'`
  - `business_hours_schedule_id` uuid null
- Extend `WorkflowScheduleStateRecord` and associated persistence helpers to read/write those fields.
- Extend workflow schedule v2 action schemas and responses to accept/return those fields.
- Reuse tenant business-hours schedule data from:
  - `business_hours_schedules`
  - `business_hours_entries`
  - `holidays`
- Use the same holiday-resolution model already used by SLA services:
  - global holidays (`schedule_id IS NULL`)
  - plus schedule-specific holidays for the selected schedule.
- Introduce a shared workflow-side helper/service to:
  - resolve the effective business-hours schedule
  - classify a scheduled date as business/non-business
  - optionally search ahead for the next eligible cron occurrence for UI/API preview

## Security / Permissions

- No new permission model is introduced.
- Existing workflow read/manage permissions continue to govern schedule listing and mutation.
- Business-hours schedule overrides must be tenant-scoped and validated against the current tenant.

## Observability

- No new observability work is in scope for v1 beyond storing actionable schedule status/error information needed by operators in existing schedule views.

## Rollout / Migration

- Add the new columns with safe defaults so all existing rows become `day_type_filter = 'any'` and continue operating unchanged.
- No backfill beyond defaults is required.
- UI should treat absent/legacy values as `any` when editing old schedules.
- Runtime should preserve current behavior for all schedules without a non-`any` day filter.

## Risks

- There are now two useful “next run” concepts for filtered recurring schedules: raw cron tick and effective next eligible run. The API/UI must be clear which one is being shown.
- Some cron/day-filter combinations may produce very sparse eligible dates (for example weekday-only cron plus non-business-only filtering), so bounded search behavior must be deterministic.
- Runtime and action validation must agree on business-day classification or operators will see save/execute mismatches.
- Selected/default business-hours schedules can drift after save; runtime misconfiguration handling must be explicit and understandable.

## Open Questions

- None for v1 based on current design approval. Future work may consider whether to expose raw cron next tick alongside effective next eligible run in the UI.

## Acceptance Criteria (Definition of Done)

- An admin can configure a recurring workflow schedule to run on any day, business days only, or non-business days only.
- A filtered recurring schedule can use either the tenant’s default business-hours schedule or a specific business-hours schedule override.
- Saving a filtered recurring schedule fails with a clear validation message if no effective business-hours schedule exists.
- Cron-triggered recurring schedules on disallowed dates are skipped rather than executed or deferred.
- Holidays are treated as non-business days for workflow scheduling, including when the chosen business-hours schedule is 24x7.
- Existing schedules without day filters remain unaffected after migration and continue to execute as before.
- Schedule list/detail/edit flows preserve and display the new filter/calendar fields accurately.
- Filtered recurring schedules surface actionable skip/error state and, when derivable within bounds, an effective next eligible run.
