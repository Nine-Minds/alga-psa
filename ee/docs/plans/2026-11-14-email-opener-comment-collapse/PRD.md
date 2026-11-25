# PRD — Collapse the comment that opened an email ticket

- Slug: `email-opener-comment-collapse`
- Date: `2026-11-14`
- Status: Draft

## Summary

When an inbound email opens a new ticket, Alga PSA stores the email body twice: once as the ticket
description and once as the ticket's first comment. Every ticket view renders the description directly
above the conversation, so the opening email appears twice in a row.

This change keeps both records but renders the opening comment as a single compact line, for example:

> ✉ Opened by email from Jane Doe ‹jane@example.com› · Nov 12, 3:41 PM · 2 attachments · **Show original email**

Clicking **Show original email** expands the row into today's full comment rendering. **Hide original
email** collapses it again. The row starts collapsed every time the ticket is opened.

## Problem

- The duplicated body clutters every email-originated ticket. Most tickets arrive by email, so this
  affects the majority of tickets.
- Users read the first comment as a comment, but nobody wrote it as one. It is the message that opened
  the ticket. Community feedback (Discord, November 2026) called this out directly: other ticketing
  systems they have used don't repeat the opening message as a comment.
- Tickets created in the MSP UI, the client portal or the REST API have no such comment, so
  email-originated tickets look inconsistent with the rest.

Why the comment can't simply be deleted: it carries the inbound email's provenance. That includes the
sender identity (including unmatched senders), Message-ID, subject, received time, parser details and
auth results. It also backs the "Original email" HTML view, and it is the root of a thread that people
can reply under. Once someone edits the description, the comment is the only record of what the client
actually sent.

## Goals

1. On every surface that shows the conversation, the comment that opened a ticket renders as one compact
   line with a "Show original email" control. Those surfaces are MSP classic, MSP bento, the thread
   drawer, the client portal and mobile.
2. Expanding the row shows exactly what renders today: the body, inline images, the response-source badge,
   the original-email switcher, actions and the metadata debug view.
3. The opening comment is identified by an explicit, durable marker written when the ticket is created,
   not guessed from "first comment by time".
4. Existing email-originated tickets get the same treatment through a backfill.
5. Nothing that reads the ticket description or the comment rows changes behavior: notifications, search,
   workflows, AI features, response state and email threading all stay as they are.

## Non-goals

- Changing what is stored. The description and the opening comment both remain, with unchanged content.
- Collapsing email replies on existing tickets. Only the comment that opened the ticket is collapsed.
- Remembering a per-user "always expanded" preference. Collapsed on every load is the intended behavior.
- Detecting or flagging when the description has been edited away from the original email.
- Changing the activity log drawer. It already shows comments as one-line entries.
- Adding an original-email HTML view to mobile or the client portal where none exists today.

## Users and Primary Flows

**MSP technician (classic or bento layout)**
1. Opens a ticket created from an email. The description shows the email body.
2. The conversation starts with the compact "Opened by email from …" line, and replies follow below.
3. Clicks **Show original email** to see the full original message, for example to check the raw HTML
   or the Cc list. Clicks **Hide original email** to collapse it again.

**Client portal user**
1. Opens their ticket. The description shows their email.
2. The conversation shows a compact "Opened by email" line instead of a second copy of their email.
   Portal redaction keeps the sender address out, so the row uses the resolved author name.

**Mobile technician**
1. Opens the ticket. `DescriptionSection` shows the body.
2. `CommentsSection` shows the compact row in place of the full first comment and expands it on tap.

**Threads:** when people replied under the opening comment, the thread bar ("N replies") and the replies
render exactly as today. Only the root comment's body collapses.

## UX / UI Notes

- **Compact row contents, left to right:**
  - Mail icon.
  - "Opened by email from {sender}". The sender is the resolved author name, or for unmatched senders
    the inbound sender identity (`getInboundSenderIdentity`).
  - The MSP view appends the sender address in angle brackets when it differs from the name.
  - The comment timestamp, in the same format as other comments.
  - "{n} attachment(s)" when the original email carried non-inline attachments.
  - A "Show original email" text button.
- **Expanded:** the full `CommentItem`, exactly as today, with a "Hide original email" control in the
  header.
- **Styling:** muted single line, visually distinct from a comment card. Same left alignment and spacing
  as a comment row. It must work in both `CommentItem` variants (`default` and the bento `compact`).
- **Position:** unchanged. The row sits where the comment sits, oldest-first at the top, and at the bottom
  when the portal sorts newest-first.
- **Tabs (All, Client, Internal, Resolution):** unchanged inclusion rules. The row appears wherever the
  comment would.
- **State:** expanded state is local to the mounted component. Re-opening the ticket starts collapsed.
- **Accessibility:** the toggle is a real button with `aria-expanded`, and its label names the action.
- **Mobile:** the same row using the app's styling, toggled by tap, reusing the existing per-comment
  expand state in `CommentsSection`.

## Requirements

### Functional Requirements

**Marker (write path)**
- FR1. `createCommentFromEmail` accepts an `opensTicket: true` input. When it is set:
  - the stored comment metadata contains top-level `opensTicket: true`;
  - the comment suppresses the technician email notification, replacing the separate
    `suppressTechEmailNotification` input at the opener call sites. Opening a ticket implies that the
    TICKET_CREATED email already covered it.
