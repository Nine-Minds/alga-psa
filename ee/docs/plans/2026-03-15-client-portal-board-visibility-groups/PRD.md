# PRD — Client Portal Board Visibility Groups

- Slug: `client-portal-board-visibility-groups`
- Date: `2026-03-15`
- Status: Draft

## Summary

Add per-client board visibility groups for client portal access. Each client can define reusable groups of allowed ticket boards, assign at most one group to a contact in v1, and use that assignment to restrict what the linked portal user can see or submit in the client portal. MSP staff must be able to manage the same groups and replace a contact's assigned group from the PSA. Existing portal users must retain full board access until a restriction is applied.

## Problem

Client portal ticket visibility is client-wide today. If a client has both broadly visible support boards and sensitive boards, every portal user for that client can see tickets across all of them. MSPs need a way to keep sensitive boards private while still letting clients self-manage access for their own portal users. This requires both a client-facing administration surface and an MSP override surface, plus server-side enforcement so direct URLs and API calls cannot bypass the restriction.

## Goals

1. Let each client define reusable board visibility groups scoped to that client.
2. Let a client portal admin assign zero or one visibility group to a portal-managed contact.
3. Let MSP staff manage the same groups and replace a contact's assignment from the PSA.
4. Enforce visibility in client portal ticket list, ticket details, ticket creation, and related ticket-facing counts or summaries.
5. Preserve backward compatibility by treating unassigned contacts as full-access until restricted.
6. Localize all new client portal strings using the existing client portal i18n pattern and add them to every supported client portal locale file.

## Non-goals

1. Multiple visibility groups per contact or portal user.
2. Tenant-wide shared groups reused across multiple clients.
3. MSP-only locked overrides that client admins cannot change.
4. Per-board permission types beyond visibility, such as separate create vs read access.
5. Reworking non-ticket client portal domains such as projects, billing, documents, or appointments.
6. Full multilingual parity requirements for new PSA-side strings beyond the repo's existing PSA standards.

## Users and Primary Flows

### MSP staff

1. Open a client contact in the PSA and manage client portal access.
2. Create or edit per-client visibility groups and choose which boards belong to each group.
3. Assign or replace the contact's visibility group.
4. Expect the change to take effect immediately for the linked portal user.

### Client portal admin

1. Open a client-portal administration screen for portal users or contacts within their own client.
2. Create a group such as "Standard Employees" or "HR Contacts".
3. Add the allowed boards for that group.
4. Assign the group to a contact or portal user from the same client.
5. Expect non-admin portal users to see only tickets on allowed boards.

### Standard client portal user

1. Sign in as usual.
2. See only tickets whose `board_id` is allowed by the assigned group, or all boards if no group is assigned.
3. Be prevented from opening or creating tickets on hidden boards even via direct links or crafted requests.

## UX / UI Notes

### Client portal

1. Add a localized administration surface available only to client portal admins.
2. Show a list of visibility groups for the admin's client with name, board count, and assignment count.
3. Provide create, edit, and delete flows for groups.
4. Provide assignment controls for portal-managed contacts. In v1, assignment is single-select plus an unassigned "Full access" state.
5. Show clear localized copy for:
   - Unassigned/full-access state
   - No boards in group
   - Group deletion blocked because contacts are assigned
   - Permission denied for non-admin portal users
6. Hide administration controls from non-admin portal users.

### PSA / MSP portal

1. Extend the existing contact portal tab to display the effective visibility group.
2. Let MSP staff create, edit, and assign per-client groups from the PSA.
3. Clarify in copy that MSP changes are not locked and client admins may change the assignment later.

## Requirements

### Functional Requirements

