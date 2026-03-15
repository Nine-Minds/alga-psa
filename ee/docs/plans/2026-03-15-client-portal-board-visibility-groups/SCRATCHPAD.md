# Scratchpad — Client Portal Board Visibility Groups

- Plan slug: `client-portal-board-visibility-groups`
- Created: `2026-03-15`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-15) Existing portal users keep full board access until restricted. `NULL` assignment is the backward-compatible state.
- (2026-03-15) Visibility is modeled as per-client reusable groups rather than per-user board checklists.
- (2026-03-15) V1 supports one group per contact/portal user, not multiple groups.
- (2026-03-15) MSP assignment changes are not locked. Client admins can replace them later.
- (2026-03-15) Groups are scoped per client, not shared tenant-wide.
- (2026-03-15) Recommended assignment anchor is the contact record, because portal ticket access already resolves through `users.contact_id` and this supports pre-invitation configuration.
- (2026-03-15) Deleting an assigned group should fail rather than silently restoring full access.

## Discoveries / Constraints

- (2026-03-15) Client portal ticket access is client-wide today. `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` resolves the signed-in user to `users.contact_id`, then `contacts.client_id`, and filters tickets by `t.client_id = contact.client_id`.
- (2026-03-15) The existing MSP contact portal management surface already exists in `packages/clients/src/components/contacts/ContactPortalTab.tsx`.
- (2026-03-15) The existing MSP-side contact action for portal admin state lives in `packages/clients/src/actions/contact-actions/contactActions.tsx`.
- (2026-03-15) Client portal locale files already exist at `server/public/locales/{de,en,es,fr,it,nl,pl,xx,yy}/client-portal.json`.
- (2026-03-15) Client portal user self-service and contact-linked client-user logic already exists in `packages/client-portal/src/actions/client-portal-actions/clientUserActions.ts`.
- (2026-03-15) Added MSP portal-side visibility-group capabilities in `ContactPortalTab.tsx`:
  - render assignment selector for selected visibility group / full-access
  - render group editor (name/description/boards)
  - wire create/edit/delete actions against new contact action handlers
- (2026-03-15) Implemented client-anchored contact action functions in `contactActions.tsx`:
  - list groups, boards, group detail
  - create/update/delete group with board validation
  - assign/unassign visibility group with client-scoped guard
  - delete blocked if currently assigned
