# Ticket Work Description in New Time Entries

- Slug: `2026-09-21-alga-2026-0002517-ticket-work-description-time-entry`
- Date: 2026-09-21
- Status: Ready for implementation
- Internal card: `alga-2026-0002517`

## Summary

When a user enters a work description on a ticket and opens the add-time flow, initialize the new time entry's notes with that description. The existing ticket-to-scheduling context already carries the value; the fix is to preserve it when `TimeEntryProvider` constructs a new entry.

## Problem

The ticket work-description field updates `timeDescription`, and the time-entry launcher maps that value to `workItem.description`. `TimeEntryProvider` then hardcodes `notes: ''` in both branches that create a new entry. The time-entry dialog consequently opens with empty notes, and saving the untouched form persists an empty string instead of the user's description.

## Goals

- Show the ticket work description in the notes field when the add-time dialog opens.
- Preserve the description for both elapsed-time launches and launches that use the standard default time window.
- Preserve the existing behavior of opening with empty notes when no description was supplied.
- Leave existing-entry editing behavior unchanged.

## Non-goals

- Changing the ticket work-description input, timer behavior, or ticket context contract.
- Changing how notes are edited, validated, or persisted after the dialog opens.
- Copying the ticket's main description or title into time-entry notes.
- Changing interval-generated notes or other time-entry launchers.
- Introducing schema, migration, API, permission, feature-flag, or localization changes.

## Users and Primary Flows

The target user is a technician recording work from a ticket.

1. The technician enters text in the ticket's work-description field.
2. The technician selects Add time, with or without elapsed timer duration.
3. The new time-entry dialog opens with that exact text in Notes.
4. The technician may edit the notes or save them unchanged.

## UX / UI Notes

No new controls or copy are required. This is a data-prefill correction in the existing time-entry dialog. The supplied string should be preserved exactly, including whitespace; only a nullish description should fall back to an empty string.

## Requirements

### Functional Requirements

1. In the new-entry branch with `defaultStartTime` and `defaultEndTime`, initialize `notes` from `workItem.description ?? ''`.
2. In the new-entry branch that derives a default or scheduled time window, initialize `notes` from `workItem.description ?? ''`.
3. Do not overwrite notes loaded through the `existingEntries` branch.
4. Keep the current empty-string behavior when the work-item description is absent or nullish.
5. Keep the notes field editable; subsequent user changes remain authoritative at save time.

### Non-functional Requirements

- Add focused automated regression coverage at the provider initialization boundary.
- Avoid widening the change beyond the shared new-entry initialization behavior.

## Data / API / Integrations

No interface or persistence changes are required. The existing flow is:

`TicketDetails.timeDescription` -> `buildTicketTimeEntryContext().timeDescription` -> `buildWorkItem().description` -> `TimeEntryProvider` entry state -> `TimeEntryDialog` save payload `notes`.

The defect is solely at the provider-to-entry-state transition.

## Security / Permissions

No authorization behavior changes. The existing time-entry launch and save permission checks remain in force.

## Observability

No new telemetry or logging is required for this scoped correction.

## Rollout / Migration

No migration or staged rollout is required. The behavior affects newly initialized time-entry forms only and does not rewrite existing entries.

## Open Questions

None. The desired source field, destination field, fallback, and affected initialization branches are confirmed by the current code path.

## Acceptance Criteria (Definition of Done)

- A non-empty ticket work description appears unchanged in Notes when Add time opens a new entry with elapsed/default start and end times.
- A non-empty ticket work description appears unchanged in Notes when Add time opens a new entry without supplied start and end times.
- A missing or nullish work-item description initializes Notes to `''`.
- Opening an existing time entry preserves its saved notes instead of replacing them with the work-item description.
- Users can edit or clear the prefilled notes before saving, and the existing save flow persists the resulting value.
- Focused automated tests covering the two new-entry branches and the existing-entry guard pass.
