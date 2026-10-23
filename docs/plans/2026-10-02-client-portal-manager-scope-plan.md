# Plan: Client portal manager scope and contact-assigned assets

Card: ace49b98 / PSA ticket alga-2026-0002577, "Client portal: manager role sees staff tickets; scope assets to contacts".
Base: `main @ 7fafd528c8`. Branch: `feature/alga-2026-0002577-client-portal-manager-role-see`.

## 1. Request

From Discord #alga-support (Napalm, rjgavin15, 2026-09-14):

1. Site, location and department managers see their staff's tickets. General users see only their own tickets, plus tickets and projects they have been added to.
2. A contact can be assigned to an asset. Standard portal users see only their assets; managers and admins see everything they are responsible for.

## 2. What exists today

### Ticket scope

- **Visibility groups.** `client_portal_visibility_groups.ticket_scope` is `'client' | 'contact'`, default `'client'` (`server/migrations/20260912090000_add_client_portal_ticket_scope.cjs`). A contact without a group has client scope.
- **Admin override.** `contacts.is_client_admin` forces client scope: `packages/tickets/src/lib/clientPortalVisibility.server.ts:176`.
- **Site-manager grant (already shipped).** `billing_profile_contacts.can_view_profile_tickets` was added with client merge (dd2504d246; `server/migrations/20260923100000_create_billing_profile_contacts.cjs`). Under contact scope it widens visibility to every ticket of the granted billing profiles. Tickets with no profile are included when the grant covers the client's default profile (`clientPortalVisibility.ts:57-79`, resolver `clientPortalVisibility.server.ts:59-99`). The merge PRD treats billing profiles as sites, and locations reach them through `client_locations.default_billing_profile_id`. The card's facts, validated against #3389 alone, predate this grant.
- **No manager relationship.** No contact field links a manager to their staff (no department, location, manager or reports-to). `users.reports_to` is MSP-only.
- **No "added to" link.** Contacts appear on tickets only through `tickets.attributes.watch_list` entries (`shared/lib/tickets/watchList.ts:6-16`; `entity_type: 'contact'`, `entity_id`, `active`). Watchers drive notifications only and grant no visibility.

### The ticket predicate is defined twice, and the copies disagree

- **SQL filter.** `applyTicketVisibilityFilter` (`packages/tickets/src/lib/clientPortalVisibility.ts:33`) is used by the portal actions (`client-tickets.ts:167,270,355,1204`, `dashboard.ts:217,347`) and the REST API (`server/src/lib/api/services/TicketService.ts:389-411`). It honours profile grants.
- **Kernel template.** `contact_visibility` (`packages/authorization/src/kernel/relationshipTemplates.ts:186-209`), plus its scope-only twin (`packages/authorization/src/kernel/providers/builtinProvider.ts:72-95`), is used for client subjects by `ticketActions.ts:1308,2330` and `optimizedTicketActions.ts:264,351`. It knows only `contactId`. A profile-granted ticket therefore passes the portal list and the REST API but is denied on the kernel paths.
- **Kernel input type.** `ContactVisibilityScope` (`packages/authorization/src/kernel/contracts.ts:69-74`) has no fields for grants.

### Assets

- **No contact link.** `assets` has no contact column. `asset_associations` is polymorphic with no foreign key, and its Zod/TS types allow only `ticket | project`.
- **Client-only filtering.** Portal reads filter on `client_id` alone:
  - `packages/client-portal/src/actions/client-portal-actions/client-assets.ts`: `listClientAssets` 97-190 (summary tiles 131-147), `getClientAssets` 193-213, `getClientAssetById` 221-242.
  - The `dashboard.ts` asset count (244-249) and maintenance activity (376-389).
  - The asset ownership check in `createClientTicket`, `client-tickets.ts:1394-1407`.
- **Portal users can't reach `/api/v1/assets`** (`apiMiddleware.ts:271-278`).
- **RMM user data is free text only.** RMM syncs record the logged-in user as text (`workstation_assets.current_user`) and never map it to a contact.

### Projects

- **Client-only filtering.** Portal reads filter on `client_id` alone:
  - `client-projects.ts:67,128,154`
  - `client-project-details.ts:62,520,619`
  - `client-project-billing.ts:82`
  - `dashboard.ts:228-233`
  - `clientDocumentAccess.ts:35` (project-task documents)
- **One contact per project.** A project has exactly one contact, `projects.contact_name_id`, and no membership table.

## 3. Decisions

