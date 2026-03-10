# Scratchpad — Multiple Contact Phone Numbers

- Plan slug: `multiple-contact-phone-numbers`
- Created: `2026-03-09`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also update earlier notes when a decision changes or an open question is resolved.

## Decisions

- (2026-03-09) Canonical contact phone types are `work`, `mobile`, `home`, `fax`, and `other`.
- (2026-03-09) The application contract is a breaking cutover: contact APIs/types/UI should move to `phone_numbers` rather than keep a long-lived scalar compatibility field.
- (2026-03-09) The storage model should be normalized instead of JSON on `contacts`.
- (2026-03-09) Custom phone types should behave like tags: tenant-scoped reusable suggestions created on demand, with normalization-based deduplication.
- (2026-03-09) List/detail/ticket surfaces should display the derived default phone rather than attempt to render every phone row in summary views.
- (2026-03-09) Migration A is implemented as one additive schema file that creates both normalized phone tables, backfills scalar contact phones, and intentionally leaves `contacts.phone_number` in place for deploy safety. Rationale: it satisfies the rollout sequencing requirement without coupling the later cutover/drop step to the initial schema release.
- (2026-03-09) `contact_phone_numbers.normalized_phone_number` is implemented as a generated stored column derived from `phone_number` instead of an app-populated plain text field. Rationale: it guarantees searchable normalized digits for every insert/update path, including direct SQL fixtures and future services that have not been cut over yet.
- (2026-03-09) Phone-row write logic is centralized in `shared/models/contactModel.ts` instead of being duplicated across `ContactService`, client actions, CSV import, and later Entra sync. Rationale: one transactional helper surface keeps default enforcement, custom-type reuse, and read hydration consistent.
- (2026-03-09) Contact read/query paths now expose `default_phone_number` and `default_phone_type` convenience fields in addition to the ordered `phone_numbers` array. Rationale: summary surfaces and sort/search code need a stable derived default without reimplementing that derivation everywhere.
- (2026-03-09) The first UI slice uses a contact-domain-local `ContactPhoneNumbersEditor` rather than extracting a global multi-entity phone component. Rationale: the PRD scope is contact-only, and a local editor let the form behavior converge before broader reuse decisions.

## Discoveries / Constraints

- (2026-03-09) `contacts.phone_number` is still assumed broadly across shared types, server interfaces, API schemas, contact actions, query actions, CSV import/export, list tables, detail views, ticket properties, and Entra sync.
- (2026-03-09) Main contact GUI surfaces in scope include:
  - `packages/clients/src/components/contacts/ContactDetails.tsx`
  - `packages/clients/src/components/contacts/ContactDetailsEdit.tsx`
  - `packages/clients/src/components/contacts/ContactDetailsView.tsx`
  - `packages/clients/src/components/contacts/QuickAddContact.tsx`
  - `packages/clients/src/components/contacts/Contacts.tsx`
  - `packages/clients/src/components/contacts/ClientContactsList.tsx`
  - `packages/clients/src/components/contacts/ContactsImportDialog.tsx`
  - `packages/clients/src/components/clients/QuickAddClient.tsx`
  - `packages/tickets/src/components/ticket/TicketProperties.tsx`
- (2026-03-09) Contact query actions currently sort and project directly on `contacts.phone_number`, so query behavior needs an explicit default-phone derivation rule after normalization.
- (2026-03-09) Contact workflow/domain events and API schemas currently still emit/validate scalar phone fields (`phoneNumber`, `phone_number`).
- (2026-03-09) Entra sync currently collapses `mobilePhone` and `businessPhones[0]` into one scalar `phone_number`; the new model should preserve more than one external number.
- (2026-03-09) Existing repo migration tests commonly use file-content contract assertions rather than spinning up a database for every migration case; the first phone migration coverage follows that pattern in `server/src/test/unit/migrations/contactPhoneNumbersMigration.test.ts`.
- (2026-03-09) This worktree’s `.env.localtest` points at `localhost:5438`, but the active local Postgres for integration tests is the Docker container exposed on `localhost:55433` with `postgres` / `app_user` passwords from `secrets/postgres_password` and `secrets/db_password_server` (`postpass123`).
- (2026-03-09) `shared/vitest.config.ts` only discovers tests under `services/**/*.test.ts` and `**/__tests__/**/*.test.ts`, so shared validation tests for this work need to live in `shared/**/__tests__/`.
- (2026-03-09) The existing shared workflow builder tests import `buildWorkflowPayload` through a package re-export that resolves the published `@alga-psa/event-schemas` entry. In this worktree, the reliable local path is `packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts`.
- (2026-03-09) `server/vitest.config.ts` needed local source aliases for `@alga-psa/clients` and `@alga-psa/user-composition` so server-side Vitest contract tests could import unbuilt package source files directly from the monorepo.
- (2026-03-09) `npx tsc -p shared/tsconfig.json --noEmit` still fails because the shared TypeScript program pulls in `packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts` outside its configured `rootDir`; that pre-existing config issue is unrelated to the contact-phone cutover.

