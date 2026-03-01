# PRD — Ticket Comment Clipboard Image Attachments

- Slug: `ticket-comment-clipboard-image-attachments`
- Date: `2026-03-01`
- Status: Draft

## Summary

Enable agents to paste images from clipboard directly into ticket comments. Pasted images are uploaded immediately, stored as ticket document attachments, rendered inline in the BlockNote comment stream via attachment-serving URLs, and included inline in outbound ticket-comment emails using CID-backed attachments.

## Problem

Today, pasted `data:image/...` content in ticket comments is not handled as first-class attachments. This causes oversized raw content payloads, inconsistent rendering, and no reliable document lifecycle. We need clipboard image paste to behave like inbound-email image attachments: persisted documents with stable rendering and email compatibility.

## Goals

- Support image paste from clipboard in ticket comment editor.
- Upload pasted images immediately (before comment submit) for fast user feedback.
- Persist pasted images as ticket documents/files through the existing attachment pipeline.
- Replace raw data URLs with attachment-backed image references for rendered comments.
- Include these images inline in outbound ticket-comment emails via CID attachments.
- On cancel, offer user choice to keep uploaded images or hard delete them.

## Non-goals

- Supporting arbitrary non-image clipboard payloads.
- Building automatic orphan cleanup jobs for abandoned drafts in this scope.
- Image editing/cropping UI.
- Reworking the existing ticket document permission model.

## Users and Primary Flows

1. Technician pastes image and submits comment
- User pastes screenshot into BlockNote ticket comment editor.
- Client uploads image immediately and inserts image block placeholder.
- Upload resolves to ticket document attachment and rendered comment references attachment-backed image.
- Comment submit sends attachment references (not raw base64 payload).

2. Technician cancels draft containing pasted images
- User starts comment, pastes one or more images, then cancels.
- UI prompts to keep uploaded images or hard delete them.
- If user chooses delete, system hard deletes the selected draft-uploaded documents/files.

3. Outbound email for ticket comments
- Ticket-comment email fanout sees attachment-referenced images in comment payload.
- Email generator emits CID inline attachments and rewrites HTML image `src` to `cid:...`.
- Recipients see inline images in email clients.

## UX / UI Notes

- Pasted image should appear immediately with an uploading state.
- Upload error states should be explicit and allow retry/remove before submit.
- Cancel flow should include clear copy:
  - keep images as ticket documents
  - delete images permanently (hard delete)
- Existing comment rendering should show inline images naturally without exposing raw data URLs.

## Requirements

### Functional Requirements

- Detect clipboard image items (`image/*`) in the ticket comment editor paste handler.
- For each image item, upload immediately using existing ticket attachment/document infrastructure.
- Apply deterministic filename convention for clipboard images.
- Insert/update BlockNote image nodes to store attachment references (document/file identity) instead of raw data URLs.
- Ensure comment persistence path stores attachment-backed content that can be re-rendered later.
- Render comment images from attachment-serving endpoints in ticket comment UI.
- Reuse attachment authorization model when serving rendered comment images.
- When sending comment emails, resolve attachment-referenced images to CID inline attachments.
- Rewrite outbound email HTML image `src` attributes to CID references for those images.
- On draft cancel, if clipboard-uploaded images exist, prompt keep vs hard delete.
- Hard delete path removes file object and metadata (document/file records) for selected clipboard-uploaded draft images.
- Do not delete images that are already referenced by a saved comment or otherwise not owned by that draft cancellation action.

### Non-functional Requirements

- Prevent comment-save payload bloat from raw base64 image bodies.
- Image handling must remain responsive for normal screenshot-sized paste actions.
- Behavior must be deterministic across page reload/render cycles for saved comments.

## Data / API / Integrations

- Reuse existing ticket document/file storage pipeline (DB + object storage).
- Extend ticket comment editor serialization/parsing to represent attachment-backed image nodes.
- Reuse/extend attachment-serving URL generation used by existing document/image consumers (for example avatar/document-style serving patterns).
- Extend outbound ticket-comment email composition to include CID attachments from stored ticket documents.

## Security / Permissions

- Only users authorized to view ticket documents can retrieve rendered comment images.
- Validate accepted MIME types for clipboard image uploads.
- Enforce tenant isolation on upload, render, and delete paths.
- Hard delete operations must be authorized and scoped to deletable draft-uploaded artifacts.

## Observability

- Log clipboard image upload success/failure in ticket comment flow.
- Log cancel-delete decisions and resulting delete operations for clipboard-uploaded images.
- Log outbound CID image attachment generation failures with fallback outcome.

## Rollout / Migration

- Ship behind a feature flag for ticket-comment clipboard image support.
- No historical data migration required.
- Existing comments containing normal text or external images remain unaffected.

## Open Questions

- None blocking for plan draft; defaults chosen below.

## Explicit Decisions Locked In

- Upload timing: immediate on paste.
- Storage target: ticket documents/files.
- Cancel behavior: prompt user; delete path is hard delete.
- Outbound strategy: CID inline attachments for comment images, with URL fallback if CID build fails.

## Acceptance Criteria (Definition of Done)

- Pasting an image into ticket comment editor uploads immediately and shows inline in editor.
- Submitted comment persists image as attachment-backed reference (not raw `data:image`).
- Ticket comment viewer renders saved image via attachment-serving URL with normal permissions.
- Outbound ticket-comment email includes inline image representation via CID attachments.
- Canceling a draft with pasted images prompts keep/delete and hard delete removes chosen artifacts.
- Existing non-image comment behavior is unchanged.
