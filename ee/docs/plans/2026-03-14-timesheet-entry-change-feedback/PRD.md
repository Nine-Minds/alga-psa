# PRD — Timesheet Entry Change Feedback

- Slug: `timesheet-entry-change-feedback`
- Date: `2026-03-14`
- Status: Draft

## Summary
Add per-time-entry change feedback to the timesheet approval workflow so managers can request specific fixes on specific entries, and employees can see exactly which entries need attention across the approval drawer, entry editor, list view, and grid view.

## Problem
Managers can currently request changes on a timesheet or on an individual time entry by status, but they cannot attach actionable notes to a specific entry. The employee only sees general timesheet comments, which makes it hard to know:

- which entry needs to be corrected
- what specific change the approver wants
- whether a previously requested change has already been addressed

This creates ambiguity in the approval loop and forces reviewers and employees to use timesheet-level comments for entry-level issues.

## Goals
- Allow approvers to attach a change suggestion to a specific time entry during approval review.
- Show the most recent per-entry change suggestion prominently when the employee edits that entry.
- Preserve the full conversation/history for an entry behind an expandable UI.
- Mark entry-level feedback as handled automatically when the employee edits and saves that entry during the `CHANGES_REQUESTED` flow.
- Surface passive visual indicators in list and grid timesheet views so employees can quickly spot entries with requested changes.

## Non-goals
- Redesign the overall timesheet approval workflow or permission model.
- Replace existing timesheet-level comments; those remain for sheet-wide discussion.
- Add notifications, audit dashboards, analytics, or operational reporting beyond the core approval feedback behavior.
- Change the meaning of timesheet-level `CHANGES_REQUESTED` status.

## Users and Primary Flows
Primary users:

- Manager or approver reviewing submitted timesheets
- Employee revising entries after approver feedback

Primary flows:

1. Approver opens a submitted timesheet in the approval drawer.
2. Approver expands a time entry, enters an entry-specific change suggestion, and clicks `Request Changes`.
3. The entry moves to `CHANGES_REQUESTED`, the note is stored as unresolved entry feedback, and the timesheet remains in the change-requested state as needed.
4. Employee opens the timesheet later and immediately sees passive indicators on the affected entries in list/grid views.
5. Employee opens the affected time entry and sees the latest feedback prominently, with the full conversation expandable.
6. Employee edits and saves the entry; the feedback auto-marks as handled.
7. In list/grid views, the indicator changes from unresolved (`X`) to handled (`check`) while the entry awaits re-review.

## UX / UI Notes
- Approval drawer
  - Each entry detail panel should include an approver note field specifically for that entry.
  - The per-entry note should be part of the `Request Changes` action for that entry, not mixed into timesheet-level comments.
  - Existing timesheet comments remain visible for overall comments.

- Time entry dialog/editor
  - When the timesheet is in the approval feedback flow, show the latest unresolved or latest relevant approver suggestion prominently within the entry editing UI.
  - Provide an expandable section for the full entry-level feedback history/conversation.
  - Keep employee-entered work notes separate from approver feedback.

- Timesheet list view
  - Show passive visual indication for entries with entry-level feedback.
  - The most recent status should be legible without opening the entry.
  - Unresolved and handled states must be visually distinct.

- Timesheet grid view
  - Add a compact icon next to or within the rounded colored entry block.
  - Use `X` for unresolved change requests and `check` for handled/resubmitted feedback.
  - The icon is a passive marker only; existing cell/entry interactions remain responsible for opening the editor.

## Requirements

### Functional Requirements
1. The system must allow an approver to save a change-request note against a specific time entry from the approval drawer.
2. Entry-level change-request notes must be stored separately from general timesheet comments.
3. A time entry may accumulate multiple feedback records over time; the system must preserve history.
4. The employee-facing time entry editor must show the most recent relevant feedback prominently.
5. The employee-facing time entry editor must allow the full feedback history for that entry to be expanded and viewed.
6. The list view must show which entries have approver feedback and whether it is unresolved or handled.
7. The grid view must show which cell blocks have approver feedback and whether it is unresolved or handled.
8. Saving an edited entry while the timesheet is in `CHANGES_REQUESTED` must auto-mark the latest unresolved feedback for that entry as handled.
9. Requesting changes again after a previous handled cycle must create a new unresolved feedback record rather than overwriting history.
10. Existing timesheet-level comments must remain available and unchanged for sheet-wide discussion.
11. Approver-only controls for creating entry-level change suggestions must remain permission-gated to approval users.
12. Employees must not be able to forge approver feedback through normal time-entry editing paths.

### Non-functional Requirements
- The feature must preserve existing approval behavior for entries and timesheets that have no per-entry feedback.
- The data model and query pattern should support efficient lookup of latest feedback per entry for list/grid/editor rendering.
- The UI should degrade gracefully when an entry has no feedback history.
- Existing approval and timesheet editing regressions must be covered by targeted automated tests.

## Data / API / Integrations
- Recommended approach: introduce a dedicated entry-level change feedback record rather than overloading `time_sheet_comments` or `time_entries.notes`.
- The record should support:
  - entry identity
  - timesheet identity
  - comment text
  - author/created metadata
  - handled metadata for resolution state
- Scheduling server actions will need:
  - create entry feedback + set entry status to `CHANGES_REQUESTED`
  - fetch entry feedback for a timesheet or set of entries
  - mark entry feedback handled when the employee saves the entry in change-requested mode
- Timesheet loading for employee views will need to include enough feedback data to render:
  - latest prominent feedback
  - history list
  - unresolved/handled markers

Approach options considered:

1. Dedicated `time_entry_change_requests` store
   - Recommended because it cleanly supports latest prominent feedback, expandable history, and handled/unhandled state.
2. Reuse `time_sheet_comments` with optional `entry_id`
   - Smaller schema change, but it mixes sheet-level and entry-level conversations and complicates UI/query behavior.
3. Single feedback field on `time_entries`
   - Too limited because it cannot support conversation/history or multiple review cycles cleanly.

## Security / Permissions
- Only users who can approve timesheets/time entries should be able to create entry-level change feedback.
- Employee edit flows may mark feedback handled only as a side effect of editing their own delegated/authorized entry during the existing timesheet edit rules.
- Feedback visibility should follow the same access scope as the associated timesheet and time entry.

## Observability
- No new observability scope is proposed in this plan.
- Existing server logs and test coverage are sufficient for the planned implementation unless scope expands.

## Rollout / Migration
- This likely requires a schema migration for dedicated per-entry feedback storage.
- Existing timesheets and entries should continue to behave normally with no backfill required.
- Entries without feedback should render exactly as they do today.

## Open Questions
- None currently blocking PRD scope.

## Acceptance Criteria (Definition of Done)
- Approvers can add an entry-specific change suggestion from the approval drawer when requesting changes.
- Employees can see the latest entry-specific suggestion inline while editing the affected time entry.
- Employees can expand and review the history of entry-level change suggestions.
- Timesheet list view shows passive feedback status for entries with per-entry feedback.
- Timesheet grid view shows passive feedback status icons for cells with per-entry feedback.
- Editing and saving an entry during the change-requested flow auto-marks the latest unresolved feedback as handled.
- A subsequent approver change request creates a new unresolved feedback record while preserving prior history.
- Existing timesheet-level comments continue to work for whole-timesheet discussion.
