# PRD — Workflow V2 Time-Based Clock Triggers

- Slug: `workflow-v2-time-based-clock-triggers`
- Date: `2026-03-07`
- Status: Draft

## Summary

Add first-class pure clock triggers to Workflow V2 for Enterprise Edition. A workflow may start from either a one-time scheduled timestamp or a recurring 5-field cron schedule with a timezone. Each clock fire starts exactly one workflow run with a fixed synthetic trigger payload. This scope does not include entity fan-out, synthetic event-catalog triggers, CE support, or an explicit manual trigger type.

## Problem

Workflow V2 is currently event-driven. The canonical trigger contract only supports event triggers, the designer only exposes event selection, and runtime fan-out starts runs only from event ingress. Users cannot build automations that run at a specific future time or on a recurring schedule without routing through unrelated systems.

This leaves a functional gap for common automation use cases such as daily summaries, end-of-day cleanup, periodic reminders, and future-dated follow-up workflows.

## Goals

- Add first-class time trigger variants to Workflow V2:
  - one-time schedule
  - recurring schedule
- Keep the model honest: time-triggered workflows should not be disguised as synthetic events.
- Make time-triggered workflows EE-only and back them with the existing job-runner scheduling layer.
- Ensure each clock fire starts exactly one workflow run.
- Give time-triggered workflows a stable, fixed payload contract that can be pinned in the designer.
- Register, reschedule, pause, and cancel underlying schedules as workflow definitions are published or updated.
- Reuse one shared run-launch path so event triggers and time triggers do not drift further apart.

## Non-goals

- Fan-out over domain entities such as “run once per due ticket”.
- A generic query/filter engine over records at fire time.
- CE support.
- Cron expressions with seconds or 6-field cron syntax.
- An explicit `manual` trigger type. “No trigger” remains the existing no-trigger shape.
- Replacing the existing Workflow V2 run worker or wait/retry model.
- Net-new operational dashboards, metrics pipelines, or feature-flag rollout work in this scope.
- Multiple schedules attached to a single workflow definition in this first version.

## Users and Primary Flows

1. Automation manager creates a workflow with a one-time trigger
- User opens Workflow Designer.
- User chooses `One-time schedule` as the trigger type.
- User selects a future timestamp.
- User reviews the fixed clock-trigger payload schema.
- User publishes the workflow.
- The system registers a one-time scheduled job.
- When the scheduled time arrives, the system starts exactly one workflow run.

2. Automation manager creates a recurring workflow
- User opens Workflow Designer.
- User chooses `Recurring schedule` as the trigger type.
- User enters a valid 5-field cron expression and selects a timezone.
- User reviews the fixed clock-trigger payload schema.
- User publishes the workflow.
- The system registers a recurring schedule.
- Each schedule fire starts exactly one workflow run.

3. Automation manager changes a published time-triggered workflow
- User edits the trigger configuration or publishes a newer version.
- The system atomically updates the registered schedule.
- Future fires use the latest published version and the new trigger configuration.

4. Automation manager pauses or removes a time-triggered workflow
- User pauses the workflow or deletes it.
- The system cancels or disables the registered schedule.
- No new runs are started while the workflow is paused or after it is removed.

## UX / UI Notes

- Replace the event-only trigger picker with a trigger-type selector:
  - No trigger
  - Event
  - One-time schedule
  - Recurring schedule
- Time-triggered workflows must not show event catalog or trigger-mapping controls.
- One-time schedule UX should use a future timestamp picker.
- Recurring schedule UX should use:
  - a 5-field cron input
  - timezone selection
  - inline validation/help text clarifying that seconds are not supported
- For time triggers, the designer should show a fixed payload schema preview instead of inferred event schema behavior.
- “No trigger” remains the absence of a trigger object; there is no separate manual trigger type in this scope.
- Runs and workflow summaries should label time triggers distinctly from events.

## Requirements

### Functional Requirements

- Extend the shared Workflow V2 trigger contract to support:
  - no trigger
  - event trigger
  - one-time schedule trigger
  - recurring schedule trigger
- Time trigger variants must be persisted as first-class trigger definitions on workflow definitions and published versions.
- One-time schedule triggers must store a single future fire timestamp.
- Recurring schedule triggers must store a valid 5-field cron expression and timezone.
- Time-triggered workflows must be EE-only.
- Time-triggered workflows must use pinned payload schema mode in this scope.
- The system must register or update underlying scheduled jobs when:
  - a time-triggered workflow is published
  - a published time trigger changes
  - a new published version supersedes an older one
