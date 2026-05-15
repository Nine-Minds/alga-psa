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
- (2026-03-15) Completed compatibility/regression closeout for default-email consumers:
  - Added `server/src/test/unit/contacts/ContactEmailDefaultConsumer.contract.test.ts` to lock portal/auth, billing, survey, project, ticket, and scheduling flows onto `contacts.email`.
  - Extended `shared/lib/tickets/__tests__/watchList.test.ts` to prove watcher recipients remain email-keyed snapshots even if later contact metadata differs.
  - Added `server/src/test/integration/contactEmailLookup.integration.test.ts` regression covering create -> promote additional email -> lookup by both addresses -> uniqueness guards.
- (2026-03-15) Found and fixed a real cross-table uniqueness bug while finishing `T049`:
  - `check_contact_additional_email_uniqueness()` originally compared against `NEW.normalized_email_address` inside a `BEFORE` trigger, but generated columns are not available there yet.
  - Fixed the migration trigger to normalize from `NEW.email_address` directly.
  - Updated `ContactModel.updateContact()` promotion flow to clear existing additional-email rows before swapping the primary email, then reinsert the final additional-email set after the primary update so immediate uniqueness triggers never observe an invalid intermediate state.
- (2026-03-15) Verification run for the final closeout:
  - `cd server && pnpm vitest run src/test/unit/migrations/contactAdditionalEmailAddressesMigration.test.ts src/test/unit/contacts/ContactEmailDefaultConsumer.contract.test.ts src/test/integration/contactModelEmailAddresses.integration.test.ts src/test/integration/contactEmailLookup.integration.test.ts --coverage=false`
  - `cd shared && pnpm vitest run lib/tickets/__tests__/watchList.test.ts --coverage=false`
- Completed shared email editor milestone:
  - Added `packages/clients/src/components/contacts/ContactEmailAddressesEditor.tsx` with:
    - pinned primary/default row
    - additional row add/remove/reorder/promote behavior
    - canonical plus custom label editing
    - helper exports for normalize/compact/reorder/promote/validate flows
  - Validation now allows reuse of the same custom label across rows because labels are tenant-scoped reusable definitions, not per-contact unique values.
  - Added focused helper coverage in `packages/clients/src/components/contacts/ContactEmailAddressesEditor.test.ts`.
  - Added jsdom interaction coverage in `server/src/test/unit/contacts/ContactEmailAddressesEditor.test.tsx`.
- Commands run for the shared editor milestone:
  - `../../node_modules/.bin/vitest run src/components/contacts/ContactEmailAddressesEditor.test.ts --coverage=false` from `packages/clients`
  - `cd server && pnpm vitest run src/test/unit/contacts/ContactEmailAddressesEditor.test.tsx --coverage=false`
- Completed contact-surface wiring milestone:
  - `ContactDetailsEdit.tsx` now edits and saves the hybrid email payload through `ContactEmailAddressesEditor`, validates it on submit, and sends compacted email rows through `updateContact`.
  - `ContactDetailsView.tsx` now renders the primary/default email distinctly and lists additional email addresses with labels underneath.
  - `QuickAddContact.tsx` now authors the hybrid email payload, including additional email rows, through the shared editor before calling `addContact`.
  - `QuickAddClient.tsx` inline contact creation now authors the same hybrid email payload before calling `createClientContact`.
  - `contactActions.tsx` now forwards primary-email label metadata and additional email rows through `addContact`, `updateContact`, and `createClientContact`.
- Added coverage for the contact-surface wiring milestone:
  - `server/src/test/unit/contacts/ContactDetailsEmailAddresses.contract.test.ts`
  - `server/src/test/unit/contacts/QuickAddContact.phoneNumbers.test.tsx`
  - `server/src/test/unit/contacts/QuickAddClient.phoneNumbers.test.tsx`
- Commands run for the contact-surface wiring milestone:
  - `cd server && pnpm vitest run src/test/unit/contacts/ContactEmailAddressesEditor.test.tsx src/test/unit/contacts/ContactDetailsEmailAddresses.contract.test.ts src/test/unit/contacts/QuickAddContact.phoneNumbers.test.tsx src/test/unit/contacts/QuickAddClient.phoneNumbers.test.tsx --coverage=false`
