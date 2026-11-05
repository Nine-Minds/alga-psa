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
| Gmail, external | Gmail API OAuth fetch; ordered duplicate Authentication-Results; original RFC 822 source | First `mx.google.com` result relies on Gmail receiver ordering/removal behavior. Raw headers are not cryptographic. Independently verify DKIM against DNS from original bytes; aligned DKIM proves domain signing only. | Immediate only with receiver evidence plus exact provider mailbox identity; otherwise mailbox confirmation |
| Microsoft, external | OAuth Graph message object and original MIME | Graph response is authenticated to the configured mailbox. Its `sender` property is independent provider metadata; resolve that exact normalized mailbox against the tenant user. MIME `From` mismatch can represent on-behalf delivery and does not override the Graph mailbox. MIME Authentication-Results/AuthSource/AuthAs alone are never trusted. DKIM validates domain and signed content, not mailbox. | Immediate for an active authorized Graph `sender` identity; otherwise confirmation when a candidate mailbox is matched or refusal |
| Generic IMAP, external | Authenticated IMAP account, original MIME, operator-configured receiver trust policy | IMAP account proves which mailbox was read, not who authored the message. Accept receiver Authentication-Results only if explicitly configured authserv IDs and receiver contract (strip incoming same-ID fields, prepend own result) establish provenance. Independently verify DKIM. Neither proves exact mailbox. | Immediate only when configured receiver evidence and exact identity are established; otherwise mailbox confirmation for a matched active tenant user |
| Intra-organization | Microsoft Graph sender metadata, or configured IMAP receiver assertion; often no DKIM/Authentication-Results | Exchange AuthAs/AuthSource in MIME are sender-controlled at this application boundary. No raw-header exception. | Graph sender match can admit; otherwise mailbox confirmation |
| Unsigned | Provider metadata may or may not identify sender | No DKIM domain proof; From remains a claim. Provider mailbox identity may still be sufficient only where independently exposed by the authenticated provider. | Otherwise mailbox confirmation; unmatched identities quarantine with actionable diagnostics |
| Forwarded | Original message may retain valid DKIM; forwarding can break DKIM and alter From | ARC is informative only after chain validation and a configured trusted sealer policy; forwarded From/Authentication-Results never establish actor identity. | Exact trusted provider sender evidence or mailbox confirmation; insufficient evidence stays quarantined |

Mailbox confirmation is a one-time approval sent only to the candidate's database-registered active internal mailbox, bound to tenant, reply-token/thread, exact candidate actor, provider message identity, and immutable content digest. Candidate matching is not admission: it runs only after token, current relationship/grant, and thread-audience checks, and returns an explicit denied confirmation-required decision before actor attribution or comment creation. Confirmation requires the candidate to authenticate as that same tenant user; it expires and is idempotently consumed. It re-runs the co-managed admission/permission gate before the single idempotent comment write. Failure, mismatch, expiry, replay, or contradictory evidence cannot write. Contact attribution continues to use contact rules and never inherits internal-user trust.

Compatibility tradeoff: unsigned or forwarded IMAP mail without a configured receiver boundary may require a user confirmation before its comment is posted. This preserves the integration and provides a recoverable path without treating domain authentication as mailbox proof.
