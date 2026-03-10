# Scratchpad — Ticket Description Rich Text Cutover

- Plan slug: `ticket-description-rich-text-cutover`
- Created: `2026-03-09`

## What This Is

Working notes for converting ticket descriptions onto the same rich-text editor model used by ticket comments while simplifying duplicate ticket rich-text logic.

## Decisions

- (2026-03-09) Store rich descriptions in the existing `ticket.attributes.description` field as serialized BlockNote JSON; do not add a new schema field.
- (2026-03-09) Use lazy upgrade for historical plain-text descriptions: keep them readable and only rewrite them when a description is edited and saved.
- (2026-03-09) Description cancel behavior for pasted images should prompt keep/delete, matching the richer draft workflow rather than silently leaking uploads.
- (2026-03-09) Use the simplification-cascade approach: treat ticket description, comment compose, and comment edit as the same ticket rich-text problem with different draft-tracking modes.
- (2026-03-09) Scope the abstraction to the ticket module for this unit of work rather than attempting an app-wide editor refactor.
- (2026-03-09) Keep the shared rich-text abstractions ticket-scoped in `packages/tickets` even though `TextEditor` already has its own parsing fallback, because the PRD explicitly wants ticket-only consolidation of description/comment behavior and draft image session rules.
- (2026-03-09) Extract the description save-side effect from `TicketDetailsContainer` into a small helper (`ticketDescriptionUpdate.ts`) so the payload merge/auth/error path can be tested directly without pulling the full optimized ticket action graph into jsdom.
- (2026-03-09) Count the plan test checklist as satisfied by a combination of new unit/hook/helper tests and existing ticket clipboard contract tests; no separate database harness was introduced for this cutover.

## Discoveries / Constraints

- (2026-03-09) `TicketInfo.tsx` already renders descriptions with `RichTextViewer` and uses `TextEditor` in edit mode, but it still carries its own JSON parsing fallback logic and does not wire the comment upload/mention helpers into the description editor.
- (2026-03-09) `TextEditor.tsx` already owns markdown paste handling, HTML normalization behavior, mention insertion support, and `uploadFile`-based clipboard-image handling. Description work should reuse that path instead of adding description-specific paste code.
- (2026-03-09) `TicketConversation.tsx` already contains the ticket clipboard-image upload, draft tracking, keep/delete prompt, and hard-delete flow for new comment drafts. That behavior is the direct precedent for description edit cancel semantics.
- (2026-03-09) `CommentItem.tsx` already has separate JSON/plain-text fallback parsing for comments and uses clipboard upload without draft tracking during existing-comment edit. That is a good target for shared-helper consolidation.
- (2026-03-09) `TicketDetailsContainer.tsx` and `TicketDetails.tsx` already save description changes through `onUpdateDescription(content: string)`, which currently writes the string directly into `ticket.attributes.description`.
- (2026-03-09) Existing code already supports rendering plain-text fallback by wrapping strings into paragraph blocks, so no migration is required to keep old tickets readable.
- (2026-03-09) `packages/tickets/vitest.config.ts` does not alias several cross-package server-only modules (`@alga-psa/documents`, `@alga-psa/event-bus`, etc.), so meaningful unit tests had to avoid importing those graphs eagerly. Lazy-loading the default upload/delete actions inside `useTicketRichTextUploadSession` fixed that without changing runtime behavior.
- (2026-03-09) The description editor needed the same document refresh callback that comments already use so cancel-delete can remove draft image documents and refresh the ticket document list immediately.
- (2026-03-09) Existing `clipboardImageDraftActions.contract.test.ts` already covers the guard rails for “already referenced”, “has other associations”, and “permission denied”, so the new description cancel-delete coverage only needed to verify the description flow routes into that action correctly.

## Completed Work

- (2026-03-09) Completed `F001`-`F018`: description edit now uses the shared `TextEditor` affordances (mentions, markdown/html paste, clipboard image upload), persists serialized BlockNote JSON, shares a ticket-scoped parse helper plus upload/session helper with comment compose/edit, prompts keep/delete for draft description images, refreshes ticket documents after upload/delete, and preserves comment compose/edit behavior on the shared helper path.
- (2026-03-09) Completed `T001`-`T031`: added `ticketRichText.test.ts`, `useTicketRichTextUploadSession.test.tsx`, `TicketDetailsContainer.description.test.tsx`, and `TicketInfo.richText.contract.test.ts`; updated the ticket clipboard/comment contract suites to assert the new shared-helper wiring; reused existing `clipboardImageUtils.test.ts` and `clipboardImageDraftActions.contract.test.ts` coverage for validation and delete guard rails.

## Commands / Runbooks

- (2026-03-09) Scaffolded the plan folder with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Ticket Description Rich Text Cutover" --slug ticket-description-rich-text-cutover`
- (2026-03-09) Validate the finished plan with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-09-ticket-description-rich-text-cutover`
- (2026-03-09) Key exploration commands:
  - `rg -n "onUpdateDescription|descriptionContent|TextEditor|RichTextViewer" packages/tickets/src/components/ticket`
  - `rg -n "uploadClipboardImage|handleClipboardImageUpload|deleteDraftClipboardImages" packages/tickets/src/components/ticket`
  - `sed -n '1,520p' packages/ui/src/editor/TextEditor.tsx`
- (2026-03-09) Verification commands:
  - `npx vitest run --config vitest.config.ts src/actions/comment-actions/clipboardImageDraftActions.contract.test.ts src/lib/clipboardImageUtils.test.ts src/lib/ticketRichText.test.ts src/components/ticket/useTicketRichTextUploadSession.test.tsx src/components/ticket/__tests__/TicketDetailsContainer.description.test.tsx src/components/ticket/TicketInfo.richText.contract.test.ts src/components/ticket/TicketConversation.clipboard.contract.test.ts src/components/ticket/TicketClipboardFlow.e2e.contract.test.ts src/components/ticket/CommentItem.clipboardImage.contract.test.ts` (run from `packages/tickets/`)
  - `npx tsc -p packages/tickets/tsconfig.json --noEmit`

## Links / References

- Reference implementation plan: `ee/docs/plans/2026-03-01-ticket-comment-clipboard-image-attachments/`
- Ticket description read/edit implementation: `packages/tickets/src/components/ticket/TicketInfo.tsx`
- Description save path: `packages/tickets/src/components/ticket/TicketDetails.tsx`
- Container save action: `packages/tickets/src/components/ticket/TicketDetailsContainer.tsx`
- Shared ticket description save helper: `packages/tickets/src/components/ticket/ticketDescriptionUpdate.ts`
- Shared editor implementation: `packages/ui/src/editor/TextEditor.tsx`
- Existing ticket clipboard-image draft flow: `packages/tickets/src/components/ticket/TicketConversation.tsx`
- Existing ticket comment edit flow: `packages/tickets/src/components/ticket/CommentItem.tsx`
- Shared ticket rich-text parse helper: `packages/tickets/src/lib/ticketRichText.ts`
- Shared ticket upload/session helper: `packages/tickets/src/components/ticket/useTicketRichTextUploadSession.ts`

## Open Questions

- Confirm whether any downstream email/export path renders ticket descriptions in contexts that need additional regression coverage for rich image blocks beyond the ticket UI.
