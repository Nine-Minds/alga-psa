# Security: delivery provider notification projection

Ticket: `alga-2026-0003078`

This spec records the mitigation already prescribed by the security review on PR #4024. It does not expand the review's design.

## Findings

1. Sponsor notifications authorized the recipient but discarded the returned `redactedFields`, allowing routing, email, and in-app messages to disclose fields hidden from interactive reads.
2. Recovered sponsor routing email used the address captured in the outbox even if the authorized sponsor user had changed addresses.

## Required behavior

- Keep the notification recipient's read authorization result, including per-recipient redactions, with the ephemeral delivery projection. Do not store that projection in the outbox.
- Build sponsor routing, ticket email, and in-app notification content from canonical field aliases and the current redaction projection. Suppress comment body, previews, and related conversation content when conversation fields are hidden.
- Recompute authorization and redactions on each delivery attempt, including recovery and retries.
- Resolve sponsor users from `payload.principalId` in `payload.sponsorTenant` at delivery time, batch-load current users, and require an active internal identity before delivery.
- Use normalized current `users.email` for sponsor email only after authorization succeeds. Skip email if the current address is unavailable while retaining the captured `ledgerRecipient` for claiming and finishing the original outbox row.
- Preserve customer-recipient behavior.

## Verification

Behavioral regression coverage should exercise recipient-specific redactions, conversation suppression, fresh policy evaluation on retry, changed sponsor email recovery, unavailable or inactive sponsor identities, and correct completion of the original ledger row. Run the co-managed regression tests and typecheck/build applicable to changed packages.

### Mitigation-round results (2026-11-03)

- The workflow card records PSA ticket `alga-2026-0003078`, link state `linked-existing`, and ticket ID `cd315622-39a9-4ec1-92a6-62c7e2771dd2`. The exact `psa-ticket-linked` and `psa-ticket-id-recorded` template commands returned exit 0 when run with these current card values. The workflow board note records that these were rendered command reruns; its verifier cannot attach a new attempt to the earlier Link PSA Ticket step while Draft Implementation is current.
- `packages/co-managed` focused regression tests passed: 52 tests across `admitReplyToken.test.ts`, `routingDeliveryReauth.test.ts`, and `sharedWorkProjection.test.ts`. Its `npm run typecheck` passed.
- Four targeted cases in `server/src/test/integration/ticketCommentAttachmentsIntegration.test.ts` passed, covering delayed sponsor email retry after attachment reconstruction, independent per-recipient comment email, and routing email recovery. The persisted in-app payload suite `internalCommentMentionAudience.test.ts` passed all 6 tests.
- Server typecheck passed with `NODE_OPTIONS=--max-old-space-size=12288`; the 8192 MiB attempt exhausted the heap.
- No repository or workflow-template mechanism named `security-finding-resolved` was available on this card, so external finding acceptance remains unverified.
