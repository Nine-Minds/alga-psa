# cm2 reply sender authentication

## Problem
`admitReplyToken` (`packages/co-managed/src/deliveryProvider.ts`) is the single admission point for inbound `cm2:` reply tokens. It had two holes.

- **A. Internal-actor impersonation (critical).** For `shared_it` / `organization_private` it resolved the raw, unauthenticated `From` address to any active internal user in the customer or sponsor tenant and returned it as `actor`. The caller then wrote the comment as that user. `senderAuthResults` was never consulted, although the caller already computes it and enforces `allowsInternalSenderAttribution` for native internal senders.
- **B. Requester admitted with no sender check.** `audience === 'requester'` returned `admitted` for any sender.

## Contract change
`CoManagedDeliveryProvider.admitReplyToken(tenant, token, metadata, sender)` takes `InboundSender = { email: string | null; internalAttributionTrusted: boolean }` instead of a raw email. The caller sets `internalAttributionTrusted = allowsInternalSenderAttribution(senderAuthResults)`; no new auth check. The gate lives inside `admitReplyToken` only. `InboundAdmission` gains the reason `sender_unauthenticated`.

Caller rule (`processInboundEmailInApp.ts`): a token is inert only when there is no provider/admission or the reason is `not_served`. Every other `admitted:false` result is quarantined; `acknowledge` decides only whether the sender is mailed. `sender_unauthenticated` quarantines as `co_managed_sender_unauthenticated` (others stay `co_managed_token_refused`).

## Decision table
| Audience | Auth trusted | Sender match | Outcome |
|---|---|---|---|
| shared_it | no | any | `sender_unauthenticated`, no ack, quarantined, no user lookup |
| shared_it | yes | active internal user (customer or sponsor) | admitted, actor = that user |
| shared_it | yes | none / missing | `not_participant`, ack |
| organization_private | no | any | `sender_unauthenticated`, no ack, quarantined |
| organization_private | yes | customer-tenant internal user | admitted, actor |
| organization_private | yes | sponsor-tenant user | `audience_forbidden`, ack |
| organization_private | yes | none / missing | `not_participant`, ack |
| requester | n/a | active contact of the ticket's client, same tenant | admitted, no actor (native writer applies its own contact-auth) |
| requester | n/a | other client / other tenant / inactive / missing | `not_participant`, ack |

Requester match: `tickets.client_id` for the token's ticket, then `contacts` in the ticket's tenant with `client_id` = ticket client, `is_inactive = false`, and the address matching the contact's primary email OR an additional address (`contact_additional_email_addresses`). That address rule is `shared/lib/email/contactEmailMatch.ts`, shared with the canonical inbound resolver `findContactByEmail`.

## Tests
- `packages/co-managed/src/__tests__/admitReplyToken.test.ts`: every row of the table, including the exploit regression (no `users` lookup when untrusted).
- `shared/services/email/__tests__/processInboundEmailInApp.coManagedTokens.test.ts`: caller passes the trusted flag for passing and failing Authentication-Results; `sender_unauthenticated` is quarantined with no write, no ack, no native fallthrough.

## Historical scope (superseded)
The earlier token-format/recipient-binding and forwarded-mail exclusions are superseded by this repair. Confirmation is bound to the existing reply token, tenant, intended actor, provider message, and content digest; forwarded content remains non-authoritative and needs independently authenticated provider mailbox evidence or the same owner-confirmation flow.

## Repair revision: evidence must establish the mailbox actor

The earlier provider policy is superseded. A parsed receiver assertion is not by itself an actor identity, and failing every Microsoft/IMAP reply is not an acceptable compatibility policy. Admission consumes a typed decision made at ingestion, never raw headers.

| Delivery mode | Evidence available | Trust boundary and limit | Admission path |
|---|---|---|---|
| Gmail, external | Gmail API OAuth fetch; ordered duplicate Authentication-Results retained for diagnostics; original RFC 822 source | Gmail API exposes message headers without provenance metadata, so neither a matching `mx.google.com` authserv-id nor its position proves receiver origin. Independently verify DKIM against DNS from original bytes; aligned DKIM proves domain signing only. Gmail API does not expose author mailbox identity. | Matched active internal candidate receives authenticated confirmation; otherwise refusal. Independently verified aligned DKIM may support contact attribution only. |
| Microsoft, external | OAuth Graph fetch of the receiving mailbox plus original MIME | OAuth authenticates access to the receiving mailbox, not the message author. Graph's `sender` is derived from incoming `Sender`, falling back to `From` per [Exchange MIME conversion](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcmail/07da79f6-8d3f-4021-b9fc-ee89af0fabad); it is message-supplied identity and is not independent mailbox evidence. MIME Authentication-Results/AuthSource/AuthAs are also message claims. Independently verified aligned DKIM establishes signing-domain/content evidence only. | Always require confirmation to the active candidate's registered mailbox; mismatch, no candidate, or revoked authorization is refused. |
| Generic IMAP, external | Authenticated IMAP account and original MIME | IMAP account proves which mailbox was read, not who authored the message. Receiver Authentication-Results are not trusted because no configured strip/prepend contract is established. Independently verify DKIM; it proves signing-domain/content evidence, not exact mailbox. | Matched active internal candidate receives authenticated confirmation; otherwise refusal. Independently verified aligned DKIM may support contact attribution only. |
| Intra-organization | Graph or IMAP MIME; often no DKIM/Authentication-Results | AuthAs/AuthSource, Sender, From, and Authentication-Results are not trustworthy mailbox proof at this application boundary. | Authenticated mailbox confirmation; no header-based shortcut. |
| Unsigned | Provider fetch and message headers | No DKIM domain proof; From/Sender remain claims. None of the three currently supported ingestion adapters independently establishes author mailbox identity. | Authenticated mailbox confirmation; unmatched identities quarantine with actionable diagnostics |
| Forwarded | Original message may retain valid DKIM; forwarding can break DKIM and alter From | ARC is not configured as trusted evidence; forwarded From/Authentication-Results never establish actor identity. Graph Sender is likewise derived from the message. | Authenticated mailbox confirmation; insufficient evidence stays quarantined |

Mailbox confirmation is a one-time approval sent only to the candidate's database-registered active internal mailbox, bound to tenant, reply-token/thread, exact candidate actor, provider message identity, and immutable content digest. Candidate matching is not admission: it runs only after token, current relationship/grant, and thread-audience checks, and returns an explicit denied confirmation-required decision before actor attribution or comment creation. Confirmation requires the candidate to authenticate as that same tenant user; it expires and is idempotently consumed. It re-runs the co-managed admission/permission gate before the single idempotent comment write. Failure, mismatch, expiry, replay, or contradictory evidence cannot write. Contact attribution continues to use contact rules and independently verified aligned DKIM where available; it never inherits internal-user trust. Raw Authentication-Results, AuthSource, and AuthAs are diagnostics only: a provider-looking authserv-id or header order alone does not establish provenance.

Compatibility tradeoff: every Microsoft, Gmail, or generic IMAP co-managed internal reply currently requires a separate authenticated confirmation because the supported provider interfaces do not expose independently verified author-mailbox evidence. The integration remains usable, but comments are delayed until the registered actor confirms. DKIM and receiver assertions remain useful diagnostics and contact-domain evidence only; neither substitutes for mailbox confirmation.