1. Introduce a per-client visibility group model for ticket boards.
2. Each visibility group must belong to exactly one client and one tenant.
3. Each visibility group may contain zero or more allowed boards from the same client/tenant context.
4. Each contact may have zero or one assigned visibility group in v1.
5. Assignment must be stored on the contact-facing path rather than only on the user record so access can be preconfigured before or independent of portal invitation/account lifecycle.
6. A contact with no assigned visibility group must retain full ticket board visibility.
7. A contact assigned to a group with no boards must see no boards and no tickets.
8. Client portal ticket list queries must filter by the assigned group's board set when a group exists.
9. Client portal ticket detail queries must reject access when the ticket's board is not visible to the current contact.
10. Client portal ticket-adjacent loaders reached from the detail view, such as documents or comments, must only succeed if the ticket itself is visible.
11. Client portal ticket creation flows must only offer allowed boards when a group is assigned.
12. Client portal ticket creation must reject attempts to submit a ticket on a disallowed board.
13. Client portal ticket dashboard counts and summaries that are ticket-backed must respect the same board filter.
14. Client portal administration for groups and assignments must be limited to client portal admins associated with the same client.
15. Client portal admins must not be able to create, edit, view, assign, or delete groups for another client.
16. MSP staff must be able to create, edit, view, assign, and delete groups for any client they can manage.
17. MSP staff replacing an assignment must simply overwrite the current assignment. No lock or precedence flag is required in v1.
18. Deleting an assigned group must be blocked with a clear error instead of silently restoring full access.
19. Deleting an unassigned group must succeed.
20. Existing invitation and portal user creation flows must continue to work with no group assignment required.

### Non-functional Requirements

1. Enforcement must be server-side. UI filtering alone is not sufficient.
2. The plan must include database-backed integration coverage for migration, filtering, and permission guards.
3. New client portal strings must use the current localization pattern and be added to `en`, `de`, `es`, `fr`, `it`, `nl`, `pl`, `xx`, and `yy` locale files under `server/public/locales/*/client-portal.json`.
4. The migration must be backward compatible and must not change access for existing portal users until an assignment is explicitly added.
5. New APIs and queries must maintain tenant and client isolation.

## Data / API / Integrations

### Recommended data model

1. `client_portal_visibility_groups`
   - `group_id`
   - `tenant`
   - `client_id`
   - `name`
   - optional descriptive fields if needed
   - timestamps
2. `client_portal_visibility_group_boards`
   - `tenant`
   - `group_id`
   - `board_id`
3. Contact assignment
   - Add nullable `portal_visibility_group_id` to `contacts`, or an equivalently simple one-to-one assignment structure if the implementation needs a dedicated table.
   - `NULL` means full access.

### Recommended server shape

1. Introduce a shared resolver that derives the effective visible board IDs for a portal contact.
2. Use that resolver from client portal ticket list, ticket detail, dashboard metrics, and ticket creation paths.
3. Keep client portal admin CRUD actions scoped by the acting user's linked `contact_id` and `client_id`.
4. Reuse the PSA contact portal tab as the MSP assignment entry point instead of creating a second independent contact-management surface.

## Security / Permissions

1. Client portal group management must require an authenticated client portal user linked to a contact marked as a client portal admin.
2. Regular client portal users must never gain access to group-management APIs or UI.
3. Group CRUD and assignment actions must validate tenant and client ownership on every read and write.
4. Ticket detail access must fail closed when a hidden-board ticket is requested directly.
5. Ticket creation must fail closed when a disallowed board is submitted, even if the board ID is manually supplied.

## Observability

This plan does not introduce new operational telemetry by default. Normal server logs and test coverage are sufficient unless implementation uncovers a debugging gap that materially blocks rollout.

## Rollout / Migration

1. Ship schema additions with no backfill that assigns groups automatically.
2. Existing contacts and portal users remain unassigned, which preserves full access.
3. Restriction begins only when MSP staff or client admins create a group and assign it to a contact.
4. Group deletion must protect assigned contacts from accidental reversion to full access.

## Open Questions

1. Whether the client portal admin screen should live under an existing account/settings area or a new dedicated administration route.
2. Whether the PSA-side group editor should live only inside the contact portal tab or also be discoverable from a client-level settings screen.
3. Whether an empty group should disable ticket creation entirely or surface an empty-state CTA explaining that no boards are available. Current recommendation is to disable creation and show clear localized copy.

## Acceptance Criteria (Definition of Done)

1. MSP staff can create per-client visibility groups, manage their board membership, and assign one group to a contact from the PSA.
2. Client portal admins can create and manage the same per-client visibility groups for their own client and assign one group to a portal-managed contact.
3. Unassigned contacts keep full board visibility.
4. Assigned contacts only see tickets, ticket details, and ticket creation options for boards in the assigned group.
5. Direct navigation to a hidden-board ticket is rejected server-side.
6. Attempting to submit a ticket to a hidden board is rejected server-side.
7. Deleting a group that is currently assigned is blocked with a clear error.
8. All new client portal strings are localized in every supported client portal locale file.
9. Database-backed integration tests cover migration, access filtering, permission guards, and assignment behavior.
