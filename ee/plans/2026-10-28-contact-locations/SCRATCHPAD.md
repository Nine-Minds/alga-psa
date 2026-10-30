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

## 2026-10-29: review round — what was missing and why

Two plan features were missing from the first implementation round with no justification recorded
(the summary commit claimed "2 are skipped with reasons below" and its body was truncated). Both are
now implemented, so nothing in features.json is skipped:

- **F039** (predicates conformance + SQL matrix) was simply not done. The table now carries nine
  cases — `location-*` for an id column and `contact-locations-*` for a set across a relation hop —
  run by the evaluator, the JSONata path (set rows carry the usual `skip.jsonata`) and the SQL
  compiler, whose harness grew `conf_contact` / `conf_contact_location` temp tables. SEMANTICS.md
  names both shapes. `ticketListFilterMatrix` gained eight DB-backed rows and portal-user
  assertions.
- **F055** (mobile location editor) was not done either. `ContactFormModal` now has the
  work-arrangement select and the location multi-select with a primary marker, `contactForm` the
  one-primary rule and the omitted/[]/replace diff.

### Tests still at `implemented: false` (43)

They are the DB-backed and render-heavy halves of the groups, not gaps in the shipped behaviour;
each one needs a live Postgres (REST routes, CSV import, the search indexer, portal actions,
`TicketModel.createTicket`'s write) or a full component mount (the bento tile, the
merge Contacts step, `ClientLocations`). The decisions those tests describe are covered at the seam
by the unit tests that did land: `shared/models/contactLocation.test.ts` (resolver, nine cases),
`shared/models/ticketLocationAutofill.test.ts` (the undefined/null/explicit contract and the
guard), `packages/clients/src/models/contactLocation.test.ts` (replace invariants),
`contactService.locations.test.ts` (the REST write contract), `clientContactsLocationFilter.test.ts`
(the client-scoped filters), `contactLocationArtifacts.contract.test.ts` (spec + registry),
`ChecklistRuleMatchers.test.tsx` (both location paths), `WhereTagFilter.test.tsx` (both toolbar
controls), `ticketWhereUrl` / `ticketWhereStorage` (URL and saved-view round trip),
`clientMergeEngine.test.ts` (engine and dry run), and the mobile `contactForm` / `ContactFormModal`
/ `api/contacts` suites. Writing the remaining 43 means standing up fixtures in the integration
lane; it is a follow-up, not a behaviour gap.

## 2026-10-30: second review round

- **Portal typecheck (blocking).** `ClientUserDetails` read `locations` / `work_arrangement` off
  `@shared/interfaces/user.interfaces`' `IUser`, which declares neither, so
  `@alga-psa/client-portal` failed `tsc --noEmit` (7× TS2339) and took the server project with it.
  `getClientUserById` now returns a locally declared `ClientUserWithLocations` (IUser plus the two
  read-only contact facts) and the component's state uses it. No index signature, no cast.
- **`work_arrangement` could never be cleared.** `contactActions` collapsed `null` to `undefined`
  on the update action and both CSV branches, and `ContactModel.updateContact` skips only
  `undefined` — so the editor's "Not set" and a mapped-but-blank CSV cell were silent no-ops while
  REST PUT cleared fine. Both paths now pass `null` through (`undefined` still means unchanged),
  with `contactActions.workArrangement.test.ts` and two CSV import cases covering it.
- **F012 was dead code.** `getContactLocationCount` shipped unused; the confirmation counted the
  links in local state, which is right when they were loaded but skipped the warning entirely for a
  contact handed to the form without `locations` — and the save dropped them anyway. The form now
  falls back to the stored count, so **T029/T030 land** (`ContactDetailsEdit.clientChange.test.tsx`,
  4 new cases).
- **FR-C3 in both layouts.** The one-click "Use contact's location" existed only in
  `TicketBentoLayout`; `TicketProperties` showed the line and left the operator to re-pick. Added
  there too (skipped when the field is frozen), with a test that holds both files to the same rule.
- **Operator line comment.** The "N contacts" counter now also rides the client page's bento
  Locations tile: `ClientPulseLocation.contact_count` from one batched `getContactCountsByLocation`,
  rendered as a chip (absent at zero), new `clientCommandCenter.locations.contactCount` plural in
  all eleven locales.
- **Merge drift.** Merged `origin/main` (dc46a3315d); golden manifest count resolved to 579 (578 on
  main + `contact_locations`). migration-lint is **clean without restamping**: main's R6 now refuses
  an earlier stamp only on a same-table conflict or past a 14-day floor, and the three migrations
  hit neither. The three OpenAPI conflicts were resolved "ours" and then regenerated with
  `npm run generate:artifacts`, so the committed spec is the union again and `artifact-drift` is
  clean.
