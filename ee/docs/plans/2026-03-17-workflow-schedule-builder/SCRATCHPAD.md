# Scratchpad — Workflow Schedule Builder

- Plan slug: `workflow-schedule-builder`
- Created: `2026-03-17`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-17) First version will only support common recurring patterns in the GUI: daily, weekly, and monthly.
- (2026-03-17) Raw cron remains available behind an advanced disclosure so unsupported schedules are still editable.
- (2026-03-17) No backend or persistence changes are planned; the dialog remains responsible for generating and parsing cron strings locally.

## Discoveries / Constraints

- (2026-03-17) [WorkflowScheduleDialog.tsx](/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx) currently stores `cron` directly for recurring schedules and already distinguishes `schedule` vs `recurring`.
- (2026-03-17) One-time schedules use `runAt` and should remain untouched by this change.
- (2026-03-17) The existing dialog already loads persisted schedules for edit mode, so cron hydration can stay client-side in the same component.
- (2026-03-17) A small local helper module was enough for the preset <-> cron conversion logic; no shared scheduling abstraction was needed yet.
- (2026-03-17) The existing `Schedules.test.tsx` harness is difficult to run outside its normal repo Vitest setup because ad-hoc configs hit React/Vitest environment mismatches. Package typecheck plus the new pure recurrence utility tests were reliable validation paths.

## Commands / Runbooks

- (2026-03-17) Inspect current dialog: `sed -n '1,260p' ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`
- (2026-03-17) Search related scheduling UI: `rg -n "cron|schedule" ee/packages/workflows/src/components/automation-hub ee/packages/workflows/src -g '*.{ts,tsx}'`
- (2026-03-17) Validate recurrence helpers: `cd ee/packages/workflows && npx vitest run src/components/automation-hub/workflowScheduleRecurrence.test.ts`
- (2026-03-17) Validate package types: `cd ee/packages/workflows && npm run typecheck`

## Links / References

- Dialog source: [WorkflowScheduleDialog.tsx](/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx)
- Plan folder: [2026-03-17-workflow-schedule-builder](/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/docs/plans/2026-03-17-workflow-schedule-builder)

## Open Questions

- No blocking questions for the first pass.
