# PRD — Co-managed seat technicians create contacts for their own client

- Slug: `2026-11-24-co-managed-seat-contact-create`
- Date: `2026-11-24`
- Status: Draft

## Summary

A co-managed seat technician is the client's own IT person working in the sponsoring MSP's tenant. They are the first to know when someone joins the client, and today they cannot add that person as a contact: they must ask the MSP before they can open a ticket for a new hire. This plan lets a seat technician create contacts for the client of their own seat arrangement, and for no other client.

Granting the permission is the small part. The contact-create paths are not uniformly fenced by client scope today, because RBAC has been the only thing keeping seat technicians (and bundle-restricted MSP users) out of several of them. One create path has no permission check at all. The plan therefore puts every actor-initiated contact create behind one create command first, then grants the seat the right to use it.

## Problem

1. **The seat cannot add a contact.** The Seat Technician role holds `contact:read` only (`packages/co-managed/src/seatRole.ts`), and the seat authority policy grants `contact: { read: ['own_client'] }` (`packages/co-managed/src/seatAuthority.ts`). The closed baseline denies every other contact action. The ticket Add dialog offers "Add new" on its contact picker with no permission gate, so the technician reaches a form that always fails.
2. **Create paths disagree about scope.** Each path runs its own sequence of permission check, duplicate lookup and scope check:
   - `addContact` and REST create check scope before the duplicate lookup.
   - `createClientContact` runs the tenant-wide duplicate check before the scope check.
   - `createOrFindContactByEmail` looks the email up tenant-wide first, and for an MSP user names the other client in the error ("This email is already associated with <client name>").
   - `createOrFindIntegrationContactByEmail` (and `createOrFindContact`, which wraps it) has no permission check and no scope check, takes `clientId` from the caller, and names the other client on a collision. It is pinned as a known gap in `permissionCoveragePinned.ts`. A seat technician can call it today.
   - Workflow `contacts.create` and `contacts.duplicate` check RBAC for the actor and no client scope.
   - Ticket CSV import inserts contacts directly after the ticket-create check.
3. **Email lookups ignore read scope.** `findContactByEmailAddress` returns the full contact for any email in the tenant, and `checkExistingEmails` reports tenant-wide matches. Both need only `contact:read`, which the seat already holds.

## Decision

A seat technician may create contacts for their arrangement's client. This is always on for a live seat; there is no per-arrangement switch (see Open questions).

Everything that expresses the MSP's relationship with the client stays with the MSP: moving a contact between clients, deleting a contact, portal access and invitations, the portal admin flag, visibility groups, and the client's billing and primary contact.

## Goals

- One create command for actor-initiated contact creation: permission, record-create authorization on the candidate's client, duplicate handling, insert, event. Server actions, REST, CSV import, ticket import and workflow actions with a user actor all call it.
- A seat technician can create a contact for their own client from the places they already work: the contact picker in the ticket Add dialog and on a ticket.
- A seat technician cannot create a contact for another client, or a contact with no client, through any path.
- A duplicate email never names or returns a contact or client the caller cannot read.
- Email lookups return only contacts in the caller's read scope.
- MSP users in a tenant with no published bundle and no resolver subject see no behaviour change beyond the corrected messages.

## Non-goals

- Editing, deactivating or deleting contacts as a seat technician. Contact update and delete paths are not record-scoped today; `2026-11-12-security-crm-client-contact-record-scope` owns that authorizer. Seat edit and deactivate follow once it has landed.
- Portal invitations, portal users, the portal admin flag and visibility groups for seat technicians.
- Opening `/msp/contacts`, `/msp/clients` or `/msp/create-contact` to the seat surface.
- REST, MCP and AI-tool contact creation for seat principals. Seat API credentials stay refused.
- A per-arrangement or per-tenant switch for this grant.
- System writers that have no user actor (inbound email, webhooks, directory and telephony sync, migration appliers, tenant provisioning).
- Changing tenant-wide email uniqueness for contacts.

## Users and flows

**Seat technician, new hire.** The technician opens Add Ticket, searches the contact picker and does not find the person. They choose Add new. The form shows their client already selected and not changeable, with no option to create a client. They enter name and email and save. The contact is selected on the ticket.

**Seat technician, email already known in their client.** Saving reports that the contact already exists and offers the existing contact.

**Seat technician, email belongs to another client or to a contact with no client.** Saving reports that the email address is already in use and that the MSP can help. No client is named and no contact is returned.

**Seat technician whose seat has lapsed or been revoked.** Create is refused by the existing seat write admission.

**Bundle-restricted MSP user.** Same rules as the seat: creates only within scope, and collisions outside scope are reported without a name.

**Unrestricted MSP user.** Unchanged, including the named-client collision message, because they can read that client.

## Design

### Contact create command

A single command in the contacts domain (beside the shared contact model) with the shape `createContactAs(trx, { tenant, actor, input })`:

1. RBAC `contact:create` for the actor (the portal own-client rule that `createOrFindContactByEmail` already honours stays).
2. `assertRecordCreateAllowed` for `resourceType: 'contact'` with the candidate's `clientId`, null included. This is the kernel `create` evaluation, so bundle rules, the seat resolver's closed baseline and the seat write-admission gate all apply, and it stays a single cached probe for tenants with nothing to narrow.
3. Duplicate lookup, tenant-wide as today, with the outcome projected through the actor's read scope: an in-scope match may be returned or named, an out-of-scope match yields the generic in-use result.
4. Insert through `ContactModel.createContact`, then the existing created event.

"Find or create" is the same command with a flag-free variant that returns the in-scope match instead of failing; it is not a second code path.

Every actor-initiated create path calls the command: `addContact`, `createClientContact`, the contact CSV import create branch, `createOrFindContactByEmail`, `createOrFindIntegrationContactByEmail` / `createOrFindContact`, REST `ContactService.create`, ticket CSV import, and workflow `contacts.create` / `contacts.duplicate` when the run has a user actor. `contactWritePaths.contract.test.ts` already ledgers contact writers; it pins that these paths reach the command and that the remaining direct writers are the system ones. The integration paths leave `permissionCoveragePinned.ts`.

`createClientPortalUser` is not moved: it creates a portal user and is gated by `user:create`, which the seat does not hold.

### Email lookups

`findContactByEmailAddress`, `findIntegrationContactByEmailAddress` and `checkExistingEmails` apply `createClientScopeContext(...).narrowing('contact')`. The CSV import preview then reports only in-scope duplicates; an out-of-scope duplicate surfaces at insert with the generic message.

### Seat authority

- `SEAT_AUTHORITY_POLICY.contact` gains `create: ['own_client']`.
- `CO_MANAGED_SEAT_ROLE_GRANTS` and `CAPABILITY_ROLES.psa` in `server/migrations/utils/permissions/roleGrants.cjs` gain `contact:create`; the catalog test keeps the two lists equal.
- Existing sponsor tenants already have a Seat Technician role. `admitCoManagedSeatRole` adds missing grants only when an arrangement is created or an invitation is accepted, so a migration adds `contact:create` to every existing seat role. It is additive and Citus-safe (see the `citus-migration-gotchas` skill).
- A candidate with no client is denied for a seat by the `own_client` condition; a test pins this.

### UI

- The contact picker's Add new affordance is shown only to a user who may create a contact.
- In the quick-add contact form, when the user's client scope resolves to exactly one client, that client is preselected and fixed, and the field is required. The add-new-client affordance is shown only to a user with `client:create`.
- Collision copy: one generic string for the out-of-scope case, added to the locale files, with no client name parameter.
- No raw ids are shown, and existing form components are reused.

### Edition boundary

Co-managed is a Pro feature whose code currently sits outside `ee/` (`packages/co-managed`); `2026-11-17-co-managed-ee-boundary` owns the move. The two grant lines change where the policy and role live when this work is implemented. Any new co-managed-specific code goes under `ee/`. The create command, the lookup narrowing and the UI gating are edition-neutral and belong in CE: they serve bundle-restricted users as much as the seat. Because the seat policy registers into the kernel as a built-in resolver, CE needs a test that a plain tenant with no resolver subject still creates contacts through the command with one probe and no behaviour change.

### Accepted limit

Contact email is unique per tenant, so a generic "already in use" answer still tells a seat technician that an address exists somewhere in the MSP's tenant. Removing that would require per-client uniqueness, which is out of scope. The answer carries no client, name or contact id.

## Rollout

Co-managed already ships behind the `co-managed` capability on `release-v2-0-feature`; no new flag. The create command and lookup narrowing are safe to land alone. The grant should not reach users before the command has landed, since the grant is what makes the unscoped paths matter.

## Acceptance criteria

- A seat technician creates a contact for their own client from the ticket Add dialog and selects it on the ticket.
- The same technician is refused, through every create path listed above, when the client is another client or absent, and no row is written.
- A lapsed or revoked seat is refused.
- A collision with an out-of-scope contact returns the generic message with no client name through every path; an in-scope collision returns the existing contact.
- `findContactByEmailAddress` and `checkExistingEmails` return nothing for an out-of-scope email.
- `createOrFindIntegrationContactByEmail` refuses a caller without `contact:create`.
- An unrestricted MSP user's create, find-or-create and CSV import behave as before.
- Existing sponsor tenants' seat roles hold `contact:create` after migration.

## Open questions

1. **Per-arrangement control.** Board scope already carries a per-arrangement `can_create`, so a switch has precedent. Recommendation: none. Contacts of the client are the client's own people, the grant excludes every MSP-relationship field, and `2026-11-24-system-managed-seat-technician-role` makes the role non-editable, so a switch would have to be a new arrangement column rather than a role edit.
2. **Edit and deactivate.** Offboarding is the other half of the technician's job. Recommendation: a follow-up plan after the record-scope authorizer lands, covering personal fields and deactivation, and deciding what happens to a contact that backs a seat assignment.