- The system must cancel or disable underlying scheduled jobs when:
  - a workflow is paused
  - a workflow is deleted
  - a trigger changes away from a time trigger
- Each schedule fire must start exactly one workflow run.
- One-time schedules must not refire after they have fired.
- Time-trigger fires must go through a shared workflow launcher service so run creation rules are centralized.
- Existing event-trigger behavior must continue to work after launcher extraction.
- Time-triggered runs must carry a fixed synthetic payload contract that includes enough clock metadata for workflow steps to reason about why and when the run started.
- Run provenance for time-triggered runs must be visible in workflow runs APIs and UI.
- Workflow list/filter logic must use real trigger type values rather than inferring schedule-like behavior from event-name strings.

### Non-functional Requirements

- Reuse the existing job-runner abstraction for scheduling rather than creating a new scheduler.
- Recurring schedules must use 5-field cron semantics only.
- Reschedule operations on published workflows must be atomic from the application’s point of view: failed reschedule attempts must not silently leave definitions and registered jobs out of sync.
- Duplicate job delivery or retry must not create duplicate workflow runs for the same scheduled fire.
- Time-trigger lifecycle state must be durably persisted in the database.

## Data / API / Integrations

- Shared workflow definition schema:
  - extend trigger union in `shared/workflow/runtime/types.ts`
- Workflow server actions:
  - update create/update/publish validation paths in `packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- Designer:
  - update `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- Scheduling backend:
  - use `IJobRunner.scheduleJobAt()` for one-time schedules
  - use `IJobRunner.scheduleRecurringJob()` for recurring schedules
- Add a workflow-specific schedule state table for EE that stores:
  - schedule id
  - tenant/workflow/version linkage
  - trigger kind
  - run-at or cron/timezone
  - enabled/paused state
  - job-runner ids
  - last fire / next fire / last result metadata as needed
- Add a dedicated EE job handler that receives workflow schedule fire payloads and invokes the shared workflow launcher.
- Register a fixed schema ref for time-trigger payloads, for example a `trigger.clock.v1`-style contract owned by Workflow V2.

Example synthetic payload shape for time-triggered runs:

```json
{
  "triggerType": "schedule",
  "scheduleId": "uuid",
  "scheduledFor": "2026-03-08T14:00:00.000Z",
  "firedAt": "2026-03-08T14:00:01.250Z",
  "timezone": "America/New_York",
  "workflowId": "uuid",
  "workflowVersion": 3
}
```

For recurring triggers, `triggerType` would be `recurring`, and the payload may additionally include the configured cron string.

## Security / Permissions

- Only users who can manage/publish workflows may configure time triggers.
- Time-triggered workflow publish paths must enforce EE-only availability.
- Schedule fire payloads must be synthetic workflow metadata only; they must not inject arbitrary external payloads.
- Schedule lifecycle operations must preserve tenant isolation in storage and job execution.

## Observability

- Reuse existing workflow run logs and job-runner status where possible.
- No new observability platform work is required in this scope.
- At minimum, the stored workflow schedule state must make it possible to determine whether a schedule is registered, last fired, and last failed.

## Rollout / Migration

- This is a net-new EE-only capability.
- Existing event-triggered workflows and no-trigger workflows must remain unchanged.
- Existing workflow list filtering should be migrated off heuristic trigger detection to real trigger types.
- No migration of legacy workflow registrations is required beyond schema/table additions for time-trigger support.

## Open Questions

- Should completed one-time schedules remain visible as completed registration records indefinitely, or be cleaned up after a retention period?
- Should recurring trigger UI show “next fire time” in this initial scope or defer that to a follow-up?
- Should time-trigger provenance use new dedicated run columns, or be represented through existing run provenance fields plus structured metadata?

## Acceptance Criteria (Definition of Done)

- Workflow V2 definitions can represent one-time and recurring clock triggers as first-class trigger variants.
- Workflow Designer supports configuring both time trigger types and does not show event-specific trigger UI for them.
- Time-triggered workflows can be published only in EE and only with pinned payload schema mode.
- Publishing a one-time triggered workflow registers one scheduled job.
- Publishing a recurring triggered workflow registers one recurring schedule.
- Editing a published time trigger reschedules it without leaving stale registrations behind.
- Pausing or deleting a time-triggered workflow stops future scheduled fires.
- Each schedule fire starts exactly one workflow run.
- One-time schedules do not refire after the scheduled execution has occurred.
- Duplicate delivery or retry of the same schedule fire does not create duplicate runs.
- Event-triggered workflows continue to publish and run correctly after launcher refactoring.