- (2026-03-15) Added `visibilityGroups` locale keys in `server/public/locales/de/es/fr/it/nl/pl/xx/yy/client-portal.json` with English fallback values for parity.
- (2026-03-15) Added server-side guard tests for contact-actions (`visibilityGroupActions.permission.test.ts`) covering cross-client assignment guard, delete-blocked-when-assigned, and delete-success-unassigned.
- (2026-03-15) Flipped checklists for F019/F020/F022/F023/F024 and T026/T033/T034 to `true` after implementation.
- (2026-03-15) Moved the portal board-visibility resolver into shared tickets lib code at `packages/tickets/src/lib/clientPortalVisibility.ts` so both client-portal actions and ticket-form actions use the same enforcement path.
- (2026-03-15) Tightened shared resolver scoping to join through `boards` and only return board IDs that still belong to the contact's client, which prevents rogue membership rows from broadening access.
- (2026-03-15) Fixed `getDashboardMetrics` to apply the visibility filter on a chainable ticket query instead of calling `.where(...)` on a `void` helper result.
- (2026-03-15) `getClientTicketFormData` now uses the shared resolver; invalid/mismatched assignments fail closed by returning no boards instead of silently restoring unrestricted board choices.
- (2026-03-15) Added migration contract coverage in `server/src/test/unit/migrations/clientPortalVisibilityGroupsMigration.test.ts` and shared resolver coverage in `packages/tickets/src/lib/clientPortalVisibility.test.ts`.
- (2026-03-15) Flipped checklists for F001/F002/F003/F004/F005/F006 and T001/T002/T003/T004/T005/T006/T007 to `true` after code/test verification.
- (2026-03-15) Added client portal visibility enforcement tests in `packages/client-portal/src/actions/client-portal-actions/client-tickets.visibility.test.ts` for restricted/unrestricted ticket list behavior, hidden-board detail/document guards, and disallowed-board ticket creation rejection.
- (2026-03-15) Added dashboard visibility coverage in `packages/client-portal/src/actions/client-portal-actions/dashboard.visibility.test.ts` to prove ticket-backed metrics respect the resolved board set.
- (2026-03-15) Flipped checklists for F007/F008/F009/F010/F011/F012/F013 and T008/T009/T010/T011/T012/T015/T016/T017 to `true` after code/test verification.
- (2026-03-15) Updated `ClientAddTicket.tsx` to surface a localized no-boards empty state for restricted contacts and keep ticket creation disabled when no boards are available.
- (2026-03-15) Added ticket-form visibility tests in `packages/tickets/src/actions/ticketFormActions.clientPortalVisibility.test.ts` and dialog UI tests in `packages/client-portal/src/components/tickets/ClientAddTicket.visibility.test.tsx`.
- (2026-03-15) Added `create.noBoardsAvailable` to all supported `server/public/locales/*/features/tickets.json` files used by the restricted-ticket empty state.
- (2026-03-15) Flipped checklists for T013/T014/T037 to `true` after code/test verification.
- (2026-03-15) Added client portal admin action coverage in `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.test.ts` for T018/T019/T020/T021/T022/T023/T024/T025/T027/T032.
- (2026-03-15) Added locale coverage in `packages/client-portal/src/components/settings/visibilityGroupsLocales.test.ts` for T035/T036 and validated the new `clientSettings.visibilityGroups.*` keys across all supported client portal locales.
- (2026-03-15) Added MSP contact portal tab UI coverage in `packages/clients/src/components/contacts/ContactPortalTab.visibilityGroups.test.tsx` for T029/T030 to verify assignment replacement plus create/edit flows in the PSA surface.
- (2026-03-15) Added lifecycle/integration coverage in `packages/tickets/src/lib/clientPortalVisibility.userModelLifecycle.test.ts` and `packages/clients/src/actions/contact-actions/visibilityGroupActions.integration.test.ts` for T028/T031/T038.
- (2026-03-15) Fixed a second parse error in `packages/clients/src/actions/contact-actions/contactActions.tsx` by correcting the `assignClientPortalVisibilityGroupToContact` `withAuth(...)` export terminator from `};` to `});`.
- (2026-03-15) Flipped checklists for F014/F015/F016/F017/F018/F021 and T018/T019/T020/T021/T022/T023/T024/T025/T027/T028/T029/T030/T031/T032/T035/T036/T038 to `true` after visibility-focused test verification.

## Commands / Runbooks

- (2026-03-15) Search client portal ticket entry points:
  `rg -n "client.*ticket|portal.*ticket|get.*ticket|list.*ticket" packages/client-portal server/src/app/client-portal packages/portal-shared --glob '!node_modules'`
- (2026-03-15) Search portal/contact admin surfaces:
  `rg -n "portal admin|portal invitation|contact.*portal|contact.*user" packages server --glob '!node_modules'`
- (2026-03-15) Inspect client portal locale coverage:
  `find server/public/locales -maxdepth 2 -name 'client-portal.json' | sort`
- (2026-03-15) Run targeted migration/resolver tests from the server Vitest root:
  `cd server && npx vitest run src/test/unit/migrations/clientPortalVisibilityGroupsMigration.test.ts ../packages/tickets/src/lib/clientPortalVisibility.test.ts`
- (2026-03-15) Run targeted ticket/dashboard visibility tests from the server Vitest root:
  `cd server && npx vitest run ../packages/client-portal/src/actions/client-portal-actions/client-tickets.visibility.test.ts ../packages/client-portal/src/actions/client-portal-actions/dashboard.visibility.test.ts`
- (2026-03-15) Run targeted ticket-form/dialog visibility tests from the server Vitest root:
  `cd server && npx vitest run ../packages/tickets/src/actions/ticketFormActions.clientPortalVisibility.test.ts ../packages/client-portal/src/components/tickets/ClientAddTicket.visibility.test.tsx`
