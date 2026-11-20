# Scratchpad — Ticket list: multi-client include/exclude filter

- Plan slug: `ticket-client-include-exclude-filter`
- Created: `2026-11-10`
- Source: AlgaPSA ticket alga-2026-0002989

## Decisions

- (2026-11-10) The client filter is a `where` row on `client.id` (`in` / `not_in`) in the existing
  `WHERE_FILTERS` table. No `clientIds` / `excludeClientIds` legacy keys. Rationale: `where` already
  round-trips through URL, named views and default views, and the descriptor table already derives
  the control, chips and clear. This is what the `LEVERAGE: pattern filter-descriptor-table` marker in
  `TicketingDashboard.tsx` (~2248) asks for, one dimension at a time.
- (2026-11-10) Tickets with no client match "None of" and do not match "Any of". This follows
  `packages/predicates/spec/SEMANTICS.md` (complements are NOT positive; a missing hop satisfies
  `not_in`) and matches location/category/board exclusion. No "no client" sentinel.
- (2026-11-10) Bundled view: "None of A" hides a bundle if the master or any child is A (SEMANTICS
  "Self or any child": the complement negates the whole self-or-child positive). Accepted as the
  engine's contract rather than special-cased.
- (2026-11-10) Legacy `clientId` is folded in by ONE function: a v2->v3 step in `migrateTicketFilters`.
  Stored views run it through the existing version hook; URL parsers run it too by treating parsed URL
  filters as a v2 document. Precedence when both exist: the explicit `where` row wins and `clientId`
  is dropped (same as `boardIds` over `boardId`, `categoryIds` over `categoryId` in the codec). The
  codec mirrors the same precedence for server callers. Rejected alternative: keep `clientId` as a
  parallel toolbar path (two UI states for one dimension).
- (2026-11-10) Keep `clientId` in `ITicketListFilters`, the codec, `ticketFiltersShape` and
  `TICKET_VIEW_URL_FILTER_PARAMS`: there are server callers (export, project task links, API) and old
  links. Only the writers stop emitting it.
