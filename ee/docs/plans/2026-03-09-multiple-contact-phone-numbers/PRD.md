# PRD — Multiple Contact Phone Numbers

- Slug: `multiple-contact-phone-numbers`
- Date: `2026-03-09`
- Status: Draft

## Summary

Replace the single `contacts.phone_number` field with a normalized multi-number model that supports one or more phone numbers per contact, fixed canonical types, tenant-scoped custom type suggestions, and an explicit default number. Update the contact creation/editing/import flows and the main dependent GUI surfaces so the new model is first-class everywhere the current scalar phone number is shown or edited.

## Problem

Contacts currently expose only one scalar `phone_number`, which is too limited for real-world usage. MSP users need to store multiple numbers per client contact, distinguish those numbers by type, and choose which number should be treated as the default. The current shape also makes integrations like Entra sync lossy because multiple external phone values are collapsed into one field.

## Goals

- Support multiple phone numbers on a contact with an explicit default number.
- Keep a small canonical type set: `work`, `mobile`, `home`, `fax`, `other`.
- Support tenant-scoped custom phone type labels with autocomplete/deduplication behavior similar to tags.
- Replace all contact-domain create/edit/read code paths so they work against the normalized model instead of `contacts.phone_number`.
- Update the key GUI surfaces that display or edit contact phone numbers.
- Preserve practical list/search behavior by defining a default-phone display rule and searchable normalized phone values.
- Map Entra mobile/business phones into the new contact phone model instead of discarding extra values.

## Non-goals

- Refactoring client company phone fields, client location phone fields, tenant support phone fields, or portal profile phone fields in this plan.
- Introducing an admin-managed settings UI for custom phone type definitions.
- Shipping a long-lived compatibility layer that keeps `contacts.phone_number` as an application field after the cutover.
- Designing a generalized reusable multi-phone component for every entity in the product; this plan only requires the contact-domain surfaces.
- Adding metrics, feature flags, or operational rollout tooling beyond normal migration sequencing and validation.

## Users and Primary Flows

### Primary users

- MSP staff managing contacts in the contact directory or client detail screens.
- MSP staff creating contacts quickly from the contacts area or while creating a client.
- MSP staff viewing a contact phone from ticket and related-detail screens.
- Admins/operators relying on contact import and Entra synchronization.

### Primary flows

1. Open a contact in the contacts area, add multiple phone numbers, assign canonical or custom types, and choose exactly one default.
2. Create a new contact from quick-add and enter one or more phone numbers before save.
3. Create a client with an inline primary contact and capture multiple phone numbers for that new contact.
4. View contacts in list/table form and see the default phone number rendered consistently.
5. Search contacts by any stored phone number, not just the default one.
6. Import contacts from CSV with one primary/default phone number in v1, then manage additional numbers in the UI after import.
7. Sync a contact from Entra and retain both mobile and business phone values where present.

## UX / UI Notes

### Contact authoring/editing surfaces in scope

- `packages/clients/src/components/contacts/ContactDetails.tsx`
- `packages/clients/src/components/contacts/ContactDetailsEdit.tsx`
- `packages/clients/src/components/contacts/ContactDetailsView.tsx`
- `packages/clients/src/components/contacts/QuickAddContact.tsx`
- `packages/clients/src/components/clients/QuickAddClient.tsx` (inline contact subsection)

### Contact display surfaces in scope

- `packages/clients/src/components/contacts/Contacts.tsx`
- `packages/clients/src/components/contacts/ClientContactsList.tsx`
- `packages/tickets/src/components/ticket/TicketProperties.tsx`
- `packages/clients/src/components/interactions/InteractionDetails.tsx` via `ContactDetailsView`

### Contact import surfaces in scope

- `packages/clients/src/components/contacts/ContactsImportDialog.tsx`
- Export/query behavior in `packages/clients/src/actions/contact-actions/contactActions.tsx`

### UX assumptions

- Contact forms should use a repeater/list UI for phone numbers with add/remove controls.
- Each phone row should let the user:
  - enter a phone number
  - pick a canonical type or choose/create a custom type
  - mark the row as default
- When numbers exist, the form must enforce exactly one default.
- List/table/detail surfaces that previously showed one `phone_number` should render the default phone number only.
- Where useful, the default phone label/type may be shown as a badge or secondary text, but v1 does not require a redesign of list layouts.
- CSV import/export remains intentionally simpler than the full UI:
  - v1 import/export handles one default phone number and its type
  - multi-number bulk CSV shape is out of scope for this first cut

## Requirements

### Functional Requirements

