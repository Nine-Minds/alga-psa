# PRD — Ticket list: multi-client include/exclude filter

- Slug: `ticket-client-include-exclude-filter`
- Date: `2026-11-10`
- Status: Draft (scope decided)
- Source: AlgaPSA ticket alga-2026-0002989

## Summary

Replace the MSP ticket list's single-select client filter with a multi-select client filter that can
either include a set of clients ("any of A, B, C") or exclude one ("all clients except A, B, C"). The
filter is a `where` row on `client.id` (`in` / `not_in`) built on the existing `WHERE_FILTERS`
descriptor mechanism, so the toolbar control, active-filter chips, URL, saved views (private, shared,
per-user default) and board/tenant default views all carry it with no new legacy filter keys. The
legacy single `clientId` keeps working everywhere it appears today (old links, stored views, API
callers) and is folded into the new row on the way in.

## Problem

The ticket list client filter selects exactly one client. MSPs whose technicians each cover a group
of clients cannot build "my clients" lists (include several clients) or "everyone but the managed-
by-someone-else accounts" lists (exclude several clients). The workaround today is one saved view per
client, which does not scale and cannot express exclusion at all.

## Goals

1. Filter the ticket list to tickets whose client is any of a chosen set of clients.
2. Filter the ticket list to tickets whose client is none of a chosen set of clients.
3. The filter round-trips through the URL, named saved views (private and shared, including a
   per-user default view) and board/tenant default views.
4. Every existing `clientId` carrier keeps working: deep links and returned-from-ticket links with
   `?clientId=`, stored views and default views that hold `clientId`, and server callers that pass
   `filters.clientId`.
5. The client picker can select many clients without loading the full client list (tenants with
   thousands of clients).

## Non-goals

- OR across different fields (`where` stays one flat `and` group; no schema change to `ticketWhereSchema`).
- A "no client" pseudo-option in the client filter.
- Multi-select include/exclude for the contact filter (it stays single-select).
- Changing the client portal ticket list, the co-managed queue's `clientId` scope parameter
  (`TICKET_LIST_CLIENT_PARAM` in `ticketListScope.ts`), or the REST/MCP ticket APIs.
- Offering `not_in` for Client in the checklist-template rule editor.
- Moving boards/categories (which already have include/exclude via legacy keys) onto `where`.

## Users and Primary Flows

Persona: an MSP dispatcher or technician working the ticket list.

1. **Include several clients.** Open Filters, open the Client control, search and tick A, B and C.
   The list shows tickets for A, B or C. Three chips appear: `Client = A`, `Client = B`, `Client = C`.
2. **Exclude clients.** With A, B, C ticked, press the mode button so it reads "None of". The list
   shows every ticket whose client is not A, B or C. Chips read `Client ≠ A`, and so on.
3. **Save it.** Save as a named view (private or shared) or set it as the per-user default. Reopening
   the view restores the same selection and mode and the view is not marked dirty.
4. **Old link.** Open a bookmarked `/msp/tickets?clientId=<id>` or return to the list from a ticket
   opened with an old filter string. The list shows that client's tickets and the new control shows
   that one client in "Any of" mode.
5. **Remove one.** Click the x on one chip; only that client leaves the selection. Removing the last
   one removes the filter.

## UX / UI Notes

- The control replaces the single `ClientPicker` in the primary filter row, in the same position
  (after Board, before Contact). It is the async client picker in multi-select mode plus the same
  "Any of" / "None of" mode button the tag and location `where` controls already use
  (`filters.tagModeAny` / `filters.tagModeNone`). The mode button appears only when something is selected.
- Picker trigger: placeholder "All Clients" when empty; the client's name for one selection; a
  translated "{{count}} clients" summary for more than one. The popover stays open while ticking,
  shows a check on selected rows, keeps the existing status/type/tag filter header, and has a
  "Clear" footer action.