**D1. Model "my staff" as a reports-to hierarchy: `contacts.manager_contact_id`.**
- The column is a nullable self-reference within the same client, and the relationship is transitive.
- A department head sees their leads' staff, and a site manager sees everyone who reports up to them. One concept covers site, location and department managers. Each person usually has one manager, which matches `users.reports_to` on the MSP side.
- The alternatives were weaker:
  - Location grants would key on `tickets.location_id`, which is often NULL, and would duplicate the billing-profile grant. That grant already gives a site-wide view, including tickets that have no contact.
  - A departments entity would add a table with nothing else to do.

**D2. Being named someone's manager is the grant.**
- The billing-profile flag separates label and grant because `is_manager` exists for billing/merge purposes. `manager_contact_id` exists only to say whose work a person oversees, so a separate grant flag would be a switch nobody leaves off.
- It widens only under contact scope. Client-scoped users and admins already see the whole client.

**D3. Watching a ticket grants read access to it.**
- An active watch-list entry with `entity_type = 'contact'` and `entity_id = me` makes the ticket visible to that contact under contact scope.
- The grant is personal. A manager does not inherit their staff's watched tickets.
- Matching is on the resolved `entity_id`, never on email. If implementation finds manual or inbound paths that leave contact entries without an `entity_id`, fix the resolution at write time (watch-list normalisation). Do not add email matching at read time.
- Rationale: watchers already receive the ticket's updates by email, so the portal shows them what they were sent.

**D4. Admins keep client-wide scope.** "Managers/admins see all" is what was requested, and the existing override stays. The card also lists this override as a gap, but it describes the existing behaviour rather than a problem to change.

**D5. Asset and project scope are separate, opt-in group settings.**
- New columns `client_portal_visibility_groups.asset_scope` and `project_scope`, each `'client' | 'contact'` with default `'client'`.
- Existing contact-scoped groups do not silently lose assets or projects. An MSP can keep tickets private while devices stay shared, or the reverse.
- The admin override applies to all three scopes and is computed once in the resolver.

**D6. An asset has one assigned contact: `assets.contact_name_id`.**
- One assigned user per asset is the asset-management norm. It mirrors `tickets.contact_name_id` and `projects.contact_name_id`, gets a real foreign key, and gives RMM user mapping a single column to write to later.
- `asset_associations` was rejected: it has no foreign key, `created_by` is NOT NULL, and it would allow several contacts per asset.
- Visible under contact asset scope: assets whose contact is me or someone who reports to me. Unassigned assets are hidden from contact-scoped non-admins, the same rule tickets with no contact follow.

**D7. A project is "mine" if `projects.contact_name_id` is me or someone who reports to me.** No project membership table (see §5).

**D8. Extract a portal-visibility layer into `@alga-psa/authorization`.**
- The resolver, the context type and the SQL and JS predicates for tickets, assets and projects move to `packages/authorization/src/portal/`. That package depends only on `@alga-psa/db` and `@alga-psa/types`, and tickets, assets, projects and client-portal can all import it.
- The kernel `contact_visibility` template calls the same predicate instead of keeping its own copy. That fixes the divergence in §2 and keeps the new grants from drifting the same way.
- `packages/tickets/src/lib/clientPortalVisibility*.ts` and `client-portal-actions/visibilityResolver.ts` become re-export shims, so existing importers and contract tests keep working.

## 4. Changes, in order

Each phase is a separate commit series that passes tests on its own.

### Phase 1: Extract the portal-visibility layer (no behaviour change except the kernel fix)

1. Create `packages/authorization/src/portal/visibility.ts` and `visibility.server.ts`:
   - Move `ContactVisibilityContext`, `applyTicketVisibilityFilter` and `getClientContactVisibilityContext` (with its helpers `resolveVisibleBoardIds` and `resolveGrantedTicketProfiles`) out of `packages/tickets/src/lib/clientPortalVisibility{,.server}.ts`.
   - Add `ticketMatchesVisibility(record, ctx)`, the in-memory equivalent of the SQL filter.
2. Make the tickets package files re-export from the new location. Keep `packages/tickets/src/lib/index.ts:63-67` and the `visibilityResolver.ts` shim working.
3. Make the kernel use the shared predicate:
   - Widen `ContactVisibilityScope` (`contracts.ts:69`) to the portal context. Add `billingProfileId` and `watcherContactIds` to `AuthorizationRecord`.
   - In `relationshipTemplates.ts:186-209`, `matches` calls `ticketMatchesVisibility`, and `compileSql` calls the shared SQL builder through new adapter columns (`billingProfileColumn`, `watchListColumn`) added to `RelationshipSqlAdapter` (`:47-67`) and `ticketAuthorizationSql.ts:15-43`.
   - The scope-only constraint list in `builtinProvider.ts:72-95` cannot express OR. Keep emitting the narrower conjunct `contact_name_id IN visibleContactIds`, which fails closed. Before relying on that, audit every consumer of `scope.constraints` (`kernel/scope.ts:24`) and confirm none filters on it more loosely than the SQL compile does.
