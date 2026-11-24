# Scratchpad — Collapse the comment that opened an email ticket

## Origin

Community feedback (Discord, 2026-11-13): the opening email shows twice on email tickets, as the
description and again as the first comment. The options considered were:

- delete the comment;
- blank the description;
- collapse the comment into a compact row (chosen).

Collapsing keeps every consumer of the description and the comment working, and keeps the email's
provenance.

## Discoveries

- **The duplicate exists only on email tickets.** MSP `addTicket`, portal `createClientTicket` and API
  `TicketService.createTicket` write no comment. Huntress and Teams write internal system notes, which
  are not duplicates.
- **Write paths for the opener comment:**
  - `shared/services/email/processInboundEmailInApp.ts` (~:2366): `createCommentFromEmail` with
    `suppressTechEmailNotification: true`.
  - `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`: action
    `create_ticket_with_initial_comment` (~:569), used by `email-processing-workflow.v2.json`.
- **Nothing persisted marks the opener today.** `suppressTechEmailNotification` only affects the event
  publisher. The only link is that the comment's `metadata.email.messageId` equals the ticket's
  `email_metadata.messageId`.
- **The workflow path's comment metadata** comes from `parsedEmail.metadata` plus
  `withEmailSenderMetadata`. It may lack `messageId`, which is why the backfill needs the time-window
  fallback.
- **`tickets.ticket_origin = 'inbound_email'`** exists (migration 20260209160000) and is reliable for the
  backfill.
- **Portal redaction:** `redactCommentForClient` (`packages/tickets/src/lib/commentVisibility.ts`)
  deletes `metadata.email` (`CLIENT_REDACTED_METADATA_KEYS`). That is why the marker is top-level.
- **The v1 comments API** (mobile, full format) passes `metadata` through. Mobile's `TicketComment` type
  just doesn't declare it.

## Render surfaces (all via CommentItem except mobile)

- **MSP classic:** `TicketInfo` description, then `TicketConversation` → `renderCommentItem` →
  `CommentItem`.
- **MSP bento:** `BentoHero` description, then `BentoTimelineTile` → `renderThreadComment` →
  `CommentItem variant="compact"`.
- **Thread drawer:** `CommentThreadDrawer` → `renderCommentItem`.
- **Client portal:** `packages/client-portal/src/components/tickets/TicketDetails.tsx` mounts the same
  `TicketConversation`.
- **Mobile:** `ee/mobile/src/screens/TicketDetailScreen.tsx` → `features/ticketDetail/components/CommentsSection.tsx`
  → `ExpandableComment`.
- **Existing helpers to reuse:**
  - `getInboundSenderIdentity` (`CommentItem.tsx` ~:90)
  - `originalEmailSourceForComment` (`packages/tickets/src/lib/inboundEmailOriginalView.ts`)
  - `ClampedContent`
- **Activity log drawer:** titles only, no change needed.

## Decisions

- **Marker shape:** top-level `metadata.opensTicket: true`, plus `metadata.attachmentCount`. It is a
  source-agnostic name, so a future channel that opens tickets with a message can reuse it.
- **`opensTicket` implies tech-email suppression,** collapsing two flags into one concept at the opener
  call sites.
- **The collapse lives inside `CommentItem`,** so one change covers every web surface.
- **No feature flag:** presentational, no data change, expanding restores today's view.
- **Always collapsed on load:** no persisted per-user preference.

## Gotchas

- **Citus:** the backfill UPDATE must join `comments`↔`tickets` on `tenant`. Don't use `now()` in
  CASE/COALESCE.
- **Attachment count:** count only non-inline attachments. Inline `cid:` images are already in the body.
- **Inline images:** both the description and the opener comment get cid→URL rewriting. Expanding must
  keep that working (covered by the existing e2e).

## Commands

- `node scripts/validate-translations.cjs`
- `node scripts/generate-pseudo-locales.cjs`
