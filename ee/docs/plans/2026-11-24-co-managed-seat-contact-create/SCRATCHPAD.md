# Scratchpad — co-managed seat contact create

## Decisions

- 2026-11-24: Seat technicians may create contacts for their own client. Rationale: they are the client's IT person and know first when someone joins. Scope is create only; edit, deactivate and delete wait for the record-scope authorizer in `2026-11-12-security-crm-client-contact-record-scope`.
- No per-arrangement switch (recommendation, open for Robert). `2026-11-24-system-managed-seat-technician-role` makes the role non-editable, so "remove the permission from the role" is not available as an opt-out.
- The general mechanism is one contact create command; the seat grant is two lines on top of it. The grant must not ship before the command.

## Where things are (verified 2026-11-24 on main plus the working tree)

Seat representation
- Internal user of the sponsor tenant, `seat_reader: true`, the seat role only: `packages/co-managed/src/seatInvitation.ts`.
- User to client: `co_managed_seat_assignments` -> `co_managed_seat_arrangements.client_id`, read per request by `seatFactsQuery` in `packages/co-managed/src/seatAuthority.ts`.
- Policy table `SEAT_AUTHORITY_POLICY` in `seatAuthority.ts`; `contact: { granted: { read: ['own_client'] } }`. Baseline closed.
- Role grants `CO_MANAGED_SEAT_ROLE_GRANTS` in `packages/co-managed/src/seatRole.ts`; mirrored in `server/migrations/utils/permissions/roleGrants.cjs` (`CAPABILITY_ROLES.psa`); pinned equal by `server/src/test/unit/migrations/coManagedSeatRoleCatalog.test.ts`.
- `admitCoManagedSeatRole` adds missing grants only on arrangement creation or invitation acceptance, so existing roles need a migration.
- Lapse and revocation: `packages/co-managed/src/seatWriteAdmission.ts` registers a gate on every kernel `authorizeMutation`. A create that goes through `assertRecordCreateAllowed` inherits it.
- Seat API credentials are refused; MCP and AI-session keys are refused.

Scope modules
- Reads: `packages/authorization/src/clientScopeAuthorization.ts` (`createClientScopeContext`, `narrowing`, `permits`), on `readScope.ts`.
- Creates: `packages/authorization/src/recordCreateAuthorization.ts` (`assertRecordCreateAllowed`, `authorizeRecordCreate`). Fast path when the tenant has no published assignment and no resolver subject.
- There is no record-mutation authorizer for update/delete yet (`authorizeRecordMutation` does not exist in code).

Contact create paths
- `packages/clients/src/actions/contact-actions/contactActions.tsx`: `addContact` (scope check then model create), `createClientContact` (duplicate check before scope check), `importContactsFromCSV` (create branch scoped; update-existing branch unscoped, needs `contact:update`).
- `packages/clients/src/actions/queryActions.ts`: `createOrFindContactByEmail` (tenant-wide lookup first; names the other client for MSP users), `findContactByEmailAddress` (unscoped read).
- `packages/integrations/src/actions/clientLookupActions.ts`: `createOrFindIntegrationContactByEmail` has only `withAuth`: no permission, no scope, names the other client. Wrapped by `createOrFindContact` in `email-actions/emailActions.ts`. Both pinned in `server/src/test/unit/product/support/permissionCoveragePinned.ts`.
- REST: `server/src/lib/api/services/ContactService.ts` create runs `assertRecordCreateAllowed`. The seat API surface opens GET only (`shared/services/productSurfaceKinds.ts`).
- Ticket CSV import: `packages/tickets/src/actions/ticketImportActions.ts` inserts contacts directly after the ticket-create check.
- Workflow: `shared/workflow/runtime/actions/businessOperations/contacts.ts`, RBAC by actor only.
- Portal: `packages/portal-shared/src/actions/portalInvitationActions.ts` `createClientPortalUser` inserts into `contacts` directly, gated by `user:create`. Left alone.
- Writer ledger: `packages/clients/src/lib/contactWritePaths.contract.test.ts`.
- Duplicate check in the model: `shared/models/contactModel.ts` (tenant-wide, `EMAIL_EXISTS`).

