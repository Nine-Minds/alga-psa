# PRD — Workflow V2 External Schedules

- Slug: `workflow-v2-external-schedules`
- Date: `2026-03-08`
- Status: Draft

## Summary

Add a dedicated schedules system for Workflow V2 in Enterprise Edition. Schedules will be managed outside the workflow definition on a new Automation Hub schedules screen, and each schedule will store its own timing and static payload. A workflow may have many schedules, each schedule follows the workflow’s latest published version, and saved schedule payloads must validate against the workflow’s pinned payload schema.

## Problem

The current time-trigger work places schedule configuration inside the workflow definition and starts runs with a fixed clock payload contract. That model does not support the actual operator need: define multiple reusable schedules for the same workflow and attach static business payload data to each one.

Without external schedules:

- one workflow cannot easily support multiple scheduled variants
- schedule timing and schedule input are coupled to the workflow draft instead of an operational schedule object
- operators cannot manage schedules globally
- the system cannot validate and persist a schedule’s real payload independently from the workflow editor

## Goals

- Add a first-class schedule entity for Workflow V2, owned outside the workflow definition.
- Allow many schedules per workflow.
- Let each schedule define:
  - required name
  - one-time or recurring timing
  - saved static payload
  - enabled/paused lifecycle state
- Add a global schedules screen in Automation Hub with create, edit, pause/resume, and delete flows.
- Remove inline time-trigger authoring from the workflow editor.
- Keep event-triggered workflows working as they do today.
- Require pinned payload schemas for scheduled workflows in v1.
- Validate schedule payloads on create/edit and again when a new workflow version is published.
- Make schedules follow the latest published workflow version automatically.

## Non-goals

- CE support.
- Fan-out schedules over domain records.
- Per-schedule version pinning in v1.
- Supporting schedules for inferred-schema workflows.
- Adding seconds to cron syntax.
- Duplicating full schedule CRUD inside the workflow editor.
- Broader production-readiness work such as metrics, observability platforms, or feature-flag rollout.

## Users and Primary Flows

1. Automation manager creates a reusable schedule
- User opens Automation Hub and navigates to Schedules.
- User creates a schedule for an existing workflow.
- User chooses one-time or recurring timing.
- User enters a static payload using form mode or JSON mode.
- System validates the payload against the workflow’s pinned payload schema.
- User saves and enables the schedule.

2. Automation manager maintains many schedules for one workflow
- User views all schedules filtered to a workflow.
- User distinguishes them by required schedule name.
- User edits timing or payload without editing the workflow definition.
- User pauses, resumes, or deletes schedules independently.

3. Automation manager publishes a new workflow version
- User publishes a new version of a workflow with existing schedules.
- System revalidates every schedule payload against the newly published version’s pinned payload schema.
- Valid schedules rebind to the new version.
- Invalid schedules are preserved but disabled/marked failed with a visible validation error.

4. Scheduled execution starts a workflow run
- At fire time, the runner loads the schedule record.
- System launches the latest published workflow version bound to that schedule.
- The run input uses the schedule’s saved payload, not a synthetic clock contract.
- Run provenance still includes schedule metadata so operators can see which schedule fired.

## UX / UI Notes

- Add a new `Schedules` entry under the Automation Hub parent menu.
- The schedules screen is the source of truth for schedule CRUD.
- Show a global list with filters for workflow, trigger type, status, and search.
- Columns should include:
  - schedule name
  - workflow name
  - trigger type
  - next fire / run-at
  - last fire
  - status
  - last error
- The schedule dialog should support:
  - workflow picker
  - required schedule name
  - trigger type
  - one-time `runAt` or recurring `cron + timezone`
  - payload editor with form/json modes
  - inline validation errors
- Workflow editor trigger selector should be reduced to:
  - No trigger
  - Event
- For workflows using no trigger, manual run remains allowed.
- For workflows using event trigger, existing event configuration and mapping UX remain.
- Add a workflow-context link into the schedules screen, prefiltered to the current workflow.

## Requirements

### Functional Requirements

- Introduce a workflow schedule model separate from workflow definitions.
- A workflow can own many schedules.
- Each schedule must belong to one workflow and tenant.
- Each schedule must have a required user-defined name.
- Each schedule must support either:
  - one-time timing with `runAt`
  - recurring timing with 5-field cron and timezone
