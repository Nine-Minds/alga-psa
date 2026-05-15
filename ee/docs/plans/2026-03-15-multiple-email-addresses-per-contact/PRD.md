# PRD — Multiple Email Addresses Per Contact

- Slug: `2026-03-15-multiple-email-addresses-per-contact`
- Date: `2026-03-15`
- Status: `Draft`

## Summary

Allow contacts to keep a required primary email on `contacts.email`, add labeled additional email addresses in a child table, and let users promote an additional email to default by swapping it into `contacts.email`. The design preserves compatibility for the large set of existing application surfaces that already treat `contacts.email` as the canonical default email while still enabling inbound matching and search across multiple stored addresses.

## Problem

The current contact model allows only one email address, which is too restrictive for real customer records. A single contact may need work, personal, and billing addresses, but duplicating contacts to represent those variants causes inbound-email ambiguity and data quality issues.

At the same time, a full normalization of contact email would force contract changes across a large part of the product because many existing surfaces already read `contacts.email` as the default send/login/summary address. A safer design should add support for more addresses without breaking those default-email consumers.

## Goals

1. Let a contact store multiple labeled email addresses.
2. Keep `contacts.email` as the required authoritative default email.
3. Let users change the default by swapping an additional email into `contacts.email`.
4. Support canonical labels plus tenant-scoped custom labels using the same general model as contact phone labels.
5. Enforce tenant-wide uniqueness across both primary and additional contact emails.
6. Match inbound email and contact lookups by either the primary or an additional email address.
7. Preserve compatibility for existing outbound, portal, auth, and summary consumers that already use `contacts.email`.

## Non-goals

- Replacing `contacts.email` with a fully normalized email collection in this effort.
- Making `contacts.email` nullable.
- Allowing a contact to have no primary/default email.
- Treating additional emails as independent login aliases for portal or client-user auth.
- Rewriting every `contacts.email` consumer to a new default-email field when existing behavior can remain unchanged.
- Re-keying existing email-snapshot recipient records unless the surface explicitly re-resolves the contact from user input.

## Users and Primary Flows

**Primary users**
- Service desk agents managing contacts
- Operators handling inbound email and ticketing
- Staff sending notifications, invoices, surveys, and portal invitations
- Automation and integration flows that create or resolve contacts by email

### Flow A — Manage Contact Emails
1. User opens contact create or edit.
2. User edits the primary email row, including its label.
3. User adds, labels, reorders, or deletes additional email rows.
4. User promotes an additional email to default.
5. The system swaps the promoted row into `contacts.email` and moves the previous primary email into the additional-email table.

### Flow B — Match Inbound Email
1. An inbound message arrives from a sender address.
2. The system normalizes the sender address and searches both `contacts.email` and additional email rows.
3. The system resolves the owning contact uniquely.
4. Ticket/comment authorship preserves the matched sender address.
5. Any default outbound contact send still uses `contacts.email`.

### Flow C — Existing Default-Email Sends
1. A workflow or product surface needs to email a contact.
2. The surface reads `contacts.email`.
3. The send path continues to work without needing a new derived default-email field.
4. If the default was changed earlier, the promoted address is already present in `contacts.email`.

## UX / UI Notes

- Use a shared `ContactEmailAddressesEditor` modeled on the phone-number editor.
- The editor should render a pinned primary/default row plus a list of additional rows.
- Canonical labels: `work`, `personal`, `billing`, `other`.
- Custom labels must support freeform entry and tenant-scoped suggestions.
- Users cannot delete the primary email row directly.
- To change default, users promote an additional email, which swaps it with the current primary row.
- Detail views show the primary/default email distinctly, with additional emails listed underneath.
- List screens, pickers, and summary cards continue showing `contacts.email` as the default summary address.

## Functional Requirements

### Data Model and Validation

**FR-01**: `contacts.email` remains required and is the authoritative default contact email.

**FR-02**: The primary contact email stored on `contacts` gains label metadata.

**FR-03**: Non-default contact emails are stored as an ordered child collection separate from `contacts.email`.

**FR-04**: Canonical email labels are `work`, `personal`, `billing`, and `other`, and custom labels are tenant-scoped and reusable across primary and additional emails.

**FR-05**: Every normalized email address is unique per tenant across both `contacts.email` and additional email rows.