UI
- `packages/clients/src/components/contacts/QuickAddContact.tsx` calls `addContact`; client field is "Client (Optional)" from `searchClientsForPicker`, with add-new-client.
- Opened from the ticket Add dialog (`packages/tickets/src/components/QuickAddTicket.tsx`, contact picker `onAddNew`, no permission gate) via `packages/clients/src/providers/QuickAddClientProviderWithCallbacks.tsx`; also from ticket properties.
- Server actions are not surface-gated: `withAuth` only authenticates. Route gating does not protect an action.

Test templates
- Real-DB seat write path: `server/src/test/integration/coManagedSeatTicketCreateEdit.db.test.ts`.
- Seat matrix: `packages/co-managed/src/__tests__/seatAuthority.test.ts`.
- Seat picker case: `server/src/test/integration/searchClientsForPicker.integration.test.ts`.
- Bundle-based client/contact scope: `server/src/test/integration/authorization/clientContactScope.integration.test.ts`.
- Seat surface e2e: `server/src/test/e2e/co-managed-seat-surface.playwright.test.ts`.

## Gotchas

- Seat client and contact reads honour the seat resolver without a published bundle only with the change in `2026-11-24-seat-client-picker-authorization` (uncommitted on main at the time of writing). The quick-add client preselection depends on it.
- Co-managed code sits outside `ee/` today; see `2026-11-17-co-managed-ee-boundary` before placing anything new.
- Contact email uniqueness is per tenant, so some existence disclosure is unavoidable; keep the answer generic.
- Migrations run on Citus in production: see the `citus-migration-gotchas` skill.

## Related plans

- `2026-11-10-co-managed-seat-and-workspace` (master seat PRD; contacts read-only there)
- `2026-11-10-authorization-client-scope-completion`
- `2026-11-12-security-crm-client-contact-record-scope` (update/delete authorizer; not implemented)
- `2026-11-24-seat-client-picker-authorization`, `2026-11-24-seat-picker-authorization-sweep`
- `2026-11-24-system-managed-seat-technician-role`
- `2026-11-17-co-managed-ee-boundary`

## S1 implementation notes (alga-2026-0003442)

- The command is `createContactAs(trx, { tenant, actor, input })` in `shared/models/contactCreateCommand.ts`, beside `contactModel.ts`. `shared` already depends on `@alga-psa/authorization`; the module imports nothing from `ee/` (T010 walks its import graph to prove it).
- Order: RBAC `contact:create` (`hasPermission` from `@alga-psa/authorization/rbac`) -> `assertRecordCreateAllowed` with `clientId ?? null` -> tenant-wide duplicate lookup (lower-cased email, same `EMAIL_EXISTS:` text as the model) -> `ContactModel.createContact` -> `queueContactCreated` (after commit, idempotency key `contact_created:<id>`, same as the old inline publish in `addContact`).
- Steps 1-2 are one exported function, `assertContactCreateAllowed`; `createContactAs` calls it. The only other caller is the CSV import: with update-existing off, a row that matches an existing contact is a failed create, and its "email/name already exists" report must not precede the scope check. The update-existing branch is untouched.
- The old `assertContactCreateInScope` helper in `contactActions.tsx` is gone. The actions keep their early localized `assertMspPermission` so permission-denied text and its order against input validation do not change; the command's own RBAC check is authoritative for other callers.
- Error mapping stays in the actions. `createClientContact` used to throw a localized `EMAIL_EXISTS:` from its own lookup; it now maps the command's `EMAIL_EXISTS:` error to the same localized text. `addContact` and the CSV import already passed `EMAIL_EXISTS:` through `prefixedContactActionErrorFrom`.
- Not done (later stories): read-scope projection of the duplicate outcome (F002), find-or-create (F003), other callers (F005-F008). `contactWritePaths.contract.test.ts` got the minimum update so it still passes; F008 owns the real ledger change.
- Tests: `server/src/test/integration/authorization/contactCreateCommand.integration.test.ts` (T001) and `contactCreateCommand.ce.integration.test.ts` (T010; probe counted as the statement selecting `publishedAssignments`).
