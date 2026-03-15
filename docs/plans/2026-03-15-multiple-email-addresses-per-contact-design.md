# Design — Multiple Email Addresses Per Contact

- Date: `2026-03-15`
- Status: `Approved`

## Summary

Replace the scalar contact email model with a normalized multi-email model that mirrors the existing multi-phone implementation. Contacts will own an ordered collection of email rows with one required default row when any email exists. Each row supports a canonical label or a tenant-scoped custom label. All contact lookup, inbound email matching, and outbound contact-email sending must move to this model in one pass.

## Decisions

- Email addresses remain unique per tenant across all contacts.
- This is a full cut-over in one pass, not a compatibility rollout.
- There will be no persistent scalar `contacts.email` database column after migration.
- Portal/login/invitation behavior automatically follows the contact's current default email.
- Canonical email labels are `work`, `personal`, `billing`, and `other`.
- Outbound sends to a contact use the default email address.
- Inbound sender matching works against any stored contact email address, but the matched sender address and the contact's default outbound address are distinct concepts.

## Proposed Model

Use the same architecture already in place for `contact_phone_numbers`:

- `email_addresses[]` is the source of truth.
- `default_email_address` and `default_email_type` are derived read-model fields.
- Each row stores:
  - `contact_email_address_id`
  - `email_address`
  - `normalized_email_address`
  - `canonical_type`
  - `custom_email_type_id`
  - `custom_type`
  - `is_default`
  - `display_order`
- Custom labels are resolved through a tenant-scoped definitions table, analogous to phone labels.
- Validation requires exactly one default row whenever a contact has one or more email rows.

## UI Shape

Use a shared `ContactEmailAddressesEditor` modeled directly on `ContactPhoneNumbersEditor`:

- Row-based editor with add/remove/reorder controls.
- Default selection via radio.
- Canonical label dropdown plus `custom`.
- Custom label input backed by existing tenant suggestions and freeform entry.
- Row compaction and validation before save.
- Contact detail pages show every row with label + default badge.
- Contact lists and pickers show the derived default email.

## Impacted Areas

1. Contact data model and migrations
2. Contact create/edit/detail/list UI
3. Contact search and picker infrastructure
4. Inbound email matching and ticket context resolution
5. Outbound ticket/project/survey/billing/contact email sends
6. Portal invitation, recovery, and registration flows
7. Workflow runtime schemas and actions
8. Public API and integration contracts, including n8n

## Risks

- The full cut-over touches many surfaces that currently assume scalar `contact.email`.
- Watch-list and locale-deduping behavior is email-keyed and must preserve stable semantics once a contact owns multiple addresses.
- Portal and auth flows need a crisp rule for "contact default email drives login-facing behavior" to avoid drift.
- Inbound email behavior must preserve exact-match sender attribution while allowing outbound follow-up to use the default email.

## Acceptance Shape

The feature is complete when:

- Contacts can own multiple labeled email addresses with one default.
- Any stored email address can resolve a contact uniquely within a tenant.
- All outbound contact email sends target the default email.
- All UI/API/runtime contracts have been updated off scalar contact email.
- Existing contact records migrate cleanly into one default email row per current email value.