## Commands / Runbooks

- (2026-03-09) Find contact phone usage in contact UI and actions:
  - `rg -n "phone_number|PhoneInput|ContactDetails|QuickAddContact|ContactsImportDialog|ClientContactsList" packages/clients/src --glob '!**/node_modules/**'`
- (2026-03-09) Find wider GUI/contact display usage:
  - `rg -n "phone_number|Phone Number|Phone" packages/clients/src/components packages/tickets/src/components ee/server/src --glob '!**/node_modules/**'`
- (2026-03-09) Find API/service/event usage:
  - `rg -n "CONTACT_CREATED|CONTACT_UPDATED|phoneNumber|phone_number" packages server ee --glob '!**/node_modules/**'`
- (2026-03-09) Validate the new migration contract suite:
  - `cd server && npx vitest run src/test/unit/migrations/contactPhoneNumbersMigration.test.ts`
- (2026-03-09) Quick syntax-load check for the new migration:
  - `node -e "require('./server/migrations/20260309120000_create_contact_phone_numbers_schema.cjs'); console.log('migration-load-ok')"`
- (2026-03-09) Run the DB-backed normalized phone storage test against the live local Postgres container:
  - `cd server && DB_PORT=55433 DB_PASSWORD_ADMIN=postpass123 DB_PASSWORD_SERVER=postpass123 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user npx vitest run src/test/integration/contactPhoneNumbers.integration.test.ts --coverage=false`
- (2026-03-09) Type-check the backend cutover slice:
  - `npx tsc -p shared/tsconfig.json --noEmit`
  - `npx tsc -p server/tsconfig.json --noEmit`
  - `npx tsc -p packages/types/tsconfig.json --noEmit`
  - `npx tsc -p packages/clients/tsconfig.json --noEmit`
  - `npx tsc -p packages/event-schemas/tsconfig.json --noEmit`
- (2026-03-09) Run the backend contract tests for normalized contact phones:
  - `cd packages/types && npx vitest run src/contact-phone.typecheck.test.ts`
  - `npx vitest run --config shared/vitest.config.ts shared/models/__tests__/contactModel.test.ts shared/workflow/streams/domainEventBuilders/__tests__/contactEventBuilders.test.ts`
  - `cd server && npx vitest run src/test/unit/validation/contactPhoneSchemas.test.ts --coverage=false`
  - `cd server && DB_PORT=55433 DB_PASSWORD_ADMIN=postpass123 DB_PASSWORD_SERVER=postpass123 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user npx vitest run src/test/integration/contactModelPhoneNumbers.integration.test.ts --coverage=false`
- (2026-03-09) Run the contact UI normalized-phone tests:
  - `npx tsc -p packages/clients/tsconfig.json --noEmit`
  - `cd server && npx vitest run src/test/unit/contacts/ContactPhoneNumbersEditor.test.tsx src/test/unit/contacts/ContactDetailsSave.contract.test.ts src/test/unit/contacts/ContactDetailsPhoneNumbers.contract.test.ts src/test/unit/contacts/QuickAddContact.phoneNumbers.test.tsx src/test/unit/contacts/QuickAddClient.phoneNumbers.test.tsx src/test/unit/contacts/ContactPhoneDisplay.contract.test.ts --coverage=false`
- (2026-03-09) Run the contact search/sort integration coverage:
  - `cd server && DB_PORT=55433 DB_PASSWORD_ADMIN=postpass123 DB_PASSWORD_SERVER=postpass123 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user npx vitest run src/test/integration/contactServicePhoneSearch.integration.test.ts --coverage=false`
- (2026-03-09) Run the contact CSV normalized-phone integration coverage:
  - `cd server && DB_PORT=55433 DB_PASSWORD_ADMIN=postpass123 DB_PASSWORD_SERVER=postpass123 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user npx vitest run src/test/integration/contactCsvPhoneImportExport.integration.test.ts --coverage=false`
- (2026-03-09) Run the Entra normalized-phone coverage:
  - `npx tsc -p ee/server/tsconfig.json --noEmit`
  - `cd ee/server && npx vitest run src/__tests__/unit/entraContactFieldSync.test.ts src/__tests__/unit/entraContactReconciler.test.ts --coverage=false`
