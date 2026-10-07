# PRD — Per-comment CC / BCC on ticket replies

- Slug: `ticket-comment-cc-bcc`
- Date: `2026-10-06`
- Status: Draft

## Summary

Let an MSP agent add CC and/or BCC recipients to a single public ticket reply. The recipients get that one comment by email, as real `Cc`/`Bcc` headers on the requester's notification. Nothing about them is remembered on the ticket afterwards. The same capability is exposed on every MSP-side path that creates a public comment: the MSP ticket composer, threaded replies, the REST API (and so MCP, AI chat and mobile), and the v2 workflow `tickets.add_comment` action.

## Problem

The only way to loop someone else into a ticket email today is the watch list. The watch list is ticket-scoped: a watcher gets every later public comment. Agents often want to include a manager, vendor, or second contact on one reply only. Right now they have to add a watcher and remember to remove them, or leave the ticket and write a separate email, which never gets logged on the ticket.

## Goals

- Add CC and BCC recipients to one public comment from the MSP ticket composer. The control sits next to the "Attach files" button.
- Deliver them as real `Cc`/`Bcc` headers on the requester's comment email, so the requester sees who was CC'd and reply-all includes them.
- Never add CC/BCC recipients to the watch list, either when the comment is sent or when they (or the requester) reply-all.
- Accept `cc`/`bcc` on every MSP-side comment-creation path: server actions, the REST API (and so mobile, MCP and chat), and the workflow `tickets.add_comment` action.
- Record the recipients on the comment, show them in the timeline (BCC visible to MSP users only), and include them in the existing email log.

## Non-goals

- CC/BCC on internal notes. The controls are hidden, and the API rejects cc/bcc when `is_internal = true`.
- CC/BCC from the client portal. Client-authored comments don't email anyone outside the MSP today.
- CC/BCC on comments created by inbound email, auto-close, migrations or imports, or on `tickets.close` `notify_requester`.
- Editing CC/BCC after a comment is published, or re-sending to new recipients.
- Remembering recent CC recipients, or per-client default CC lists.
- Changing how the watch list behaves.

## Users and Primary Flows

**Persona:** MSP technician or dispatcher replying to a client ticket.

1. The agent opens a ticket and starts a public reply.
2. The agent clicks **Cc/Bcc** next to **Attach files**. Two recipient rows (Cc, Bcc) expand above the editor.
3. In each row, the agent picks from the ticket client's contacts or internal users, or types or pastes free-text email addresses. Each recipient becomes a removable chip.
4. The agent sends. The requester gets the normal comment email with `Cc:` and `Bcc:` set. Assigned agents, additional agents and watchers get their usual separate emails, unchanged.
5. The timeline shows `Cc: …` (and, for MSP users, `Bcc: …`) under the comment.
6. A CC'd person replies-all. Their reply becomes a comment on the ticket. They are **not** added to the watch list, and neither are the reply's other To/Cc addresses that came from this CC list.

**Other flows**

- **Scheduled comment:** CC/BCC are saved with the comment and applied when it publishes.
- **API or mobile:** `POST /api/v1/tickets/{id}/comments` with `cc: string[]` and `bcc: string[]`.
- **Workflow:** `tickets.add_comment` with `cc`/`bcc` inputs. When either input is non-empty, the comment publishes the normal `TICKET_COMMENT_ADDED` event, so the requester email and CC/BCC go out exactly as from the UI. Workflow comments without cc/bcc keep today's no-email behaviour.

## UX / UI Notes

- **Placement:** the shared `TextEditor` (`packages/ui/src/editor/TextEditor.tsx:494-515`) owns the "Attach files" button. Add an optional slot for extra footer actions next to it (e.g. `footerActions`). `TicketConversation` uses it to render a **Cc/Bcc** toggle button (id `ticket-comment-cc-bcc-toggle`).
- **Expanded state:** two labelled rows, "Cc" and "Bcc" (ids `ticket-comment-cc-input`, `ticket-comment-bcc-input`), shown above the editor body Gmail-style.
  - Each row is a chip input with suggestions: the client's contacts first, then internal users, plus free-text emails.
  - Pasting a comma- or semicolon-separated list splits it into chips.
  - Invalid addresses render as error chips and block sending.
