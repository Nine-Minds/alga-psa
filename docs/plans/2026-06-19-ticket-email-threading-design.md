# Ticket Email Threading — Design

**Date:** 2026-06-19
**Branch:** `feature/email-threading`
**Status:** Approved design, pre-implementation

## Problem

Outbound ticket notification emails do not thread in recipients' mail clients. Every
notification for a ticket — created, commented, updated, status-changed, closed,
assigned — arrives as a standalone message instead of collapsing into one conversation
per ticket. The regression is customer-visible: roughly half a dozen MSP customers have
complained, including a top account, and one provided a screenshot showing each ticket
email as an independent thread in their client. Prior PSAs the customer used (Zendesk,
NinjaOne, Autotask) all threaded correctly, so this is a competitive liability and a
churn risk.

## Root cause

Threading headers are attached on the **comment path only**; every other ticket
notification is sent as a fresh root message.

- `packages/email/src/BaseEmailService.ts:407` sets a `Message-ID` **only when**
  `replyContext.commentId` is present, and `In-Reply-To` / `References` are produced
  **only** by `addCommentThreadReplyHeaders()` (`:401`), which keys entirely off a
  comment thread.
- The high-volume event types — `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_CLOSED`,
  `TICKET_ASSIGNED` — pass `replyContext: { ticketId, threadId }` with **no
  `commentId`** (e.g. `ticketEmailSubscriber.ts:1041`, `:1377`, `:1424`). They therefore
  get no Alga-controlled `Message-ID` and no `In-Reply-To` / `References`. The provider
  stamps a random `Message-ID` and the client sees a standalone email.
- Even the comment chain lacks a root: the first email on a ticket is almost always a
  non-comment ("created"), which is never recorded as the thread anchor, so later
  comments have nothing stable to reference.
- Subjects are not a usable fallback. Updates hardcode `Ticket Updated: <title>`
  (`:1374`); created uses the template subject; the `Ticket #<number>` token lives only
  in the body meta-line (`:902`), never in the Subject — so client subject-grouping
  cannot rescue threading either.
- The little threading that exists anchors on `tickets.email_metadata.threadId/messageId`,
  which exists **only for email-origin tickets**. UI-created tickets have no anchor at all.

The branch already built the persistence layer (`comment_threads.email_references`,
`email_sending_logs.rfc_message_id`) but wired it to fire only for comments.

## Decisions

1. **Anchor model:** one canonical, stable root `Message-ID` per ticket (ticket-scoped
   threading), not per-comment-thread.
2. **Scope:** fix both audiences. Internal agent notifications collapse into one
   conversation per ticket; contact-facing emails for email-origin tickets merge into the
   customer's **original** email thread by seeding the anchor from the inbound
   `Message-ID`.
3. **Storage:** reuse `tickets.email_metadata` for the anchor and the references chain;
   no new table. `comment_threads` remains for comment sub-threading.
4. **References cap:** root + last 20 message-ids.
5. **Sending domain:** synthetic ids use the tenant's configured sending/email domain;
   fall back to a single configured app domain. Stop minting `*.alga-psa.local` ids.

## Design

### 1. Canonical root Message-ID per ticket

Each ticket resolves one stable RFC `Message-ID` that is the conversation root,
determined once and persisted on the ticket:

- **Email-origin ticket** → root = the customer's original inbound `Message-ID`
  (already stored in `email_metadata.messageId`). This is what merges agent replies into
  the customer's existing conversation.
- **UI-origin ticket** → root = deterministic synthetic `<ticket-{ticketId}@{sendingDomain}>`,
  generated once and stored. Deterministic form lets concurrent first-events converge
  without minting two anchors.

### 2. Threading headers on every outbound ticket email

Replace the comment-only gate (`BaseEmailService.ts:401–409`) with
`applyTicketThreadHeaders({ tenantId, ticketId, headers })` invoked for **all** ticket
events. Per email:

- `Message-ID`: always a fresh `<evt-{uuid}@{sendingDomain}>`.
- `In-Reply-To`: the most recent prior outbound `rfc_message_id` for the ticket (from
  `email_sending_logs`), else the root.
- `References`: `[root, …prior ticket message-ids]`, deduped and capped (root + last 20).
- After send, record this message's `rfc_message_id` in `email_sending_logs` scoped to
  the **ticket** (`entity_type='ticket'`, `entity_id=ticketId`), in addition to any
  comment-thread linkage.

Header resolution is best-effort: wrapped in try/catch, it must never block or fail the
send (matches the current `addCommentThreadReplyHeaders` contract).

### 3. Stable subject

Centralize subject construction (in `sendEventEmail` after template compilation) so every
event renders `[Ticket #<number>] <title>`, preserving the normalized inbound subject for
email-origin tickets. Applying it post-compile avoids editing each DB-stored template.

### 4. Provider preservation

Confirm nodemailer (`SMTPEmailProvider.ts:260`) and Resend (`ResendEmailProvider.ts:366`)
transmit our `Message-ID` / `In-Reply-To` / `References` unchanged, and that the
`rfc_message_id` we record equals what is actually on the wire — otherwise `References`
point at ids that never existed and threading silently breaks. Use the real sending domain
so ids are well-formed and replies route back.

### 5. Inbound round-trip

Because every outbound email now logs an `rfc_message_id` keyed to the ticket, a customer
replying to **any** notification (not just comments) resolves to the correct ticket: the
inbound resolver already walks `In-Reply-To` / `References` →
`email_sending_logs.rfc_message_id`. Required change: the resolver must map a
**ticket-entity** log row back to its ticket, not only a `comment_thread_id`. Reply-token
matching remains the primary path; this is the header-based fallback.

## Data model

No new tables.

- `tickets.email_metadata` — holds the resolved root anchor and the accumulating
  references chain (the branch already appends references here at `sendEventEmail.ts:478`).
- `email_sending_logs` — every outbound email records `rfc_message_id` and ticket linkage
  (`entity_type='ticket'`, `entity_id`), enabling both the outbound chain and inbound
  reply matching.
- `comment_threads` — unchanged; retained for comment sub-threading.

## Error handling & safety

- Threading-header resolution is best-effort and isolated from the send path.
- `References` is capped to bound header growth.
- Anchor creation is idempotent under concurrency via the deterministic synthetic id.

## Testing / verification

Driven end-to-end through the local GreenMail + IMAP-service rig (raw headers inspected
from GreenMail; invariants checked in SQL):

- **Outbound, UI-origin:** create → comment → close; assert each agent email has a
  `Message-ID`, a growing `References` chain sharing one root, and a `[Ticket #N]` subject.
- **Email-origin + merge:** inbound email creates a ticket (root = inbound `Message-ID`);
  agent reply/comment references that inbound id.
- **Round-trip:** customer replies to a status-update (non-comment) email → matched to the
  same ticket, no duplicate ticket created.
- **Invariants:** `email_sending_logs` / `email_metadata` show one root per ticket and a
  monotonically growing, capped references chain.

## Out of scope

- Reworking `comment_threads` into the ticket anchor (we reuse `email_metadata` instead).
- Changes to notification preferences, recipient resolution, or template content beyond
  the subject token.
- Provider/transport changes beyond verifying header passthrough and the sending domain.
