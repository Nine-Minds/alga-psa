# PRD — Workflow Schedule Builder

- Slug: `workflow-schedule-builder`
- Date: `2026-03-17`
- Status: Draft

## Summary
Replace the recurring schedule cron text box in the Automation Hub schedule dialog with a simple GUI builder for common recurrence patterns. Users should be able to configure daily, weekly, and monthly schedules with normal form controls, while the dialog continues to save a cron string under the hood. A raw cron editor remains available as an advanced escape hatch.

## Problem
Recurring workflow schedules currently require users to type a cron expression directly in [WorkflowScheduleDialog.tsx](/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx). That is technical and error-prone for normal users. The schedule dialog should match the rest of the Automation Hub by guiding users through the most common scheduling cases instead of forcing them to know cron syntax.

## Goals
- Let users create the most common recurring schedules without knowing cron.
- Preserve the existing backend contract by continuing to save cron strings and timezones.
- Support editing existing recurring schedules by hydrating the GUI from supported cron patterns.
- Preserve an advanced raw-cron path for unsupported patterns and power users.

## Non-goals
- Building a full cron editor with support for every cron pattern in the GUI.
- Changing schedule storage, API shape, or worker-side cron handling.
- Adding natural-language schedule parsing.
- Adding complex recurrence rules such as “every 2 hours,” “last weekday of month,” or multi-month cadences in this first pass.

## Users and Primary Flows
Primary users are operations users and workflow builders creating reusable workflow schedules from the Automation Hub.

Primary flows:
- Create a recurring workflow schedule with a daily, weekly, or monthly cadence.
- Edit an existing recurring schedule that already uses one of those supported cron patterns.
- Open an existing recurring schedule with an unsupported cron expression and keep editing it safely through advanced mode.

## UX / UI Notes
- The recurring section of the dialog should replace the raw cron field with a recurrence builder.
- The builder should include:
  - `Frequency`: Daily, Weekly, Monthly
  - `Time`: one time-of-day control
  - `Weekly`: day-of-week selection
  - `Monthly`: day-of-month selection
- The dialog should display a readable schedule summary beneath the controls, for example `Runs every Monday and Wednesday at 9:00 AM UTC`.
- An `Advanced cron` disclosure should reveal the raw cron input. This is the escape hatch for unsupported or custom schedules.
- When an existing cron cannot be represented by the builder, the dialog should open with advanced mode expanded and the cron value preserved.

## Requirements

### Functional Requirements
- For `triggerType === 'recurring'`, the dialog must offer GUI controls for daily, weekly, and monthly schedules.
- The dialog must derive a cron string from the GUI state before save.
- The dialog must still submit `cron` and `timezone` through the existing schedule create/update actions.
- Weekly schedules must require at least one selected weekday.
- Monthly schedules must require a valid day of month.
- Supported saved cron patterns must hydrate back into GUI state when opening the dialog in edit mode.
- Unsupported saved cron patterns must preserve the cron value and default to advanced mode.
- Advanced mode must allow the user to view and edit the raw cron string directly.
- If the user switches from advanced mode back to the preset builder, the builder should only be available when the cron is representable by one of the supported patterns or when the user explicitly chooses a new preset schedule.

### Non-functional Requirements
- The GUI must remain local to the schedule dialog and avoid backend schema changes.
- Validation feedback must be clear before save and should avoid exposing cron jargon unless the user is in advanced mode.
- Existing one-time schedule behavior must remain unchanged.

## Data / API / Integrations
- No API contract changes are required.
- `createWorkflowScheduleAction` and `updateWorkflowScheduleAction` should continue receiving `cron` and `timezone` for recurring schedules.
- The dialog will need local utilities to:
  - convert GUI schedule state to cron
  - parse a subset of cron strings back into GUI schedule state
  - format a readable summary string from GUI state and timezone

## Security / Permissions
No permission model changes. The dialog should continue respecting the existing schedule create/edit permissions and workflow eligibility checks already present in the component.

## Observability
No new telemetry is required for this scope.

## Rollout / Migration
- No data migration is required.
- Existing recurring schedules remain valid because unsupported cron strings can still be edited in advanced mode.
- The only user-facing migration is improved dialog UX for supported recurring schedules.

## Open Questions
- None blocking for the first version. Future expansions can revisit more complex recurrence types if users need them.

## Acceptance Criteria (Definition of Done)
- A user creating a recurring schedule can configure a daily schedule without touching cron.
- A user creating a recurring schedule can configure a weekly schedule by choosing weekdays and a time without touching cron.
- A user creating a recurring schedule can configure a monthly schedule by choosing a day of month and time without touching cron.
- Saving those schedules still persists valid cron strings and the selected timezone through the existing schedule actions.
- Editing a supported recurring cron schedule opens with the GUI builder populated correctly.
- Editing an unsupported recurring cron schedule preserves the cron value and defaults to advanced mode.
- One-time schedule behavior remains unchanged.
