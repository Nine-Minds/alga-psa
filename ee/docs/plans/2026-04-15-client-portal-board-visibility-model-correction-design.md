# Client Portal Board Visibility Model Correction Design

Date: 2026-04-15
Slug: `client-portal-board-visibility-model-correction`

## Summary

The original Client Portal Board Visibility Groups feature was intended to make **visibility groups client-scoped** while using **board IDs as tenant-scoped visibility controls**. The current implementation appears to assume that boards themselves belong to a client via `boards.client_id`, but the real schema does not model that relationship.

This design corrects the implementation to match the intended product model:

- visibility groups belong to a client
- contacts are assigned zero or one visibility group
- groups contain tenant board IDs
- ticket access remains client-scoped through `contact.client_id` and `ticket.client_id`
- board filtering is applied as an additional restriction layer, not as proof of board ownership

## Current-State Findings

Re-review of the PRD, migration, and current schema showed:

1. The PRD clearly intends **client-scoped groups** and **board-based filtering** for that client's portal users.
2. The migration adds:
   - `client_portal_visibility_groups(tenant, group_id, client_id, ...)`
   - `client_portal_visibility_group_boards(tenant, group_id, board_id)`
   - `contacts.portal_visibility_group_id`
3. The migration does **not** add:
   - `boards.client_id`
   - a client-board join table
   - `client_id` on `client_portal_visibility_group_boards`
4. The live schema confirms `boards` is tenant-scoped and has no `client_id` column.
5. Current visibility-group actions and the shared visibility resolver still query `boards.client_id`, causing intermittent 500s and invalid empty states.

So the mismatch is not that a product feature is missing. The mismatch is that the implementation filled an ambiguous technical gap in the PRD with the wrong data-model assumption.

## Product Rule

The corrected rule is:

> A client portal contact may only see tickets where `ticket.client_id = contact.client_id`, and if that contact has an assigned visibility group, the ticket's `board_id` must also be included in that group's allowed board IDs.

This means:

1. Client isolation comes from contact/group/ticket relationships.
2. Board IDs act as a secondary visibility filter.
3. Board rows do not need to belong to a client.

## Recommended Approach

Use a **targeted model-correction fix**.

Why:

1. It matches the approved product interpretation and the shipped migration.
2. It avoids inventing a new board-ownership model that the PRD never required.
3. It preserves the current feature scope and acceptance criteria.
4. It keeps the fix small enough to validate with focused smoke tests.

## Core Rules

1. `client_portal_visibility_groups.client_id` remains the source of group ownership.
2. `client_portal_visibility_group_boards` stores tenant board IDs only.
3. Group assignment remains on `contacts.portal_visibility_group_id`.
4. Unassigned contacts retain legacy full access within their own client.
5. Restricted contacts remain scoped to their own client's tickets, then filtered by allowed board IDs.
6. Group CRUD and assignment actions validate client ownership through the group and contact, not through the board row.

## Board Selection and Validation

### Board picker rule

For both MSP and client portal admin management surfaces, board pickers should list:

- **all active boards in the tenant**

This is intentional. Boards are tenant-scoped visibility mechanisms, not client-owned objects.

### Validation rule

When a group is created or updated, each submitted board must:

1. exist in the tenant
2. be active

Validation must **not** require `boards.client_id`.

### Inactive board rule

If a board already assigned to a group later becomes inactive:

1. keep the board membership record in the group
2. exclude the inactive board from management pickers and new ticket creation choices
3. keep historical group membership data intact for auditability and predictable rollback

## UI Behavior

### MSP contact portal tab

The PSA contact portal tab remains the MSP management surface.

Expected behavior:

1. assignment dropdown remains client-scoped through the contact's client
2. visibility-group editor remains available from the contact portal tab
3. board picker lists all active tenant boards
4. `No boards available` should only appear when there are truly no active tenant boards in the tenant

### Client portal admin settings

The client portal settings screen remains the client-admin management surface.

Expected behavior:

1. group CRUD remains limited to the acting admin's client
2. contact assignments remain limited to contacts from that client
3. board picker lists all active tenant boards
4. board selection does not imply board ownership by the client

## Server-Side Enforcement

### Group CRUD and assignment

Actions must verify:

1. acting user can manage the target client
2. target contact belongs to the same client as the target group
3. submitted boards are valid active boards in the tenant

They must not enforce a nonexistent `boards.client_id` relationship.

### Shared visibility resolver

The shared resolver should:

1. load the contact and its `client_id`
2. return unrestricted access when `portal_visibility_group_id` is `NULL`
3. if a group is assigned:
   - load the group
   - verify `group.client_id === contact.client_id`
   - load board IDs from `client_portal_visibility_group_boards`
   - optionally join `boards` only to exclude inactive boards, not to enforce client ownership

### Ticket list/detail/dashboard/create

These paths should continue to enforce:

1. `ticket.client_id = contact.client_id`
2. `ticket.board_id in visibleBoardIds` when a group is assigned

This preserves the intended security model:

- no cross-client access
- no hidden-board access within the same client
- no crafted ticket creation to a disallowed board

## PRD Clarification

The original PRD was strong on product behavior but ambiguous in one technical phrase:

> "allowed boards from the same client/tenant context"

This should be clarified in implementation notes as:

> Boards remain tenant-scoped. Visibility groups are client-scoped. Enforcement uses the contact's client and the ticket's client, with group board IDs acting as a secondary visibility filter.

## Testing Focus

Update or add tests for:

1. MSP and client-portal board pickers using active tenant boards without `boards.client_id`
2. group create/update validation accepting tenant board IDs
3. cross-client assignment rejection through `group.client_id` and `contact.client_id`
4. shared visibility resolver returning allowed board IDs without client-owned board assumptions
5. ticket list/detail/dashboard/create still enforcing both client scoping and board restriction
6. inactive boards excluded from pickers and creation choices

## Smoke Validation Target

After the correction lands, use Emerald City smoke data to validate:

1. MSP group CRUD and assignment
2. client portal admin group CRUD and assignment
3. restricted user sees only allowed-board tickets
4. full-access user keeps unrestricted behavior
5. pre-invite assignment still applies after user creation
6. empty-group behavior blocks ticket creation and shows the expected empty state
7. assigned-group deletion remains blocked

## Implementation Shape

Likely touchpoints:

- `packages/clients/src/actions/contact-actions/contactActions.tsx`
- `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts`
- `packages/tickets/src/lib/clientPortalVisibility.ts`
- related visibility-group tests
- related client-ticket and dashboard visibility tests

## Conclusion

This should be treated as an **implementation correction**, not as a new feature or schema expansion. The correct model is:

- client-scoped groups
- tenant-scoped boards
- client-scoped ticket access
- board-based restriction layered on top