- Completed summary-surface compatibility audit:
  - `Contacts.tsx`, `ClientDetails.tsx`, `ContactPicker.tsx`, and `ContactPickerDialog.tsx` already remained anchored on scalar `contact.email` for summary rendering and picker search.
  - Added a contract regression test to lock in that list and picker surfaces keep using the primary/default `contacts.email` field even as detailed contact rendering grows richer.
- Added coverage for the summary-surface compatibility audit:
  - `server/src/test/unit/contacts/ContactSummaryEmail.contract.test.ts`
- Command run for the summary-surface compatibility audit:
  - `cd server && pnpm vitest run src/test/unit/contacts/ContactSummaryEmail.contract.test.ts --coverage=false`

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

## Update (2026-03-15, event/workflow contracts)
- Completed `F012` and flipped `T017` to implemented.
- Updated contact domain-event builders to emit:
  - `primaryEmailCanonicalType`
  - `primaryEmailCustomTypeId`
  - `primaryEmailType`
  - `additionalEmailAddresses`
  while still leaving the summary/default address on top-level `email`.
- Added an alias rule in `buildContactUpdatedPayload` so workflow/event diffs treat input-only `primary_email_custom_type` changes as changes to the persisted `primary_email_type` and `primary_email_custom_type_id` fields.
- Updated both schema copies of CRM event payloads:
  - `shared/workflow/runtime/schemas/crmEventSchemas.ts`
  - `packages/event-schemas/src/schemas/domain/crmEventSchemas.ts`
- Updated both workflow event publishers that build `CONTACT_CREATED` payloads:
  - `server/src/lib/api/services/ContactService.ts`
  - `packages/clients/src/actions/contact-actions/contactActions.tsx`
- Verification runbook used:
  - `pnpm vitest run workflow/streams/domainEventBuilders/__tests__/contactEventBuilders.test.ts` from `shared/`

## Update (2026-03-15, contact search/export compatibility)
- Completed `F018` and flipped `T026` and `T027` to implemented.
- Extended server-side contact email searching so `ContactService` now treats both the primary `contacts.email` column and `contact_additional_email_addresses.email_address` as valid matches for:
  - search clauses targeting the `email` field
  - list filters using `email`
  - free-text contact search
- Kept compatibility boundaries intact:
  - contact lists, pickers, and exports continue rendering/emitting scalar `contact.email` as the summary/default address
  - local client-side filtering in `Contacts.tsx` now includes additional email rows without changing the visible summary email column
- Added regression coverage:
  - `server/src/test/integration/contactServiceEmailSearch.integration.test.ts`
  - `server/src/test/unit/contacts/ContactsAdditionalEmailSearch.contract.test.ts`
  - `server/src/test/unit/contacts/ContactSummaryEmail.contract.test.ts`
- Verification runbook used:
  - `cd server && pnpm vitest run src/test/unit/contacts/ContactSummaryEmail.contract.test.ts src/test/unit/contacts/ContactsAdditionalEmailSearch.contract.test.ts src/test/integration/contactServiceEmailSearch.integration.test.ts --coverage=false`

## Update (2026-03-15, contact CSV hybrid email support)
- Completed `F019` and flipped `T028` through `T030` to implemented.
- Added a shared CSV email-field helper in `packages/clients/src/lib/contactCsvEmailFields.ts` so contact CSV import/export/template generation uses one representation for:
  - `primary_email_type`
  - `additional_email_addresses` as `label:email@example.com | label:email@example.com`
- Updated `contactActions.tsx` so contact CSV flows now:
  - export primary email labels and formatted additional-email rows while keeping scalar `email` as the primary/default address
  - generate a CSV template with the new hybrid email columns and example values
  - check existing emails across both `contacts.email` and `contact_additional_email_addresses`
  - import/create/update contacts with primary label metadata and additional-email rows
  - support updating an existing contact when the import row matches one of that contact's additional email addresses
- Updated `ContactsImportDialog.tsx` so CSV mapping, validation, preview, and upload copy understand the new hybrid-email fields and collision checks.
- Added/updated regression coverage in `server/src/test/integration/contactCsvPhoneImportExport.integration.test.ts` for:
  - DB-backed create/update import behavior with primary and additional email rows when the local test Postgres harness is available
- Added no-DB contract coverage for the CSV email representation and import wiring:
  - `server/src/test/unit/contacts/contactCsvEmailImportExport.contract.test.ts`
  - `server/src/test/unit/contacts/contactCsvImport.contract.test.ts`
