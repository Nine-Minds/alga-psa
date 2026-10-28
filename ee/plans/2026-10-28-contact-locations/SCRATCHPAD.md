# Scratchpad — Contact locations

## Decisions

- **Join table, not a column.** Contacts can work at several sites; `contact_locations` with one `is_primary` per contact. The primary is what auto-fill uses. (User decision 2026-10-28.)
- **No backfill.** `resolveContactLocationId` falls back to the client's default active location, so single-site clients work as before.
- **Remote.** `contacts.work_arrangement` (`on_site | hybrid | remote`, null = unset). `remote` suppresses auto-fill and the default-location fallback, so a remote worker's tickets do not land on head office. Links are still allowed on a remote contact.
- **No silent data loss.** Location delete is RESTRICT at the DB and refused in the model with a count (same list as tickets and tax rates). Contact client change removes links only after the UI confirms with the count; the action returns the removed count.
- **Auto-fill contract.** `location_id === undefined` on ticket create means "infer from contact"; `null` means "explicitly none". The rule lives once in `TicketModel.createTicket` so REST, mobile, portal, email and recurring generation share it. The web form pre-fills client-side so the user sees it, then submits `null` when they clear it.
- **Existing tickets are never re-pointed silently.** Contact change on a ticket with a location shows a one-click hint instead.
- **Inbound email precedence** (OQ1): contact explicit location → mailbox defaults location (same client) → model fallback. Reverse is a one-line change if support disagrees.

## Discoveries

- Nothing links contacts to locations today: no column, no join table, no plan. Contacts have no address fields at all (`packages/types/src/interfaces/contact.interfaces.ts:58-87`).
- `client_locations` schema: `server/migrations/20250522200645_refactor_company_locations_for_tenant_support.cjs:32-76`; one default per client enforced by `ux_client_locations_default_per_client` (`20260718234058`).
- Migration template with the Citus FK guard: `server/migrations/20260518120000_add_location_id_to_assets.cjs`. `asset_group_contacts` (`20261009124000_create_asset_groups.cjs`) is the closest existing contact join table.
- `deleteLocation` already refuses with a dependency list for tickets and tax rates: `packages/clients/src/models/clientLocation.ts:245-275`. Add contacts there. The action maps it through `clientLocationActionErrorFrom`.
- Ticket creation never infers location: `packages/tickets/src/components/QuickAddTicket.tsx:694` resets it on client change, `:1614-1622` is the manual select; `TicketDetails.tsx:2620` `handleContactChange`, `:3036` `handleLocationChange`. Inbound email: `shared/services/email/processInboundEmailInApp.ts:2094` uses `defaults.location_id` only when clients match. Portal `createClientTicket` (`client-tickets.ts:1333`) never sets `location_id`. Model-level same-client check: `shared/models/ticketModel.ts:796, 1282`.
- PR #3858 (merged 2026-10-28, on `origin/main`, not on this branch) is the mechanism to reuse:
  - `packages/clients/src/lib/displayTags.ts` `attachDisplayTags(db, tenant, user, taggedType, rows, idOf)` — one batched read per page; `attachContactLocations` is its sibling.
  - `packages/ui/src/components/ContactPicker.tsx:331, 477` render `EntityTagBadges`; the location name goes beside them.
  - `shared/lib/ticketQuery/ticketQuerySchema.ts:263-272` `contact` relation with `tags: tagSet(...)`; a set attribute is `{ kind: 'set', table, local, foreign, valueColumn, valueType, where? }` (`packages/predicates/src/querySchema.ts:27-39`), so `contact.locations` over `contact_locations` needs no new predicate feature.
  - `packages/tickets/src/lib/ticketWhereFilters.ts` `WHERE_TAG_FILTERS` descriptor table (tag-only today; generalise). `packages/predicates/README.md` "Adding a ticket-list dimension" lists the five steps; conformance in `packages/predicates/spec/conformance.json`, SQL lane in `server/src/test/integration/predicatesSql.integration.test.ts`.
  - New tenant tables must be added to `packages/db/src/lib/tenantTableManifest.ts` (golden test) and `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` order (`client_locations` at 504, `contacts` at 530).