4. Have `toTicketAuthorizationRecord` in `ticketActions.ts:~250` and `optimizedTicketActions.ts:~225` fill `billingProfileId` from `billing_profile_id` and `watcherContactIds` from `attributes.watch_list`. Make sure the queries that feed them select those columns.
5. Tests: kernel parity, meaning the same fixture is allowed or denied identically by the SQL filter, the kernel `matches` and the kernel `compileSql`. Add a regression test for a profile-granted ticket read through `getTicketById` as a client user.

### Phase 2: Schema (`server/migrations/`, `exports.config = { transaction: false }`, idempotent)

1. **`contacts.manager_contact_id uuid NULL`.**
   - Composite FK `(tenant, manager_contact_id)` → `contacts(tenant, contact_name_id)` with **NO ACTION**. On Citus, `SET NULL` on a composite FK also nulls `tenant`; follow `20260719120000_fix_suppression_contact_fk_set_null.cjs:21-37`.
   - Index `(tenant, manager_contact_id)`.
   - `CHECK (manager_contact_id <> contact_name_id)`.
2. **`client_portal_visibility_groups.asset_scope` and `project_scope`**: `text NOT NULL DEFAULT 'client'`, each with a CHECK constraint, in the same shape as `20260912090000`.
3. **`assets.contact_name_id uuid NULL`.**
   - Composite FK with NO ACTION, using the Citus distribution guard from `20260518120000_add_location_id_to_assets.cjs:128-184`.
   - Index `(tenant, client_id, contact_name_id)`.
4. Update the types in `packages/types` (`contact.interfaces.ts:58-83`, `asset.interfaces.ts:55-90,467,536`) and the visibility-group row types.

### Phase 3: Ticket visibility widening

1. **Resolver.** Under contact scope only, load `visibleContactIds`: me plus everyone who reports to me, directly or indirectly.
   - Use one query: `contacts WHERE client_id = mine AND manager_contact_id IS NOT NULL`, selecting `(contact_name_id, manager_contact_id)`. Walk the tree in memory with a visited set, so a cycle the database guard missed cannot loop.
   - Add `watchGrant: true`.
   - Admins and client-scoped users skip both, the same way profile grants are skipped today (`clientPortalVisibility.server.ts:121-134,177-179`).
2. **Predicate under contact scope:**
   ```
   board ∧ ( contact ∈ visibleContactIds
           ∨ billing_profile ∈ granted (∪ NULL when the default is granted)
           ∨ watch_list @> [{"entity_type":"contact","entity_id":me,"active":true}] )
   ```
   - An empty grant set must produce exactly today's SQL. Pin that with a snapshot test.
   - `watchListColumn` is optional in the same way `billingProfileColumn` is. A call site that doesn't pass it narrows rather than widens.
3. Pass `watchListColumn` at every site: `client-tickets.ts:167,270,355,1204`, `dashboard.ts:217,347`, `TicketService.ts:411`, and the kernel adapter.
4. **Mutations follow reads.** `resolveVisibleTicket` (`client-tickets.ts:152`) gates comments and status changes (`:631,758,921,1147`). A manager or watcher who can see a ticket can therefore comment on it, the same rule that applies to their own tickets.

### Phase 4: Authoring the manager relationship

1. **Server validation in `packages/clients`.** A shared `assertValidContactManager(trx, tenant, contactId, managerId)` checks:
   - the manager is in the same client and is not a shared mailbox (`contact_kind = 'person'`);
   - the manager is not the contact itself;
   - no cycle results, by walking up the chain with a depth bound.
2. **MSP side:**
   - Add a "Manager" `ContactPicker`, filtered to the same client and excluding the contact and their reports, in `packages/clients/src/components/contacts/ContactDetailsEdit.tsx`. Show it read-only in `ContactDetailsView.tsx`.
   - Persist it through the contact update action in `contactActions.tsx`.
   - `ContactPortalTab.tsx` shows "Sees tickets of N people who report to them" when the contact is contact-scoped.