- (2026-03-09) Run the contact helper/seed normalized-phone regression:
  - `cd server && DB_PORT=55433 DB_PASSWORD_ADMIN=postpass123 DB_PASSWORD_SERVER=postpass123 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user npx vitest run src/test/integration/contactTestHelpersPhoneRows.integration.test.ts --coverage=false`
- (2026-03-09) Validate the post-cutover server slice and Migration B coverage:
  - `npx tsc -p server/tsconfig.json --noEmit`
  - `cd server && DB_PORT=55433 DB_PASSWORD_ADMIN=postpass123 DB_PASSWORD_SERVER=postpass123 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user npx vitest run src/test/integration/contactPhoneColumnCutover.integration.test.ts src/test/unit/migrations/contactPhoneNumbersCutoverMigration.test.ts --coverage=false`

## Links / References

- Contact type definition: `packages/types/src/interfaces/contact.interfaces.ts`
- Contact actions: `packages/clients/src/actions/contact-actions/contactActions.tsx`
- Contact query actions: `packages/clients/src/actions/queryActions.ts`
- API contact schemas: `server/src/lib/api/schemas/contact.ts`
- Initial contacts schema: `server/migrations/202409071803_initial_schema.cjs`
- Contact details screen explicitly called out by user: `packages/clients/src/components/contacts/ContactDetails.tsx`

## Open Questions

- Should v1 CSV import/export add an explicit phone type column, or should import/export remain single-default-phone only?
- Should the server expose derived `default_phone_number` convenience fields on list responses, or should callers derive them from `phone_numbers`?
- Should the new multi-phone editor be contact-local first, or extracted immediately into a shared UI component?

## Completed Items

- (2026-03-09) Completed `F001`, `F002`, `F004`, and `F005` with `server/migrations/20260309120000_create_contact_phone_numbers_schema.cjs`.
  - Added `contact_phone_type_definitions` with tenant-scoped unique `normalized_label` and a DB check that stored normalized labels are lower-trimmed.
  - Added `contact_phone_numbers` with canonical/custom type exclusivity, canonical type constraint, per-contact default uniqueness, display ordering, and tenant/contact lookup indexes.
  - Backfilled non-empty legacy `contacts.phone_number` values into default `work` phone rows while retaining the legacy column for the later cutover/drop sequence.
- (2026-03-09) Completed `T001` through `T005` with `server/src/test/unit/migrations/contactPhoneNumbersMigration.test.ts`.
  - Coverage asserts the migration contract for custom type deduplication, phone-row type exclusivity, default uniqueness, and the scalar-phone backfill rules.
- (2026-03-09) Completed `F003` by switching `contact_phone_numbers.normalized_phone_number` to a generated stored column in `server/migrations/20260309120000_create_contact_phone_numbers_schema.cjs`.
  - Searchable normalized digits are now derived by the database from the display phone value, which avoids drift between formatted and normalized storage.
- (2026-03-09) Completed `T006` with `server/src/test/integration/contactPhoneNumbers.integration.test.ts`.
  - The integration test inserts a formatted phone row and verifies the stored/generated normalized digits can be queried without punctuation.
- (2026-03-09) Completed `F007`, `F008`, `F009`, `F011`, and `F021` by cutting the backend contracts over to normalized contact phones.
  - `shared/interfaces/contact.interfaces.ts`, `packages/types/src/interfaces/contact.interfaces.ts`, and `server/src/interfaces/contact.interfaces.tsx` now expose `phone_numbers` plus derived default-phone convenience fields instead of a scalar `phone_number`.
  - `shared/models/contactModel.ts` now validates canonical/custom phone rows, enforces exactly one default, auto-creates/reuses tenant-scoped custom type definitions, replaces child phone rows transactionally, and hydrates ordered phone rows on reads.
  - `server/src/lib/api/services/ContactService.ts`, `packages/clients/src/actions/contact-actions/contactActions.tsx`, and `packages/clients/src/actions/queryActions.ts` now create/read/update contacts through the normalized phone model and derive default-phone search/sort/export behavior from child rows.
  - `server/src/lib/api/schemas/contact.ts`, `shared/workflow/runtime/schemas/crmEventSchemas.ts`, `packages/event-schemas/src/schemas/domain/crmEventSchemas.ts`, and `shared/workflow/streams/domainEventBuilders/contactEventBuilders.ts` now validate and emit normalized phone payloads.
