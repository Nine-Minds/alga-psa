# PRD — Multiple Email Addresses Per Contact

- Slug: `2026-03-15-multiple-email-addresses-per-contact`
- Date: `2026-03-15`
- Status: `Draft`

## Summary

Allow contacts to store multiple email addresses, each with a label and a single default. Match inbound email against any stored address, send outbound contact email to the default address, and remove the scalar contact email model in one coordinated migration.

## Problem

The current contact model allows only one email address. That is too restrictive for real customer records, where a single contact may have separate work, personal, and billing addresses. The scalar model also leaks into many unrelated areas: inbound email matching, portal invitations, ticket notifications, workflow actions, pickers, integrations, and APIs. As a result, the application cannot represent real-world contact communication preferences without either overwriting information or creating duplicate contacts.

## Goals

1. Let a contact store multiple email addresses with one default address.
2. Support canonical labels plus tenant-scoped custom labels using the same model as contact phone labels.
3. Preserve tenant-wide uniqueness for every stored email address.
4. Match inbound email against any stored contact email address.
5. Send outbound contact email to the contact's default email address.
6. Remove the scalar `contacts.email` database model and update all contracts in one pass.

## Non-goals

- Supporting duplicate contact email addresses within a tenant.
- Multi-email support for internal users in this effort.
- Compatibility rollout with long-lived scalar `contact.email` persistence in the database.
- Advanced email preference rules beyond one default email address.
- Shared-contact or shared-mailbox fan-out semantics for watch lists or notifications beyond existing email-based behavior.

## Users and Primary Flows

**Primary users**
- Service desk agents managing contacts
- Operators handling inbound email and ticketing
- Staff sending notifications, surveys, invoices, and portal invitations
- Automation/integration flows creating or resolving contacts

### Flow A — Manage Contact Emails
1. User opens contact create or edit.
2. User adds one or more email rows.
3. User assigns canonical or custom labels.
4. User chooses exactly one default row.
5. The system validates uniqueness, label correctness, and default selection before save.

### Flow B — Match Inbound Email
1. An inbound message arrives from a sender address.
2. The system normalizes the sender address and looks up any matching contact email row.
3. The system resolves the owning contact uniquely.
4. Ticket/comment authorship uses the matched sender address.
5. Any follow-up outbound contact send uses that contact's default email.

### Flow C — Send Outbound Contact Email
1. A workflow or product surface needs to email a contact.
2. The system resolves the contact's default email address.
3. The send path uses that address consistently.
4. If the contact has no default email because it has no email rows, the existing surface-specific validation/error behavior applies.

### Flow D — Portal / Client User Invitation
1. A portal invitation or registration flow targets a contact.
2. The system uses the contact's current default email as the canonical invitation/login address.
3. If the default email changes later, future contact-driven invite/login operations use the new default.

## UX / UI Notes

- Use a shared `ContactEmailAddressesEditor` modeled directly on `ContactPhoneNumbersEditor`.
- Canonical labels: `work`, `personal`, `billing`, `other`, plus `custom`.
- Custom labels must support freeform entry and tenant-scoped suggestions.
- If a custom label is no longer used anywhere in the tenant, it should be eligible for cleanup, like phone labels.
- Detail screens show all email rows and mark the default.
- List screens, pickers, and summary cards show the derived default email.
- Validation should mirror the phone editor pattern: row-level errors, duplicate custom-label checks, and exactly-one-default enforcement.

## Functional Requirements

### Data Model and Validation

**FR-01**: Contacts store email addresses as a normalized child collection, not as a scalar database column.

**FR-02**: Each email row includes address, normalized address, label metadata, default flag, and display order.

**FR-03**: Canonical email labels are `work`, `personal`, `billing`, and `other`.

**FR-04**: Custom email labels are tenant-scoped, normalized for dedupe, and reusable across contacts.

**FR-05**: A contact with one or more email rows must have exactly one default email row.

**FR-06**: Every normalized email address is unique per tenant across all contacts.

**FR-07**: Existing contacts migrate to one default email row seeded from the previous scalar email value.

### Contact CRUD and UI

**FR-08**: Contact create/edit screens support adding, removing, reordering, and defaulting multiple email rows.

**FR-09**: Contact detail views display all email rows with label and default indication.

**FR-10**: Contact list, picker, and summary views display the derived default email.

**FR-11**: Contact search by email matches any stored email row.

### Inbound and Workflow Behavior

**FR-12**: Inbound email sender matching resolves contacts by any stored email address.

**FR-13**: Inbound processing preserves the matched sender address separately from the contact's default email.

**FR-14**: Workflow/runtime contact lookup actions resolve contacts by any stored email address.

**FR-15**: Workflow/runtime contact payloads expose multi-email data plus derived default email information.

### Outbound Email Behavior

**FR-16**: Ticket notifications to requester contacts send to the contact's default email.

**FR-17**: Project notifications, surveys, invoices, portal invitations, and other contact-addressed sends use the contact's default email.

**FR-18**: Surfaces that require a contact email continue to fail explicitly when the contact has no email rows.

### Portal, Auth, API, and Integrations

**FR-19**: Portal invitation and contact-driven registration flows use the contact's default email automatically.

**FR-20**: Public/API schemas remove scalar contact email write contracts and replace them with multi-email contracts.

**FR-21**: n8n and integration helpers support the new multi-email contact contract in the same release.

**FR-22**: Any contract that still needs a summary email in responses uses the derived default email from the multi-email model, not a stored scalar column.

## Non-functional Requirements

- Keep validation and editor behavior aligned with the existing phone-number implementation to minimize UX divergence.
- Avoid ambiguous lookup behavior by enforcing tenant-wide uniqueness on every email row.
- Preserve stable behavior for existing email-driven workflows after migration.
- Update test coverage across database, UI, API, workflow, and notification layers in the same effort.

## Data / API / Integrations

### Proposed Contact Email Row Shape

Each email row should follow the phone-row pattern:

- `contact_email_address_id`
- `email_address`
- `normalized_email_address`
- `canonical_type`
- `custom_email_type_id`
- `custom_type`
- `is_default`
- `display_order`

### API Direction

- Remove scalar contact email as a write field.
- Add `email_addresses` to create/update contracts.
- Return `email_addresses`, `default_email_address`, and `default_email_type` in contact read contracts.
- Update any legacy summary response fields to be derived from the default email if still needed by response consumers.

### Workflow Direction

- `findContactByEmail` and related actions must search child email rows.
- Inbound workflow context should expose both:
  - matched sender email
  - resolved contact default email

## Risks and Migration Notes

- This is a broad one-pass contract break and will require coordinated updates across UI, shared runtime code, APIs, and integrations.
- Portal and auth behavior becomes explicitly tied to the current default contact email; changing the default changes future invitation/login targeting.
- Watch-list and recipient-dedupe behavior is still email-keyed and must be audited so contact selection keeps predictable outcomes.
- Existing tests and fixtures that build contacts with scalar `email` will need widespread updates.

## Acceptance Criteria / Definition Of Done

1. Contacts can create, edit, view, and save multiple labeled email addresses with one default.
2. Tenant-wide uniqueness is enforced on every stored email address.
3. Inbound email processing can resolve a contact by any stored email address.
4. Outbound contact-targeted sends use the resolved default email.
5. Portal, auth-adjacent contact flows, API schemas, workflow actions, and integrations are updated to the multi-email model.
6. Existing contact data migrates successfully off the scalar email column.
7. Automated coverage includes DB-backed migration/model tests plus representative UI, workflow, notification, and API tests.
