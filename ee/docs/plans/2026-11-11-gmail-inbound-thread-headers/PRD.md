# PRD — Carry reply headers on inbound Gmail messages

Date: 2026-11-11
Status: ready for implementation
Origin: Perceptive IT (Dan Cudjoe) email threading report, 2026-10-19
Related: `ee/docs/plans/2026-11-11-resend-on-wire-message-id/` (XO card 7f9e7dfc)

## Summary

Inbound mail from a Gmail mailbox reaches `processInboundEmailInApp` with no `inReplyTo`, no `references` and no `threadId`. The header fallback that attaches a reply to its ticket when the reply token is missing therefore has nothing to match on, for every Gmail mailbox. A Gmail reply without a reply token always opens a new ticket.

Microsoft and IMAP mailboxes carry these fields. This plan makes the three providers derive them the same way, from one function.

## Problem and findings

Code (main at `16e88d614d`, and the deployed image `alga-psa-ee:accbf4dd`, 2026-10-27):

- `fetchEmailPayloadsForJob` in `shared/services/email/unifiedInboundEmailQueueJobProcessor.ts` handles `job.provider === 'google'` by calling `GmailAdapter.getMessageDetails(messageId)` for each message. This is the only Gmail path that runs in production.
- `getMessageDetails` in `shared/services/email/providers/GmailAdapter.ts` fetches the message with `format: 'full'` and returns `id, provider, providerId, tenant, receivedAt, from, to, cc, subject, body, attachments, headers`. It never sets `inReplyTo`, `references` or `threadId`. The file contains none of those three words. The raw `In-Reply-To` and `References` values are present in the returned `headers` map, and the Gmail API response carries `threadId`; neither is used.
- `processInboundEmailInApp.ts` reads only `emailData.inReplyTo`, `emailData.references` and `emailData.threadId` (header fallback near L1938–1977, saved ticket metadata near L1227 and L2334). It never falls back to `emailData.headers`.
- `MicrosoftGraphAdapter.getMessageDetails` sets all three, but finds the headers by exact-case name and splits `References` on a single space. The IMAP path (`buildEmailMessageDetailsFromParsedMime` in the queue processor, L347–349) uses `extractMessageIds` from `inboundEmailMimeHelpers` and sets `threadId` to `references[0] || inReplyTo`. Three providers, three derivations.
- Two other `GmailAdapter` copies exist (`server/src/services/email/providers/GmailAdapter.ts`, `packages/integrations/src/services/email/providers/GmailAdapter.ts`). Neither sets the fields. The queue processor imports the `shared` one.
- The durable inbox path (`inboundEmailSourceStager.ts`, which parses staged MIME and does set the fields) is not live: `inbound_email_inbox` has zero rows in production for any provider.

Production, `email_processed_messages`, last 45 days (queried 2026-11-11):

| provider | messages | with In-Reply-To recorded |
| --- | --- | --- |
| microsoft | about 27,000 | about 37% |
| imap | about 1,300 | about 67% |
| google | 9 | 0 |

- All 9 Gmail rows have `headersSnapshot.inReplyTo = null`, `references = []`, `threadId = null`. Three of them are replies (`Re: [Ticket #…]`) from two tenants. All three attached by reply token; none could have attached by header.
- For Gmail rows `threading.originalMessageIdCandidate` is the Gmail API message id (for example `1a127f5b0fabfb0d`), not an RFC Message-ID, because `emailData.id` is the Gmail id and there is no `inReplyTo` to prefer.
- Gmail volume is low because 10 of the 11 Google providers are in `error` status. That is a separate problem (see Non-goals) and it means this defect has had little chance to show.

## Goals

- An inbound Gmail message that has `In-Reply-To` / `References` headers reaches the processor with `inReplyTo` and `references` set, normalized the same way as for IMAP.
- An inbound Gmail message carries a `threadId` that lets a later message in the same conversation find the ticket created from the first one.
- Gmail, Microsoft and IMAP derive these three fields through one shared function, so a provider cannot omit or mis-parse them again.

