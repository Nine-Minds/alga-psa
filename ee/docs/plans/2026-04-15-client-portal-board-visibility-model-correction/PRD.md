# PRD — Client Portal Board Visibility Model Correction

- Slug: `client-portal-board-visibility-model-correction`
- Date: `2026-04-15`
- Status: Draft

## Summary

Correct the Client Portal Board Visibility Groups implementation to match the intended data model: visibility groups remain client-scoped, but board IDs inside those groups are tenant-scoped visibility controls rather than client-owned records. Remove the invalid `boards.client_id` assumption from board pickers, group validation, and visibility resolution while preserving the original product behavior for MSP staff, client portal admins, and restricted portal users.

## Problem

The shipped feature and migration model visibility groups as client-scoped records containing board IDs, but current implementation paths assume boards themselves belong to a client via `boards.client_id`. The real schema does not contain that column. This mismatch produces intermittent 500s, false empty states like "No boards available," and risks incorrect server-side visibility enforcement.

## Goals

1. Align the implementation with the intended model: groups are client-scoped and boards are tenant-scoped.
2. Remove all runtime dependence on `boards.client_id` for this feature.
3. Keep MSP and client portal admin group management working with active tenant boards.
4. Preserve server-side enforcement for ticket list, detail, dashboard, and ticket creation.
5. Preserve backward compatibility for unassigned contacts and existing invitation / onboarding flows.
6. Clarify the effective model in plan documentation so future work does not reintroduce the same assumption.

## Non-goals

1. Introducing a new client-owned board schema or board-client mapping table.
2. Expanding the feature beyond ticket visibility into projects, billing, assets, or documents.
3. Changing one-group-per-contact behavior.
4. Changing lock semantics, precedence semantics, or assignment ownership semantics.
5. Redesigning portal invitation or account creation flows beyond what is needed to keep this feature compatible.

## Users and Primary Flows

### MSP staff

1. Open a client contact in the PSA portal tab.
2. Create or edit visibility groups for that contact's client.
3. Choose allowed boards from all active tenant boards.
4. Assign a visibility group to the contact or reset to full access.
5. Expect the contact's portal visibility to update immediately.

### Client portal admin

1. Open client settings under the visibility groups tab.
2. Create or edit visibility groups for their own client.
3. Choose allowed boards from all active tenant boards.
4. Assign a visibility group to contacts from their own client.
5. Expect restricted users to only see tickets on allowed boards for that client.

### Standard client portal user

1. Sign in as usual.
2. See only tickets where `ticket.client_id` matches the user's client and `ticket.board_id` is allowed by the assigned group.
3. Be blocked from viewing or creating tickets on disallowed boards.
4. Continue seeing full access when no group is assigned.

## UX / UI Notes

1. MSP and client-portal board pickers should show all active tenant boards.
2. `No boards available` should only render when the tenant truly has no active boards.
3. Existing group-management labels, assignment labels, and empty-group messaging remain unchanged unless implementation finds a mismatch.
4. If a board already in a group later becomes inactive, keep the membership record but exclude that board from board pickers and new ticket creation choices.
5. Existing assigned groups with inactive boards should not silently disappear from storage.

## Requirements

### Functional Requirements

1. Board pickers for MSP and client-portal group management must load active tenant boards without requiring `boards.client_id`.
2. Group create/update validation must accept submitted board IDs that exist in the tenant and are active.
3. Group create/update validation must reject missing, cross-tenant, or inactive board IDs.
4. Group assignment must continue validating client ownership through `group.client_id` and `contact.client_id`.
5. The shared portal visibility resolver must verify `group.client_id === contact.client_id`.
6. The shared portal visibility resolver must derive visible board IDs from `client_portal_visibility_group_boards` without requiring client-owned board rows.
7. Ticket list queries must continue enforcing `ticket.client_id = contact.client_id` and apply board filtering only when a group is assigned.
8. Ticket detail and ticket-adjacent loaders must continue failing closed when a ticket is on a hidden board.
9. Ticket creation must continue restricting available boards and rejecting submissions to disallowed boards.
10. Dashboard ticket-backed counts and summaries must continue respecting visible board IDs.
11. Unassigned contacts must remain unrestricted within their own client.
12. Empty groups must still yield no visible boards and no ticket creation options.
13. Existing pre-invite contact assignment behavior must remain valid.
14. Deleting an assigned group must remain blocked.

### Non-functional Requirements

1. Enforcement must remain server-side for ticket visibility and ticket creation.
2. The correction must not require schema changes or data backfills.
3. Tests must include real DB-backed integration coverage for the corrected board-selection and visibility logic.
4. The change must not broaden access across clients.
5. The change must not reintroduce false empty states caused by invalid board ownership assumptions.

## Data / API / Integrations

1. `client_portal_visibility_groups` remains the source of client ownership.
2. `client_portal_visibility_group_boards` remains a `(tenant, group_id, board_id)` membership table.
3. `contacts.portal_visibility_group_id` remains the assignment field.
4. `boards` should be treated as tenant-scoped records for this feature.
5. Ticket enforcement should continue relying on `tickets.client_id` for client isolation.
6. If inactive boards need to be filtered from group resolution or ticket creation, that should be done through the existing `boards.is_inactive` flag rather than a client ownership check.

## Security / Permissions

1. MSP actions must continue requiring contact update permission.
2. Client portal admin actions must continue requiring a client portal user whose linked contact is marked `is_client_admin`.
3. Group CRUD and assignment must still reject cross-client access.
4. Ticket list/detail/create/dashboard must still fail closed for hidden boards.
5. The correction must not make it possible for a user from one client to see another client's tickets by sharing a board ID.

## Observability

Normal server logs and test coverage are sufficient. If implementation uncovers ambiguous failures during smoke testing, add clear server error logging around invalid board submissions and invalid group/contact relationships, but do not expand scope into new telemetry by default.

## Rollout / Migration

1. No schema migration is required.
2. Existing group and assignment records should continue working after the correction.
3. Existing unassigned contacts retain full access.
4. After rollout, smoke validation should use a seeded Emerald City scenario covering restricted, full-access, and pre-invite contacts.

## Open Questions

1. Whether inactive boards should still count as visible for historical ticket-detail access or only be excluded from pickers and creation. Current design preference is to keep historical membership data intact and exclude inactive boards from pickers and new ticket creation choices.

## Acceptance Criteria (Definition of Done)

1. MSP visibility-group management no longer queries `boards.client_id` and no longer produces false "No boards available" states.
2. Client portal admin visibility-group management no longer queries `boards.client_id` and no longer produces false empty board pickers.
3. Group create/update accepts active tenant board IDs and rejects invalid or inactive board IDs.
4. Shared visibility resolution validates group-to-contact client ownership via `group.client_id` and `contact.client_id`, not via `boards.client_id`.
5. Restricted users still only see their own client's tickets on allowed boards.
6. Full-access users still retain unrestricted access within their own client.
7. Ticket detail, ticket documents/comments, dashboard counts, and ticket creation all remain server-side enforced.
8. No schema changes are introduced.
9. Tests cover the corrected model and smoke setup can proceed against the seeded Emerald City scenario.