- (2026-11-10) Multi-select lives on the async path: `AsyncSearchableSelect` gets a multi variant and
  `AsyncClientPicker` exposes it. There is no async multi-select in `packages/ui` today
  (`MultiContactPicker`, `MultiUserPicker`, `TagFilter`, `BoardFilterPicker`/`TreeSelect` are all
  in-memory, and `ClientPicker`'s `clients` prop is deprecated for 5k+ client tenants). Building the
  multi variant on the shared async select makes any future async multi-entity picker cheap.
  The in-memory `ClientPicker` path is not extended.
- (2026-11-10) Mode switch follows the `where` family (flip operator, keep ids, "Any of"/"None of"
  labels), not the Board picker's Include/Exclude tree toggle that clears the other set. Extract the
  mode button (third copy otherwise).
- (2026-11-10) Contact/location coupling keys off "Any of exactly one client" to preserve today's
  scoped behaviour; any other selection falls back to tenant-wide lists, with contacts narrowed
  client-side by the row.
- (2026-11-10) Client row placement in the primary toolbar row is data on the descriptor, not a
  dashboard special case.

## Discoveries / Constraints (verified on origin/main 88c634d5b5)

- `packages/tickets/src/lib/ticketFilterPredicates.ts:98` — `if (filters.clientId) all.push(clause('client.id', 'equals', filters.clientId));` Confirmed. Boards and categories already do include/exclude via legacy keys (`boardIds`/`excludeBoardIds`, `categoryIds`/`excludeCategoryIds`) at lines 47-96.
- `packages/tickets/src/actions/optimizedTicketActions.ts:1262-1282` — codec group plus `...(validatedFilters.where?.clauses ?? [])`, compiled with `selfOrAnyChild: bundleView === 'bundled'`. Confirmed (told ~1264-1281).
- `shared/lib/ticketQuery/ticketQuerySchema.ts:260` — `id: uuidColumn('client_id', ['equals', 'in'])`. Confirmed, no `not_in`. `packages/tickets/src/lib/ticketQuerySchema.ts` just re-exports the shared file.
- `contact.id` (line 270) has the same `['equals','in']` shape; not touched here.
- `location_id` already allows `not_in`; matrix row `location-not-in-warehouse-keeps-no-location` is the precedent for "missing keeps".
- `packages/tickets/src/lib/ticketWhereFilters.ts` — `WHERE_FILTERS` has 4 rows (contact.tags, client.tags, location_id, contact.locations); options source union is `{ tags } | { locations }`; selection helpers `getWhereTagSelection`/`setWhereTagSelection`; `whereFilterChips` falls back to the raw id when a label is unknown (the client row must supply a non-id fallback).
- `WhereTagFilter.tsx` and `WhereLocationFilter.tsx` duplicate the mode button. `WhereLocationFilter` shows an unknown location by its id (existing; out of scope, noted).
- `WhereTagFilter.test.tsx` contains source-string assertions such as `WHERE_FILTERS.map((descriptor) =>`; they will need updating when the render loop changes.
- `packages/tickets/src/lib/ticketWhere.ts` — flat `and` group, max 50 clauses, validated against the shared schema; `sanitizeTicketWhere` drops schema-invalid clauses (so an old pod drops `client.id not_in`).
- `packages/list-views/src/lib/definitions/tickets.ts` — `ticketFiltersShape` includes `clientId: z.string()` and `where`.
- `packages/list-views/src/lib/ticketFilterMigration.ts` — `TICKET_FILTERS_SCHEMA_VERSION = 2`; `migrateTicketFilters(filters, fromVersion, ctx)` is pure; called from `registry.ts` (named views via `migrateListViewSettings`, which only runs when stored < definition version), `migrateTicketDefaultView`, and `packages/tickets/src/lib/ticketViewSettings.ts:246` (board/tenant default read path).
- `packages/tickets/src/lib/ticketListViewAdapter.ts:188` — sanitize keeps `clientId` via `keepScalar` with no universe; the container deliberately passes no `clientIds` universe (`TicketingDashboardContainer.tsx:616`).
- Toolbar: `TicketingDashboard.tsx:2582` renders `<ClientPicker ... searchClients={searchClientsForPicker} selectedClientId={selectedClient} />`. `selectedClient` (line 451) feeds: chip label lookup (452-465, marked `LEVERAGE: pattern fetch-selected-client-by-id`), location options (579), `isFiltered` (599), active count (621), contact options (654), `handleClientSelect` (2194), chips (2280), export filters (1296), ContactPicker `clientId` (2603). URL writer at 931.
- URL readers: `TicketingDashboardContainer.tsx:120`, `server/src/app/msp/tickets/page.tsx:115`, `ticketFilterUtils.ts:160` (`parseReturnFilters`). URL writer in container at ~380. `boardTabs.ts:181` lists `clientId` in `TICKET_VIEW_URL_FILTER_PARAMS`.
- `ticketListScope.ts:81` `TICKET_LIST_CLIENT_PARAM = 'clientId'` is the co-managed qualified queue's own scope param, a different surface. Leave it alone.
- `ClientPicker` (`packages/ui/src/components/ClientPicker.tsx`) delegates to `AsyncClientPicker` unless `clients` is passed; `AsyncSearchableSelect` is single-value only. `searchClientsForPicker` (`shared/ticketClients/clientPicker.ts`) caps `ids` lookups at 100 (`CLIENT_PICKER_MAX_LOOKUP_IDS`).
- `ITicket.client_id` is `string | null` (`packages/types/src/interfaces/ticket.interfaces.ts:43`), so no-client tickets exist; the matrix fixture currently has none and needs one.
- Conformance: no record-level case exercises `not_in` on an id across a `one` hop, but no new operator/path kind/value type is added, so per the schema recipe no SEMANTICS/conformance change is required; the SQL matrix is the proof.

## Gotcha found during verification (not in the brief)

- `client.id` is also used by checklist-template rules. `TICKET_PREDICATE_FIELDS` (`packages/tickets/src/lib/ticketPredicateFields.ts:45`) takes the Client field's operators from the shared schema, so adding `not_in` would offer it in the rule editor. Worse, `checklistWhereForOwner` (`shared/lib/ticketChecklists/rulePredicates.ts:~46`) ignores the operator: for an owned template, `client.id not_in [owner]` has every value equal to the owner and simplifies to TRUE (the opposite of its meaning). `readChecklistWhere` validates against the same schema, so such a rule would become storable. Plan pins the editor field to equals/in and makes the simplifier complement-aware (FR3/FR4).

## Commands / Runbooks

- Unit: `npx vitest run packages/tickets/src/lib/ticketWhereFilters.test.ts packages/list-views/src/lib/ticketFilterMigration.test.ts`
- DB matrix: `cd server && npx vitest run src/test/integration/ticketListFilterMatrix.integration.test.ts` (needs a migrated test DB; see `server/test-utils/dbConfig`).
- Translations: `node scripts/validate-translations.cjs`
- Find markers: `grep -rn "LEVERAGE:" packages/tickets/src`

## Links / References

- Schema recipe: header of `shared/lib/ticketQuery/ticketQuerySchema.ts` (steps 1-5).
- Semantics: `packages/predicates/spec/SEMANTICS.md` (Missing values, Complements, Self or any child).
- Bundled client filter Citus correlation precedent: `server/src/test/integration/ticketListBundledClientContactFilter.integration.test.ts` (alga-2026-0002783).

## Open Questions

- None blocking.
