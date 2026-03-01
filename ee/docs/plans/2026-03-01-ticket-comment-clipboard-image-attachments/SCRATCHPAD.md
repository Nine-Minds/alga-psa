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
- (2026-03-01) F013 implemented: Outbound comment HTML image `src` values are rewritten to `cid:` references matching generated inline attachments.
- (2026-03-01) F014 implemented: Outbound processing now falls back to original attachment URL when CID conversion/download fails, preserving renderability.
- (2026-03-01) F015 implemented: Ticket compose state now tracks uploaded clipboard draft images (document/file/url identity) for subsequent cancel handling.
- (2026-03-01) F016 implemented: Canceling a draft with uploaded clipboard images now prompts keep-vs-delete through confirmation dialog copy and actions.
- (2026-03-01) F017 implemented: Delete option on cancel now hard-deletes selected draft clipboard images through server action + document deletion pipeline.
- (2026-03-01) F018 implemented: Draft hard delete now guards against non-owned/not-ticket/non-image/already-referenced artifacts before deletion.
- (2026-03-01) F019 implemented: Clipboard upload path now validates image MIME prefix and maximum file size before upload begins.
- (2026-03-01) F020 implemented: Non-image paste/plain-text behavior remains on existing path; clipboard image logic is isolated to image upload flow only.
- (2026-03-01) F021 implemented: Clipboard image paste flow is now rollout-gated behind `ticket-comment-clipboard-images` feature flag in ticket details.
- (2026-03-01) F022 implemented: Added client/server observability logs for upload outcomes, cancel keep/delete actions, and outbound CID vs fallback outcomes.
- (2026-03-01) T001 implemented: `clipboardImageUtils.test.ts` verifies image MIME clipboard items are extracted while non-image entries are ignored.
EOF && git add ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T001): cover clipboard image MIME filtering"- (2026-03-01) T002 implemented: `clipboardImageUtils.test.ts` verifies multi-image clipboard extraction preserves deterministic input order for per-image upload jobs.
EOF && git add ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T002): verify deterministic multi-image upload ordering"- (2026-03-01) T003 implemented: added `TicketConversation.clipboard.contract.test.ts` asserting upload is wired via editor `uploadFile` callback and that submit handler does not invoke `uploadDocument`, enforcing immediate pre-submit upload flow.
EOF && git add packages/tickets/src/components/ticket/TicketConversation.clipboard.contract.test.ts ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T003): assert immediate clipboard upload wiring"- (2026-03-01) T004 implemented: contract coverage verifies pasted-image upload path appends file to `FormData` and calls `uploadDocument` with `ticketId` scope.
- (2026-03-01) T005 implemented: `clipboardImageUtils.test.ts` validates deterministic clipboard filename output format.
EOF && git add ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T005): verify deterministic clipboard filename pattern"- (2026-03-01) T006 implemented: contract coverage confirms `uploadFile` wiring in `TicketConversation` so BlockNote can render in-flight upload placeholder UI for pasted images.
- (2026-03-01) T007 implemented: contract test validates successful upload return payload includes attachment-backed URL, enabling placeholder replacement with persisted image node.
EOF && git add ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T007): assert placeholder success replacement payload"- (2026-03-01) T008 implemented: contract test covers explicit upload error throws for validation and upload failures, feeding editor error affordances.
- (2026-03-01) T009 implemented: contract assertion validates failure propagation strategy that enables editor retry path to re-run upload callback after prior failure.
- (2026-03-01) T010 implemented: added contract assertions that pasted-image serialization path emits attachment-serving URLs (`/api/documents/view/...`) and does not embed `data:image` payload content.
- (2026-03-01) T011 implemented: `blocknoteUtils.image.test.ts` now includes non-image paragraph conversion regression assertions for markdown + HTML outputs.
EOF && git add ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T011): add non-image serialization regression assertions"- (2026-03-01) T012 implemented: added `CommentItem.clipboardImage.contract.test.ts` verifying saved BlockNote JSON is parsed and rendered through `RichTextViewer` for inline comment image display.
- (2026-03-01) T013 implemented: route contract coverage asserts ticket-associated document access checks include guard branch for users without resolved ticket/contact scope.
EOF && git add ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T013): cover unauthorized ticket-image route guard branch"- (2026-03-01) T014 implemented: route contract test asserts ticket-associated branch grants access (`hasPermission = true`) when contact/client scope matches associated ticket.
- (2026-03-01) T015 implemented: `ticketCommentInlineImageEmail.test.ts` verifies comment image attachment URLs are collected/mapped for outbound email composition.
- (2026-03-01) T016 implemented: outbound inline-image unit test asserts one CID attachment is produced per converted comment image.
- (2026-03-01) T017 implemented: outbound inline-image test asserts HTML image `src` rewrite from document-view URL to matching `cid:` reference.
- (2026-03-01) T018 implemented: outbound inline-image test covers storage/CID failure fallback retaining original attachment URL in HTML.
- (2026-03-01) T019 implemented: contract test now verifies draft clipboard image state tracking and document/file identity capture during upload.
- (2026-03-01) T020 implemented: contract assertions verify cancel action opens keep-vs-delete prompt when draft includes uploaded clipboard images.
EOF && git add ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/tests.json ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/SCRATCHPAD.md && git commit -m "test(T020): verify cancel prompt for uploaded draft images"- (2026-03-01) T021 implemented: contract coverage validates keep path handler clears draft state and closes editor without invoking hard-delete action.
- (2026-03-01) T022 implemented: added `clipboardImageDraftActions.contract.test.ts` validating hard-delete loop invokes `deleteDocument` for vetted draft artifacts.
- (2026-03-01) T023 implemented: draft-delete contract test asserts saved-comment reference guard (`already_referenced`) based on comment payload token scan.
- (2026-03-01) T024 implemented: draft-delete contract test validates permission-denied guard when requester lacks document delete permission.
- (2026-03-01) T025 implemented: `clipboardImageUtils.test.ts` covers unsupported MIME validation rejection before upload starts.
- (2026-03-01) T026 implemented: `clipboardImageUtils.test.ts` validates max-size guard rejects oversized clipboard images with explicit error.
- (2026-03-01) T027 implemented: `TicketDetails.clipboardFlag.contract.test.ts` asserts dedicated feature flag default-off gating for clipboard image paste flow.
- (2026-03-01) T028 implemented: feature-flag contract coverage verifies enabled state wires `uploadFile` callback to conversation editor flow.
- (2026-03-01) T029 implemented: contract assertions verify upload logs include ticket/user identifiers plus uploaded document/file artifact identity.
- (2026-03-01) T030 implemented: contract logging coverage verifies cancel keep/delete actions include selected action and delete-result counts/failure context.
