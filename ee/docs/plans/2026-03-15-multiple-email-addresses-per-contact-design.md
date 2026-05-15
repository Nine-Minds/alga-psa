# Design — Multiple Email Addresses Per Contact

- Date: `2026-03-15`
- Status: `Approved`

## Summary

Adopt a hybrid contact-email model that preserves `contacts.email` as the required authoritative default email while adding labeled non-default email rows in a child table. This keeps the current default-email behavior intact for a large part of the application and narrows the true change surface to contact editing, cross-location uniqueness, additional-email lookup, and inbound/workflow semantics.

## Decisions

- Email addresses remain unique per tenant across both the primary email column and the additional-email table.
- `contacts.email` remains required and authoritative.
- The primary/default email gets a label.
- Additional emails are non-default only.
- Changing the default email is implemented as a swap:
  - selected additional email moves into `contacts.email`
  - previous `contacts.email` moves into the additional-email table
  - label metadata swaps with it
- Canonical email labels are `work`, `personal`, `billing`, and `other`.
- Existing default-email consumers should keep using `contacts.email` wherever possible.
- Inbound sender matching must work across both primary and additional emails and preserve the matched sender separately when it differs from `contacts.email`.

## Proposed Model

Primary/default email remains on `contacts`:

- `email`
- primary-email label metadata

Additional emails live in a child table:

- `contact_additional_email_address_id`
- `email_address`
- `normalized_email_address`
- label metadata
- `display_order`

Custom labels are tenant-scoped and shared between the primary email and the additional-email rows.

## UI Shape

Use a shared `ContactEmailAddressesEditor` with:

- a pinned primary/default row
- additional rows underneath
- canonical label dropdown plus custom labels
- promote-to-default action that performs the swap
- no direct delete for the primary row

Detail screens show the primary/default email distinctly and list additional emails below it. List and picker surfaces continue showing `contacts.email` as the default summary.

## What Still Changes

1. Contact schema, migrations, validation, hydration, and swap behavior
2. Contact create/edit/detail/import/export UI
3. Search and lookup paths that must match additional emails
4. Inbound email matching and workflow contact lookup behavior
5. REST, n8n, and integration contracts that need to expose or parse additional emails

## What Simplifies

1. Most outbound email sends can keep using `contacts.email`
2. Portal/auth/client-user flows can keep using `contacts.email`
3. Ticket and comment summary payloads can keep using scalar email summaries
4. Billing/survey/project notification paths mostly stay anchored on `contacts.email`

## Risks

- Cross-location uniqueness must be enforced reliably between the primary email column and the child table.
- Default-swap behavior must be transactional.
- Email-keyed snapshot recipients such as watchers should remain intentionally snapshot-based unless a later product decision says otherwise.
- CSV/API/integration contracts still need coordinated updates even though the core default-email compatibility is preserved.

## Acceptance Shape

The feature is complete when:

- Contacts can keep a labeled primary email and optional labeled additional emails.
- Promoting an additional email to default swaps it into `contacts.email`.
- Any stored email address can resolve a contact uniquely within a tenant.
- Existing default-email consumers continue to work from `contacts.email`.
- Contracts that need the richer model can read and write primary-email labels plus additional-email rows.
