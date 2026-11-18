# Scratchpad

## threadId rule (F004)
Trace:
- `processInboundEmailInApp` stores `tickets.email_metadata.threadId = emailData.threadId` (and `messageId = emailData.id`, which for Gmail is the Gmail API id, NOT an RFC Message-ID).
- Header fallback order: outbound `rfc_message_id` (In-Reply-To, then References) -> `resolveReplyTargetFromProviderThreadId` (compares `comment_threads.email_provider_thread_id`, only set by outbound sends) -> `findTicketByEmailThread` (integrations action: `email_metadata.threadId = input.threadId`, then In-Reply-To/References against stored `messageId`/`inReplyTo`/`references`).
- Rule chosen for Gmail: the Gmail API `threadId`. The first message of a conversation has no In-Reply-To/References, so `references[0] || inReplyTo` would be undefined and the ticket would store no threadId; the second message could never match it, and stored `messageId` is the Gmail id so the message-id strategies cannot match either. The Gmail API threadId is identical on both messages and is what `email_metadata.threadId` is compared against.
- Shared rule: `threadId = conversationId ?? (references[0] || inReplyTo)`. Gmail passes API threadId, Microsoft passes `conversationId` (unchanged when present), IMAP passes none (unchanged). Only change: Microsoft with a missing conversationId now falls back to the header rule instead of undefined.
- Normalization nuance: Microsoft `References` was split on one space and `In-Reply-To` taken raw; now both go through `extractMessageIds`. Identical for well-formed `<id>` values.

## Duplicate adapters (F006)
NOT dead. `server/src/services/email/providers/GmailAdapter.ts` is imported by server EmailProviderService, GmailWebhookService and the listMessagesSince test; `packages/integrations/.../GmailAdapter.ts` is exported from `@alga-psa/integrations/runtime` (used by workflow-worker) and by its own EmailProviderService/GmailWebhookService. Both therefore kept and routed through `deriveReplyIdentity`. Deleting them is a separate refactor.

## Other
- `originalMessageIdCandidate` already follows from `inReplyTo` being set (`normalizeRfc822MessageId(inReplyTo ?? id)`), brackets stripped; no processor change.
- The processor had a private copy of `extractMessageIds`; removed since it became unused.
- `inboundEmailSourceStager.ts` (durable staged-MIME path) now also uses `deriveReplyIdentity`, so no copy of the derivation remains.
- T004/T005 are unit-level (mocked DB), not DB-backed; `findTicketByEmailThread` is mocked in T005 with the threadId equality it performs.
- `findTicketByEmailThread` in `shared/services/emailService.ts` prefers originalMessageId over threadId (else-if chain); the integrations action used by the processor tries threadId first. Not touched.

## Implement-step revision (XO order)
- References now has In-Reply-To appended when the header omits it (RFC 5322 puts the parent last). threadId still roots at references[0], so it is unchanged for every input.
- `deriveReplyIdentity` reads the `{name,value}[]` shape (Gmail payload.headers, Graph internetMessageHeaders) directly via `readHeaderValues`, so repeated headers are no longer collapsed by Object.fromEntries.
- Absent fields are omitted, not null: `inboundEmailReceived` event and workflow action zod schemas declare them `z.string().optional()`, which rejects null.
