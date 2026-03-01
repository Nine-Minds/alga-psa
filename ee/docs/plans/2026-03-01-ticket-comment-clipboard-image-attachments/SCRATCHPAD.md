# Scratchpad — Ticket Comment Clipboard Image Attachments

- Plan slug: `ticket-comment-clipboard-image-attachments`
- Created: `2026-03-01`

## What This Is

Working notes for implementing clipboard image paste support in ticket comments, with attachment-backed rendering and outbound email inline-image support.

## Decisions

- (2026-03-01) Paste behavior is immediate upload, not deferred-until-submit.
- (2026-03-01) Uploaded clipboard images are persisted as ticket documents/files.
- (2026-03-01) Render saved comment images from attachment-serving URLs, not embedded `data:image` payloads.
- (2026-03-01) Outbound ticket-comment emails should render pasted images inline via CID attachments.
- (2026-03-01) Cancel flow must offer keep/delete choice when pasted images were uploaded.
- (2026-03-01) Delete choice on cancel is hard delete (remove metadata + stored object), not soft detach.

## Discoveries / Constraints

- (2026-03-01) Existing inbound email work already converts `data:image`/CID content into ticket document attachments; this plan should reuse those attachment rendering and storage patterns where possible.
- (2026-03-01) Clipboard image flows are user-driven and must avoid storing raw base64 image strings in persisted comment payloads.
- (2026-03-01) Cancel-delete safety must prevent removing artifacts that are already referenced by submitted comments.

## Commands / Runbooks

- (2026-03-01) Scaffolded plan folder with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Ticket Comment Clipboard Image Attachments" --slug ticket-comment-clipboard-image-attachments`

## Links / References

- Related plan: `ee/docs/plans/2026-02-27-inbound-email-embedded-images-and-original-eml/`
- Related plan: `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/`
- Related plan: `ee/docs/plans/2026-03-01-unified-inbound-email-pointer-queue/`

## Open Questions

- Confirm final max size/count limits for clipboard image uploads, or reuse existing ticket attachment limits exactly.
- Confirm whether cancel-delete prompt supports per-image selection or all-or-nothing delete in first version.
- (2026-03-01) F001 implemented: ticket comment editor now supports clipboard image paste handling via BlockNote `uploadFile` wiring in `TextEditor`, enabled from `TicketConversation` when the new feature flag is on.
- (2026-03-01) Implementation notes: introduced `packages/tickets/src/lib/clipboardImageUtils.ts` for MIME detection, deterministic naming, and pre-upload validation; this utility underpins paste-image handling.
- (2026-03-01) Commands: `npx vitest run src/lib/clipboardImageUtils.test.ts` (packages/tickets), `npx vitest run src/test/unit/notifications/ticketCommentInlineImageEmail.test.ts` (server), `npx vitest run src/blocknoteUtils.image.test.ts` (packages/formatting), `npx tsc -p packages/tickets/tsconfig.json --noEmit`, `npx tsc -p server/tsconfig.json --noEmit`.
- (2026-03-01) F002 implemented: ticket comment image uploads now start immediately on paste via `TextEditor` `uploadFile` wiring and `TicketConversation.handleClipboardImageUpload`, without waiting for comment submit.
- (2026-03-01) F003 implemented: Persist pasted images through ticket document/file pipeline via `uploadDocument` and returned document/file ids in comment image URLs.
- (2026-03-01) F004 implemented: Deterministic clipboard image naming added through `createClipboardImageFilename` and upload-time file renaming (`clipboard-image-YYYYMMDD-HHMMSS-SEQ.ext`).
- (2026-03-01) F005 implemented: BlockNote image upload placeholder path is enabled by providing `uploadFile` to editor configuration for pasted images.
- (2026-03-01) F006 implemented: Successful upload resolves placeholder to attachment-backed image node using `/api/documents/view/<fileId>` URL payload from upload handler.
- (2026-03-01) F007 implemented: Upload failure path now propagates upload/validation errors through editor upload API so users can retry/remove via BlockNote image error controls.
- (2026-03-01) F008 implemented: Comment content now persists attachment-backed image URLs (document view endpoints) instead of raw `data:image` bodies.
- (2026-03-01) F009 implemented: Ticket comment rendering path now uses saved attachment-serving URLs for inline images in BlockNote-rendered comment content.
- (2026-03-01) F010 implemented: Attachment image serving auth strengthened in `/api/documents/view/[fileId]` for ticket-associated document access checks.
- (2026-03-01) F011 implemented: Outbound ticket-comment email flow now maps comment image URLs into ticket document lookup + inline image processing model.
- (2026-03-01) F012 implemented: Outbound email now builds CID inline attachments for eligible ticket-comment images via storage-backed attachment generation.
