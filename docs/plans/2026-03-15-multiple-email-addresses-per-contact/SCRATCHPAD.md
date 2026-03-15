# Scratchpad — Multiple Email Addresses Per Contact

- Plan slug: `2026-03-15-multiple-email-addresses-per-contact`
- Created: `2026-03-15`

## What This Is

Working memory for adding multiple email addresses to contacts using a compatibility-preserving hybrid model:

- `contacts.email` stays required and remains the authoritative default email
- primary/default email label metadata lives on `contacts`
- additional non-default emails live in a child table
- changing default swaps the selected additional email into `contacts.email`

## Decisions

- (2026-03-15) Contacts may have multiple email addresses, but every stored email address remains unique per tenant across both the primary and additional-email storage locations.
- (2026-03-15) `contacts.email` remains required and authoritative. This effort does not make it nullable or replace it with a derived default.
- (2026-03-15) Changing the default email swaps the selected additional email into `contacts.email` and demotes the old primary email into the additional-email table.
- (2026-03-15) The primary/default email also carries a label.
- (2026-03-15) Canonical email labels are `work`, `personal`, `billing`, and `other`, with freeform tenant-scoped custom labels.
- (2026-03-15) The implementation should mirror the existing phone-label architecture and editor behavior where practical.

## Discoveries / Constraints

- (2026-03-15) The original fully normalized design was broader than necessary because many application surfaces already use `contacts.email` exactly the way we want the default email to behave.
- (2026-03-15) The biggest remaining change surface under the hybrid model is:
  - contact schema/model persistence
  - contact edit/create/import/export UI
  - lookup/query paths that must match additional emails
  - inbound/workflow paths that must distinguish matched sender email from `contacts.email`
- (2026-03-15) A large set of outbound and auth-adjacent consumers likely stays compatible with little or no contract change because they already read `contacts.email`:
  - portal invitation and registration flows
  - survey sends
  - invoice/billing sends
  - ticket/project notifications that already resolve a contact and then send to `contact.email`
  - many summary payloads such as `contact_email` / `author_contact_email`
- (2026-03-15) Search and lookup paths still need real changes because the app currently matches only `contacts.email` in several places:
  - `shared/services/emailService.ts`
  - `shared/workflow/actions/emailWorkflowActions.ts`
  - `shared/workflow/runtime/actions/businessOperations/contacts.ts`
  - `server/src/lib/api/services/ContactService.ts`
  - `packages/clients/src/actions/queryActions.ts`
  - `packages/integrations/src/actions/clientLookupActions.ts`
- (2026-03-15) Watch-list and similar recipient stores are email-keyed snapshots today. Under the hybrid model, they are likely safest to leave snapshot-based unless a surface explicitly re-resolves a contact from user input.

## Key Files To Revisit

- `shared/interfaces/contact.interfaces.ts`
- `packages/types/src/interfaces/contact.interfaces.ts`
- `shared/models/contactModel.ts`
- `server/src/lib/api/schemas/contact.ts`
- `server/src/lib/api/services/ContactService.ts`
- `packages/clients/src/components/contacts/ContactDetailsEdit.tsx`
- `packages/clients/src/components/contacts/ContactDetailsView.tsx`
- `packages/clients/src/components/contacts/QuickAddContact.tsx`
- `packages/clients/src/components/clients/QuickAddClient.tsx`
- `packages/clients/src/components/contacts/Contacts.tsx`
- `packages/clients/src/components/contacts/ContactsImportDialog.tsx`
- `packages/clients/src/actions/queryActions.ts`
- `shared/services/emailService.ts`
- `shared/services/email/processInboundEmailInApp.ts`
- `shared/workflow/actions/emailWorkflowActions.ts`
- `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`
- `shared/workflow/runtime/actions/businessOperations/contacts.ts`
- `shared/workflow/streams/domainEventBuilders/contactEventBuilders.ts`
- `packages/portal-shared/src/actions/portalInvitationActions.ts`
- `packages/auth/src/lib/registrationHelpers.ts`
- `packages/users/src/actions/user-actions/registrationActions.ts`
- `packages/client-portal/src/actions/portal-actions/tenantRecoveryActions.ts`
- `server/src/services/surveyService.ts`
- `server/src/lib/jobs/handlers/invoiceEmailHandler.ts`
- `packages/billing/src/actions/invoiceJobActions.ts`
- `shared/lib/tickets/watchList.ts`
- `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts`
- `packages/integrations/src/actions/clientLookupActions.ts`
- `packages/integrations/src/actions/email-actions/emailActions.ts`
- `packages/integrations/src/services/xeroCsvClientSyncService.ts`

## Suggested Delivery Order

