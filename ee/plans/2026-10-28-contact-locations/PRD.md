# PRD — Contact locations

- Slug: `contact-locations`
- Date: `2026-10-28`
- Status: Draft

## Summary

A contact can be linked to one or more of their client's locations, with one marked primary, and can be flagged as remote. The link is shown wherever a contact is shown (contact page, contact lists, pickers, the ticket contact tile, the client portal, mobile), tickets raised for a contact pick up the contact's location, and the ticket list can filter by it. Nothing about the link is ever dropped silently: deleting a location that contacts use is refused with a count, and moving a contact to another client tells the operator how many location links will be removed.

## Problem

Contacts have no address or location data at all. Locations hang off clients, with one default per client. Tickets, assets and asset groups carry a `location_id`, but nothing says where a person works. Consequences today:

- A technician opening a ticket for a contact at a multi-site client has to know, or ask, which site the person is at, then pick it by hand. Ticket creation offers the client's locations and labels the default; it never infers from the contact.
- Inbound email tickets take their location from the mailbox defaults, so every emailed ticket for a multi-site client lands on the same site or none.
- Portal-created tickets never get a location.
- On mobile a technician looking at a contact cannot get directions, because the contact has no address to hand to the maps app. Client and ticket screens already do this.
- There is no way to say "this person works at both the warehouse and head office" or "this person is remote, do not assume head office".

## Goals

- Link a contact to zero or more of its client's existing `client_locations` rows, with at most one primary, plus a work arrangement (`on_site`, `hybrid`, `remote`). Contacts never own address data; the link is a reference to the client's location, so editing the address on the client updates every linked contact.
- Show the link everywhere a contact is shown, including pickers and data tables through the chip and column mechanism from PR #3858.
- Auto-fill the ticket location from the contact when nothing more specific is set: MSP quick add, ticket detail contact change, inbound email, client portal, REST v1 and mobile ticket creation, recurring-ticket overrides.
- Ticket list and checklist predicates can filter by the ticket's location and by the requester's locations.
- Every REST v1 surface that returns a contact or a location carries the link, the unified search index and the MCP tools pick it up, and CSV import and export carry it.
- Client merge keeps every link.
- Mobile shows a contact's locations with a maps link for routing, and can edit them.
- No silent data loss: location delete is refused while contacts use it; client change on a contact removes the links only after an explicit confirmation that states the count.

## Non-goals

- Backfill. Existing contacts stay unlinked. The effective-location resolver makes single-location clients work without one.
- Per-location roles (site manager, receiving contact). A tag on the contact covers this for now.
- Home or mailing addresses on contacts that are not client locations.
- Geocoding, distance, dispatch routing or scheduling by location. The maps link hands the address to the platform maps app and stops there.
- Portal users editing their own locations. Read-only in the portal for this release.
- Asset assignment defaults from the contact's location.

## Users and Primary Flows

1. **Dispatcher raises a ticket.** Quick add: picks client, picks contact. The Location select fills with the contact's primary location and shows the contact's locations first, marked. The dispatcher can still change it. Clearing the contact clears a location that came from the contact; a location the dispatcher chose by hand stays.
2. **Technician on the road.** Opens a contact on mobile, sees "Locations: Warehouse (primary) · Head office", taps the warehouse address and the maps app opens with the address, ready to route.
3. **Account manager sets up a multi-site client.** On the contact page, under Locations, adds Warehouse and Head office, marks Warehouse primary. On the client's Locations tab each card shows "3 contacts" and lists them.
4. **Remote worker.** Sets work arrangement to Remote. The contact shows a Remote badge, tickets for them get no location and do not fall back to the client's default.
5. **Inbound email.** A ticket emailed by a contact with a primary location lands on that location even when the mailbox defaults point elsewhere.
6. **Filtering.** Ticket list: "Location is Warehouse" and "Requester location is Warehouse" as `where` filters, saved in views and shareable in the URL like requester tags.
7. **Location cleanup.** Deleting a location two contacts use fails with "Cannot delete location: it has associated 2 contact(s)". Moving a contact to another client shows "This removes 2 location links" before the save.

## UX / UI Notes

### Contact page (`packages/clients/src/components/contacts/ContactDetailsView.tsx`, `bento/ContactBentoLayout.tsx`, `ContactDetailsEdit.tsx`, `bento/useContactEditDrawer.tsx`)