## Non-goals

- Recording the on-wire Message-ID for Resend sends. That is the related plan; without it a header match against a Resend-sent notification still misses. Both are needed for the Perceptive IT case.
- The Google provider `error` states (five tenants with `refreshAccessToken: unauthorized_client (401)`, one `invalid_grant`, others Pub/Sub setup). Track separately.
- Why one Gmail message for tenant `bc9aa7be` (2026-10-10 23:41 UTC) was never ingested.
- Turning on the durable inbox path.
- Reply-token matching. It stays first.

## Users and primary flows

- A contact replies to a ticket notification from a mail client that drops the quoted body, to an MSP whose inbound mailbox is Gmail. The reply attaches to the ticket by header match.
- A contact emails a Gmail support mailbox, then sends a second message in the same conversation before any notification arrives. The second message lands on the ticket the first one created.

## Requirements

### One derivation of reply identity

- A single function takes what a provider can supply (a header map looked up case-insensitively, plus an optional provider conversation id) and returns `inReplyTo`, `references` and `threadId`. Message-IDs are extracted with `extractMessageIds`, so folded headers, multiple spaces, tabs and newlines between ids, and a missing header all behave the same for every provider.
- `GmailAdapter.getMessageDetails`, `MicrosoftGraphAdapter.getMessageDetails` and the IMAP builder in the queue processor all call it. No provider keeps its own parsing of these headers.
- Trace how `threadId` is consumed before choosing its value for Gmail: `resolveReplyTargetFromProviderThreadId`, `findTicketByEmailThread`, and what is written to `tickets.email_metadata`. The value must match what those lookups compare against. Gmail's API `threadId` is the mailbox's own conversation id; IMAP today uses `references[0] || inReplyTo`. Pick one rule that is correct for the lookups and record the reasoning in the scratchpad. Microsoft's current `conversationId` behaviour must keep working for tickets already stored.
- Reserved header names (`x-resolved-*`, `x-list-*`) stay stripped from the Gmail `headers` map exactly as now.

### Gmail adapter

- `getMessageDetails` returns `inReplyTo`, `references` and `threadId` from the shared function. No extra Gmail API call: the `format: 'full'` response already has the headers and `threadId`.
- Decide what to do with the two unused `GmailAdapter` copies. If nothing imports them on a live path, delete them rather than patch them. If something does, it goes through the same function.

### Processor

- No change to matching order. Confirm with a test that a Gmail message with no reply token and an `In-Reply-To` naming a stored `email_sending_logs.rfc_message_id` attaches to that ticket.
- `threading.originalMessageIdCandidate` for a Gmail reply is the normalized `In-Reply-To`, not the Gmail API id.

## UX / UI notes

None.

## Data / API / integrations

- No schema change. No new Gmail scope.
- `email_processed_messages.metadata.headersSnapshot` will start to show values for Gmail. That is the production check after deploy.

## Security / permissions

- `In-Reply-To` and `References` are sender-controlled. They are already used for Microsoft and IMAP; the existing sender and tenant checks in the header fallback apply unchanged. Do not use these values to derive message identity or dedupe keys (see the comment in the IMAP builder).

## Verification

- Unit test on the shared function: exact-case and lower-case header names, folded `References`, multiple ids, absent headers.
- `GmailAdapter.getMessageDetails` test with a fixture Gmail API payload (next to `server/src/test/unit/email/GmailAdapter.listMessagesSince.test.ts`).
- Extend `server/src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts` so the Google branch asserts the three fields.
- After deploy: a Gmail reply's `headersSnapshot.inReplyTo` is non-null in production.

## Open questions

- Which `threadId` rule is right for Gmail, given how the lookups compare it. Settled by the trace above.
- Are the two other `GmailAdapter` copies dead code?