- **Hidden state:** when the **Internal** toggle is on, the toggle and rows are hidden. If CC/BCC were already entered, a short inline note says they will not be sent with an internal note, and the values are kept so turning Internal off restores them.
- **Reset:** the draft CC/BCC clear after a successful send. They are never carried to the next comment.
- **Badge:** the toggle shows a count badge when it is collapsed and recipients are present.
- **Timeline:** under the comment header, a muted line `Cc: Jane Doe, vendor@acme.com`. MSP users also see `Bcc: …`. The client portal sees Cc only, and the client portal and its actions never return Bcc.
- **Threaded replies (in v1):** `InlineReplyComposer` (`packages/ui/src/components/InlineReplyComposer.tsx`) renders the same `TextEditor` with "Attach files" enabled for ticket rooms. It is used inline under a comment and inside `CommentThreadDrawer`.
  - The reply inherits `is_internal` from its parent comment (there is no Internal toggle), so the Cc/Bcc control only shows when replying to a public comment.
  - `InlineReplyComposer` is generic UI. It gets an optional slot next to "Attach files" plus cc/bcc in its submit payload, and stays unchanged when the slot isn't passed.
- **Bento layout (in v1):** `BentoTimelineTile` has its own copy of the main composer and its own `InlineReplyComposer`. Both get the same control.
- **One implementation:** a shared `CommentEmailRecipientsControl` (toggle, rows, hide-when-internal) is used by the classic composer, the bento composer and both reply composers.
- **Opt-in:** the control is enabled by a prop (e.g. `allowEmailRecipients`). The client portal reuses `TicketConversation` and does not enable it.
- **Mobile (ee/mobile):** an expandable Cc/Bcc section in the comment composer (`CommentsSection` / `useCommentDraft`) with free-text chips and contact suggestions. It is hidden for internal comments.
- **i18n:** all strings go through `t()` and are added to every locale file.

## Requirements

### Functional Requirements

**Validation (shared helper, used by every entry point)**

- FR1. `cc` and `bcc` are optional arrays of email strings.
- FR2. Addresses are trimmed and lower-cased for comparison, and display casing is kept.
- FR3. Invalid addresses are rejected with a field error.
- FR4. Duplicates within and across cc and bcc are removed; cc wins over bcc.
- FR5. At most 20 combined recipients.
- FR6. Rejected when the comment is internal.

**Storage**

- FR7. Normalised recipients are saved on the comment row as `comments.metadata.email_recipients = { cc: Recipient[], bcc: Recipient[] }`, where `Recipient = { email, name?, contact_id?, user_id? }`. No migration is needed: `metadata` is jsonb, and `CommentMetadata` already has an open index signature. Add a typed field anyway.

**Entry points**

Each entry point accepts cc/bcc, validates them and stores them:

- FR8. `addTicketCommentWithCache`
- FR9. `createComment`, including threaded replies
- FR10. `addTicketComment`
- FR11. `TicketService.addComment` and `createTicketCommentSchema`, plus the OpenAPI body
- FR12. The workflow `tickets.add_comment` input schema

**Delivery** (`handleTicketCommentAdded`)

- FR13. Read `email_recipients` from the comment row, not from the event payload. This survives scheduled publication and recovery republishes.
- FR14. When the requester email is sent, it carries `cc`/`bcc` headers.
- FR15. When no requester email is sent (no requester address, `suppressContactNotifications`, the requester is the author, or the comment was written by a workflow with no user row), send one message:
  - `To` = the CC list and `Bcc` = the BCC list.
  - If there is no CC either, send each BCC address its own message.
  - A tenant that switched comment notifications off is the exception: the fallback runs but passes the same notification gate, so the kill switch silences the copies too. An MSP that wants per-comment copies has to leave comment notifications on.
- FR16. Any address already receiving its own copy of this comment (assigned user, additional agent, watcher, bundle-child requester) is dropped from that separate send, so nobody gets the comment twice. The headers keep the address.
- FR17. `sendEventEmail` and `SendEmailParams` gain optional `cc`/`bcc` and pass them to `TenantEmailService.sendEmail`, which already supports them.
- FR18. The delivery claim (`ticket_comment_email_deliveries`) for a combined send is keyed on the `To` recipient as today. The email log already records `cc_addresses`/`bcc_addresses`.
- FR19. Explicitly chosen CC/BCC recipients receive the same message and attachments as the `To` recipient. The per-recipient attachment gate is evaluated for the `To` recipient only.

**Bundles**

- FR20. CC/BCC apply only to the comment on the ticket they were added to. Copies mirrored to child tickets don't inherit them, and neither do bundle-child requester emails.

**Workflow**

- FR21. When `tickets.add_comment` receives non-empty cc or bcc, it creates the comment with an event publisher, so `TICKET_COMMENT_ADDED` is emitted. Delivery then follows the normal subscriber path (FR13–FR19).
- FR22. The workflow designer shows `cc`/`bcc` as email-list inputs that accept expressions.