- Toggling the mode keeps the same clients and flips the operator (the `where` family's convention;
  the Board picker's clear-on-mode-switch convention is not used here).
- Chips: one chip per client, `Client = <name>` / `Client ≠ <name>`, built by `whereFilterChips`.
  Names come from a batched id lookup. A client id that no longer resolves shows a translated
  "Unknown client" label and is still removable. Raw ids are never shown.
- The Filters button badge counts the client row as one active filter group, as before.
- All new strings go through `features/tickets` (or `common` for picker strings) in every supported
  locale; run `node scripts/validate-translations.cjs`.
- Check light and dark themes.

## Requirements

### Functional Requirements

**Query schema and semantics**

- FR1. `client.id` in `shared/lib/ticketQuery/ticketQuerySchema.ts` accepts `not_in` (operators become
  `equals`, `in`, `not_in`). No new operator, path kind or value type is introduced, so
  `packages/predicates/spec/SEMANTICS.md` and the conformance file are unchanged.
- FR2. Semantics (from SEMANTICS.md "Complements" and "Self or any child"; restated here as the
  product decision):
  - Tickets with **no client** never match "Any of" and **do** match "None of" (`not_in` is NOT `in`,
    and a missing relation row satisfies it). This matches the existing location, category and
    board exclusion behaviour.
  - In the **bundled** view, "Any of A" shows a bundle when the master or any child belongs to A
    (unchanged). "None of A" hides a bundle when the master or any child belongs to A. In the
    individual view each ticket is judged on its own client.

**Checklist-rule safety (shared schema consumer)**

- FR3. The checklist-template rule editor's Client field keeps offering only `equals` / `in`
  (pinned in `TICKET_PREDICATE_FIELDS`, like Board is pinned to `equals`), so a stored `not_in` rule
  stays a preserved, non-editable rule there.
- FR4. `checklistWhereForOwner` (`shared/lib/ticketChecklists/rulePredicates.ts`) handles a `client.id`
  complement correctly for an owned template: `not_in` naming only the owner simplifies to FALSE (it
  currently would simplify to TRUE); a foreign client id still throws the out-of-ownership error.

**Legacy `clientId` compatibility**

- FR5. Stored ticket filters move to schema version 3 (`TICKET_FILTERS_SCHEMA_VERSION`). The v2→v3 step
  in `migrateTicketFilters` (`packages/list-views/src/lib/ticketFilterMigration.ts`) moves a string
  `clientId` into `where` as `{ path: 'client.id', operator: 'in', value: [clientId] }` and deletes
  `clientId`. If `where` already has a `client.id` `in`/`not_in` clause, that clause wins and
  `clientId` is dropped (same precedence as `boardIds` over `boardId` in the codec). The step is
  idempotent and never throws. Named views, board default views and the tenant default view all go
  through it.
- FR6. Every URL entry point folds legacy `clientId` the same way, by running the same migration
  over the parsed filters (a URL is a v2 filter document): the server page
  (`server/src/app/msp/tickets/page.tsx`), the container's URL parser
  (`TicketingDashboardContainer.tsx`) and `parseReturnFilters` (`ticketFilterUtils.ts`).
- FR7. The URL writers (`getCurrentFiltersQuery` in `TicketingDashboard.tsx`, `updateURLWithFilters`
  in `TicketingDashboardContainer.tsx`) no longer emit `clientId`; the client row travels in `where`.
- FR8. The codec (`ticketFiltersToPredicates`) keeps translating `filters.clientId` for server callers,
  but skips it when `filters.where` carries a `client.id` `in`/`not_in` clause, so server and toolbar
  apply the same precedence.
- FR9. `clientId` stays in `ITicketListFilters`, `ticketFiltersShape` and `TICKET_VIEW_URL_FILTER_PARAMS`
  for read compatibility.

**Descriptor table and toolbar**

- FR10. `WHERE_FILTERS` (`packages/tickets/src/lib/ticketWhereFilters.ts`) gains a Client row:
  path `client.id`, a server-searched client options source, label `fields.client` / "Client", and
  toolbar placement data so the toolbar renders it in the primary row while the existing rows stay in
  the secondary row. The control, chips, chip clear, `isFiltered` and the active-filter count all
  derive from the table (the dashboard's separate client branches are removed).
- FR11. A new `WhereClientFilter` control (`packages/tickets/src/components/`) composes the async
  client picker in multi mode and the shared mode button. The "Any of / None of" button used by
  `WhereTagFilter` and `WhereLocationFilter` is extracted into one shared component used by all three.
- FR12. `AsyncSearchableSelect` (`packages/ui`) gains a multi-select variant (a discriminated prop
  shape: `values: string[]` + `onValuesChange`), with check marks on selected rows, the popover kept
  open on select, and a caller-supplied trigger label. `AsyncClientPicker` gains the matching multi
  props (`selectedClientIds`, `onSelectedClientIdsChange`). The in-memory `ClientPicker` path is not
  extended (it is deprecated for large lists).
- FR13. Selected-client names are hydrated by one shared hook over `searchClientsForPicker({ ids })`,
  batched and chunked at the server's 100-id lookup cap. The picker and the dashboard chips both use
  it; it replaces the dashboard's single-id lookup (retires
  `LEVERAGE: pattern fetch-selected-client-by-id`).

**Coupled filters**

- FR14. Contact filter options: when the client row is "Any of" exactly one client, options are that
  client's contacts including inactive ones (today's behaviour). Otherwise options are all active
  contacts, narrowed client-side to contacts whose client the row allows.