- Verification runbook used:
  - `cd server && pnpm vitest run src/test/unit/contacts/contactCsvEmailImportExport.contract.test.ts src/test/unit/contacts/contactCsvImport.contract.test.ts --coverage=false`
- Gotchas discovered:
  - Import updates that match by an additional email need pre-normalization before calling `ContactModel.updateContact`, otherwise the model correctly rejects a raw primary-email change that has not been expressed as a promote/swap.
  - When the import row promotes an existing additional email to primary, the import layer must omit the old primary from the incoming additional-email list because the model appends the demoted primary row transactionally during the swap.

## Update (2026-03-15, shared lookup helpers)
- Completed `F020` and flipped `T031` and `T032` to implemented.
- Updated `ContactModel.getContactByEmail` so shared lookup now resolves contacts by either:
  - `contacts.email`
  - `contact_additional_email_addresses.normalized_email_address`
- Updated `findContactByEmailAddress` in `packages/clients/src/actions/queryActions.ts` to defer to the shared model helper instead of running a primary-only SQL query.
- `createOrFindContactByEmail` now inherits the hybrid lookup behavior through `ContactModel.getContactByEmail` while still creating new contacts with only a primary email on `contacts.email` when no match exists.
- Added focused no-DB regression coverage:
  - `shared/models/__tests__/contactModel.getContactByEmail.test.ts`
  - `server/src/test/unit/contacts/contactEmailLookup.contract.test.ts`
- Verification runbook used:
  - `cd shared && pnpm vitest run models/__tests__/contactModel.getContactByEmail.test.ts --coverage=false`
  - `cd server && pnpm vitest run src/test/unit/contacts/contactEmailLookup.contract.test.ts --coverage=false`

## Update (2026-03-15, shared email service lookup semantics)
- Completed `F021` and flipped `T033` and `T034` to implemented.
- Updated `shared/services/emailService.ts` so `EmailService.findContactByEmail` now:
  - delegates contact resolution to `ContactModel.getContactByEmail`
  - preserves the canonical primary/default contact email on `email`
  - surfaces the exact lookup match separately on `matched_email`
  - still hydrates default phone and client name for downstream consumers
- Confirmed `EmailService.createOrFindContact` remains compatibility-safe:
  - it reuses the hybrid lookup path through `findContactByEmail`
  - it still creates new contacts with only `contacts.email` populated and no additional-email rows when no match exists
- Added focused no-DB coverage:
  - `shared/services/__tests__/emailService.contactLookup.test.ts`
- Added a DB-backed integration regression for environments where the local test harness is available:
  - `server/src/test/integration/emailServiceContactLookup.integration.test.ts`
- Verification runbook used:
  - `cd shared && pnpm vitest run services/__tests__/emailService.contactLookup.test.ts --coverage=false`

## Update (2026-03-15, workflow contact email lookup)
- Completed `F022` and flipped `T035` to implemented.
- Updated `shared/workflow/actions/emailWorkflowActions.ts#findContactByEmail` so workflow contact matching now searches both:
  - `contacts.email`
  - `contact_additional_email_addresses.normalized_email_address`
- Kept the existing context-aware ticket/default-client resolution logic intact after broadening the candidate query, so inbound workflow attribution still prefers ticket/default-client boundaries when multiple mocked candidates are present in tests.
- `createOrFindContact` in the workflow action already used `ContactModel.getContactByEmail`, so it now inherits the hybrid lookup behavior while continuing to create new contacts with only a primary email on `contacts.email`.
- Extended the existing workflow unit suite:
  - `shared/workflow/actions/__tests__/emailWorkflowActions.findContactByEmail.context.test.ts`
- Verification runbook used:
  - `cd shared && pnpm vitest run workflow/actions/__tests__/emailWorkflowActions.findContactByEmail.context.test.ts --coverage=false`

## Update (2026-03-15, inbound matched-email preservation)
- Completed `F023` and flipped `T036` and `T037` to implemented.
- Updated `shared/services/email/processInboundEmailInApp.ts` so inbound comment metadata now preserves both:
  - `metadata.email.matchedAddress` for the exact sender address that matched lookup
  - `metadata.email.contactEmail` for the matched contact's primary/default `contacts.email`
- Kept the existing authorship routing intact:
  - `contact_id`, `author_id`, and `client_id` continue to resolve from the matched contact record
  - default-email consumers can continue to treat `contacts.email` as authoritative
