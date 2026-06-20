# PRD — Ticket Email Threading

- Slug: `2026-06-19-ticket-email-threading`
- Date: `2026-06-19`
- Status: Draft — pending confirmation
- Design: [../2026-06-19-ticket-email-threading-design.md](../2026-06-19-ticket-email-threading-design.md)

## Summary

Make every outbound email for a ticket thread into a single conversation in the
recipient's mail client by giving each ticket one stable root `Message-ID` and attaching
consistent RFC threading headers (`Message-ID`, `In-Reply-To`, `References`) plus a stable
`[Ticket #N]` subject to **every** notification — created, updated, closed, assigned, and
comment — for both internal agents and external contacts. For tickets created from a
customer email, the anchor is seeded from the inbound `Message-ID` so agent replies merge
into the customer's original email thread. Because every outbound email is logged with its
`rfc_message_id` keyed to the ticket, customer replies to any notification route back to
the correct ticket.

## Problem

Today threading headers are attached only on the comment path
(`BaseEmailService.ts:407`). The high-volume notification types (created/updated/closed/
assigned) are sent with no Alga-controlled `Message-ID` and no `In-Reply-To`/`References`,
so each arrives as a standalone message. Subjects diverge by event type and the
`Ticket #N` token never reaches the Subject, so client subject-grouping can't compensate.
UI-origin tickets have no email anchor at all. Result: a single ticket generates dozens of
disconnected emails. ~6 MSP customers (including a top account) have complained; one
provided a screenshot of independent emails. Prior PSAs (Zendesk/NinjaOne/Autotask)
threaded correctly, making this a churn risk.

## Goals

- Every outbound email for a ticket carries a stable `Message-ID`, a correct
  `In-Reply-To`, and an accumulating `References` chain anchored to one per-ticket root.
- A stable `[Ticket #N] <title>` subject across all event types.
- Email-origin tickets merge into the customer's original conversation (anchor = inbound
  `Message-ID`); UI-origin tickets use a deterministic synthetic root.
- Customer replies to **any** notification (not just comments) match back to the ticket
  with no duplicate-ticket regressions.
- Threading works identically for SMTP (nodemailer) and Resend transports.

## Non-goals

- No new threading tables; reuse `tickets.email_metadata` and `email_sending_logs`.
- No changes to notification preferences, recipient resolution, accumulator/retry queues,
  or template body content beyond the subject token.
- No reflow of `comment_threads` into the ticket anchor (it stays for comment
  sub-threading).
- No deliverability/DKIM/SPF work beyond using a real sending domain for generated ids.

## Target users / personas & primary flows

- **MSP agent (internal recipient):** receives ticket notifications; wants one
  conversation per ticket in their inbox.
- **End customer / contact (external recipient):** emails support or receives updates;
  wants agent replies in the same thread as their original message.

Primary flows: (1) UI-created ticket → created/comment/close notifications thread together
for agents; (2) Email-created ticket → outbound replies merge into the customer's original
thread; (3) Customer replies to any notification → appended to the same ticket.

## UX / UI notes

- Subject becomes `[Ticket #<number>] <title>` consistently (token moves from body
  meta-line into the Subject). `Re:` preserved for replies; email-origin tickets keep the
  customer's normalized subject so it matches their thread.
- No other visible template changes.

## Data model / API integration notes

- `tickets.email_metadata`: stores the resolved root anchor (`threadRoot`) and the
  accumulating references chain (already appended at `sendEventEmail.ts:478`).
- `email_sending_logs`: every outbound email records `rfc_message_id` with ticket linkage
  (`entity_type='ticket'`, `entity_id`), powering both the outbound chain and inbound
  reply matching.
- Inbound resolver (`processInboundEmailInApp.ts`) must map a ticket-entity log row back
  to its ticket for header-based matching; reply-token remains primary.
- Generated ids use the tenant sending domain (fallback app domain), not `*.alga-psa.local`.

## Risks, rollout, migration

- **Header passthrough:** if the provider overrides our `Message-ID`, the recorded
  `rfc_message_id` won't match the wire and threading silently breaks — must verify on both
  transports.
- **References growth:** cap to root + last 20 to bound header size.
- **Concurrency:** first events on a brand-new ticket must converge on one anchor
  (deterministic synthetic id / upsert).
- **Backfill:** existing in-flight tickets have no anchor; they begin threading from their
  next outbound email (acceptable; no historical backfill).
- No schema migration required (reuses existing JSONB/columns).

## Open questions

- Confirm the exact field name/shape for the stored anchor in `email_metadata`
  (`threadRoot`) and references cap value (default 20).
- Confirm sending-domain source of truth per tenant (email provider domain vs app config).

## Acceptance criteria / definition of done

- For a UI-origin ticket, created + comment + closed emails share one root in
  `References`, each has a distinct `Message-ID`, and all carry `[Ticket #N]` subjects
  (verified from raw GreenMail headers).
- For an email-origin ticket, outbound emails reference the inbound `Message-ID`.
- A customer reply to a non-comment notification appends to the same ticket; no duplicate
  ticket is created.
- SMTP and Resend both emit the exact headers Alga set; recorded `rfc_message_id` equals
  the on-wire id.
- Header-resolution failure never blocks a send.