- New **Locations** tile (id `contact-bento-locations`): work-arrangement badge (On site / Hybrid / Remote, hidden when unset), then one row per linked location: name, one-line address, "Primary" marker, inactive marker when the location is inactive. Empty state: "No locations" with an **Add** action. Remote with no locations reads "Remote".
- Edit drawer and edit form get a shared `ContactLocationsEditor` (id `contact-locations-editor`): a work-arrangement select, a multi-select of the client's active locations (inactive ones already linked stay listed, marked), and a primary radio among the selected. Disabled with a hint until a client is chosen. Changing the client in the editor clears the selection and shows the removal count when the contact already has links.

### Quick add contact (`QuickAddContact.tsx`)

- Same editor, collapsed by default under "Locations", enabled once a client is chosen.

### Contact lists (`Contacts.tsx`, `ClientContactsList.tsx`)

- New **Location** column: primary location name, "+N" when more, "Remote" when the arrangement is remote and nothing is linked. Sortable by primary location name.
- Client contacts tab gets a Location filter (the client's locations, plus Remote and No location).

### Client Locations tab (`packages/clients/src/components/clients/ClientLocations.tsx`)

- Each card gets a contact count chip (id `client-location-contact-count-<id>`) that expands to the contact names, each linking to the contact. Delete error text already surfaces model errors; the model gains the contact dependency.

### Pickers and ticket contact tile (PR #3858 mechanism)

- `ContactPicker` rows carry `primaryLocation` next to `displayTags`; the option and the selected row show the location name as secondary text after the tag badges. `AsyncClientPicker` is unchanged.
- Ticket detail contact tile (`TicketBentoLayout.tsx`, `TicketProperties.tsx`) shows the requester's primary location under the tag chips, and a one-click **Use contact's location** hint when the ticket's location differs from every location of the contact.

### Ticket creation (`packages/tickets/src/components/QuickAddTicket.tsx`, `ticket/TicketDetails.tsx`)

- Location select groups options: "Contact's locations" (primary first, marked) then "Other locations". Auto-fill rules in FR-C.

### Ticket list filters (`TicketingDashboard.tsx`, `lib/ticketWhereFilters.ts`)

- Two new `where` filters beside Requester tags and Client tags: **Location** (ticket `location_id`) and **Requester location** (`contact.locations`). Options are the locations of the client currently filtered, or all tenant locations grouped by client when no client filter is set. Each shows active-filter chips with individual clear, same as tags.

### Merge dialog, Contacts step (`packages/clients/src/components/clients/MergeClientsDialog.tsx`)

- The existing Contacts step (one row per source contact with Billing profile, Manager, Sees profile tickets) gets a **Locations** column (id `merge-contact-locations-<contactId>`): a multi-select of every location the merged client will have, that is the source's locations (marked "moving from <source>") and the target's existing ones, pre-filled with the contact's current links and primary. The operator can switch a person to a target location, add one, or clear. A Remote badge shows for remote contacts; the select stays usable.
- When the target has a location whose name matches a source location the contact is linked to (case and whitespace insensitive), the row shows a hint "<Target> also has 'Head office'" with a one-click **Use it** that re-points that link. Nothing is re-pointed without the click.
- The confirm step lists "N contact location links, M re-pointed" and the dry run validates every chosen location.

### Client portal (`packages/client-portal/src/components/settings/ClientUserDetails.tsx`)

- Read-only Locations line on the user detail (names, primary marked, remote badge).

### Mobile (`ee/mobile`)

- `ContactDetailScreen`: new **Locations** section modelled on the client screen's location list; each row shows name, primary marker, address, and opens `buildMapsUrl(mapsQueryFromLines(address))` on press. Remote badge beside the name when remote.
- `ContactsListScreen` rows show the primary location name as a secondary line.
- `ContactFormModal`: work-arrangement select and a location multi-select with a primary toggle, loaded from `/api/v1/clients/{id}/locations`, enabled once a client is set.
- `ContactPickerModal` (ticket detail) shows the primary location under the name.

## Requirements

### Functional Requirements

**A. Data model**

- FR-A1. New table `contact_locations`: `tenant`, `contact_name_id`, `location_id`, `is_primary boolean not null default false`, `created_at`, `created_by`. PK `(tenant, contact_name_id, location_id)`. Composite FK to `contacts(tenant, contact_name_id)` ON DELETE CASCADE, composite FK to `client_locations(tenant, location_id)` ON DELETE RESTRICT. Partial unique index on `(tenant, contact_name_id) WHERE is_primary`. Index `(tenant, location_id)`. Distributed by `tenant` on Citus, co-located with `contacts`; the FK guard mirrors `20260518120000_add_location_id_to_assets.cjs`.
- FR-A2. `contacts.work_arrangement text null` with a check constraint on `on_site | hybrid | remote`. Null means unset.
- FR-A3. The table is registered in `packages/db/src/lib/tenantTableManifest.ts` (ordered deletion) and placed in the tenant-deletion order in `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` before `contacts` and `client_locations`.
- FR-A4. `IContact` gains `work_arrangement` and `locations: IContactLocation[]` (location id, name, address fields, `is_primary`, `is_active`). New `IContactLocation` in `packages/types/src/interfaces/contact.interfaces.ts`.

**B. Contact model and actions (`packages/clients/src/actions/contact-actions/contactActions.tsx`, `packages/clients/src/models/contactLocation.ts` new)**

- FR-B1. `replaceContactLocations(trx, tenant, contactId, links)` replaces the set in one transaction: every location must belong to the contact's client and be a real location (mismatch throws `ContactLocationClientMismatch`), at most one `is_primary` (more than one throws), a single link with no primary is made primary.
- FR-B2. `addContact` and `updateContact` accept `work_arrangement` and `locations` (array of `{ location_id, is_primary }`); `locations` omitted leaves links unchanged, an empty array removes them all.
- FR-B3. Changing `client_id` on a contact removes all its location links in the same transaction. The action returns the removed count so the UI can confirm first; a `getContactLocationCount` read backs the confirmation dialog. The client-portal and v1 API paths apply the same rule.
- FR-B4. `getContactByContactNameId`, `getContactsByClient`, `getAllContacts` and the contact bento loader return `work_arrangement` and `locations` with one batched read per page (sibling of `attachDisplayTags`: `attachContactLocations(db, tenant, rows, idOf)` in `packages/clients/src/lib/contactLocations.ts`).
- FR-B5. `resolveContactLocationId(trx, tenant, contactId): Promise<string | null>` in `shared/models/contactLocation.ts`: `remote` → null; else the primary link; else the only link; else the client's default active location; else null.
- FR-B6. `deleteLocation` (`packages/clients/src/models/clientLocation.ts`) counts `contact_locations` rows and adds "N contact(s)" to the dependency error. Deactivating a location keeps links.
- FR-B7. Client merge (`packages/clients/src/lib/clientMergeEngine.ts`): `contacts` and `client_locations` are both in `CLIENT_OWNED_MOVE_TABLES` and re-parent wholesale to the target, and `contact_locations` keys on contact and location rather than client, so no link row changes and none can cross clients afterwards. The engine asserts link count before equals after and that every link's contact and location share a client. The merge preview (`clientMergePlan.ts`) and the merge report list the number of contact location links moving. A source default location demoted beside the target's default keeps its links.
- FR-B8. Merge preview: each contact row carries `locations: [{ locationId, locationName, isPrimary }]` and `workArrangement`; the preview carries `locationsAfterMerge: [{ locationId, locationName, fromSource: boolean, isActive }]` and, per contact link, `suggestedTargetLocationId` when a target location name matches.
- FR-B9. Merge input gains `contactLocationAssignments?: Array<{ contactNameId, locations: [{ locationId, isPrimary }] }>`. After the client-owned tables have moved, the engine applies `replaceContactLocations` for each listed contact; contacts not listed keep their links. A location that is neither a moved source location nor a target location fails the merge with a clear error, and the dry run runs the same validation. The report counts `contact location` links and how many were re-pointed.

**C. Ticket auto-fill**

- FR-C1. `TicketModel.createTicket` (shared model) applies, when `location_id` is `undefined` and `contact_name_id` is set: `location_id = resolveContactLocationId(contact)`. `null` means "explicitly none" and is kept. The existing same-client check still runs on the resolved value. This single rule covers the REST v1 `POST /tickets`, mobile, the portal and recurring-ticket generation.
- FR-C2. `QuickAddTicket`: on contact select, when the location is empty or was filled from a previous contact, set it to the resolved location (client-side read `getContactEffectiveLocation`). A location the user chose by hand is never replaced. Clearing the contact clears a contact-filled location. The form submits `null` when the user explicitly chose None, `undefined` when untouched, so FR-C1 and the form agree.
- FR-C3. `TicketDetails.handleContactChange` on an existing ticket: when the ticket has no location, set the resolved one and record it in the ticket history as a contact-derived change. When it has one that is not among the new contact's locations, keep it and show the **Use contact's location** hint (FR in UX). Never overwrite an existing ticket location without a click.
- FR-C4. Inbound email (`shared/services/email/processInboundEmailInApp.ts`): location precedence is the matched contact's explicit location (primary or only link, `remote` → skip to next) → inbound defaults location when the resolved client equals the defaults' client → `undefined` (so FR-C1 falls back to the client default). Order recorded in the scratchpad as a decision to confirm.
- FR-C5. Client portal `createClientTicket` passes `location_id: undefined` so FR-C1 fills it from the portal user's contact.
- FR-C6. Recurring-ticket client overrides dialog pre-fills the location from the chosen contact when the location field is empty; generation of recurring tickets leaves an unset override to FR-C1.
- FR-C7. Mobile ticket creation sends no `location_id` unless the user picked one, so FR-C1 applies.

**D. Lists, pickers, filters**

- FR-D1. `ContactPicker` rows (`getContactsByClient` and the search path) carry `primaryLocation: { location_id, location_name } | null` and `work_arrangement`; the picker renders them.
- FR-D2. Contacts data tables add the Location column and the client contacts tab filter (UX notes).
- FR-D3. Ticket query schema (`shared/lib/ticketQuery/ticketQuerySchema.ts`): attribute `location_id` (uuid column, operators `equals, in, not_in, is_empty, is_not_empty`) and, under the `contact` relation, set attribute `locations` over `contact_locations` (`valueColumn: location_id`, operators `in, not_in, is_empty, is_not_empty`). Conformance rows added to `packages/predicates/spec/conformance.json` for the new paths; evaluator, SQL compiler and JSONata backends pass. Bundled view "self or any child" applies.
- FR-D4. `WhereTagFilterDescriptor` generalises to `WhereFilterDescriptor` with an options source (`{ tags: taggedType } | { locations: 'ticket' | 'contact' }`) so the toolbar control, chips and clear derive from the table; two new rows. `ticketPredicateFields` picks them up for checklist predicates. Legacy saved-view migration is untouched.
- FR-D5. Ticket filter matrix (`server/src/test/integration/predicatesSql.integration.test.ts` and the ticket list matrix) gains rows for both paths with explicit ids and totals, including bundled view and a client-portal user.
- FR-D6. `location_id` on tickets gets a Location column in the ticket list definition when the list does not already show one.

**E. REST v1 and CSV**

- FR-E1. `contactResponseSchema` gains `work_arrangement` and `locations[]` (`location_id, location_name, is_primary, is_active, address_line1, address_line2, city, state_province, postal_code, country_code, country_name`). `createContactSchema` and `updateContactSchema` (strict) accept `work_arrangement` and `locations: [{ location_id, is_primary? }]`. A location of another client returns 400 with the mismatch code.
- FR-E2. `GET /api/v1/contacts` accepts `location_id` (any link) and `work_arrangement` filters. `GET /api/v1/clients/{id}/contacts` accepts the same.
- FR-E3. `GET /api/v1/clients/{id}/locations` rows gain `contact_count`.
- FR-E4. Route docs in `server/src/lib/api/openapi/routes/clientsContacts.ts` describe the new fields and filters on every contact and location operation (list, get, create, update, search, export, client-scoped contacts, client locations). `npm run generate:artifacts` regenerates the OpenAPI spec and the MCP registry; the spec is synced to the developer portal (`alga-openapi-sync`).
- FR-E6. `GET /api/v1/contacts/export` and `GET /api/v1/contacts/search` rows carry the same three fields as the list response.
- FR-E5. CSV export adds `work_arrangement`, `locations` ("Warehouse; Head office") and `primary_location`. Import maps the same three headers; a location name not found under the contact's client fails that row with a message naming the location, never skips silently. The template gains the columns.

**F. Client portal**

- FR-F1. `ClientUserDetails` shows the locations line read-only; portal account action joins the links.
- FR-F2. Portal ticket creation per FR-C5.

**G. Mobile**

- FR-G1. `api/contacts.ts` types gain `work_arrangement` and `locations[]`; `ContactWriteInput` gains both for create and update.
- FR-G2. Contact detail Locations section with maps link per UX notes; the maps query uses the address lines, falling back to the location name.
- FR-G3. Contact form location editor with primary toggle and work-arrangement select; validation mirrors the server (one primary).
- FR-G4. Contact list row and ticket contact picker show the primary location.

**I. Search and MCP**

- FR-I1. Contact search indexer (`packages/search/src/indexers/contact.ts`) loads links the way it loads phone numbers (one child query per batch): the primary location name joins the subtitle after the client name, every linked location name and city joins the body, and `remote` adds "Remote" to the body. So "warehouse" finds the people who work there in the app search, `/api/v1/search` and the MCP `search_business_data` tool, which proxies that endpoint.
- FR-I2. Saving a contact's links reindexes the contact (the existing contact-updated path). Renaming or deactivating a location reindexes its linked contacts, so the subtitle never shows a stale name.
- FR-I3. MCP: `search_api_registry` and `call_api_endpoint` read the generated registry, so FR-E4's regeneration is what exposes `locations`, `work_arrangement`, the `location_id` and `work_arrangement` filters and `contact_count` to agents. The registry entries for the contact and location operations get the new parameters described in their summaries so ranked search finds them for queries like "contacts at a location".

**H. i18n**

- FR-H1. Every new string in the MSP app, portal and mobile goes through `t()` with keys in the `contacts`, `clients` and `tickets` namespaces for all shipped locales, respecting the glossary gates.

### Non-functional Requirements

- Every query scopes `tenant`; join conditions carry `tenant` on both sides.
- Picker and list pages do one batched read for locations, like display tags.
- The new paths are a persisted filter contract from first release.

## Data / API / Integrations

- Migration `server/migrations/<ts>_create_contact_locations.cjs` (table, indexes, FKs with Citus guard, distribution) and `<ts>_add_contact_work_arrangement.cjs`. Down migrations drop in reverse.
- `tenantTableManifest` golden test updated.
- Interfaces: `packages/types/src/interfaces/contact.interfaces.ts`; `MappableField` union gains the three CSV fields.
- Server-action payloads through `contactActions.tsx`; REST through `server/src/lib/api/schemas/contact.ts` and `ContactService.ts`.
- Mobile uses REST v1 only.

## Security / Permissions

- Editing links requires the same permission as editing the contact (`contact:update`); location reads follow `client:read`. Portal users read their own contact's links only; the portal write path rejects `locations` and `work_arrangement`.
- Client-portal manager scope: the locations line respects the existing visibility rules; no new scope.

## Rollout / Migration

- Additive migrations, no backfill, no feature flag. Links appear as people edit contacts. Single-location clients behave as before through the resolver fallback.

## Open Questions

- OQ1. Inbound email precedence (FR-C4): contact's explicit location over mailbox defaults. Confirm with support; the reverse is a one-line change.
- OQ2. Should the ticket list Location column be on by default, or available in the column picker only? Default: available, off.
- OQ3. Should `hybrid` exist, or is on-site plus multiple links enough? Kept because the filter "Remote / Hybrid" is cheap and reads clearly; drop if unwanted before the schema lands.

## Acceptance Criteria (Definition of Done)

- A contact can hold several locations of its client with one primary and a work arrangement, in the MSP app, REST v1, CSV and mobile.
- Location delete with linked contacts fails with a count; contact client change requires a confirmation that states the count and then removes the links.
- Quick add, ticket detail, inbound email, portal, REST and mobile ticket creation fill the location per FR-C; a hand-picked location is never overwritten without a click.
- Ticket list filters by Location and Requester location, in URL and saved views; predicates conformance passes on all backends.
- Pickers, contact tables, the ticket contact tile, client location cards and the portal show the link.
- Every contact-returning and location-returning v1 endpoint carries the link, the OpenAPI spec and MCP registry are regenerated, and app search, the search endpoint and `search_business_data` find contacts by location name.
- A client merge moves every link with no loss, the Contacts step shows each person's locations and lets the operator switch them, and the preview and report say how many moved and how many were re-pointed.
- Mobile contact detail opens the maps app on the location address.
- All new strings translated; tier-1 CI green.