- (2026-03-09) Completed `T007` through `T015`, `T030`, `T031`, and `T032`.
  - `packages/types/src/contact-phone.typecheck.test.ts` verifies the exported contact create/read types accept `phone_numbers` collections and reject legacy scalar-only create payloads.
  - `shared/models/__tests__/contactModel.test.ts` verifies create validation rejects duplicate defaults and missing defaults while accepting mixed canonical/custom rows.
  - `server/src/test/unit/validation/contactPhoneSchemas.test.ts` verifies contact API schemas validate `phone_numbers` collections and response payloads with derived default fields.
  - `server/src/test/integration/contactModelPhoneNumbers.integration.test.ts` verifies DB-backed custom-type reuse, transactional create/update behavior, rollback on failed child writes, and ordered read hydration.
  - `shared/workflow/streams/domainEventBuilders/__tests__/contactEventBuilders.test.ts` now asserts `CONTACT_CREATED` and `CONTACT_UPDATED` payloads carry normalized phone data rather than scalar-only phone fields.
- (2026-03-09) Completed `F010`, `F012`, `F013`, `F014`, `F015`, `F016`, and `F018` by wiring the contact-facing UI and display surfaces to normalized phone rows.
  - `packages/clients/src/components/contacts/ContactPhoneNumbersEditor.tsx` provides the shared repeater UI for add/remove/reorder/default behavior, canonical vs. custom type selection, suggestion datalists, and normalized validation feedback.
  - `packages/clients/src/components/contacts/ContactDetails.tsx`, `packages/clients/src/components/contacts/ContactDetailsEdit.tsx`, `packages/clients/src/components/contacts/QuickAddContact.tsx`, and `packages/clients/src/components/clients/QuickAddClient.tsx` now read and submit `phone_numbers` collections instead of a scalar phone field.
  - `packages/clients/src/components/contacts/ContactDetailsView.tsx`, `packages/clients/src/components/contacts/Contacts.tsx`, `packages/clients/src/components/contacts/ClientContactsList.tsx`, and `packages/tickets/src/components/ticket/TicketProperties.tsx` now render the derived default contact phone from normalized rows.
  - `packages/clients/src/actions/contact-actions/contactActions.tsx` now exposes `listContactPhoneTypeSuggestions`, and `server/vitest.config.ts` now resolves the package-source aliases needed for these UI contract tests.
- (2026-03-09) Completed `T016` through `T023` and `T026`.
  - `server/src/test/unit/contacts/ContactPhoneNumbersEditor.test.tsx` verifies multi-row editor behavior for custom types, explicit default selection, and invalid duplicate-default states.
  - `server/src/test/unit/contacts/ContactDetailsSave.contract.test.ts` and `server/src/test/unit/contacts/ContactDetailsPhoneNumbers.contract.test.ts` verify the contact detail screens bind `phone_numbers` into the shared editor, validate before save, and render normalized rows instead of scalar `phone_number`.
  - `server/src/test/unit/contacts/QuickAddContact.phoneNumbers.test.tsx` and `server/src/test/unit/contacts/QuickAddClient.phoneNumbers.test.tsx` verify the quick-add flows submit normalized phone collections with the expected default row.
  - `server/src/test/unit/contacts/ContactPhoneDisplay.contract.test.ts` verifies contacts lists and ticket properties derive their displayed contact phone from `default_phone_number` or the default normalized child row.
- (2026-03-09) Completed `F017` with DB-backed coverage in `server/src/test/integration/contactServicePhoneSearch.integration.test.ts`.
  - `server/src/lib/api/services/ContactService.ts` now searches contact phone matches through any normalized child phone row, including non-default rows, and sorts `phone_number` list views by the derived default row.
  - `packages/clients/src/actions/queryActions.ts` keeps client-side list sorting aligned with the same derived-default-phone rule after hydrated contacts are returned.
- (2026-03-09) Completed `T024` and `T025` with `server/src/test/integration/contactServicePhoneSearch.integration.test.ts`.
  - The integration suite verifies `ContactService.search()` returns a contact when only a secondary phone row matches the query digits.
  - The integration suite verifies `ContactService.list()` sorts by `default_phone_number` rather than a non-default child phone row.
- (2026-03-09) Completed `F019` and `F020` by finishing the CSV import/export cutover for the normalized phone model.
  - `packages/clients/src/actions/contact-actions/contactActions.tsx` now maps CSV `phone_number` values into one default canonical `work` phone row on import, exports the derived default phone value, and normalizes optional CSV text fields so omitted `role`/`notes` values do not fail contact validation.
  - `packages/clients/src/components/contacts/ContactsImportDialog.tsx` now labels the CSV phone column as the default phone number and explicitly tells users that v1 CSV import/export handles one default phone per contact.