3. **Portal admin side:** `ClientUserDetails.tsx`/`UserManagementSettings.tsx` gain the same picker, persisted through `clientUserActions.ts` `updateClientUser` (`:318`) behind the existing `is_client_admin` check.
4. **REST API:** add `manager_contact_id` to the v1 contact schemas and service, validated with the same assertion.
5. **Integrity paths:**
   - `deleteContact` (`contactActions.tsx:421`, cleanup 440-494) nulls `manager_contact_id` on the deleted contact's reports and nulls `assets.contact_name_id` for it. This is needed because both FKs are NO ACTION.
   - Changing a contact's `client_id` clears that contact's manager and detaches its reports.
   - The client merge engine (`packages/clients/src/lib/clientMergePlan.ts:355`) moves contacts together, so links stay within one client. Add a merge test.

### Phase 5: Assets

1. **MSP write paths** (`packages/assets/src/actions/assetActions.ts`):
   - `createAssetInTransaction` (855-929), `updateAssetRecord` (1072), `updateAsset` (1321) and `bulkUpdateAssets` (1512).
   - Validate with a `resolveValidatedAssetContact` modelled on `resolveValidatedAssetLocation` (286-315).
   - Keep an explicit `null` in `sanitizeUpdatePayload` (278-280), as `location_id` does.
   - Clear the contact when `client_id` changes (next to 1135-1158).
   - Add a `contact_name_id` filter to `listAssets` (1853).
2. **Zod schemas:** `packages/assets/src/lib/schemas/asset.schema.ts` 97-106, 194-215, 258-260.
3. **REST API:** `server/src/lib/api/services/AssetService.ts` (list filter 97-113, create 291-301, update 335-383 clearing on client change, plus an `assertContactBelongsToClient` modelled on 416-431) and `server/src/lib/api/schemas/asset.ts`.
4. **UI:**
   - An "Assigned to" `ContactPicker` in `AssetForm.tsx` and `QuickAddAsset.tsx`, next to the location picker.
   - Display it in `panels/AssetInfoPanel.tsx:132-142`.
   - Add an "Assigned to" column/filter in the MSP asset list.
5. **RMM:** `shared/rmm/sharedAssetIngestionService.ts:278-284` clears `contact_name_id` when a sync moves an asset to another client.
6. **Portal enforcement:** add `applyAssetVisibilityFilter(query, ctx, { contactColumn })` to the portal layer and apply it in:
   - `client-assets.ts`: `resolveClientId` (71-92) becomes a call to the visibility resolver. Apply the filter in `listClientAssets`, including the summary tiles (131-147) so the counts match the list, and in `getClientAssets` and `getClientAssetById`.
   - `dashboard.ts`: the asset count (244-249) and the maintenance activity (376-389).
   - `createClientTicket`: the asset ownership check (`client-tickets.ts:1394-1407`) uses the asset filter, so a user can only file tickets against assets they can see.
7. **Ticket-linked assets stay authorised by the ticket.** `getClientTicketDetails` linked assets (`client-tickets.ts:407-427`) keep the client filter, because seeing the ticket shows its context. Change the `TicketDetails.tsx:748` pill to render from `linkedAssets` instead of calling `getClientAssetById`, so it doesn't go blank for an asset the viewer can't otherwise see.
8. **Contract test:** update `client-assets.contract.test.ts:41-46` to assert the new choke point. Don't delete the assertion.

### Phase 6: Projects

1. Add `applyProjectVisibilityFilter(query, ctx, { contactColumn: 'projects.contact_name_id' })` and apply it at:
   - `client-projects.ts:67,128,154`
   - `client-project-details.ts:62` (project gate), `:520` and `:619` (task gates)
   - `client-project-billing.ts:82`
   - `dashboard.ts:228-233`
   - the project-task branch of `clientDocumentAccess.ts:35`
2. Every client-only `contacts → client_id` lookup in those files goes through the resolver instead. No new hand-rolled client resolution.

### Phase 7: Group editor UI and copy

1. **Server actions:** `asset_scope` and `project_scope` on create, update and read in both modules: `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts` (19, 43, 280, 479, 541) and `packages/clients/src/actions/contact-actions/contactActions.tsx` (1781-1790, 1950, 2023, 2104-2192).
2. **Editors:** `VisibilityGroupsSettings.tsx` and `ContactPortalTab.tsx` add a scope `RadioGroup` (`packages/ui/src/components/RadioGroup.tsx`, vertical, with descriptions) for **Devices** and for **Projects**, alongside the existing Tickets one.
   - Group list rows (`VisibilityGroupsSettings.tsx:452`, `ContactPortalTab.tsx:1070`) summarise all three scopes.
   - The "Only their own" descriptions say that managers also see the people who report to them, and that client admins always see everything.
