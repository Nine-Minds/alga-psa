# AlgaPSA Deletion Rules

How client and contact deletion works in AlgaPSA.

> **Source of truth:** the blocker lists below are declared in
> [`packages/core/src/config/deletion/index.ts`](../packages/core/src/config/deletion/index.ts)
> (`DELETION_CONFIGS`) and enforced by `deleteEntityWithValidation` in
> [`packages/core/src/server/deletion/deletionActions.ts`](../packages/core/src/server/deletion/deletionActions.ts).
> Cascade lists come from `deleteClient` / `deleteContact` in
> `packages/clients/src/actions/`. If you change either, update this file — it is
> prose, not generated, and it has drifted before.

## How a deletion is evaluated

1. The caller's `client:delete` / `contact:delete` permission is checked.
2. `validateDeletion` counts every configured dependency inside one transaction.
3. Any non-zero count blocks the delete and is returned to the UI as a named
   dependency (with a link to the blocking records where a `viewUrlTemplate` exists).
4. If nothing blocks, the cascade runs and the entity row is deleted — same transaction.

Both entities support **deactivation** (`supportsInactive: true`). Neither supports archiving.

## Client deletion

### Blocked by any of these

| Dependency | Table |
|---|---|
| Contacts | `contacts` |
| Tickets (including closed) | `tickets` |
| Projects | `projects` |
| Invoices | `invoices` |
| Documents | `document_associations` |
| Interactions | `interactions` |
| Assets | `assets` |
| Usage records | `usage_tracking` |
| Bucket usage records | `bucket_usage` |
| Survey invitations | `survey_invitations` |
| Survey responses | `survey_responses` |
| Ticket materials | `ticket_materials` |
| Project materials | `project_materials` |
| Asset associations | `asset_associations` |

### Also blocked when

- The client is the tenant's **default client** (`tenant_companies.is_default`).
  Set another default in General Settings first. Returned as `IS_DEFAULT`.

### Cleaned up automatically on delete

Tags, tax settings (`client_tax_settings`), tax rates (`client_tax_rates`),
contracts (`client_contracts`), billing cycles (`client_billing_cycles`),
billing settings (`client_billing_settings`), locations (`client_locations`),
the client logo and its document rows, and — on Enterprise — payment customer
records (`client_payment_customers`).

Note that billing *configuration* is cascade-deleted while **invoices block the
delete**. Financial history is preserved; the settings that produced it are not.

## Contact deletion

### Blocked by any of these

| Dependency | Table |
|---|---|
| Tickets (including closed) | `tickets` |
| Interactions | `interactions` |
| Documents | `document_associations` |
| Portal user account | `users` |
| Survey invitations | `survey_invitations` |
| Survey responses | `survey_responses` |
| Asset associations | `asset_associations` |

Being a client's **billing contact no longer blocks deletion** — that rule was
removed. `billing_contact_id` is left pointing at a deleted contact only if the
contact clears every blocker above.

### Cleaned up automatically on delete

Tags, phone numbers (`contact_phone_numbers`), additional email addresses
(`contact_additional_email_addresses`), comments, and portal invitations.

## Deactivate instead

Deactivation is the intended path for any record with business history: it hides
the entity from active lists, preserves all data, and is reversible.

**One caveat worth knowing.** Deactivating a client also deactivates its active
contacts and their portal users. Reactivating the client reactivates *every*
inactive contact on it — including contacts that were deactivated individually,
long before the client was. There is no column recording why a contact is
inactive, so the cascade cannot tell the two apart.

## Why blockers exist

- **Audit and legal retention** — tickets, invoices, and interactions are records.
- **Referential integrity** — avoids orphaned rows across a distributed schema.
- **Reporting continuity** — usage, bucket, and material rows feed billing history.

## Error messages

Blocked deletions return a `DeletionValidationResult` with a `code`, a message,
and the `dependencies` array that the UI renders as a list of counts. Codes in
use include `PERMISSION_DENIED`, `NOT_FOUND`, `IS_DEFAULT`, and `UNKNOWN_ENTITY`.
