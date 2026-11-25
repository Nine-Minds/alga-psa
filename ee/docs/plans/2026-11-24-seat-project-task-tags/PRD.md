# Existing tags on co-managed seat project tasks

Seat technicians can select existing ticket tags, but the project task dialog disables its Tags field even when the technician can update the task. Let technicians classify their work using the MSP’s vocabulary.

## Seat workflow

On tickets and project tasks a seat technician can update in the sponsoring MSP workspace, allow applying and removing existing, visible tags of the matching record type. Keep the tag definition when the final use is removed. Creating, renaming, recoloring and deleting definitions remain MSP-administered operations.

In the project task dialog, show applied tags and enable the picker for eligible choices. Show “No project-task tags available” when the seat has no eligible task tags. If all eligible tags are already applied, keep them visible and removable. Read-only records retain their display-only behavior.

## Implementation and acceptance

Use the existing tag mappings and the seat’s record and tag permissions. Align the dialog with the server’s decisions for listing, applying and removing. Verify scope on both the target record and chosen tag. A technician can reopen a ticket or task and see the saved change. Preserve ordinary MSP workflows and existing project-management restrictions. Scope covers the seat working in the sponsoring MSP workspace. No schema migration is anticipated.
