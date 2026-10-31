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

Requester match: `tickets.client_id` for the token's ticket, then `contacts` in the ticket's tenant with `lower(email)` = sender, `client_id` = ticket client, `is_inactive = false`.

## Tests
- `packages/co-managed/src/__tests__/admitReplyToken.test.ts`: every row of the table, including the exploit regression (no `users` lookup when untrusted).
- `shared/services/email/__tests__/processInboundEmailInApp.coManagedTokens.test.ts`: caller passes the trusted flag for passing and failing Authentication-Results; `sender_unauthenticated` is quarantined with no write, no ack, no native fallthrough.

## Out of scope
Token format / recipient binding, forwarded-mail support, refactors of the surrounding code.