- Added a focused regression covering the additional-email-match path:
  - `shared/services/email/__tests__/processInboundEmailInApp.additionalPaths.test.ts`
- Verification runbook used:
  - `cd shared && pnpm vitest run services/email/__tests__/processInboundEmailInApp.additionalPaths.test.ts --coverage=false`

## Update (2026-03-15, runtime matched-email contracts)
- Completed `F024` and flipped `T038` to implemented.
- Updated `shared/workflow/actions/emailWorkflowActions.ts` so workflow contact lookups now return `matched_email` alongside the primary/default `email`.
- Updated `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` so runtime contact outputs now expose:
  - `email` for the primary/default `contacts.email`
  - `matched_email` for the exact sender email that matched when it differs from the primary email
- Updated `shared/workflow/runtime/schemas/emailWorkflowSchemas.ts` so the shared runtime schema vocabulary can describe both the primary/default email and the matched sender email separately.
- Extended runtime registry coverage:
  - `shared/workflow/actions/__tests__/emailWorkflowActions.findContactByEmail.context.test.ts`
  - `shared/workflow/runtime/actions/__tests__/registerEmailWorkflowActions.contactAuthorship.test.ts`
- Verification runbook used:
  - `cd shared && pnpm vitest run workflow/actions/__tests__/emailWorkflowActions.findContactByEmail.context.test.ts workflow/runtime/actions/__tests__/registerEmailWorkflowActions.contactAuthorship.test.ts services/email/__tests__/processInboundEmailInApp.additionalPaths.test.ts --coverage=false`
- Constraint observed:
  - `cd server && pnpm vitest run src/test/integration/workflowRuntimeV2.email.integration.test.ts --coverage=false` is currently blocked locally because the configured `server` test database does not exist in this environment.

## Update (2026-03-15, workflow business contact email search)
- Completed `F025` and flipped `T039` to implemented.
- Updated `shared/workflow/runtime/actions/businessOperations/contacts.ts` so:
  - `contacts.find` resolves email lookups through `ContactModel.getContactByEmail`, which now covers both primary and additional contact emails
  - `contacts.search` keeps summary rows sourced from `contacts.email` while adding an `EXISTS` search clause for `contact_additional_email_addresses`
- Added focused unit coverage:
  - `shared/workflow/runtime/actions/__tests__/businessOperations.contacts.emailSearch.test.ts`
- Verification runbook used:
  - `cd shared && pnpm vitest run workflow/runtime/actions/__tests__/businessOperations.contacts.emailSearch.test.ts --coverage=false`

## Update (2026-03-15, REST contact hybrid email contracts)
- Completed `F026` and flipped `T040` and `T041` to implemented.
- Updated `server/src/lib/api/schemas/contact.ts` so REST contact schemas now accept and return:
  - scalar `email` as the primary/default address
  - `primary_email_canonical_type`
  - `primary_email_custom_type`
  - `primary_email_custom_type_id`
  - `primary_email_type` on responses
  - `additional_email_addresses`
- Updated `server/src/lib/api/services/ContactService.ts#create` so create requests stop dropping the hybrid email fields before they reach `ContactModel.createContact`.
- Added focused unit coverage:
  - `server/src/test/unit/validation/contactPhoneSchemas.test.ts`
  - `server/src/test/unit/api/contactService.hybridEmailFields.test.ts`
- Verification runbook used:
  - `cd server && pnpm vitest run src/test/unit/validation/contactPhoneSchemas.test.ts src/test/unit/api/contactService.hybridEmailFields.test.ts --coverage=false`
- Constraint observed:
  - A DB-backed `ContactService` integration variant was not kept because local Postgres connectivity to the `.env.localtest` harness is currently blocked (`EPERM` to `127.0.0.1:5438` / `::1:5438`) in this environment.

## Update (2026-03-15, n8n hybrid email payloads)
- Completed `F027` and flipped `T042` to implemented.
- Updated `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/helpers.ts` so contact create/update payload builders now preserve:
  - scalar `email` as the primary/default address
  - `primary_email_canonical_type`
  - `primary_email_custom_type`
  - `primary_email_custom_type_id`
  - `additional_email_addresses`
