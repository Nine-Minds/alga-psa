# Scratchpad — Multiple Email Addresses Per Contact

- Plan slug: `2026-03-15-multiple-email-addresses-per-contact`
- Created: `2026-03-15`

## What This Is

Working memory for replacing scalar contact email with a normalized multi-email contact model across Alga PSA.

## Decisions

- (2026-03-15) Contacts may have multiple email addresses, but every stored email address remains unique per tenant.
- (2026-03-15) This is a full cut-over in one pass. Do not keep a persistent scalar `contacts.email` database column.
- (2026-03-15) The contact's default email automatically becomes the canonical email for portal/client-user invitation and login-adjacent contact flows.
- (2026-03-15) Canonical email labels are `work`, `personal`, `billing`, and `other`, with freeform tenant-scoped custom labels.
- (2026-03-15) The implementation should mirror the existing multi-phone architecture and editor behavior as closely as possible.

## Discoveries / Constraints

- (2026-03-15) The current phone-number implementation already provides the target pattern:
  - shared type contract in `shared/interfaces/contact.interfaces.ts`
  - validation + hydration in `shared/models/contactModel.ts`
  - shared editor in `packages/clients/src/components/contacts/ContactPhoneNumbersEditor.tsx`
- (2026-03-15) Current scalar contact email assumptions are spread broadly across:
  - shared contact model
  - shared inbound email services
  - workflow email actions and runtime action schemas
  - ticket/project/survey/billing outbound sends
  - portal invitation/recovery and auth-adjacent registration
  - REST schemas/services, n8n, and integrations
- (2026-03-15) Inbound email needs two email concepts after the migration:
  - the exact sender address that matched a contact row
  - the contact's default email for outbound follow-up
- (2026-03-15) Watch-list and locale-deduping logic is email-keyed, so contact picker changes must preserve default-email semantics cleanly.

## Key Files To Revisit

- `shared/interfaces/contact.interfaces.ts`
- `shared/models/contactModel.ts`
- `packages/clients/src/components/contacts/ContactPhoneNumbersEditor.tsx`
- `packages/clients/src/components/contacts/ContactDetails.tsx`
- `packages/clients/src/components/contacts/ContactDetailsEdit.tsx`
- `packages/clients/src/components/contacts/QuickAddContact.tsx`
- `packages/clients/src/components/contacts/Contacts.tsx`
- `packages/clients/src/components/contacts/ClientContactsList.tsx`
- `shared/services/emailService.ts`
- `shared/services/email/processInboundEmailInApp.ts`
- `shared/workflow/actions/emailWorkflowActions.ts`
- `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`
- `shared/workflow/runtime/actions/businessOperations/contacts.ts`
- `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
- `packages/portal-shared/src/actions/portalInvitationActions.ts`
- `server/src/lib/api/schemas/contact.ts`
- `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts`

## Suggested Delivery Order

1. Schema + shared types
2. Contact model validation/persistence/hydration
3. Shared editor + contact CRUD UI
4. Inbound/workflow contact lookup
5. Outbound notification consumers
6. Portal/auth-adjacent flows
7. API + n8n + integrations
8. Fixture/test cleanup + DB-backed regression coverage

## Commands / Runbooks

- Search scalar contact email usage:
  - `rg -n "\\bcontact\\.email\\b|contacts\\.email|contact_email" server ee packages shared -g '!**/node_modules/**'`
- Search phone-number reference pattern:
  - `rg -n "phone_numbers|default_phone_number|contact_phone" server ee packages shared -g '!**/node_modules/**'`
- Check plan files:
  - `find docs/plans/2026-03-15-multiple-email-addresses-per-contact -maxdepth 1 -type f | sort`

## Open Questions

- None for the first draft. Product direction is set for:
  - unique-per-tenant emails
  - one-pass cut-over
  - default email drives portal/login contact behavior
  - canonical label set

## Updates

- (2026-03-15) Approved design recorded in `docs/plans/2026-03-15-multiple-email-addresses-per-contact-design.md`.
- (2026-03-15) Initial PRD, features list, and test list created for the multi-email contact effort.