1. Schema and shared contracts
2. Contact model validation, hydration, persistence, and swap behavior
3. Shared email editor plus contact CRUD UI
4. Query/search/import/export surfaces
5. Inbound email and workflow lookup paths
6. REST, n8n, and integrations
7. Compatibility regressions for existing `contacts.email` consumers

## Commands / Runbooks

- Search scalar contact-email consumers:
  - `rg -n "\\bcontact\\.email\\b|contacts\\.email|contact_email|author_contact_email" server ee packages shared -g '!**/node_modules/**'`
- Search current phone-label reference pattern:
  - `rg -n "phone_numbers|default_phone_number|contact_phone|custom_phone_type" server ee packages shared -g '!**/node_modules/**'`
- Search lookup paths that currently match only `contacts.email`:
  - `rg -n "findContactByEmail|createOrFindContact|contacts\\.find|contacts\\.search|where\\(\\{ 'contacts\\.email'" server ee packages shared -g '!**/node_modules/**'`

## Open Questions

- None blocking the regenerated plan. The working assumptions are:
  - `contacts.email` stays required and authoritative
  - primary email changes are swaps, not pointer changes
  - additional emails are not independent login aliases
  - snapshot recipient stores remain snapshot-based unless later product direction changes

## Updates

- (2026-03-15) Original full-normalization plan replaced with a safer hybrid plan after design pivot.
- (2026-03-15) The regenerated plan reduces scope by preserving `contacts.email` compatibility for many existing outbound and auth-adjacent consumers.
- (2026-03-15) The regenerated feature inventory now concentrates on schema/model, editor UI, lookup/query behavior, inbound/workflow semantics, and contract extensions rather than rewriting every default-email consumer.
## Update (2026-03-15)
- Completed first milestone for schema/interface foundation:
  - Added shared email canonical labels and email row interfaces in `shared/interfaces/contact.interfaces.ts`.
  - Mirrored contact email interface updates in `packages/types/src/interfaces/contact.interfaces.ts`.
  - Added migration `20260315120000_create_contact_additional_email_addresses_schema.cjs` to support:
    - `contacts.primary_email_canonical_type`
    - `contacts.primary_email_custom_type_id` with tenant-scoped FK to `contact_email_type_definitions`
    - new `contact_email_type_definitions` table
    - new `contact_additional_email_addresses` table
    - normalized email uniqueness and tenant scoping
    - trigger-backed cross-table uniqueness checks
    - backfill of existing contacts with default primary email canonical type
- Added tests:
  - `server/src/test/unit/migrations/contactAdditionalEmailAddressesMigration.test.ts` for migration-level assertions.
  - `shared/models/__tests__/contactInterfaceParity.test.ts` for contract parity between shared interfaces and `@alga-psa/types`.
- Decision made to model primary email label metadata as explicit columns on `contacts` and use child rows for additional emails only.
- Constraint to keep: keep `contacts.email` as authoritative default and compatibility boundary for downstream consumers.

## Update (2026-03-15, validation/persistence block)
- Completed `F008` through `F011` in the shared contact model and flipped `T008` through `T016` to implemented.
- Added input support for `primary_email_custom_type` in shared and `@alga-psa/types` contact contracts so callers can create or update primary custom labels without pre-resolving definition IDs.
- Tightened validation in `shared/models/contactModel.ts` to enforce canonical-vs-custom exclusivity for primary labels and to reject primary custom labels that duplicate canonical values.
- Fixed a swap edge case: promoting an additional email with a custom label now preserves that custom label on the promoted primary row instead of dropping back to `null`.
- Fixed a persistence edge case: demoting a custom-labeled primary email during swap now preserves its existing `custom_email_type_id` when writing the additional-email row.
- Confirmed the current cleanup helpers already count both `contacts.primary_email_custom_type_id` and `contact_additional_email_addresses.custom_email_type_id`, so orphan detection/deletion works across both storage locations.
- Updated tests:
  - `shared/models/__tests__/contactModel.test.ts`
  - `shared/models/__tests__/contactInterfaceParity.test.ts`
  - `server/src/test/integration/contactModelEmailAddresses.integration.test.ts`
- Verification runbook used:
  - `pnpm vitest run models/__tests__/contactModel.test.ts models/__tests__/contactInterfaceParity.test.ts` from `shared/`
  - `pnpm vitest run src/test/integration/contactModelEmailAddresses.integration.test.ts` from `server/`
- Gotcha discovered:
  - The first draft of the model only supported custom primary labels by stored definition ID, which was insufficient for create/update flows and broke promotion of custom-labeled additional emails. The fix was to treat primary labels like additional rows at the input boundary, then resolve/create the tenant-scoped label definition inside the model transaction.
