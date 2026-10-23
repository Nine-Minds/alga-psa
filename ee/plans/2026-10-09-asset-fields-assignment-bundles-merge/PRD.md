# PRD — Asset fields, people assignment, bundles & shared workspaces, merge billing attribution

- Slug: `asset-fields-assignment-bundles-merge`
- Date: `2026-10-09`
- Status: Draft

## Summary

Close the gaps that a Snipe-IT comparison exposed in AlgaPSA's asset record, and fix how assets relate to people and to billing. Five pieces, in build order:

1. **Asset record fields.** Manufacturer, model, vendor, purchase cost, order number become first-class columns, and asset status becomes a tenant-managed list with a lifecycle kind instead of a free-text field with three hardcoded options.
2. **Assignment to a person.** The assigned contact is shown everywhere an asset is shown (details page, drawer, client Assets tab, contact page, client portal, mobile), can be set in one click from the details page, and every change is kept as assignment history.
3. **RMM signed-in user to contact.** The user name RMM agents report is matched to a client contact, suggested on the asset, and optionally auto-assigned. Unmatched names can be mapped once per RMM organization.
4. **Bundles and shared workspaces.** A set of equipment can be grouped. A bundle travels and is assigned as one unit. A shared workspace (front desk, lab bench, hot desk) has a location and a list of people who use it instead of a single assignee.
5. **Merge, RMM and billing.** When a client is merged into another, the merge shows which RMM organizations and assets move and lets the operator choose whether the merged client's work and devices (tickets, projects, assets, RMM organizations) stay billed under the merged client's billing profile or fold into the target's default profile. Assets and RMM organization mappings gain an optional billing profile, and changing an RMM organization's client moves its assets immediately and consistently across providers.

The Snipe-IT connector itself (import and sync) is a separate plan that builds on these fields.

## Problem

- **Thin asset record.** Assets have no manufacturer, model, vendor, cost or order number columns. Imports stuff manufacturer and model into `attributes` jsonb and the details page digs model out of RMM `system_info`. Status is free text with three hardcoded options (`active`, `inactive`, `maintenance`) and RMM sync overwrites it on every run, so an MSP cannot mark a device "in repair" or "in stock" and have it stick.
- **Assignment is half-built.** `assets.contact_name_id` exists and drives client-portal visibility, but it is only editable in the edit form and quick-add, and only visible in the list column. The details page, the drawer, the client Assets tab, the contact page, the portal and mobile do not show who an asset is assigned to. Changes are buried inside `asset_history.changes` with no dedicated record, so there is no "who had this laptop in March" answer.
- **RMM knows the user, Alga ignores it.** Every RMM provider reports a last-signed-in user into `workstation_assets.current_user` / `server_assets.current_user`. It is displayed as a string ("Signed in: CORP\\jdoe") and never linked to a contact, so an MSP that syncs 400 devices still assigns each one by hand.
- **No grouping.** `asset_relationships` is pairwise parent/child with a free-text type and a flat table. There is no way to say "these six things are the front-desk setup" or "this is a hot desk used by three people".
- **Merge is a black box for assets.** Client merge moves `assets` and `rmm_organization_mappings` to the target, but the dialog does not say so, and there is no way to keep the merged site's devices billed separately from the parent. Assets have no billing profile, so tickets raised from alerts on those devices fall to the target's default profile. Separately, Level.io and Tanium sync re-stamp `client_id` on every run (reverting manual moves) while NinjaOne never does, and re-pointing an RMM organization mapping moves assets late or never.

## Goals

- Manufacturer, model, vendor, purchase cost and order number are editable, displayed, searchable, exposed on the REST API and populated by RMM sync and the migration importer.
- Asset status is a per-tenant list with a lifecycle kind. RMM sync stops overwriting the human-managed status on update.
- The assigned contact is visible on every asset surface and changeable from the details page without opening the full form. Every assignment change is recorded with who, when and source.
- RMM signed-in users are matched to contacts with explicit mapping as a fallback. Per RMM organization the MSP chooses off, suggest or auto-assign.
- Assets can be grouped into bundles (one owner, moves as a unit) or shared workspaces (a place plus a list of users). Groups are visible on the asset, the client and the contact, and shared-workspace users see those assets in the client portal.
- Client merge shows assets and RMM organizations that move and offers one billing choice that governs tickets, projects, assets and RMM organization mappings with no explicit profile. Assets and RMM organization mappings can carry a billing profile that flows into tickets created from them. Changing an RMM organization's client moves its assets immediately, for every provider, and sync no longer reverts manual client moves.