- Added `parseContactEmailAddresses` to normalize the freeform JSON field used for additional email rows and keep n8n validation errors local to the node layer.
- Updated `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts` so contact create/update operations expose hybrid-email fields in the node UI.
- Updated supporting docs and examples:
  - `packages/n8n-nodes-alga-psa/README.md`
  - `packages/n8n-nodes-alga-psa/examples/create-update-contact.workflow.json`
- Added focused package coverage:
  - `packages/n8n-nodes-alga-psa/__tests__/helpers.test.ts`
  - `packages/n8n-nodes-alga-psa/__tests__/node-description-loadoptions.test.ts`
  - `packages/n8n-nodes-alga-psa/__tests__/node-execute.test.ts`
  - `packages/n8n-nodes-alga-psa/__tests__/docs.test.ts`
- Verification runbook used:
  - `cd packages/n8n-nodes-alga-psa && ../../node_modules/.bin/vitest run --config vitest.config.ts __tests__/helpers.test.ts __tests__/node-description-loadoptions.test.ts __tests__/node-execute.test.ts __tests__/docs.test.ts`

## Update (2026-03-15, integration contact email lookup)
- Completed `F028` and flipped `T043` to implemented.
- Updated `packages/integrations/src/actions/clientLookupActions.ts` so integration contact lookup now routes through `ContactModel.getContactByEmail` instead of querying only `contacts.email`.
- This broadens both:
  - `findIntegrationContactByEmailAddress`
  - `createOrFindIntegrationContactByEmail`
  to resolve contacts when the requested email matches an additional-email row while still returning the primary/default `contacts.email` on the hydrated contact object.
- Confirmed the higher-level integration email helper inherits the same behavior because `packages/integrations/src/actions/email-actions/emailActions.ts#findContactByEmail` still delegates into the client lookup helper.
- Added focused coverage:
  - `packages/integrations/src/actions/clientLookupActions.emailLookup.test.ts`
- Verification runbooks used:
  - `cd packages/integrations && ../../node_modules/.bin/vitest run src/actions/clientLookupActions.emailLookup.test.ts`
- Constraint observed:
  - `node_modules/.bin/tsc -p packages/integrations/tsconfig.json --noEmit` currently fails in pre-existing shared-model code under `shared/models/contactModel.ts` because `ContactEmailAddressInput` typing there does not include `normalized_email_address` / `normalized_custom_type`. This check is not blocked by the `F028` package changes themselves.

## Update (2026-03-15, external sync email compatibility)
- Completed `F029` and flipped `T044` to implemented.
- Audited the remaining external sync/import/export adapter surface after `F028`:
  - no remaining adapter-specific contact lookup path was bypassing the shared integration contact-email helpers
  - `packages/integrations/src/services/xeroCsvClientSyncService.ts` does not resolve contact email aliases directly; it operates on client billing/summary email fields
- Made the compatibility boundary explicit by extracting `getClientSummaryEmail` inside `packages/integrations/src/services/xeroCsvClientSyncService.ts` and keeping export behavior anchored on the client's primary billing/summary email before any location fallback.
- Added focused regression coverage:
  - `packages/integrations/src/services/xeroCsvClientSyncService.emailSummary.test.ts`
- Verification runbook used:
  - `cd packages/integrations && ../../node_modules/.bin/vitest run src/services/xeroCsvClientSyncService.emailSummary.test.ts`

## Update (2026-03-15, contact helper fixtures and seeds)
- Completed `F030` and flipped `T045` to implemented.
- Updated reusable contact helpers to author the hybrid email model directly through `ContactModel.createContact`:
  - `server/src/test/e2e/factories/contact.factory.ts`
  - `server/src/test/e2e/utils/contactTestDataFactory.ts`
  - `server/src/test/e2e/utils/email-test-factory.ts`
- Those helpers now support:
  - labeled primary email metadata
  - optional additional email rows with normalized `display_order`
  - backward-compatible defaults that still create a primary email label when tests only pass a scalar email
- Updated the dev seed fixture:
  - `server/seeds/dev/05_contacts.cjs`
  - added primary email labels on seeded contacts
  - added an example `contact_additional_email_addresses` row
- Added DB-backed regression coverage:
  - `server/src/test/integration/contactTestHelpersEmailRows.integration.test.ts`
- Verification runbook used:
  - `cd server && pnpm vitest run src/test/integration/contactTestHelpersEmailRows.integration.test.ts --coverage=false`
- Constraint observed:
  - the additional-email seed must not set `normalized_email_address` directly because that column is generated by the database schema.