- FR15. Changing the client row clears the contact filter in the same update when the contact's
  client is not allowed by the new row (`in`: not listed; `not_in`: listed).
  `contactFilterUpdateForClientChange` generalises from a single id to a row selection.
- FR16. Location filter options: scoped to the client when the row is "Any of" exactly one client;
  otherwise tenant-wide (today's no-client behaviour).
- FR17. CSV export and adjacent-ticket navigation use the same filters (the export filter object stops
  setting `clientId` and carries `where`).

### Non-functional Requirements

- The picker never loads the full client list; selection hydration is one batched request per change.
- No new raw SQL; everything compiles through `@alga-psa/predicates`.

## Data / API / Integrations

- No database migration. Stored view JSON is upgraded on read through the existing version hook;
  documents are rewritten at v3 on their next save.
- `where` URL form is unchanged (`v1:client.id:not_in:<id>,<id>`).
- `getTicketsForList` / `getAdjacentTicketIds` signatures are unchanged.

## Security / Permissions

- The client-portal user's own-client scope is applied separately from `where` in
  `optimizedTicketActions.ts`; a `where` row can narrow but never widen it. The DB matrix proves it.
- Every compiled hop stays tenant-correlated (predicates compiler guarantee).

## Observability

None beyond existing logging.

## Rollout / Migration

- No feature flag; the single-client behaviour is a special case of the new control.
- Version skew during a rolling deploy: an old pod reading a view saved at v3 with `client.id not_in`
  rejects that clause (old schema) and drops it, showing a wider list until the pod rolls. Brief and
  self-healing; accepted.
- Stored `clientId` is not rewritten in place; it is folded on every read until the view is next saved.

## Open Questions

None blocking. Recorded decisions are in SCRATCHPAD.md.

## Acceptance Criteria (Definition of Done)

1. A user can include several clients, or exclude several, from the ticket list toolbar; the list,
   chips and Filters badge reflect it in both individual and bundled views.
2. Tickets with no client appear under "None of" and not under "Any of".
3. The selection survives a reload (URL), a named view save/apply (private, shared, per-user default)
   and a board/tenant default view, without marking the view dirty.
4. `?clientId=<id>` links, return-to-list links and stored views holding `clientId` open with that
   client selected in "Any of" mode.
5. A stored checklist rule cannot be simplified to TRUE by a `client.id not_in [owner]` clause, and the
   rule editor does not offer `not_in` for Client.
6. No raw client ids are displayed anywhere in the control or chips.
7. The tests in tests.json pass, including the DB-backed filter matrix rows.