## Non-goals

- The Snipe-IT connector (API pull, category and company mapping, incremental sync). Separate plan.
- Software licenses and seats, accessories, consumables, components, depreciation, book value, EOL dates.
- A client parent/child hierarchy model. `clients.properties.parent_client_id` stays as it is.
- Un-merging a client. Changing how billing history rows (invoices, cycles, payments, transactions, credits, tax settings) are stamped on merge: they always keep the moved profile, since they are issued history rather than moving work.
- Booking or scheduling for shared workspaces. A shared workspace is a static list of people.
- Editing groups or assignments from the mobile app. Mobile is read-only for the new data in this plan.
- Check-in/check-out workflows with signatures or EULA acceptance.
- Changing which RMM fields (name, serial, agent status, extension data) sync owns, beyond `status` and `client_id` as specified here.

## Users and Primary Flows

**Personas:** MSP technician (works tickets, touches devices), MSP asset or account manager (maintains the fleet record, runs merges), client contact in the portal.

1. **Enrich a device.** A technician opens a laptop's details page. The Identity tile shows Manufacturer, Model, Vendor, Purchase cost and Order no. alongside tag, serial, status and dates. The status reads "In repair", a status the MSP added in Settings. RMM sync ran overnight and did not change it.
2. **Assign in one click.** On the same page the Identity tile shows "Assigned to: Unassigned" with an **Assign** button. The technician picks a contact from the client's contacts. The timeline gains "Assigned to Jane Doe by Alex". The contact's page now lists the laptop under Assets.
3. **Accept an RMM suggestion.** The Live vitals tile shows "Signed in: CORP\\jdoe · Looks like Jane Doe · Assign". One click assigns the asset and remembers that `jdoe` is Jane for this RMM organization. In Settings the MSP flips that organization to **Auto-assign**, and from then on new devices Jane signs into are assigned to her on sync, unless someone assigned them by hand.
4. **Build a front-desk bundle.** In the asset list the manager selects a PC, two monitors, a dock and a label printer and chooses **Add to group → New bundle "Front desk 1"**. Assigning the bundle to the receptionist assigns all five. Moving the bundle to the "Lobby" location moves all five.
5. **Set up a hot desk.** The manager creates a group of kind **Shared workspace** called "Hot desk B", at location "Floor 2", adds a PC and monitor, and adds three contacts as users. The assets show "Shared workspace: Hot desk B · 3 people" instead of an assignee. All three see the assets in the client portal. A ticket raised from that PC offers those three as the contact.
6. **Merge a site into its parent.** The manager merges "Acme Warehouse" into "Acme Corp". The merge dialog's new **Assets and RMM devices** section says "2 RMM organizations (NinjaOne: Acme WH, Tactical: acme-wh) and 37 assets will move. Bill them under: ( ) Acme Warehouse billing profile, kept as a separate profile on Acme Corp  ( ) Acme Corp default billing profile". They keep the separate profile. Afterwards alert tickets for those 37 devices land on the Acme Warehouse profile, and sync keeps the devices under Acme Corp.
7. **Re-point an RMM organization.** In NinjaOne settings the manager changes the "Acme WH" organization from client "Acme Corp" to "Acme Logistics". A confirmation says "37 assets will move to Acme Logistics. Assignees, groups and billing profiles that belong to Acme Corp will be cleared." The assets move immediately, for NinjaOne the same as for Level.io.

## UX / UI Notes

Ids are kebab-case on every interactive element. All strings go through `t()` in `server/public/locales/<lang>/msp/assets.json` (and the client-portal and mobile locale files where touched), and are added to every locale.

