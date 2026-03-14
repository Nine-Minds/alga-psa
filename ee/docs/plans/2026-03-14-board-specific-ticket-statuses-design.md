# Design — Board-Specific Ticket Statuses

- Date: `2026-03-14`
- Status: Approved design summary

## Scope
This change applies to ticket statuses only. Project, interaction, and project-task statuses remain on their current tenant-wide model for now.

## Approved Decisions
1. Ticket statuses become board-owned records, not tenant-wide shared records.
2. The existing `statuses` table remains the canonical table, with ticket statuses gaining `board_id`.
3. The migration clones the current tenant-wide ticket statuses once per board, creates new `status_id` values, and remaps existing references.
4. Saved references should be remapped automatically when board context exists.
5. Changing a ticket's board must require the user to pick a valid status on the destination board. There is no runtime auto-remap.
6. New board creation must support both:
   - copying statuses from an existing board,
   - creating statuses inline.

## Data Model And Migration
The core runtime rule becomes: a ticket `status_id` is valid only within its `board_id`.

Implementation direction:
- add `board_id` to `statuses`,
- require `board_id` for `status_type = 'ticket'` rows after migration,
- keep non-ticket statuses boardless,
- update ticket status lookups and validation to use board scope.

Migration direction:
- clone all current tenant-wide ticket statuses for every board,
- preserve status metadata (`name`, `is_closed`, `is_default`, `order_number`, `color`, `icon`, `standard_status_id`, custom flags),
- build `old_status_id + board_id -> new_status_id` mappings,
- remap tickets and saved configuration records to the cloned board-owned status ids,
- fail or explicitly surface any persisted ticket-status reference that cannot be remapped safely because board context is missing.

## Admin UX
Ticket status management moves out of the tenant-wide ticket status list and into board setup.

Board UX direction:
- board create flow includes status seeding,
- source options are `Copy from existing board` and `Create statuses inline`,
- inline creation requires at least one open default status,
- board edit includes a board-local status manager for add, rename, reorder, default, open/closed, and delete flows.

## Application Contract Change
Every ticket status picker must become board-dependent.

That includes:
- ticket create and edit,
- quick add and bulk flows,
- client portal ticket actions,
- inbound ticket defaults,
- billing renewal ticket defaults,
- workflow ticket actions and filters,
- any other configuration UI that currently stores a ticket `status_id`.

Behavioral rule:
- no board selected means no ticket statuses are selectable,
- changing board invalidates the previous status selection until the user chooses a destination-board status.

## Refactor Surface
This is a platform-wide refactor, not a local settings change.

High-risk areas:
- ticket models, actions, APIs, and validation,
- status actions and generic status endpoints,
- workflow authoring/runtime and saved filters,
- billing renewal defaults,
- inbound email defaults,
- SLA pause config and reporting,
- notifications, surveys, and event subscribers,
- onboarding/import/seed helpers,
- fixtures, harnesses, and integration tests.

## Risks
1. Persisted ticket-status references without board context may block safe automatic migration.
2. Tenant-wide ticket-status helper APIs will need contract changes, not just implementation changes.
3. The migration must preserve behavior for workflows and billing settings that already store raw `status_id` values.
