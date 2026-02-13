# Scratchpad — Inbound Email Domain Matching + Client Default Contact

- Plan slug: `inbound-email-domain-matching-default-contact`
- Created: `2026-02-13`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-02-13) Store the “client default contact” using existing `clients.properties.primary_contact_id` (and optional `primary_contact_name`) to avoid a DB migration for this phase.
- (2026-02-13) Implement domain-to-client matching by deriving from existing `contacts.email` domains (unique client only); do not introduce a new client-domain mapping UI/table in this phase.

## Discoveries / Constraints

- (2026-02-13) In-app inbound email new-ticket creation happens in `shared/services/email/processInboundEmailInApp.ts` and currently:
  - Finds a contact strictly by exact normalized email (`findContactByEmail`).
  - Otherwise uses inbound ticket defaults `client_id` and leaves `contact_id` null.
- (2026-02-13) Updated in-app inbound email new-ticket creation (`shared/services/email/processInboundEmailInApp.ts`) to:
  - Prefer exact contact match (existing behavior).
  - Else attempt unique client match by sender domain, and apply the client's validated `properties.primary_contact_id` as ticket contact when available.
  - Keep comment author attribution as `system` unless there is an exact sender email contact match (avoids implying the default contact authored the email).
  - When the resolved client differs from the inbound defaults client, do not apply `defaults.location_id` to avoid cross-client location mismatch.
- (2026-02-13) Client "default contact" storage is already supported end-to-end via client `properties`:
  - Types: `packages/types/src/interfaces/client.interfaces.ts` includes `properties.primary_contact_id` and `properties.primary_contact_name`.
  - Client-side validation: `packages/clients/src/schemas/client.schema.ts` includes `primary_contact_id` and `primary_contact_name`.
  - Server API schema: `server/src/lib/api/schemas/client.ts` allows `properties.primary_contact_id` (uuid) + `primary_contact_name`.
  - Client update persistence merges `properties` into `clients.properties`: `packages/clients/src/actions/clientActions.ts`.
- (2026-02-13) Added shared helper `extractEmailDomain()` in `shared/lib/email/addressUtils.ts` which normalizes via `normalizeEmailAddress()` then returns substring after `@` (lowercased).
- (2026-02-13) Implemented `findUniqueClientIdByContactEmailDomain(domain, tenant)` in `shared/workflow/actions/emailWorkflowActions.ts`:
  - Uses active contacts only (`contacts.is_inactive = false`), tenant-scoped.
  - Matches by email suffix `@{domain}` (case-insensitive).
  - Returns a client_id only when exactly one unique client matches; otherwise returns null.
- (2026-02-13) Implemented `findValidClientPrimaryContactId(clientId, tenant)` in `shared/workflow/actions/emailWorkflowActions.ts` to safely apply `clients.properties.primary_contact_id` only when it references an active contact belonging to the client.
- (2026-02-13) The workflow runtime action `resolve_inbound_ticket_context` in `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` contains similar “find contact by email, else defaults” logic and should be kept in parity if workflows still invoke it.
- (2026-02-13) Updated `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` (`resolve_inbound_ticket_context`) to match in-app resolution:
  - Exact contact match first.
  - Else unique domain-to-client match and optional validated client default contact.
  - `targetLocationId` is null when resolved client differs from defaults client.
- (2026-02-13) Added inbound-email integration coverage for domain fallback in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - Unique domain match sets ticket client_id.
  - Default contact applied when configured on client properties.
  - Ambiguous domain match falls back to defaults.
  - Location_id cleared when resolved client differs from defaults.
- (2026-02-13) There is existing “billing contact” (`clients.billing_contact_id`) UI in `packages/clients/src/components/clients/BillingConfigForm.tsx`, but it is billing-specific and not suitable as the inbound-email default contact.
- (2026-02-13) Added "Default contact" picker to the client details screen: `packages/clients/src/components/clients/ClientDetails.tsx` persists `properties.primary_contact_id` and `properties.primary_contact_name`.
- (2026-02-13) Client default contact picker supports clearing by selecting "None" (empties both `primary_contact_id` and `primary_contact_name`).
- (2026-02-13) Added Playwright coverage for default contact persistence: `ee/server/src/__tests__/integration/client-default-contact.playwright.test.ts`.

## Commands / Runbooks

- (2026-02-13) Code search:
  - `rg -n "resolve_inbound_ticket_context|processInboundEmailInApp|findContactByEmail" -S`
- (2026-02-13) Unit tests:
  - `shared/lib/email/addressUtils.test.ts` covers `extractEmailDomain()` normalization + domain extraction cases.
  - `shared/workflow/actions/emailWorkflowActions.domainLookup.test.ts` covers `findUniqueClientIdByContactEmailDomain()` null return when the domain has no contacts.
  - `shared/workflow/actions/emailWorkflowActions.domainLookup.test.ts` covers `findUniqueClientIdByContactEmailDomain()` returning a unique client_id when exactly one client matches.
  - `shared/workflow/actions/emailWorkflowActions.domainLookup.test.ts` covers `findUniqueClientIdByContactEmailDomain()` returning null on ambiguous domain matches.

## Links / References

- `shared/services/email/processInboundEmailInApp.ts` (new-ticket path)
- `shared/workflow/actions/emailWorkflowActions.ts` (`findContactByEmail`)
- `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` (`resolve_inbound_ticket_context`)
- `packages/clients/src/components/clients/ClientDetails.tsx` (client screen)
- `packages/types/src/interfaces/client.interfaces.ts` (`IClient.properties.primary_contact_id`)

## Open Questions

- Should domain-to-client matching be derived from contacts (this phase) or do we need explicit client-domain configuration immediately?
- Should domain matching consider inactive contacts?
- Should comment author attribution change when ticket contact is set via default contact (domain fallback)?