- (2026-03-15) Run client portal admin/localization visibility tests from the server Vitest root:
  `cd server && npx vitest run ../packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.test.ts ../packages/client-portal/src/components/settings/visibilityGroupsLocales.test.ts`
- (2026-03-15) Run MSP visibility group tests from the server Vitest root:
  `cd server && npx vitest run ../packages/clients/src/actions/contact-actions/visibilityGroupActions.permission.test.ts ../packages/clients/src/actions/contact-actions/visibilityGroupActions.integration.test.ts ../packages/clients/src/components/contacts/ContactPortalTab.visibilityGroups.test.tsx`
- (2026-03-15) Run lifecycle visibility tests from the server Vitest root:
  `cd server && npx vitest run ../packages/tickets/src/lib/clientPortalVisibility.userModelLifecycle.test.ts`
- (2026-03-15) Consolidated visibility-focused regression run from the server Vitest root:
  `cd server && npx vitest run src/test/unit/migrations/clientPortalVisibilityGroupsMigration.test.ts ../packages/tickets/src/lib/clientPortalVisibility.test.ts ../packages/tickets/src/lib/clientPortalVisibility.userModelLifecycle.test.ts ../packages/client-portal/src/actions/client-portal-actions/client-tickets.visibility.test.ts ../packages/client-portal/src/actions/client-portal-actions/dashboard.visibility.test.ts ../packages/tickets/src/actions/ticketFormActions.clientPortalVisibility.test.ts ../packages/client-portal/src/components/tickets/ClientAddTicket.visibility.test.tsx ../packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.test.ts ../packages/client-portal/src/components/settings/visibilityGroupsLocales.test.ts ../packages/clients/src/actions/contact-actions/visibilityGroupActions.permission.test.ts ../packages/clients/src/actions/contact-actions/visibilityGroupActions.integration.test.ts ../packages/clients/src/components/contacts/ContactPortalTab.visibilityGroups.test.tsx`

## Links / References

- [client-tickets.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/client-portal/src/actions/client-portal-actions/client-tickets.ts)
- [ContactPortalTab.tsx](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/clients/src/components/contacts/ContactPortalTab.tsx)
- [contactActions.tsx](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/clients/src/actions/contact-actions/contactActions.tsx)
- [clientUserActions.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/client-portal/src/actions/client-portal-actions/clientUserActions.ts)
- [client-portal.json](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/server/public/locales/en/client-portal.json)
- [clientPortalVisibility.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/tickets/src/lib/clientPortalVisibility.ts)
- [clientPortalVisibility.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/tickets/src/lib/clientPortalVisibility.test.ts)
- [clientPortalVisibilityGroupsMigration.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/server/src/test/unit/migrations/clientPortalVisibilityGroupsMigration.test.ts)
- [client-tickets.visibility.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/client-portal/src/actions/client-portal-actions/client-tickets.visibility.test.ts)
- [dashboard.visibility.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/client-portal/src/actions/client-portal-actions/dashboard.visibility.test.ts)
- [ticketFormActions.clientPortalVisibility.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/tickets/src/actions/ticketFormActions.clientPortalVisibility.test.ts)
- [ClientAddTicket.visibility.test.tsx](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/client-portal/src/components/tickets/ClientAddTicket.visibility.test.tsx)
- [visibilityGroupActions.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.test.ts)
- [visibilityGroupsLocales.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/client-portal/src/components/settings/visibilityGroupsLocales.test.ts)
- [ContactPortalTab.visibilityGroups.test.tsx](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/clients/src/components/contacts/ContactPortalTab.visibilityGroups.test.tsx)
- [visibilityGroupActions.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/clients/src/actions/contact-actions/visibilityGroupActions.integration.test.ts)
- [clientPortalVisibility.userModelLifecycle.test.ts](/Users/roberisaacs/alga-psa.worktrees/test/portal-user-ticket-visibility/packages/tickets/src/lib/clientPortalVisibility.userModelLifecycle.test.ts)

## Open Questions

- Should the client portal admin UI live under account/settings or under a dedicated administration route?
- Should the PSA-side group CRUD live only in the contact portal tab, or also at the client level?
