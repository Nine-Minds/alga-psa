# Close-popup: BlockNote resolution editor + notification suppression

**Branch:** `feature/notification-suppression-close-popup`
**Date:** 2026-07-17

## Problem

The "Close ticket" popup added in PR #2963 (`TicketResolutionDialog`, opened from the
close button on the ticket detail screen in both classic and bento layouts) lags the
real resolution composer in two ways:

1. The resolution is a plain `TextArea`; the conversation composer uses the BlockNote
   `TextEditor` with mentions and clipboard-image upload. The popup's text gets wrapped
   in a single rich-text paragraph on save, losing all formatting ability.
2. It has no notification-suppression checkboxes. The composer (and the bulk-move flow)
   offer `TicketNotificationSuppressionControl` ("Don't notify the customer" → "Also
   don't notify agents and watchers"); a close via the popup always notifies.
   Additionally, when the popup's close is blocked by close rules, the blocked-close
   override dialog is opened with `suppression: null` hardcoded
   (`TicketDetails.tsx:2692`), so even a suppressed close would notify after
   "Close anyway".

## Settled design (approach A — self-contained dialog)

The dialog owns its editor, upload session, and suppression state, mirroring how the
conversation composer is built. No backend changes: `updateTicketWithCache` already
accepts `suppressContactNotifications` / `suppressInternalNotifications`, and the
resolution comment continues to use the `closesTicket=true` flag for duplicate-email
dedupe (identical to the conversation path).

Decisions made in the design session:

- Editor parity: mentions + clipboard-image uploads, **no** Hocuspocus `roomName`
  (a room shared with the main composer would cross-contaminate).
- Suppression control always active (a close status is mandatory in this dialog),
  defaults to both-unchecked on every open. No persistence of last choice.
- Suppression choice carries into the blocked-close override dialog, fixing the
  hardcoded `null`.
- The old `TextArea` placeholder string is dropped (BlockNote has no placeholder; the
  prompt sentence above the fields carries that job).

## Changes

### 1. `packages/tickets/src/components/ticket/TicketResolutionDialog.tsx`

- Replace `TextArea` with the BlockNote editor, same pattern as `TicketConversation`:
  `dynamic(() => import('@alga-psa/ui/editor').then((m) => m.TextEditor), { loading: () => <RichTextEditorSkeleton height="200px" /> })`
  wrapped in `Suspense` with the same skeleton. No `roomName`. `autoFocus`.
- Content state is `PartialBlock[]`, initialized from `DEFAULT_BLOCK` (import the
  existing export from `./TicketConversation`). Remount the editor on each open
  (bump an editor key in the existing `isOpen` effect) so content resets.
- "Has content" check for enabling confirm: `JSON.stringify(content) !== JSON.stringify(DEFAULT_BLOCK)`
  — the same comparison `handleAddNewComment` uses. Confirm stays disabled without a
  status or content, and while submitting.
- Mentions: `searchMentions={searchUsersForMentions}` imported from
  `@alga-psa/user-composition/actions` (as `TicketConversation` does).
- Uploads: own `useTicketRichTextUploadSession` instance —
  `componentLabel: 'TicketResolutionDialog'`, `trackDraftUploads: true`, wired to the
  upload plumbing props below; `uploadFile={session.uploadFile}` on the editor.
  - On cancel/close with tracked draft images: `session.requestDiscard()` instead of
    closing directly; render the same `ConfirmationDialog` the composer has
    (`clipboardDraftCancelTitle` / `clipboardDraftCancelMessage` keys, delete / keep /
    continue-editing), then close after resolution. Without drafts, close immediately.
  - On confirm: `session.resetDraftTracking()` (images become part of the comment).
- Add `TicketNotificationSuppressionControl` below the editor
  (`idPrefix={`${id}-notification-suppression`}`), state reset to both-false in the
  `isOpen` effect, disabled while submitting.
- Props change:
  - New: `ticketId: string`, `currentUserId?: string | null`,
    `onClipboardImageUploaded?: () => Promise<void> | void`, plus the three optional
    upload plumbing props with the same signatures `TicketConversation` declares:
    `uploadTicketAttachmentAction`, `deleteDraftTicketAttachmentImagesAction`,
    `resolveTicketAttachmentViewUrl`.
  - `onConfirm` becomes
    `(statusId: string, contentBlocks: PartialBlock[], suppression: TicketNotificationSuppressionValue) => void`.
- Widen the dialog: `max-w-lg` → `max-w-2xl` so the editor toolbar fits.
- Drop the `info.closeTicketResolutionPlaceholder` usage.

### 2. `packages/tickets/src/components/ticket/TicketDetails.tsx`

- `addResolutionComment` now takes the stringified BlockNote JSON and passes it to
  `addTicketCommentWithCache` unchanged (still `isInternal=false`, `isResolution=true`,
  `closesTicket=true`). Remove the `createTicketRichTextParagraph` wrap and its import
  (line 126 — this was its only use).
- `handleResolveAndClose(statusId, contentBlocks, suppression)`:
  - `addResolutionComment(JSON.stringify(contentBlocks))`.
  - Blocked-close dialog gets
    `suppression: suppression.suppressContactNotifications ? suppression : null`
    instead of `null` (the existing override handler at `TicketDetails.tsx:421` already
    forwards `closeBlockedDialog.suppression`, so this is the only fix needed).
  - Status write becomes
    `updateTicketWithCache(ticket.ticket_id!, { status_id: statusId }, suppression.suppressContactNotifications ? suppression : undefined)`
    — matching the `options?.suppressContactNotifications ? options : {}` pattern used
    elsewhere.
- Pass the new props at the `<TicketResolutionDialog>` render site (~line 3428):
  `ticketId={ticket.ticket_id!}`, `currentUserId={userId}`,
  `onClipboardImageUploaded={refreshTicketDocuments}`, and forward
  `uploadTicketAttachmentAction` / `deleteDraftTicketAttachmentImagesAction` /
  `resolveTicketAttachmentViewUrl` (already available as `TicketDetails` props).

### 3. Tests — `TicketResolutionDialog.test.tsx`

- Mock `@alga-psa/ui/editor` (and neutralize the `next/dynamic` indirection) with a stub
  that renders a textarea and calls `onContentChange` with paragraph blocks; mock
  `@alga-psa/user-composition/actions` (`searchUsersForMentions`) and the upload-session
  dependencies as needed (simplest: mock `./useTicketRichTextUploadSession`).
- Update existing cases: confirm disabled until status + non-empty content; submit now
  yields `(statusId, blocks, suppression)`.
- New cases:
  - Suppression defaults: both checkboxes unchecked on open, and reset after reopen.
  - Checking contact + internal suppression passes
    `{ suppressContactNotifications: true, suppressInternalNotifications: true }`.
  - Internal checkbox disabled until contact is checked (control behavior wired in).

### 4. Locales

- Remove the now-unused `info.closeTicketResolutionPlaceholder` key from all 10
  `server/public/locales/*/features/tickets.json` files. No new keys needed — the
  suppression control and clipboard-draft dialogs bring their own existing keys.

## Out of scope

- Backend/notification-subscriber changes (initially believed unnecessary; superseded by
  the review mitigation below).
- Extracting a shared "resolution composer" from `TicketConversation` (approach C —
  deliberately rejected as a larger refactor than the feature warrants).
- The conversation composer and bulk-move suppression flows (already shipped).

## Verification

1. `npx vitest run packages/tickets/src/components/ticket/TicketResolutionDialog.test.tsx`
   plus the adjacent contract tests
   (`ticketActions.suppressionMirror.contract.test.ts`,
   `optimizedTicketActions.liveUpdates.test.ts`) to confirm no regressions.
2. Manual smoke on the running dev stack (http://localhost:3432): open a ticket → close
   button → popup shows BlockNote editor + suppression checkboxes; type formatted text,
   paste an image, @mention a user; confirm → ticket closes, resolution comment renders
   with formatting and image; reopen popup on another ticket → fields and checkboxes
   reset. Cancel-with-pasted-image path shows the keep/delete dialog.
3. Suppression smoke: close a ticket with "Don't notify the customer" checked and
   verify no contact notification is recorded (internal notification still sent);
   repeat with both checked and verify neither is sent. Verify the blocked-close
   "Close anyway" override after a suppressed popup close also suppresses.

## Review mitigation: resolution-comment event suppression

The close operation writes its resolution comment and status in separate transactions.
The original implementation applied suppression only to the status write, so the
resolution comment's `TICKET_COMMENT_ADDED` event remained loud. The mitigation:

- passes the selected suppression value into `addTicketCommentWithCache` when the close
  popup persists its resolution;
- publishes both suppression flags on that comment event (defaulting to false for all
  existing callers and enforcing the existing contact-before-internal invariant);
- applies contact suppression to contact/portal recipients and external watchers in
  comment notification subscribers; and
- classifies mentions by the mentioned user's type, then applies contact or internal
  suppression as appropriate; assigned/additional agents and internal watchers use
  internal suppression.

Behavioral coverage verifies both contact-only and full suppression on closing
resolution comment events and on each subscriber's recipient policy.