- Mobile (`ee/mobile`): `src/urls/mapsUrl.ts` `buildMapsUrl` + `mapsQueryFromLines`; `ClientDetailScreen.tsx:488-515` is the location list with maps links to copy; `TicketDetailScreen.tsx:735-745` does the same for the ticket location. Contacts go through REST v1 (`src/api/contacts.ts`), so the v1 response must embed the locations with address fields. Client locations: `src/api/clients.ts:176`.
- Contact CSV: export `contactActions.tsx:1144`, import `:1276`, `MappableField` union in the contact interfaces file, header mapping in `ContactsImportDialog.tsx:163-179`.
- REST schemas: `server/src/lib/api/schemas/contact.ts:96` `createContactSchema` is `.strict()`; `client.ts:185-250` location schemas. Locations routes under `clients/[id]/locations` are marked DEPRECATED in a header comment but are what mobile uses.
- Contact client move UX problem already fixed once: `docs/plans/2026-10-02-contact-client-picker-plan.md`.

## Open items

- OQ1 email precedence; OQ2 ticket list Location column default; OQ3 keep `hybrid`.
- Check during implementation whether `ticket-columns` on main already has a Location column (grep found none).
- Check how client merge moves `client_locations` and `contacts` (no `*merge*` file under `packages/clients/src/actions`; find the merge action first) before writing T026.

## Commands

- Plan validation: `python3 ~/.claude/skills/software-planner/scripts/validate_plan.py ee/plans/2026-10-28-contact-locations`
- Predicates conformance: `npx vitest run --config packages/predicates/vitest.config.ts`
- OpenAPI: `alga-openapi-sync` skill.

## 2026-10-28 later: merge, API coverage, search, MCP

- Locations are always the client's `client_locations` rows; contacts never own address data (confirmed with user).
- **Merge** (`packages/clients/src/lib/clientMergeEngine.ts:821-860`): `contacts` and `client_locations` are both in `CLIENT_OWNED_MOVE_TABLES` and re-parent wholesale; a source default location is demoted when the target already has one (`:832-838`). Because `contact_locations` keys on contact and location, links survive untouched. Work = an assertion plus the preview count in `clientMergePlan.ts`. Locations are not de-duplicated by the merge, so a contact linked to the source's "Head office" stays linked to that row even if the target has its own "Head office".
- **MCP** (`ee/server/src/lib/mcp/jsonRpcServer.ts`): `search_api_registry` and `call_api_endpoint` run on the registry generated from the OpenAPI route docs (`server/src/lib/api/openapi/routes/clientsContacts.ts` for contacts and locations; `server/src/lib/mcp/registry.generated.ts` via `npm run mcp:registry:generate`, bundled in `npm run generate:artifacts`). `search_business_data` proxies `GET /api/v1/search`. So "add to MCP" = document the new fields and filters on the routes, regenerate, and make the search index carry locations.
- **Search** (`packages/search/src/indexers/contact.ts`): title = full name, subtitle = email | role | client name, body = phones etc.; phones are loaded per batch as a child query (`:85-104`), which is the pattern for links. Reindex is triggered from `contactActions.tsx`; location rename needs a new trigger for linked contacts.
- Repo now on `main` at `a0febdac00` (pulled 2026-10-28), which includes PR #3858; the earlier branch-based notes about "not on this branch" no longer apply.

## 2026-10-28: merge Contacts step gets a Locations column (user request)

- Contacts step: `MergeClientsDialog.tsx:40-45` wizard order, `:418-470` the per-contact table (Billing profile `CustomSelect`, Manager and Sees-tickets checkboxes), `:247` builds `contactAssignments` for submit. Engine preview builds `contacts[]` at `clientMergeEngine.ts:470-510`; assignments applied at `:892-910` (section 7, after the client-owned tables moved in section 5). Location assignments go in as a sibling input and a section after 5, so the chosen location ids already belong to the target when `replaceContactLocations` validates them.
- Decision: pre-fill with current links, suggest a same-named target location with a one-click apply, never re-point by default. Keeps "no silent data loss" and still makes the common duplicate-site case one click per person.