- (2026-03-09) Completed `T027`, `T028`, and `T029` with `server/src/test/integration/contactCsvPhoneImportExport.integration.test.ts`.
  - The integration suite verifies importing one CSV phone column creates one default normalized `work` phone row.
  - The integration suite verifies contact CSV export emits the derived default phone instead of depending on a legacy scalar field.
  - The same suite contract-checks the import dialog copy for the single-default-phone CSV rule.
- (2026-03-09) Completed `F022` by mapping Entra contact phones into normalized contact phone rows.
  - `ee/server/src/lib/integrations/entra/sync/contactFieldSync.ts` now builds `phone_numbers` collections from `businessPhones[]` and `mobilePhone` instead of returning a scalar `phone_number` patch.
  - `ee/server/src/lib/integrations/entra/sync/contactReconciler.ts` now creates Entra contacts with `phone_numbers` and routes linked-contact phone updates through `ContactModel.updateContact(...)` inside the same transaction rather than trying to update child rows via the raw `contacts` table.
- (2026-03-09) Completed `T033` and `T034` with `ee/server/src/__tests__/unit/entraContactFieldSync.test.ts` and `ee/server/src/__tests__/unit/entraContactReconciler.test.ts`.
  - The Entra field-sync tests verify `mobilePhone` becomes canonical `mobile`, `businessPhones[]` become canonical `work`, and the first business phone wins default precedence over mobile.
  - The Entra reconciler tests verify the create path passes normalized `phone_numbers` into `ContactModel.createContact(...)` and linked-contact phone sync uses `ContactModel.updateContact(...)` with the same normalized mapping.
- (2026-03-09) Completed `F023` by updating contact-facing seeds, factories, and E2E helpers to create normalized phone rows.
  - `server/seeds/dev/05_contacts.cjs` now inserts contacts without the legacy scalar field and seeds one default `contact_phone_numbers` row per contact.
  - `server/src/test/e2e/factories/contact.factory.ts` and `server/src/test/e2e/utils/contactTestDataFactory.ts` now create contacts through `ContactModel.createContact(...)`, which leaves `contacts.phone_number` empty while writing normalized child rows.
  - `server/src/test/e2e/api/contacts.e2e.test.ts` and `server/src/test/e2e/utils/clientTestData.ts` now use the normalized `phone_numbers` shape instead of scalar contact phones in their generated contact payloads.
- (2026-03-09) Completed `T035` with `server/src/test/integration/contactTestHelpersPhoneRows.integration.test.ts`.
  - The integration suite verifies the E2E contact factory and contact test data helper leave `contacts.phone_number` null while creating default `contact_phone_numbers` rows.
  - The same suite contract-checks the dev contacts seed for normalized default phone inserts.
- (2026-03-09) Completed `F024` by removing the remaining application-level reads and writes of `contacts.phone_number`.
  - `shared/ticketClients/contacts.ts`, `shared/services/emailService.ts`, and `shared/workflow/actions/emailWorkflowActions.ts` now hydrate contact phones through `ContactModel` and derive the default phone from normalized child rows instead of selecting the legacy scalar field.
  - `packages/integrations/src/actions/clientLookupActions.ts`, `packages/integrations/src/actions/email-actions/emailActions.ts`, `packages/ui/src/components/ContactPickerDialog.tsx`, `server/src/lib/api/services/TicketService.ts`, and `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` now read or display the default contact phone from `contact_phone_numbers`.
  - `packages/clients/src/actions/contact-actions/contactActions.tsx` no longer falls back to writing scalar `phone_number` values in the main contact create/update flows after the normalized model cutover.
- (2026-03-09) Completed `T036` with `server/src/test/integration/contactPhoneColumnCutover.integration.test.ts`.
  - The DB-backed suite drops `contacts.phone_number` against the live test schema and verifies `ContactService.create(...)`, `update(...)`, and `getById(...)` continue to work through normalized phone rows only.
- (2026-03-09) Completed `F006` with `server/migrations/20260309183000_drop_contacts_phone_number_column.cjs`.
  - Migration B now drops `contacts.phone_number` once the app no longer depends on it, and restores the column on rollback so the rollout remains reversible.
- (2026-03-09) Completed `T037` with `server/src/test/integration/contactPhoneColumnCutover.integration.test.ts` and `server/src/test/unit/migrations/contactPhoneNumbersCutoverMigration.test.ts`.
  - The migration contract test asserts the new migration explicitly drops and restores `contacts.phone_number`.
  - The integration coverage verifies contact create/update/read flows still pass after applying Migration B and before rolling it back.
