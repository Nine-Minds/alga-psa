# Client Portal Board Visibility Groups Design

- Date: `2026-03-15`
- Status: Approved for planning

## Summary

Introduce per-client board visibility groups for client portal access. Groups contain allowed boards. Each contact can have zero or one assigned group in v1. If no group is assigned, the contact keeps legacy full access to all of the client's boards. MSP staff and client portal admins can both manage groups and replace assignments.

## Recommended Approach

Use reusable groups rather than direct per-user board grants.

Why:

1. Per-user board checklists do not scale once a client has many portal users and many boards.
2. A group-based model supports common access bundles such as "Standard Employees" and "HR Contacts".
3. One group per contact is enough for v1 and keeps both the schema and UI simpler than a multi-group system.
4. Storing the assignment on the contact works with the existing portal architecture because portal ticket access already resolves through `users.contact_id`.

## Core Rules

1. Groups are scoped per client.
2. Contacts can have zero or one assigned group in v1.
3. `No assigned group` means full access.
4. MSP changes are not locked. Client admins may replace them later.
5. Ticket visibility must be enforced server-side, not only in the UI.

## Enforcement Scope

The implementation must cover:

1. Client portal ticket list filtering.
2. Client portal ticket details access.
3. Client portal ticket creation options and submit validation.
4. Ticket-backed dashboard summaries that should reflect only visible boards.

## UI Surfaces

1. Client portal admin surface for group CRUD and contact assignment.
2. PSA contact portal tab extension for MSP-side group CRUD and assignment.
3. Localized client portal copy in every supported client portal locale file.

## Not In Scope

1. Multiple groups per contact.
2. Tenant-wide shared groups.
3. Locked MSP overrides.
4. Non-ticket visibility domains.