**Inbound replies** (`processInboundEmailInApp`)

- FR23. Build a per-ticket "one-off recipient" set: the union of `metadata.email_recipients` cc and bcc across the ticket's comments.
- FR24. On a token-matched reply, if the sender is in the set, don't add the sender as an `inbound_from` watcher.
- FR25. On any matched reply, addresses in the set are excluded from the reply's To/Cc watch-list additions. This covers the requester replying-all.
- FR26. On a thread-header-only match, a sender in the set is treated as an allowed sender, the same as an active watcher, instead of being quarantined.

**Display**

- FR27. The comment read APIs and actions used by the MSP timeline return `email_recipients`.
- FR28. Client portal actions strip `bcc` before returning comments.
- FR29. The MSP timeline renders the Cc/Bcc lines; the client portal timeline renders Cc only.

### Non-functional Requirements

- No new table and no migration.
- Tenant scoping on every new query: the one-off recipient lookup filters `comments` by `tenant` and `ticket_id`.
- No change in behaviour or send count for comments without cc/bcc.

## Data / API / Integrations

**`comments.metadata.email_recipients`**

```jsonc
{
  "cc":  [{ "email": "jane@client.com", "name": "Jane Doe", "contact_id": "…" }],
  "bcc": [{ "email": "boss@msp.com", "user_id": "…" }]
}
```

**REST API**

- `createTicketCommentSchema` (`server/src/lib/api/schemas/ticket.ts:372`) gains:
  - `cc: z.array(z.string().email()).max(20).optional()`
  - `bcc: z.array(z.string().email()).max(20).optional()`
  - A refine that rejects either field when `is_internal` is true.
- The comment response includes `email_recipients`.
- Regenerate OpenAPI and the MCP registry, then sync the developer portal (`alga-openapi-sync`).

**Email plumbing**

`sendEventEmail` is the only layer that needs new fields. `TenantEmailService`, `BaseEmailService` and the Graph, Resend and SMTP providers already send cc/bcc and log them.

**Workflow**

`shared/workflow/runtime/actions/businessOperations/tickets.ts:702` gains new inputs and passes a publisher into `TicketModel.createComment` (`shared/models/ticketModel.ts:1383`). Because `shared/` changes, the workflow-worker must be redeployed.

**Threading**

One combined message has one `Message-ID` and one reply token. Reply-all from any CC recipient carries the token, so it matches the ticket.

## Security / Permissions

- Same permission as posting a public comment (`ticket:update` / comment-create). There is no new RBAC resource.
- Free-text external addresses are allowed: this is the core use case.
- BCC addresses are never exposed in client-portal responses, in email headers seen by other recipients, or in client-facing API surfaces.
- Internal notes can't be CC'd. This is enforced server-side, not only in the UI.
- Abuse ceiling: at most 20 recipients per comment.

## Rollout / Migration

- No schema migration and no feature flag. The feature is additive, and existing comments simply have no `email_recipients`.
- Deploy server, workflow-worker and email-service together, because `shared/` changes reach the v2 workflow actions.
- Mobile ships in the next app build. The server accepting cc/bcc is backward compatible with older app builds.

## Open Questions

- ~~Does the threaded-reply composer render the full `TextEditor` with attachments?~~ Resolved 2026-10-06: yes, so it is in v1 (see UX notes). The bento layout composer was found at the same time and is also in v1.
- Should a contact picked via CC who later becomes the ticket requester see past BCC lines? Proposed answer: no. BCC is MSP-only, period.
- Client-portal CC is excluded for now. Confirm it isn't wanted.

## Acceptance Criteria (Definition of Done)

1. In the MSP UI, an agent adds Cc and Bcc recipients to a public reply via the button next to "Attach files". The requester's email arrives with matching `Cc`/`Bcc` headers, and the next comment on the ticket does not go to them.
2. Neither the CC/BCC recipients nor anyone else appears in the watch list after sending, or after a CC'd person (or the requester) replies-all.
3. A reply-all from a CC'd person becomes a ticket comment and is not quarantined.
4. The same works via `POST /api/v1/tickets/{id}/comments`, the mobile app, and a workflow `tickets.add_comment` with cc/bcc.
5. Internal notes can't carry cc/bcc in the UI, the API or workflows.
6. The timeline shows Cc to everyone and Bcc only to MSP users. The client portal payload never contains bcc.
7. Comments without cc/bcc behave exactly as before, with the same recipients and email count.
