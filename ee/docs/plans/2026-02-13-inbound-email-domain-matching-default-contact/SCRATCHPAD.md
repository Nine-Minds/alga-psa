# Scratchpad — Inbound Email Domain Matching + Client Default Contact

- Plan slug: `inbound-email-domain-matching-default-contact`
- Created: `2026-02-13`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-02-13) Store the “client default contact” using existing `clients.properties.primary_contact_id` (and optional `primary_contact_name`) to avoid a DB migration for this phase.
- (2026-02-13) Superseded: Domain-to-client matching derived from scanning `contacts.email` domains.
- (2026-02-13) New requirement: Admin must explicitly configure inbound email domains per client; enforce uniqueness per tenant; do not attempt domain matching unless the domain is configured.

## Discoveries / Constraints

- (2026-02-13) In-app inbound email new-ticket creation happens in `shared/services/email/processInboundEmailInApp.ts` and:
  - Finds a contact strictly by exact normalized email (`findContactByEmail`).
  - If no exact contact match, only attempts domain matching via explicit domain mappings (`client_inbound_email_domains`).
  - If no explicit mapping exists for the sender domain, falls back to inbound ticket defaults `client_id` and leaves `contact_id` null.
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
- (2026-02-13) Superseded implementation: contact-derived domain matching (`findUniqueClientIdByContactEmailDomain`) was removed in favor of explicit domain mappings.
- (2026-02-13) Implemented `findClientIdByInboundEmailDomain(domain, tenant)` in `shared/workflow/actions/emailWorkflowActions.ts`:
  - Looks up `client_inbound_email_domains` by `lower(domain)` in the tenant.
  - Returns a client_id only when a mapping exists; otherwise returns null.
- (2026-02-13) Added migration creating `client_inbound_email_domains` with unique `(tenant, lower(domain))`: `server/migrations/20260213180500_create_client_inbound_email_domains.cjs`.
- (2026-02-13) Added server actions for managing inbound email domains:
  - `packages/clients/src/actions/clientInboundEmailDomainActions.ts`
- (2026-02-13) Implemented `findValidClientPrimaryContactId(clientId, tenant)` in `shared/workflow/actions/emailWorkflowActions.ts` to safely apply `clients.properties.primary_contact_id` only when it references an active contact belonging to the client.
- (2026-02-13) The workflow runtime action `resolve_inbound_ticket_context` in `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` contains similar “find contact by email, else defaults” logic and should be kept in parity if workflows still invoke it.
- (2026-02-13) Updated `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` (`resolve_inbound_ticket_context`) to match in-app resolution using explicit domain mappings:
  - Exact contact match first.
  - Else configured domain-to-client match and optional validated client default contact.
  - `targetLocationId` is null when resolved client differs from defaults client.
- (2026-02-13) Added inbound-email integration coverage for domain fallback in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - Configured domain match sets ticket client_id.
  - Default contact applied when configured on client properties.
  - No explicit mapping => no domain match (falls back to defaults), even if contacts exist with that domain.
  - Location_id cleared when resolved client differs from defaults.
- (2026-02-13) There is existing “billing contact” (`clients.billing_contact_id`) UI in `packages/clients/src/components/clients/BillingConfigForm.tsx`, but it is billing-specific and not suitable as the inbound-email default contact.
- (2026-02-13) Added "Default contact" picker to the client details screen: `packages/clients/src/components/clients/ClientDetails.tsx` persists `properties.primary_contact_id` and `properties.primary_contact_name`.
- (2026-02-13) Client default contact picker supports clearing by selecting "None" (empties both `primary_contact_id` and `primary_contact_name`).
- (2026-02-13) Added Playwright coverage for default contact persistence: `ee/server/src/__tests__/integration/client-default-contact.playwright.test.ts`.
- (2026-02-13) Added Playwright coverage for clearing the default contact: `ee/server/src/__tests__/integration/client-default-contact.playwright.test.ts`.

## Commands / Runbooks

- (2026-02-13) Code search:
  - `rg -n "resolve_inbound_ticket_context|processInboundEmailInApp|findContactByEmail" -S`
- (2026-02-13) Unit tests:
  - `shared/lib/email/addressUtils.test.ts` covers `extractEmailDomain()` normalization + domain extraction cases.
  - `shared/workflow/actions/emailWorkflowActions.inboundDomainLookup.test.ts` covers `findClientIdByInboundEmailDomain()` lookup + normalization behavior.

## Links / References

- `shared/services/email/processInboundEmailInApp.ts` (new-ticket path)
- `shared/workflow/actions/emailWorkflowActions.ts` (`findContactByEmail`)
- `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` (`resolve_inbound_ticket_context`)
- `packages/clients/src/components/clients/ClientDetails.tsx` (client screen)
- `packages/types/src/interfaces/client.interfaces.ts` (`IClient.properties.primary_contact_id`)
- `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts` (inbound email integration coverage)
- `server/src/test/integration/resolveInboundTicketContext.domainFallback.integration.test.ts` (workflow action parity coverage)

## Open Questions

- Exact-only domain matching vs subdomain handling (`it.acme.com` vs `acme.com`).
- Should comment author attribution change when ticket contact is set via default contact (domain fallback)?
- Do we want an admin helper that suggests domains based on contacts, while still requiring explicit confirmation?