3. **Locales:** `client-portal.json` and `msp/contacts.json` for en, de, es, fr, it, nl, pl, pt, xx, yy, plus the asset strings in the assets namespace. Run the i18n audit (`tools/i18n/tests/audit-tooling.test.mjs`).

### Phase 8: Docs

- Update `docs/client-ticket-visibility.md` to cover managers, watchers, device scope and project scope, including what unassigned devices and contact-less tickets mean.
- Prepare the matching nm-store patch as #3389 did.

## 5. Deliberately not doing

- **No location-level or department-level grant tables.** Reports-to covers people. The existing billing-profile grant covers a site's tickets, including tickets with no contact.
- **No change to the client-admin override.**
- **No project membership table.** "Projects they're added to" maps to the project's single contact. A multi-contact project roster would be a project-management feature with its own MSP surface, so it should be a follow-up card.
- **Managers don't see their staff's watched tickets.** The watch grant is personal.
- **No automatic mapping of RMM `current_user` to a contact.** The new column is where it would write; that is a follow-up.
- **No manager import:** no Entra/Graph `manager` sync and no CSV import column in `ContactsImportDialog.tsx`. Both are follow-ups that write `manager_contact_id`.
- **No client-level default visibility group.** "General users see only their own" still means assigning them to a contact-scoped group.
- **No contact scoping of invoices, billing metrics (`client-billing-metrics.ts`), contracts, appointment requests or documents**, beyond the ticket-derived and project-derived document paths.
- **No change to MSP-side visibility. Portal access to `/api/v1/assets` stays internal-only.**

## 6. Risks

- **Watchers can see more tickets than before.** Existing contact-scoped users will see tickets they are active watchers on, including tickets where they were added automatically from an inbound CC. This is intended (D3), and it must be in the release note and the docs. If the captain wants it opt-in, it becomes a fourth group flag; the predicate does not change.
- **Kernel paths honour profile grants after Phase 1.** Profile-granted contacts gain read access on `ticketActions`/`optimizedTicketActions` paths that currently deny them. The portal list and the REST API already allow those reads, so this removes an inconsistency.
- **Large or unindexed predicates.**
  - A manager of hundreds of staff produces an `IN` list of that size. That is bounded by the client and well under parameter limits; a subquery would be the fallback.
  - The `watch_list` JSONB containment check has no index. It runs after the tenant, client and board predicates. Measure on a large tenant before adding an expression index.
- **Citus foreign keys.** `SET NULL` on composite foreign keys breaks on Citus. With NO ACTION, the contact-delete and client-change cleanups are the only thing keeping the data consistent, and they need tests.
- **Hierarchy cycles.**
  - The database guard covers only self-reference. Longer cycles are blocked by the server-side check.
  - The resolver's visited set means corrupt data cannot hang a request.
- **Devices tab can go empty.** Turning on contact asset scope hides unassigned devices from ordinary members, so the tab can look empty until the MSP assigns contacts. The scope description and docs must say so.
- **Tests that pin source text or mock builders:**
  - `server/src/test/unit/client-portal/algadeskPortalTicketing.contract.test.ts:39`
  - `client-assets.contract.test.ts:41-46`
  - the closed method list of the `makeChainable` fake in `client-tickets.visibility.test.ts`

  Update them to the new choke points rather than deleting them. At least one DB-backed suite (`server/src/test/integration/ticketClientPortalAbac.integration.test.ts`) must exercise the real SQL for manager, watcher and asset scopes.

## 7. Test plan (summary)

- **Unit:**
  - Resolver: hierarchy walk, cycle, admin override, no group, cross-client manager rejected.
  - SQL snapshot: no grants produces byte-identical SQL.
  - Parity: SQL filter = kernel `matches` = kernel `compileSql` for tickets.
- **Integration (DB):**
  - Manager sees a report's and a sub-report's tickets, not a peer's.
  - Watcher sees a watched ticket; an inactive entry grants nothing.
  - REST `/api/v1/tickets` and `getTicketById` agree with the portal list.
  - Asset scope: list, tiles, dashboard and ticket-create ownership.
  - Project scope: list, detail, tasks and task documents.
  - Contact delete and client change clear links.
- **Smoke (portal):** three contacts (admin, manager, report) in one client, a contact-scoped group with device and project scope on. Check what each one sees on Tickets, Devices, Projects and Dashboard.
