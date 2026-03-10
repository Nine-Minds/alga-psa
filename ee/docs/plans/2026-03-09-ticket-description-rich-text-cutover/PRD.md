# PRD — Ticket Description Rich Text Cutover

- Slug: `ticket-description-rich-text-cutover`
- Date: `2026-03-09`
- Status: Draft

## Summary

Replace the ticket description's plain-text edit path with the same shared BlockNote/Tiptap editor used for ticket comments so technicians can author descriptions with formatting, mentions, HTML-to-markdown paste conversion, pasted images, and document-backed inline images. Persist rich descriptions in the existing `ticket.attributes.description` field as serialized BlockNote JSON while continuing to read legacy plain-text values and lazily upgrading them on the next save. Use a ticket-scoped shared rich-text pipeline so description editing, comment composition, and comment editing stop carrying separate parsing and clipboard-image logic.

## Problem

Ticket descriptions are still treated as a plain-text field even though comments already use a richer editor stack. That mismatch creates both a product gap and a maintenance problem:

- users can format comments but not descriptions
- pasted HTML and markdown are normalized in comments but not descriptions
- pasted images and document-backed inline images work in comments but not descriptions
- description parsing and save behavior are implemented as a separate one-off path instead of using the established ticket rich-text model

We need ticket descriptions to behave like the rest of the ticket rich-text surfaces without introducing a separate storage model or a third special-case editor implementation.

## Goals

- Use the same shared rich-text editor behavior for ticket descriptions that ticket comments already use.
- Support the expected rich-text authoring flows in descriptions:
  - formatting
  - mentions
  - emoji
  - HTML-to-markdown paste conversion
  - markdown paste conversion
  - pasted image upload
  - document-backed inline image rendering
- Keep `ticket.attributes.description` as the single persisted storage location.
- Make serialized BlockNote JSON the canonical stored description format after edit/save.
- Preserve read compatibility for legacy plain-text descriptions and lazily upgrade them on save.
- Simplify ticket rich-text logic by extracting shared parsing and clipboard-image session behavior instead of adding a description-specific implementation.

## Non-goals

- Bulk backfill or migration of all historical ticket descriptions.
- Changing the ticket schema or adding a separate markdown column for descriptions.
- Reworking the comment editor UX beyond what is needed to share the same underlying logic safely.
- Adding new rollout flags, observability work, or operational tooling beyond existing ticket editor patterns.
- Extending this cutover to unrelated note editors outside the ticket module.

## Users and Primary Flows

### Primary users

- Technicians and internal ticket editors who update ticket descriptions in the main ticket UI.

### Primary flows

1. Edit legacy plain-text description
- User opens a ticket whose `attributes.description` is plain text.
- Description loads into the rich-text editor as a paragraph block.
- User applies formatting or inserts images.
- Save persists serialized BlockNote JSON back to `attributes.description`.

2. Create rich ticket description
- User opens description edit mode on a ticket with no description or an existing rich description.
- User pastes formatted HTML or markdown content.
- Editor normalizes pasted content using the shared rich-text pipeline.
- User saves and sees the same content rendered in read mode through `RichTextViewer`.

3. Paste images while editing description
- User pastes one or more clipboard images into the description editor.
- Images upload immediately as ticket documents and appear inline in the editor.
- If the user saves, the description persists document-backed image references.
- If the user cancels, UI prompts whether to keep uploaded images as ticket documents or delete them.

4. Reopen an existing rich description
- User opens a ticket whose description is already stored as serialized BlockNote JSON.
- Description renders in read mode and reopens in edit mode without losing formatting, mentions, or image blocks.

## UX / UI Notes

- Keep the existing inline description edit affordance in the ticket details/info view rather than introducing a new modal or new page flow.
- Read mode should continue using `RichTextViewer`.
- Edit mode should use the same editor family and interaction model users already see in ticket comments.
- Description save/cancel actions remain where they are today.
- Cancel behavior for pasted images should match the richer draft workflow, not silent leakage:
  - if draft-uploaded description images exist, prompt user to keep or delete them
  - keep leaves the uploaded documents attached to the ticket
  - delete hard-deletes only the uploaded draft images selected for that cancel action
- Existing comment-edit cancel behavior should not be changed by this work.

## Requirements

### Functional Requirements