- FR2. The marker is top-level in `metadata`, not inside `metadata.email`, so it survives
  `redactCommentForClient`, which strips `metadata.email` for client principals.
- FR3. The opener comment also records `metadata.attachmentCount`: the number of non-inline attachments
  on the original email. It is omitted when unknown.
- FR4. Both new-ticket paths set the marker:
  - `processInboundEmailInApp` (new-ticket branch, `createCommentFromEmail` call).
  - The workflow action `create_ticket_with_initial_comment` in `registerEmailWorkflowActions.ts`.
- FR5. Reply paths never set the marker: the in-app reply branch, `create_comment_from_email` and
  `create_comment_from_parsed_email`. This includes a reply to a closed ticket that reopens it. A reply
  that is rerouted into a brand-new ticket goes through the new-ticket branch, so it is marked.

**Backfill**
- FR6. A migration sets `metadata.opensTicket = true` on existing opening comments. A comment qualifies
  when all of the following hold:
  - its ticket has `ticket_origin = 'inbound_email'`;
  - the comment is a root comment (`parent_comment_id IS NULL`) with inbound-email provenance
    (`metadata.responseSource = 'inbound_email'` or `metadata.email` present);
  - and either:
    - **primary:** `comments.metadata->'email'->>'messageId'` equals
      `tickets.email_metadata->>'messageId'`, or
    - **fallback, only when the primary leaves the ticket unmatched:** it is the ticket's earliest such
      comment and was created within 120 seconds of the ticket.
- FR7. At most one comment per ticket is marked. The migration is idempotent and leaves
  `attachmentCount` absent on backfilled rows.

**Rendering**
- FR8. A shared predicate `isTicketOpenerComment(comment)` reads `metadata.opensTicket === true`, and
  handles metadata stored as a jsonb string.
- FR9. `CommentItem` renders the compact opener row when the predicate holds and the row is collapsed,
  and the full comment otherwise. This one change covers MSP classic, MSP bento, the thread drawer, the
  bundle child-reply block and the client portal, since all of them render through `CommentItem`.
- FR10. Expand/collapse is local component state that defaults to collapsed.
- FR11. Thread replies under an opener root render unchanged, including the "N replies" bar and the
  auto-collapse behavior.
- FR12. Client portal: the row renders without the sender address and without the original-email
  switcher, since that data is redacted. Expanding shows today's portal comment.
- FR13. Mobile:
  - `TicketComment` gains an optional `metadata` field. The v1 comments API already returns it.
  - `CommentsSection` renders the compact opener row with tap-to-expand.
- FR14. All new strings are localized:
  - MSP and portal: `features/tickets` in every shipped locale, with the pseudo-locales regenerated.
  - Mobile: `en` `tickets.json`.

### Non-functional Requirements

- No extra queries per comment. The predicate reads data already on the row.
- The backfill runs on Citus. `comments` and `tickets` are distributed and co-located by `tenant`, so the
  join must include `tenant`. The migration avoids `now()` inside CASE/COALESCE.

## Data / API / Integrations

- `CommentMetadata` (`packages/types/src/interfaces/comment.interface.ts`) gains typed optional fields
  `opensTicket?: boolean` and `attachmentCount?: number`.
- No schema change: `comments.metadata` is already jsonb.
- No API contract change. The v1 comments endpoint and the portal action already pass `metadata` through.
  The markdown-format branch of `TicketService.getTicketComments` drops metadata; that is acceptable,
  since mobile uses the full format.
- Unchanged: outbound notifications, the TICKET_CREATED payload, response state, workflow events, search
  indexing and inbound threading (Message-ID lookups).

## Security / Permissions

- `opensTicket` and `attachmentCount` are not sensitive and stay visible to client principals.
  `metadata.email` stays redacted for clients as today.
- No new endpoints or permission checks.

## Observability

None beyond existing logging.

## Rollout / Migration

- Ships complete, with no feature flag. It is a presentational change with no data loss, and expanding
  the row restores today's view.
- The backfill migration ships in the same release. Comments written before the release and not caught
  by the backfill heuristic render fully, as they do today. That failure mode is safe.
- Mobile picks up the row in its next app release. Until then mobile behaves as today.

## Open Questions

- Should the bento hero's existing "Opened by {name}" caption be deduplicated against the new row? The
  default is to leave it, since one sits on the description and the other on the conversation.

## Acceptance Criteria (Definition of Done)

- A new email-originated ticket shows a compact "Opened by email from …" line instead of a duplicate body
  in MSP classic, MSP bento, the client portal and mobile.
- "Show original email" expands to the exact current rendering, and "Hide original email" collapses it.
  Reloading the ticket starts collapsed.
- Email replies, internal notes and comments on non-email tickets render exactly as before.
- Existing email-originated tickets render collapsed after the migration runs.
- Replies threaded under the opening comment remain visible and reachable.
- Technician notifications for new email tickets are unchanged: one TICKET_CREATED email and no comment
  email.
- Translations validate (`scripts/validate-translations.cjs`).