- Each schedule must store a static payload JSON document.
- A schedule may only be created for a workflow that has:
  - a published version
  - a pinned payload schema
- Schedule payload must validate against the workflow payload schema before save.
- Schedule payload must be revalidated when a new workflow version is published.
- Schedules follow the latest published version automatically.
- If a schedule payload is invalid for the latest published version:
  - preserve the schedule record
  - prevent firing
  - surface a validation error in the schedules UI
- Scheduled workflow runs must use the saved schedule payload as `workflow_runs.input_json`.
- Scheduled workflow runs must still store schedule provenance metadata.
- Workflow definitions must no longer use inline `schedule` or `recurring` trigger types for authoring in this feature path.
- Workflow editor publish and run behavior for `No trigger` and `Event` must keep working.
- Users must be able to edit, pause/resume, and delete existing schedules.

### Non-functional Requirements

- Reuse the existing job-runner abstraction for one-time and recurring registration.
- Keep schedule registration and DB persistence coherent from the user’s point of view.
- Preserve tenant isolation for schedule data and launches.
- Support DB-backed integration coverage for schedule CRUD, validation, and runner registration.
- Keep the implementation EE-only.

## Data / API / Integrations

- Add or revise a workflow schedule persistence model under `shared/workflow/persistence` and its EE migration.
- Change the schedule table from one-schedule-per-workflow to many-schedules-per-workflow.
- Add schedule fields at minimum:
  - `id`
  - `tenant_id`
  - `workflow_id`
  - `workflow_version`
  - `name`
  - `trigger_type`
  - `run_at`
  - `cron`
  - `timezone`
  - `payload_json`
  - `enabled`
  - lifecycle/job-runner metadata already needed for registration tracking
- Add workflow schedule server actions for:
  - list
  - get
  - create
  - update
  - pause/resume
  - delete
- Update publish logic so schedule rebinding and payload revalidation happen whenever the latest published version changes.
- Reuse the existing workflow run schema-fetching and form/json payload editing patterns from the manual run dialog where possible.
- Scheduled job handlers must load the schedule record and launch with `payload_json`.
- Run metadata should include schedule context such as schedule id, schedule name, and trigger timing info.

## Security / Permissions

- Only users with workflow management permissions may create, edit, pause, resume, or delete schedules.
- Schedule CRUD must remain tenant-scoped.
- Saved schedule payloads must be treated like workflow inputs and pass through existing redaction/display rules where applicable.
- Event-trigger permissions and behavior are unchanged.

## Observability

- Use existing workflow run and schedule state fields rather than introducing new observability infrastructure.
- Schedules UI must expose enough state to diagnose why a schedule is not firing:
  - enabled/disabled
  - last error
  - last fire
  - next fire or run-at
- Invalid schedules after publish must show schema validation failure details.

## Rollout / Migration

- This is a follow-on EE redesign for workflow time-trigger functionality.
- Existing inline workflow time triggers should be migrated off the workflow definition model and into schedule records.
- The old one-schedule-per-workflow table shape must be migrated to support many schedules per workflow.
- Existing event-triggered and no-trigger workflows remain valid.
- Existing inline time-trigger UI in the workflow editor should be removed once the schedules UI is in place.

## Open Questions

- None currently. The v1 product decisions are:
  - many schedules per workflow
  - pinned-schema workflows only
  - global schedules screen under Automation Hub
  - schedules follow latest published version
  - required schedule names

## Acceptance Criteria (Definition of Done)

- Automation Hub contains a Schedules destination with a global schedule list.
- Users can create one-time and recurring schedules for eligible workflows.
- Each schedule stores and validates a static payload against the workflow payload schema.
- Users can edit, pause/resume, and delete schedules.
- A workflow can have many schedules.
- Workflow editor no longer exposes inline one-time/recurring trigger authoring.
- Workflow editor still supports No trigger and Event trigger flows.
- Manual runs still work for no-trigger workflows.
- Publishing a new workflow version revalidates and rebinds schedules to the latest published version.
- Invalid schedules after publish are preserved, visible, and prevented from firing.
- Scheduled runs use the saved schedule payload as workflow input.
- DB-backed integration tests cover schedule persistence and validation behavior.