- `FR-001` Replace the ticket description edit surface with the shared `TextEditor` used for ticket comments.
- `FR-002` Continue rendering saved descriptions through `RichTextViewer` in non-edit mode.
- `FR-003` Load legacy plain-text `attributes.description` values into the editor as a paragraph fallback instead of failing to parse.
- `FR-004` Load existing serialized BlockNote JSON descriptions into the editor without data loss.
- `FR-005` Persist description saves as serialized BlockNote JSON in `ticket.attributes.description` through the existing `onUpdateDescription(content: string)` contract.
- `FR-006` Support HTML-to-markdown normalization and markdown paste in the description editor through the shared editor path.
- `FR-007` Support pasted clipboard image upload in the description editor using the same ticket document upload pipeline comments use.
- `FR-008` Persist description image blocks as document-backed references that still render after save and reopen.
- `FR-009` Support mentions and other existing shared editor affordances in ticket descriptions.
- `FR-010` When canceling description edit after draft image uploads, prompt the user to keep or delete those uploaded images.
- `FR-011` Keep path exits description edit mode without deleting uploaded draft images.
- `FR-012` Delete path hard-deletes only the draft-uploaded description images chosen for that cancel action and refreshes ticket documents accordingly.
- `FR-013` Extract a shared ticket rich-text parsing helper so description and comment surfaces do not each maintain their own JSON/plain-text fallback logic.
- `FR-014` Extract a shared ticket rich-text upload/session helper so description edit and comment composition can share upload, validation, draft tracking, and cancel-cleanup behavior.
- `FR-015` Migrate ticket comment compose and existing comment edit flows onto the shared ticket rich-text helper without changing their existing user-visible behavior except where shared infrastructure is internal.
- `FR-016` Keep tickets with empty descriptions, plain-text descriptions, or existing rich descriptions safe to open, edit, cancel, save, and reopen.
- `FR-017` Add automated coverage for description rich-text authoring, description image cancel flows, and regression coverage for comment flows now using the shared helper.

### Non-functional Requirements

- `NFR-001` No schema migration is required; storage remains in `ticket.attributes.description`.
- `NFR-002` Legacy descriptions must remain readable even if they are never edited.
- `NFR-003` Load/save behavior must be deterministic so round-trip tests can assert rich description persistence safely.
- `NFR-004` Shared ticket rich-text abstractions should reduce code duplication rather than creating a third special-case implementation.
- `NFR-005` Existing ticket comment behavior must not regress while the shared helper extraction happens.

## Data / API / Integrations

- Persist description content in the existing `ticket.attributes.description` field only.
- Keep the `onUpdateDescription(content: string)` save interface unchanged.
- Canonical saved payload after edit is the serialized BlockNote document JSON string.
- Continue reading plain-text description strings by converting them to a one-paragraph block structure at load time.
- Reuse the existing ticket document upload pipeline for clipboard images:
  - `uploadDocument`
  - ticket-scoped document associations
  - document view/download URLs
- Reuse the existing delete flow for draft clipboard images rather than inventing a separate description-only delete path.

## Security / Permissions

- Description editing continues to use the same ticket update permissions that already gate `onUpdateDescription`.
- Clipboard image upload and draft deletion must stay within the existing ticket document permission model.
- Draft delete must not remove images already referenced by saved content or images the requester is not allowed to delete.
- No new cross-tenant or cross-ticket document access path is introduced.

## Observability

- No new observability scope is planned beyond the existing upload/delete logging patterns already present in the ticket clipboard-image flow.

## Rollout / Migration

- No bulk migration or backfill is included.
- Existing plain-text descriptions stay valid and readable.
- The first successful rich-text save for a legacy description lazily upgrades that record to serialized BlockNote JSON.
- Existing rich descriptions remain compatible and should round-trip unchanged.

## Open Questions

- None blocking for this draft. Current defaults are:
  - lazy upgrade on save, not bulk migration
  - description cancel prompt uses keep/delete when draft-uploaded images exist
  - shared ticket-scoped abstraction is preferred over a wider app-wide editor refactor in this unit of work

## Acceptance Criteria (Definition of Done)

- A technician can edit a ticket description with the same rich-text editing capabilities available in ticket comments.
- A legacy plain-text description opens correctly in the editor and, after save, is stored as serialized BlockNote JSON.
- Pasted HTML and markdown are normalized in the description editor through the shared rich-text path.
- Pasted images upload as ticket documents and render inline in the saved description.
- Canceling description edit after pasted-image upload prompts keep/delete and the chosen action is applied correctly.
- Ticket comments continue to work after the shared helper extraction with no user-visible regressions in compose or edit flows.