- `FR-001` Add a normalized contact phone storage model that supports multiple phone rows per contact.
- `FR-002` Add a tenant-scoped custom phone type definition store for suggestion/deduplication of custom labels.
- `FR-003` Keep canonical phone types fixed to `work`, `mobile`, `home`, `fax`, and `other`.
- `FR-004` Require at most one default phone number per contact and exactly one default when a contact has at least one phone number.
- `FR-005` Preserve display order for multiple phone numbers.
- `FR-006` Store a searchable normalized phone value per phone row in addition to the displayed phone string.
- `FR-007` Backfill existing `contacts.phone_number` values into the new normalized phone table as default `work` numbers unless empty.
- `FR-008` Replace contact create and update contracts so they accept the new phone collection instead of the old scalar field.
- `FR-009` Replace contact read contracts so callers receive ordered phone rows and can derive the default number without reading `contacts.phone_number`.
- `FR-010` Update contact validation so phone collection writes validate number format, type shape, default uniqueness, and custom type deduplication.
- `FR-011` Update `ContactDetails` to edit multiple phone numbers, custom types, and default selection.
- `FR-012` Update `ContactDetailsEdit` and `ContactDetailsView` to render the normalized contact phone model.
- `FR-013` Update `QuickAddContact` to capture the normalized contact phone model.
- `FR-014` Update the inline contact section in `QuickAddClient` to capture the normalized contact phone model.
- `FR-015` Update contacts list surfaces to display the default phone number in place of the old scalar phone.
- `FR-016` Update contact search/filter behavior so phone search matches any stored contact phone number.
- `FR-017` Update contact list sort behavior so phone sorting is based on the derived default phone number.
- `FR-018` Update ticket/contact-related display surfaces to show the derived default contact phone number.
- `FR-019` Update contact CSV import/export behavior to map a single imported/exported phone into the normalized model as the default number.
- `FR-020` Update workflow/domain event payloads and API/service schemas that currently emit or validate `phone_number`.
- `FR-021` Update Entra sync so mobile and business phones are mapped into the normalized contact phone model instead of collapsing to one scalar.
- `FR-022` Remove application reliance on `contacts.phone_number` after the new model is in use.
- `FR-023` Drop the legacy `contacts.phone_number` column in a follow-up migration after code has cut over.

### Non-functional Requirements

- `NFR-001` Migration sequencing must be operationally safe: add/backfill new tables before the code release that stops reading `contacts.phone_number`, then drop the old column afterward.
- `NFR-002` Contact writes touching phone numbers must remain transactional so child rows and the parent contact cannot drift.
- `NFR-003` Existing contacts with no phone number must remain valid and should simply hydrate with an empty phone list.
- `NFR-004` Custom phone type deduplication must be case-insensitive at the tenant scope.
- `NFR-005` Searchability of phone numbers must not depend on formatting characters in the stored display value.

## Data / API / Integrations

### Proposed tables

`contact_phone_type_definitions`
- `tenant`
- `contact_phone_type_id`
- `label`
- `normalized_label`
- `created_at`
- `updated_at`
- unique on `(tenant, normalized_label)`

`contact_phone_numbers`
- `tenant`
- `contact_phone_number_id`
- `contact_name_id`
- `phone_number`
- `normalized_phone_number`
- `canonical_type` nullable
- `custom_phone_type_id` nullable
- `is_default`
- `display_order`
- `created_at`
- `updated_at`

### Table constraints

- Exactly one of `canonical_type` or `custom_phone_type_id` must be present.
- `canonical_type` is constrained to `work | mobile | home | fax | other`.
- Foreign key from `contact_phone_numbers` to `contacts`.
- Foreign key from `contact_phone_numbers` to `contact_phone_type_definitions` when custom type is used.
- Partial uniqueness for one default per contact.

### Type/API shape

- Replace scalar `phone_number` on contact DTOs with a `phone_numbers` collection.
- Each phone row should expose:
  - `contact_phone_number_id`
  - `phone_number`
  - `normalized_phone_number`
  - `canonical_type`
  - `custom_type`
  - `is_default`
  - `display_order`
- Contact list/query responses may additionally expose a derived `default_phone_number` and `default_phone_type` for convenience.

### Import/export shape

- CSV import v1 continues to accept one phone column and maps it to a single default `work` phone unless a type column is added in the same effort.
- CSV export v1 emits the default phone number only.

### Entra mapping assumption

- `mobilePhone` maps to canonical `mobile`.
- `businessPhones[]` map to canonical `work`.
- If one or more business phones exist, the first business phone is the default.
- Otherwise the first mobile phone becomes the default.

## Security / Permissions

- No new permission model is introduced.
- Existing contact create/update/read permissions continue to govern all affected flows.
- Custom phone type creation is implicit within existing contact edit/create permissions; no separate admin permission is added.

## Observability

- No new observability scope is included in v1 beyond normal migration logging, validation errors, and test coverage.

## Rollout / Migration

1. Migration A:
   - create `contact_phone_type_definitions`
   - create `contact_phone_numbers`
   - backfill existing `contacts.phone_number` into `contact_phone_numbers`
   - keep `contacts.phone_number` in place temporarily for deploy safety
2. Code release:
   - move all contact-domain reads/writes/UI to `phone_numbers`
   - stop reading or writing `contacts.phone_number`
3. Migration B:
   - drop `contacts.phone_number`
   - remove any remaining schema/index references to the old scalar field

This is still a breaking cutover at the application contract level, but the database rollout is intentionally split to avoid coupling schema removal to the same deploy that introduces the new readers/writers.

## Open Questions

- Whether v1 CSV import/export should add an explicit phone-type column or stay with default `work` only.
- Whether contact list/table responses should expose derived `default_phone_number` fields from the server for convenience or let each caller derive them from `phone_numbers`.
- Whether the first version of the phone-number editor should be a contact-only local component or a reusable shared UI component.

## Acceptance Criteria (Definition of Done)

- MSP users can add, remove, type, reorder, and default multiple phone numbers on a contact.
- MSP users can choose canonical phone types or enter a new custom type that becomes a tenant-scoped suggestion for future contacts.
- Contact detail, quick-add, and inline client-contact creation flows all work against the new model.
- Contact list and ticket display surfaces render the derived default phone consistently.
- Contact search finds a contact by any stored phone number.
- Existing scalar phone values are migrated into the normalized model.
- Entra sync preserves both mobile and business phone information in the normalized contact phone model.
- The application no longer relies on `contacts.phone_number`, and the legacy column can be removed cleanly.