**FR-06**: Promoting an additional email to default swaps both the email value and its label metadata with the current `contacts.email` values.

**FR-07**: A contact can never lose its primary/default email; deleting the current default directly is disallowed.

**FR-08**: Existing contacts migrate without changing their current `contacts.email` values and gain safe initial primary-email label metadata.

### Contact CRUD and Discovery

**FR-09**: Contact create/edit screens support editing the primary email label plus adding, removing, reordering, and promoting additional email rows.

**FR-10**: Contact detail views display the primary/default email distinctly and list all additional emails with labels.

**FR-11**: Contact list, picker, and summary views continue to display `contacts.email` as the visible default email.

**FR-12**: Contact search, filter, import, and export by email must be able to match both primary and additional email addresses.

### Inbound Email and Workflow Lookups

**FR-13**: Inbound email sender matching resolves contacts by either the primary or an additional stored email address.

**FR-14**: Inbound and workflow contexts preserve the matched sender email separately when it differs from `contacts.email`.

**FR-15**: Shared contact lookup and create-or-find helpers search both storage locations while creating new contacts with the primary email stored in `contacts.email`.

**FR-16**: Workflow/domain-event/full-contact contracts expose primary-email label metadata and additional email rows where a full contact shape is needed, while summary email fields continue to use `contacts.email`.

### Compatibility and Integrations

**FR-17**: Existing outbound notifications, portal/auth flows, client-user linking, billing sends, and similar default-email consumers continue to use `contacts.email` without needing a new default-email field.

**FR-18**: Existing email-keyed watcher and recipient snapshot behavior remains compatible unless a surface explicitly re-resolves a contact from user-supplied email input.

**FR-19**: REST, n8n, CSV, and integration contracts add support for primary-email labels and additional email rows without removing scalar `email`.

**FR-20**: Automated coverage includes DB-backed uniqueness, swap, and lookup tests plus compatibility regressions for major `contacts.email` consumers.

## Non-functional Requirements

- Keep the email-label editor behavior aligned with the existing phone-number label model where practical.
- Favor compatibility by preserving `contacts.email` as the authoritative default field.
- Avoid ambiguous contact resolution by enforcing tenant-wide uniqueness across both storage locations.
- Keep the migration safe and reversible by preserving existing primary email values and layering additional-email support around them.

## Data / API / Integrations

### Proposed Shape

Primary/default email remains on `contacts`:

- `email`
- primary email label metadata fields

Additional emails live in a child table:

- `contact_additional_email_address_id`
- `email_address`
- `normalized_email_address`
- label metadata
- `display_order`

### API Direction

- Keep `email` in create/update/read contracts as the primary/default email.
- Add primary-email label fields to create/update/read contracts.
- Add `additional_email_addresses` to create/update/read contracts.
- Keep response summary email fields sourced from `contacts.email`.

### Workflow Direction

- `findContactByEmail` and related lookup helpers must search both `contacts.email` and additional email rows.
- Workflow contexts that care about inbound authorship should preserve:
  - matched sender email
  - primary/default contact email from `contacts.email`

## Risks and Migration Notes

- The main schema risk is cross-location uniqueness: the system must prevent duplicates between `contacts.email` and the additional-email table in both directions.
- Default-swap behavior must be transactional so the primary and additional rows cannot drift.
- CSV/import/export and API contracts still need real updates, even with the safer compatibility model.
- Some recipient stores, such as watcher-like email snapshots, may intentionally remain email-keyed rather than dynamically following future contact default swaps.
- Existing tests and fixtures that only know about scalar email will still need widespread updates to cover primary labels and additional emails.

## Acceptance Criteria / Definition Of Done

1. Contacts can keep a labeled primary/default email and add labeled additional emails.
2. Users can promote an additional email to default, and the system swaps it into `contacts.email`.
3. Tenant-wide uniqueness is enforced across both primary and additional contact emails.
4. Inbound email processing and lookup helpers can resolve a contact by any stored email address.
5. Existing default-email consumers continue to operate against `contacts.email`.
6. REST/API, CSV, n8n, and integration contracts support the hybrid model.
7. Automated coverage proves swap behavior, uniqueness, inbound lookup, and compatibility for key `contacts.email` consumers.
