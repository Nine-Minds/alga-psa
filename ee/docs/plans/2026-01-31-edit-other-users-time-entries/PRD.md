# Time Entry Delegation (Enter/Edit Time for Other Users)

## Summary
Enable authorized users (billing admins, system admins, and team managers) to **create and edit time entries on behalf of another user** so invoicing and reporting are not blocked by missing time. This includes the ability to add time into **any existing time period** (including previously approved periods) while preserving billing integrity:

- **Billing/system admins** can act tenant-wide and can **reopen + approve** time sheets as needed.
- **Managers** can act **only for users in teams they manage**.
- **No changes are allowed for already-invoiced time** (cannot add/edit entries that would affect an invoiced period).

This work also clarifies “actor vs subject”:
- **Actor**: the logged-in user performing the action.
- **Subject**: the user whose time is being entered/edited.

## Problem Statement
When generating invoices, admins frequently find missing time (e.g., a technician forgot to enter time). Today, the Time Entry UI and server actions implicitly operate only on the current user, making it impossible (or unsafe) for an authorized admin/manager to record time for someone else.

## Goals
- Allow an authorized actor to:
  - select a subject user
  - view that subject’s time periods/time sheets
  - create/edit/delete time entries for the subject within a selected time sheet
  - submit/reopen/approve time sheets as needed to reach an **APPROVED** state for billing
- Enforce permissions and relationship constraints:
  - billing/system admins: tenant-wide capability (RBAC-driven)
  - managers: limited to their managed teams
- Preserve billing integrity:
  - disallow any action that would alter invoiced time (time entries marked `invoiced=true` or time sheets containing invoiced entries)
- Add auditability:
  - record who created/updated entries on behalf of others

## Non-Goals
- Supporting retroactive billing changes for already-invoiced time (credits/reinvoicing workflows).
- A full “missing time” workflow embedded inside the invoicing UI (this can be added later).
- Role semantics beyond RBAC (roles are labels; permissions drive behavior).

## Users / Personas
- **Billing admin / finance**: needs to ensure all billable work is recorded and approved so invoices can be generated.
- **System admin**: needs global corrective capabilities and oversight.
- **Team manager**: can correct/complete time sheets for their direct reports.

## Primary User Flows
### Flow A: Billing Admin enters missing time (open period)
1. Billing admin opens Time Entry.
2. Selects a subject user (any internal user in tenant).
3. Selects a time period.
4. Adds or edits entries (subject’s time).
5. Submits and approves the time sheet.

### Flow B: Billing Admin enters missing time (previously approved period, not invoiced)
1. Billing admin opens the subject’s already-approved time sheet.
2. Clicks “Reopen for edits” (reverse approval) → time sheet becomes editable.
3. Adds missing entries.
4. Re-submits and approves.

### Flow C: Team manager enters missing time for a report
1. Manager opens Time Entry.
2. Selects a subject user from within teams they manage.
3. Selects a time period and edits time.
4. Submits and approves.

### Flow D: Attempt to change invoiced time (blocked)
1. Actor attempts to edit an invoiced time entry or reopen a time sheet with invoiced entries.
2. System blocks the action with a clear error message.

## UX / UI Notes
- Add a **“User” selector** to the Time Entry landing page (`/msp/time-entry`) for users who can act on behalf of others.
  - Default selection: current user.
  - For non-authorized users, hide the selector (or show it disabled).
- The delegated time-entry UI (subject selector + delegated timesheet editing UX) is gated behind the PostHog feature flag **`delegated-time-entry`** (UI-only).
  - When disabled: the UI only supports working with the current user’s own time sheets; delegated sheets (if accessed directly) are read-only and show an explanation.
- Bundled tickets (tickets that are part of a ticket bundle) cannot have time logged directly; the UI should:
  - show bundled tickets as **disabled/greyed out** in ticket pickers
  - explain why (e.g. “Bundled ticket — log time on the master ticket”)
- Timesheet view (`/msp/time-entry/timesheet/[id]`) must clearly indicate:
  - “Time Sheet for {Subject Name}”
  - Optional small text: “Edited by {Actor Name}” for transparency (audit UI).
- Add a **“Reopen for edits”** action for authorized actors when a time sheet is `APPROVED` and contains no invoiced entries.
  - Reopen should set the time sheet status to `CHANGES_REQUESTED` (editable) and restore time entry statuses accordingly.

## Technical Design Notes
### Current-State Notes (as observed in repo)
- Time entry CRUD is handled via Next.js server actions in:
  - `packages/scheduling/src/actions/timeEntryCrudActions.ts`
- Time sheet operations/time-period listing are in:
  - `packages/scheduling/src/actions/timeSheetOperations.ts`
- Timesheet approval flows exist in:
  - `packages/scheduling/src/actions/timeSheetActions.ts`
  - `packages/scheduling/src/components/time-management/approvals/ManagerApprovalDashboard.tsx`
- Billing engine uses only `APPROVED` + `invoiced=false` time entries:
  - `server/src/lib/billing/billingEngine.ts`
- Known blocker/bug to address:
  - `saveTimeEntry` currently forces `user_id` to the actor (`user.user_id`), which prevents “on behalf of” and can corrupt ownership on updates.

### Proposed Architecture
#### 1) Add explicit “subject user” support across time entry actions
- Introduce a `subjectUserId` parameter (or derive subject via time sheet) for:
  - fetching time periods
  - fetching/creating time sheets
  - saving/deleting time entries
- Ensure the persisted time entry uses:
  - `time_entries.user_id = subjectUserId`
  - audit columns track actor (see below)

#### 2) Centralize authorization checks for on-behalf access
Define a shared helper used by all relevant server actions:
- If subject is self → allow (subjectUserId === actor.user_id).
- Else require:
  - actor has `timesheet:approve`, and
  - (actor has `timesheet:read_all` for tenant-wide) OR (actor manages a team that includes subject).

Important: manager/team checks must be validated server-side (do not trust client-supplied team ids).

#### 3) Support approved periods by reopening (reverse approval)
- Provide a “reopen” operation that:
  - requires `timesheet:reverse` (and the same on-behalf rules above)
  - blocks if any associated time entries are invoiced
  - sets time sheet to `CHANGES_REQUESTED` (editable)
  - sets time entries to `CHANGES_REQUESTED`

#### 4) Add audit columns for actor tracking
Add columns on `time_entries`:
- `created_by` (nullable, references users)
- `updated_by` (nullable, references users)

Behavior:
- On create: set `created_by = actor.user_id`, `updated_by = actor.user_id`
- On update: set `updated_by = actor.user_id`

#### 5) Enforce invoicing and boundary constraints
- Disallow update/delete when `time_entries.invoiced = true`.
- Disallow reopening a time sheet if any related time entry is invoiced.
- Add server-side validation that new/edited entry timestamps are within the time period boundaries for the time sheet.

## Risks / Considerations
- Multiple implementations exist (server actions vs `server/src/lib/api/services/TimeSheetService.ts`). We should keep behavior consistent for the UI paths we update and avoid accidental divergence.
- Need to ensure “subject timezone” is used when computing `work_date`/`work_timezone` so the entry is attributed to the correct day for the subject.

## Acceptance Criteria
- A billing/system admin can create/edit time entries for any internal user and approve/reopen as needed (unless invoiced).
- A manager can create/edit time entries only for users in teams they manage.
- A user without these capabilities cannot view or edit another user’s time sheets/entries (even if they know IDs).
- Attempting to modify invoiced time is blocked with a clear error.
- Time entry records capture “who entered/edited” via audit fields.
- Bundled tickets are visibly non-selectable in the UI with clear messaging about logging time on the master ticket.
