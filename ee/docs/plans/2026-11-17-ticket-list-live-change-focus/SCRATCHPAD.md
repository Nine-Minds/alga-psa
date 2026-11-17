# Scratchpad: ticket list live-change focus

## Where things are (origin/main, after PR 4135)

- Banner: `packages/tickets/src/components/TicketingDashboard.tsx`, button `#refresh-ticket-list-changes` (~line 2646). Click calls `onRefreshListForChanges`.
- Refresh: `refreshListForChanges` in `packages/tickets/src/components/TicketingDashboardContainer.tsx` (~line 584) refetches with `activeFiltersRef.current`.
- Change tracker: `packages/tickets/src/lib/changedSinceLoad.ts` (`ChangedSinceLoad`). Entries map ticketId -> kind; `load()` runs on every list load from a `useLayoutEffect` keyed on `initialTickets, loadedAt, loadedFilters`.
- Live events: `packages/tickets/src/hooks/useTicketListChanges.ts` (hocuspocus stateless messages on `tenant:<id>:ticket-changes`); classification in `packages/tickets/src/lib/listChangeFilters.ts`.
- Recovery: `getTicketChangeCounts` in `packages/tickets/src/actions/optimizedTicketActions.ts` and `countAuthorizedTicketChanges` in `packages/tickets/src/lib/ticketChangeCounts.ts`. Used after an outage and on every event while a search query is active (`liveTicketChangeWiring.ts`).
- Load by IDs precedent: `loadTicketListItemsByIds` (used by smart search). Not used for focus, because a `where` clause gives paging, sort, select-all and export for free.
- Query schema: `shared/lib/ticketQuery/ticketQuerySchema.ts`. `ITicketListFilters.where` doc says new filter dimensions go there, not as new interface keys.
- Where URL codec: `packages/tickets/src/lib/ticketWhereUrl.ts`; clause cap `TICKET_WHERE_MAX_CLAUSES = 50` in `ticketWhere.ts` (no value cap).

## Decisions

- Focus replaces the other filters instead of combining with them: an "updated" ticket may no longer match the original filters (closed while the list shows Open).
- Focus is a container-held overlay, kept out of `activeFilters`, URL and saved views.
- Recovery returning new-ticket IDs is safe: candidates are already filtered by `filterAuthorizedTickets` and intersected with the list query's matching set.
- 200 cap on `ticket_id in` values, shared by the validator and `newTicketIds`.

## Known quirk (out of scope)

"New" means "matches the filters but is not on the loaded page", so an old ticket edited on page 2 counts as new. The focused view makes this visible. Fix separately by using the event's `changeKind`.