### Asset form and quick add (`packages/assets/src/components/AssetForm.tsx`, `QuickAddAsset.tsx`)
- New fields in the general section: **Manufacturer** (text), **Model** (text), **Vendor** (searchable select of the tenant's `vendors`, with "Create vendor" link to inventory vendors), **Purchase cost** (money input, tenant default currency, stored as cents), **Order no.** (text).
- **Status** select now lists the tenant's active `asset_statuses`, grouped by kind. Archived statuses still display when already set.
- **Billing profile** select appears only when the client has more than one active billing profile. Cleared when the client changes.
- The "Assigned to" picker stays as it is.

### Asset details page (`packages/assets/src/components/AssetBentoLayout.tsx`, `AssetDetailHeader.tsx`)
- Identity tile gains rows: **Assigned to** (contact name as a link that opens the contact drawer, or "Unassigned" plus an **Assign** button, id `asset-assign-button`), **Manufacturer**, **Model**, **Vendor**, **Purchase cost**, **Order no.**, **Billing profile** (only when set). Rows with no value are hidden except Assigned to.
- **Assign** opens a popover with the existing `ContactPicker` filtered to the asset's client, plus **Unassign**. Saving writes an assignment with source `manual`.
- Live vitals "Signed in" row: when a suggestion exists, append "Looks like {contact} · Assign". When no match, append "Map to contact…" which opens the contact picker and saves an explicit RMM user mapping. Hidden when the asset is in a shared workspace.
- New tile **Group** (id `asset-bento-group`), shown when the asset is in a group: kind badge (Bundle / Shared workspace), group name linking to the group drawer, location, sibling assets (name + type, linking to each), people (owner for bundle, users for shared workspace). When not in a group, a small **Add to group** action in the Related assets tile.
- Timeline: assignment entries ("Assigned to X by Y", "Unassigned by Y", "Auto-assigned to X from {provider} signed-in user", "Assigned to X via bundle Z") and group entries ("Added to bundle Z", "Removed from Z").

### Asset drawer (`AssetDetailDrawerClient.tsx`)
- Info grid adds Assigned to, Manufacturer, Model, Group.

### Asset list (`AssetDashboardClient.tsx`)
- Optional columns Manufacturer, Model, Group. Filters: status comes from `asset_statuses`; new filter "Group".
- Bulk actions add **Assign to contact** (enabled only when all selected assets share one client) and **Add to group** (same rule), which opens a dialog to pick an existing group of that client or create a new one (name + kind).

### Client page Assets tab (`packages/msp-composition/src/clients/MspClientAssets.tsx`)
- Add column **Assigned to**. Add a segmented control **Assets | Groups**. The Groups view lists the client's groups (name, kind, location, member count, people) with **New group** and row click opening the group drawer.

### Group drawer (new, `packages/assets/src/components/groups/AssetGroupDrawer.tsx`)
- Header: name (editable), kind badge, client, location select (client's locations).
- **Members**: list with remove; **Add assets** uses `ClientAssetMultiSelect` restricted to the client and to assets not in another group.
- **People**: for a bundle, a single **Owner** contact picker; for a shared workspace, a list of **Users** with add/remove via `ContactPicker`.
- Description, Delete group (members keep their current assignee and location).
- Changing kind from shared workspace to bundle requires removing users first; the reverse unassigns members (confirm dialog explains).

### Contact page (`packages/contacts` contact details)
- New **Assets** section: assigned assets (name, type, tag, status, link) and **Shared workspaces** the contact uses (group name, location, member count).

### Settings
- **Assets → Statuses** (new tab in `packages/assets/src/components/settings`): table of statuses with label, kind, builtin flag, in-use count; add, rename, change kind, archive. Builtin statuses can be renamed and archived but not deleted. A status in use cannot be archived until no assets use it (show count).
- **RMM organization mapping managers** (Tactical in `packages/integrations`, NinjaOne/Huntress/Tanium/Level.io in `ee/server`): each mapping row gains **People** (select: Off / Suggest / Auto-assign) and **Billing profile** (select, only when the mapped client has more than one active profile). A shared **Signed-in users** panel (`RmmUserContactMappingPanel`, in `packages/integrations`) lists distinct normalized signed-in user names for the organization with device count, matched contact (and how: mapped / email / username / name), and a contact picker to map or re-map. Changing the mapped client on a row shows a confirmation with the asset count that will move.

### Merge dialog (`packages/clients/src/components/clients/MergeClientsDialog.tsx`)
- New section **Assets and RMM devices** between contracts and the confirm step: list of RMM organization mappings moving (provider, external name, device count), total assets moving, groups moving. Radio **Bill merged work and devices under**: "{source} billing profile, kept as a separate profile on {target}" (default) or "{target} default billing profile". The section states that the choice applies to tickets, projects, assets and RMM devices that have no explicit billing profile, with counts for each. Preview endpoint supplies the counts.

### Client portal (`packages/client-portal/src/components/assets`)
- Asset list and detail show **Assigned to** and, for shared-workspace members, "Shared workspace: {name}".

### Mobile (`ee/mobile`)
- Asset detail screen shows Assigned to, Manufacturer, Model, Vendor, Group (read-only).

## Requirements

### Functional Requirements

**A. Asset record fields**
- FR-A1. `assets` gains `manufacturer text`, `model text`, `vendor_id uuid` (composite FK to `vendors (tenant, vendor_id)`, ON DELETE SET NULL via application clear in vendor delete path), `purchase_cost bigint` (cents), `purchase_cost_currency text` (defaults to tenant currency on write), `order_number text`.
- FR-A2. A data migration copies `attributes.manufacturer` and `attributes.model` into the columns and removes those keys; it also copies `system_info.model` / `system_info.manufacturer` (or `systemModel`) from `workstation_assets` / `server_assets` into the columns when they are empty.
- FR-A3. `NormalizedRmmDeviceExtensionSnapshot` gains `manufacturer` and `model`. Every provider mapper (Tactical, NinjaOne, Level.io, Tanium, Huntress) fills them when the source has the data. Shared ingestion and the NinjaOne engine write the columns on create and on update whenever the snapshot value is non-empty.
- FR-A4. Create, update, bulk update, the REST API (`AssetService`, schemas, OpenAPI) and the migration importer accept and return the new fields. The importer writes columns instead of `attributes`.
- FR-A5. The details page Model row reads the column; the `system_info` fallback in `getModelName()` is removed.
- FR-A6. Asset search (list search box, command palette) matches manufacturer and model.

**B. Status taxonomy**
- FR-B1. New table `asset_statuses` (tenant, status_id, slug, label, kind in `deployable | pending | undeployable | archived`, is_builtin, is_active, display_order, timestamps). PK (tenant, status_id), UNIQUE (tenant, slug). Distributed by tenant.
- FR-B2. A migration seeds every tenant with `active` (deployable, "Active"), `in_stock` (deployable, "In stock"), `maintenance` (pending, "In maintenance"), `inactive` (undeployable, "Inactive"), `retired` (archived, "Retired"), and new tenants get the same via the tenant bootstrap path. Existing `assets.status` values not in the list are inserted as custom statuses with kind `undeployable` so nothing is lost.
- FR-B3. `assets.status` keeps storing the slug. Create, update, bulk update and the REST API reject a slug that is not an active status for the tenant (archived allowed only when unchanged).
- FR-B4. Settings UI to list, add, rename, change kind, reorder and archive statuses. Deleting is not offered. Archiving is blocked while assets use the status.
- FR-B5. Status filters and the dashboard breakdown read from `asset_statuses`. Metrics that treat "active" as deployed (`AssetSummaryMetrics`, health) use `kind = deployable` instead of the literal slug.
- FR-B6. RMM sync sets `status` only on asset creation (`active`, or `inactive` when the device is offline at first sight) and sets `retired` when the device is deleted or tombstoned. It no longer writes `status` on ordinary updates. Connectivity continues to live in `agent_status`.

**C. Assignment history and surfaces**
- FR-C1. New table `asset_assignments` (tenant, assignment_id, asset_id, contact_name_id, assigned_at, assigned_by_user_id nullable, unassigned_at nullable, unassigned_by_user_id nullable, source in `manual | api | rmm | bundle | import | merge | system`, note text nullable). PK (tenant, assignment_id); indexes on (tenant, asset_id, unassigned_at) and (tenant, contact_name_id, unassigned_at).
- FR-C2. A single helper `setAssetAssignee(trx, tenant, assetId, contactId | null, { actorUserId, source, note })` in `packages/assets/src/lib/assetAssignment.ts` closes the open assignment, opens a new one when `contactId` is set, updates `assets.contact_name_id`, and writes an `asset_history` row with `change_type = 'assignee_changed'`. It validates the contact belongs to the asset's client. It is a no-op when the assignee is unchanged.
- FR-C3. Every writer uses the helper: `createAsset`, `updateAsset`, `bulkUpdateAssets`, `AssetService` create/update (source `api`), shared RMM ingestion and NinjaOne engine client-change clearing (source `system`), the migration importer (source `import`), bundle propagation (source `bundle`), RMM auto-assign (source `rmm`).
- FR-C4. A backfill migration opens one assignment row per asset with a non-null `contact_name_id` (assigned_at = `assets.updated_at`, source `system`).
- FR-C5. `clearContactLinksBeforeDelete` closes open assignments for the contact (unassigned_at = now, source `system`) in addition to nulling `assets.contact_name_id`.
- FR-C6. Details page, drawer, client Assets tab, contact page, client portal list and detail, and mobile detail show the assigned contact as specified in UX.
- FR-C7. Details page **Assign** popover and list bulk **Assign to contact** write through the helper with source `manual`.
- FR-C8. `getAssetAssignments(assetId)` and `getContactAssignedAssets(contactId)` actions, and REST `GET /api/v1/assets/{id}/assignments`.
- FR-C9. Timeline renders assignment and group entries from `asset_history`.

**D. RMM signed-in user to contact**
- FR-D1. `normalizeRmmUsername(raw)` in `shared/rmm/userMatching.ts` returns `{ key, username, domain, email }`: strips `DOMAIN\`, `AzureAD\`, `.\`; detects `user@domain` as email; lower-cases; collapses `First Last` into `username = "first last"` for name matching. `key` is the lower-cased raw value without the domain prefix.
- FR-D2. `matchContactForRmmUser(trx, tenant, clientId, integrationId, provider, normalized)` returns `{ contactId, method }` or null. Order: explicit mapping in `tenant_external_entity_mappings` (integration_type `rmm:<provider>`, alga_entity_type `contact`, external_realm_id = integration id, external_entity_id = key); contact email equals `email`; exactly one contact whose email local part equals `username`; exactly one contact whose full name equals `username` case-insensitively. Ambiguity returns null. Only contacts of `clientId` are considered.
- FR-D3. `rmm_organization_mappings` gains `contact_assignment_mode text not null default 'suggest'` (`off | suggest | auto`).
- FR-D4. In `auto` mode, shared ingestion and the NinjaOne engine, after upserting the extension row, call the matcher when `current_user` is non-empty and the asset is not a shared-workspace member. If a contact is found and the asset is unassigned, or its open assignment has source `rmm`, the helper assigns with source `rmm` and note = the raw user name. A manual, bundle, api or import assignment is never overridden. An empty `current_user` never unassigns.
- FR-D5. In `suggest` mode nothing is written on sync. `suggestAssigneeFromRmmUser(assetId)` action computes the match for the details page.
- FR-D6. `mapRmmUserToContact(integrationId, provider, rawUser, contactId | null, { assignAssetId? })` action upserts or deletes the explicit mapping and, when `assignAssetId` is given, assigns that asset with source `manual`. In `auto` mode other assets of the organization with the same key and an `rmm`-sourced or empty assignment are assigned in the same call.
- FR-D7. `listRmmSignedInUsers(integrationId, externalOrganizationId)` action returns distinct normalized keys with raw samples, device count, matched contact and method.
- FR-D8. The shared panel and the mode/billing selects are added to the Tactical mapping UI (CE) and the four EE mapping managers.

**E. Bundles and shared workspaces**
- FR-E1. Tables: `asset_groups` (tenant, group_id, client_id, name, kind in `bundle | shared_workspace`, location_id nullable with composite FK to `client_locations`, description, created_by, created_at, updated_at; PK (tenant, group_id)); `asset_group_members` (tenant, group_id, asset_id, added_at, added_by; PK (tenant, group_id, asset_id); UNIQUE (tenant, asset_id)); `asset_group_contacts` (tenant, group_id, contact_name_id, role in `owner | user`, added_at; PK (tenant, group_id, contact_name_id)). All distributed by tenant.
- FR-E2. Invariants enforced in the model layer: member asset's `client_id` equals the group's; contact's `client_id` equals the group's; a bundle has at most one `owner` and no `user`; a shared workspace has no `owner`; a shared-workspace member has `contact_name_id` null.
- FR-E3. Bundle propagation: setting or clearing the owner assigns or unassigns every member (source `bundle`, note = group name); adding a member assigns it to the owner and sets its `location_id` to the group's; changing the group's location updates every member's `location_id`. Removing a member or deleting the group leaves members' assignee and location as they are.
- FR-E4. Shared workspace: adding a member that has an assignee unassigns it (source `bundle`, note = group name) after a confirm in the UI. The Assign action and RMM auto-assign are disabled for members; the details page shows the group's users instead.
- FR-E5. Moving an asset to another client (manual, API, RMM mapping move, merge is exempt since groups move too) removes it from its group and writes `group_removed` history.
- FR-E6. Deleting an asset removes its member row. Deleting a contact removes its `asset_group_contacts` rows and clears bundle owner propagation (members become unassigned via FR-C5).
- FR-E7. Client portal visibility with `asset_scope = 'contact'` includes assets that are members of a shared workspace where the contact (or one of their reports) is a `user`.
- FR-E7b. Portal ticket creation and the portal asset picker use the same extended filter, so a shared-workspace user can raise a ticket on any workspace asset. Under ticket scope `contact`, the portal ticket list and ticket detail also include open tickets linked (via `asset_associations`) to a shared workspace the contact uses, read-only unless the contact is requester or watcher.
- FR-E8. Ticket from asset (MSP button, portal, mobile, alert ticket creator): when the asset is a shared-workspace member and the ticket has no contact, offer the group's users; preselect when there is exactly one.
- FR-E9. Actions: `createAssetGroup`, `updateAssetGroup`, `deleteAssetGroup`, `addAssetsToGroup`, `removeAssetFromGroup`, `setAssetGroupOwner`, `addAssetGroupUser`, `removeAssetGroupUser`, `listAssetGroups(clientId)`, `getAssetGroup(groupId)`, `getAssetGroupForAsset(assetId)`, `getContactSharedWorkspaces(contactId)`. REST: `/api/v1/asset-groups` CRUD, `/members`, `/contacts`, documented in OpenAPI.
- FR-E10. `asset_history` entries `group_added` and `group_removed` on the asset; group changes recorded in `asset_history` of each affected member when assignment or location propagates (through the helper and the location update).
- FR-E11. `asset_groups` joins `CLIENT_OWNED_MOVE_TABLES` in the client merge plan so groups follow the client. Member and contact rows are keyed by group and need no change.
- FR-E12. UI as specified: group tile on details, Groups view on the client Assets tab, group drawer, bulk Add to group, Group column and filter in the list, contact page Shared workspaces, mobile read-only.

**F. Billing attribution for assets and RMM organizations**
- FR-F1. `assets.billing_profile_id uuid nullable` (composite FK to `client_billing_profiles (tenant, billing_profile_id)`); `rmm_organization_mappings.billing_profile_id uuid nullable` (same FK). Validation: the profile belongs to the row's client and is active. Cleared whenever the row's `client_id` changes.
- FR-F2. `resolveAssetBillingProfileId(trx, tenant, assetId)` returns `asset.billing_profile_id ?? asset.location.default_billing_profile_id ?? null`.
- FR-F3. Ticket creation from an asset (MSP CreateTicketFromAssetButton, portal, mobile, `createTicketForAlert`) passes `billing_profile_id` when the caller supplied none: for alert tickets `mapping.billing_profile_id ?? resolveAssetBillingProfileId`; otherwise `resolveAssetBillingProfileId`. `TicketModel.resolveTicketBillingProfileId` is unchanged and still validates.
- FR-F4. Asset form and Identity tile expose the asset's billing profile (only when the client has more than one active profile). RMM mapping managers expose the mapping's billing profile under the same condition.
- FR-F5. The client merge moves `assets.billing_profile_id` and `rmm_organization_mappings.billing_profile_id` with their profiles (profiles already move; ids are stable, so no re-stamp is needed). Per the operator's choice, moving rows whose profile is null are either stamped with the moved default profile (`source_profile`, default, today's behaviour for tickets and projects) or left null so they inherit the target default (`target_default`). The choice applies uniformly to `tickets`, `projects`, `assets` and `rmm_organization_mappings`. Rows with an explicit profile are untouched. Billing history tables (invoices, cycles, payments, transactions, credits, tax settings) keep today's stamping regardless of the choice.

**G. Merge dialog and RMM mapping moves**
- FR-G1. `previewClientMerge` returns `assets: { total, byRmmOrganization: [{ provider, integrationId, externalOrganizationId, externalOrganizationName, deviceCount }], groups }` and `billingChoice: { unstampedTickets, unstampedProjects, unstampedAssets, unstampedRmmMappings }` (counts of moving rows with a null profile that the choice will affect).
- FR-G2. `executeClientMerge`, the server action, `ClientService.mergeClient` and the REST merge route accept `billingStrategy: 'source_profile' | 'target_default'` (default `source_profile`), apply FR-F5 and record the choice in `client_merges` (new column `billing_strategy text`).
- FR-G3. The merge dialog renders the Assets and RMM devices section with counts and the radio, and the radio's helper text lists the affected counts for tickets, projects, assets and RMM devices.
- FR-G4. A shared `moveRmmOrganizationAssets(trx, tenant, mapping, newClientId, actorUserId)` in `shared/rmm/` re-points every asset of the organization (matched by `rmm_provider + rmm_organization_id` or by the asset's `tenant_external_entity_mappings` row) to the new client in the same transaction as the mapping update: sets `client_id`, clears `contact_name_id` (through the helper, source `system`), `billing_profile_id`, `location_id`, removes group membership (FR-E5), writes `asset_history`. Returns the moved count. Every provider's mapping update action (Tactical, NinjaOne, Huntress, Tanium, Level.io) calls it when `client_id` changes; the UI confirms with the count from a `countRmmOrganizationAssets` action.
- FR-G5. Shared ingestion no longer writes `client_id` on update (create unchanged). Manual client moves persist across syncs for every provider.

### Non-functional Requirements
- Every new table has `tenant` in the primary key and is distributed by tenant in Citus; every query and join includes `tenant`.
- New tables ship without RLS policies (application scoping).
- Server actions use `withAuth`; permissions: asset fields, assignment and groups follow the `asset` resource (`read`/`update`/`create`/`delete`); status settings follow `settings` update; RMM mapping changes follow the existing integration permission; merge follows the existing client update + delete rule.
- Group and assignment reads on the client portal go through the existing visibility filters only.

## Data / API / Integrations

- New tables: `asset_statuses`, `asset_assignments`, `asset_groups`, `asset_group_members`, `asset_group_contacts`.
- New columns: `assets.manufacturer, model, vendor_id, purchase_cost, purchase_cost_currency, order_number, billing_profile_id`; `rmm_organization_mappings.contact_assignment_mode, billing_profile_id`; `client_merges.asset_billing_strategy`.
- Reused: `tenant_external_entity_mappings` for RMM user → contact mappings (`integration_type = 'rmm:<provider>'`, `alga_entity_type = 'contact'`); `vendors` from inventory as the supplier list; `client_billing_profiles`; `client_locations.default_billing_profile_id`.
- Migrations live in `server/migrations/` (all CE). Use the `./utils/tenantDb.cjs` shim, never `@alga-psa/db`.
- Types in `packages/types/src/interfaces/asset.interfaces.ts` (Asset gains the new fields, `AssetAssignment`, `AssetGroup`, `AssetGroupMember`, `AssetGroupContact`, `AssetStatus`).
- REST: extend asset schemas and OpenAPI; add `/api/v1/assets/{id}/assignments`, `/api/v1/asset-groups*`, `/api/v1/asset-statuses`; extend `/api/v1/clients/{id}/merge` and its preview. Regenerate the OpenAPI spec with the `alga-openapi-sync` skill afterwards.
- Events: publish `ASSET_UPDATED` as today for assignment and group changes; no new event types.

## Security / Permissions

- Contact and billing-profile ids are validated against the asset's client on every write path (server action, REST, sync, merge).
- Client portal never exposes `asset_assignments` history, group contacts beyond names, or vendor/cost fields.
- RMM user mapping keys are tenant and integration scoped; a mapping never applies across tenants or integrations.

## Observability

Not in scope beyond existing `asset_history` and merge audit rows.

## Rollout / Migration

1. Schema and backfill migrations (fields, statuses, assignments backfill) are additive and safe to run on a live tenant.
2. Ship A–C first (fields, status, assignment). D (RMM matching) defaults to `suggest`, so nothing auto-assigns until an MSP opts in per organization.
3. E (groups) and F/G (billing, merge, mapping moves) ship together or after; FR-G5 changes sync behaviour and is called out in release notes ("manual client changes on RMM-synced assets now persist").
4. Rebuild `@alga-psa/types`, `@alga-psa/assets` dist, and `shared` dist (RMM code runs on the workflow worker).

## Open Questions

Resolved 2026-10-09 with the product owner:

1. Default `contact_assignment_mode` is `suggest`. **Decided.**
2. RMM sync stops writing `status` on update; `agent_status` carries connectivity. **Decided.**
3. One group per asset. **Decided.**
5. Purchase cost currency is stored per asset, defaulting to the tenant currency. **Decided.**
6. Supplier is the inventory `vendors` table, with quick create from the asset form. **Decided.**
7. Shared-workspace users can raise portal tickets on workspace assets and see open tickets linked to those assets (FR-E7b). **Decided.**

4. The merge billing choice governs every moving row with no explicit profile: tickets, projects, assets and RMM organization mappings. Billing history rows keep today's stamping. **Decided.**

No open questions remain.

## Acceptance Criteria (Definition of Done)

- A technician can set manufacturer, model, vendor, purchase cost and order number on an asset in the form, see them on the details page and drawer, search by manufacturer or model, and read them from the REST API. RMM sync fills manufacturer and model for a Tactical and a NinjaOne device.
- An MSP can add an "In repair" status in Settings, set it on an RMM-synced device, and it is still "In repair" after the next sync. Dashboard filters list it.
- The assigned contact is visible on the details page, drawer, client Assets tab, contact page, client portal and mobile. Assigning from the details page writes an `asset_assignments` row and a timeline entry; the REST assignments endpoint returns the history.
- With an RMM organization in `suggest`, a device whose signed-in user matches a contact's email shows the suggestion; accepting it assigns and persists a mapping. In `auto`, the next sync assigns an unassigned device to the matched contact and does not touch a manually assigned one.
- A bundle of five assets is assigned and relocated with one action; a shared workspace with three users makes its assets visible to those three in the portal and offers them on ticket creation.
- The merge dialog lists RMM organizations and asset counts and the chosen billing strategy is applied to tickets, projects, assets and RMM mappings alike: with `source_profile`, a moved unbilled ticket and an alert ticket for a moved device land on the moved profile; with `target_default`, both land on the target's default.
- Changing an RMM organization's client moves its assets immediately for every provider, and a manual client change on a Level.io device survives the next sync.
- `features.json` and `tests.json` are all `implemented: true`, unit and integration suites pass, and the OpenAPI spec is regenerated.
