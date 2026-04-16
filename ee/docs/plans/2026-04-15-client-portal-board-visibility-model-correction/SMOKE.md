# Smoke Readiness — Emerald City Scenario

Date: 2026-04-15

## Scope
Validate client portal board visibility model correction against seeded Emerald City data without relying on `boards.client_id`.

## Preconditions
- Local server running (`http://localhost:3784`)
- Seed client: `ea00c9e1-a294-40f8-84e7-f3e9bb9dd41c` (Emerald City)
- At least two active boards with open tickets for Emerald City

## Runbook
1. MSP user opens Emerald City contact in the Portal tab.
2. In visibility-group board picker, verify active tenant boards render (no false "No boards available").
3. Create a restricted group selecting one active board; assign it to a standard portal contact.
4. Verify restricted contact ticket list only shows Emerald City tickets from the selected board.
5. Verify restricted contact cannot open ticket details/documents/comments for Emerald City tickets on hidden boards.
6. Verify restricted contact ticket creation only offers allowed active boards and rejects manual disallowed board submission.
7. Set another Emerald City contact to Full Access (`portal_visibility_group_id = NULL`), verify unrestricted ticket list within Emerald City client.
8. Assign a group to a pre-invite Emerald City contact; complete invite/onboarding; verify assignment remains effective after first login.
9. Attempt to delete an assigned group; verify delete guard blocks the operation.

## Expected Outcome
- No server errors from `boards.client_id` references.
- Board pickers are tenant-active-board based.
- Visibility remains client-scoped through `client_portal_visibility_groups.client_id`.
- Restricted vs full-access behavior matches PRD acceptance criteria.
