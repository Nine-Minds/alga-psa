# Ticket list live-change focus links

## Problem

The MSP ticket list shows a live-update banner when other people create or update tickets after the list loaded ("2 new tickets and 3 updated tickets"). The banner is a single button: clicking anywhere reloads the whole list with its current filters. The user can't tell which rows are the new or changed ones, and on a busy list the changed tickets are lost among everything else on the page.

## Goal

Make each part of the banner a link to the tickets it counts:

- **"N new tickets"** filters the list to just those new tickets.
- **"N tickets updated"** filters the list to just those updated tickets.
- A separate **"Refresh list"** entry keeps today's behaviour: reload the full list with its own filters and clear the counts.

## Non-goals

- Changing how changes are detected, published or authorized (the hocuspocus relay, `ticket-list-changes` Redis channel and per-recipient authorization are unchanged).
- Changing what counts as "new". Today a ticket that matches the filters but is not on the loaded page counts as new, even if it is an old ticket on a later page that was just edited. The focused view will make that visible. Fixing it (classify by the event's `changeKind`) is a separate change.
- Persisting a focused view: it is never saved as a board or tenant view and is not written to the URL.

## Users and flow

MSP technicians and dispatchers working the ticket list.

1. The list is loaded; another user creates two tickets and updates three on the page.
2. The banner reads: `2 new tickets · 3 tickets updated · Refresh list`.
3. The user clicks "2 new tickets". The list shows exactly those two tickets. A notice in the toolbar reads "Showing 2 new tickets" with a "Show all tickets" action.
4. The banner still offers "3 tickets updated" and "Refresh list". Further live changes keep counting against the full list, not the focused one.
5. "Show all tickets" or "Refresh list" returns to the full list with its original filters. Refresh also clears the remaining counts.

## Design

### Focus is a temporary overlay, not a filter edit

The container holds focus as its own state: `{ kind: 'new' | 'updated', ticketIds: string[] }`. At fetch time the container builds the request from it instead of from `activeFilters`:

- the only scope clause is `where: ticket_id in [...]`;
- `boardFilterState: 'all'`, bundles shown individually, no status/assignee/board/search filters;
- the current sort and page size are kept.

The other filters are replaced, not combined. Combining breaks the main case: with the list filtered to Open, a ticket someone closed counts as "updated", but `status = open AND ticket_id in [...]` would hide it.

`activeFilters`, the URL sync (`updateURLWithFilters`), saved-view capture (`captureTicketViewSettings`) and the dirty-view baseline never see the focus overlay. Select-all-matching, bulk actions and export use the focused request while focus is active, so they act on what is shown.

### Ticket ID as a query field

Add `ticket_id: uuidColumn('ticket_id', ['in'])` to `createTicketQuerySchema` in `shared/lib/ticketQuery/ticketQuerySchema.ts`. The list query, counts, select-all and export then honour it with no extra code. The `where` validator must cap the number of values in a `ticket_id` clause (200). `TICKET_WHERE_MAX_CLAUSES` limits clauses only.

`matchesTicketListChange` in `packages/tickets/src/lib/listChangeFilters.ts` adds `ticket_id: change.ticketId` to the record it evaluates. Otherwise the unknown-path check returns null for every event while a `ticket_id` clause is present.

### Change tracking stays on the full list

`ChangedSinceLoad.load()` (in `packages/tickets/src/lib/changedSinceLoad.ts`) currently runs on every list load. It drops every change older than that load and reclassifies against the loaded rows and filters. If it ran on a focused load, clicking "2 new" would silently clear the "3 updated" count, and changes outside the focused set would stop counting.

- Focused loads do not call `load()`. The tracker keeps the full list's snapshot (page IDs, filters, loadedAt).
- New methods:
  - `ticketIds(kind)` returns the tracked IDs of one kind (live entries plus fallback IDs).
  - `acknowledge(kind, at)` clears that kind's entries up to `at` and leaves the other kind alone.
- Entering focus acknowledges the clicked kind at the time the focused query completes.

### Counts-only recovery must return new-ticket IDs

After a live-connection outage, and whenever a search query is active, the counts come from `getTicketChangeCounts` in `packages/tickets/src/actions/optimizedTicketActions.ts`. It returns IDs for changed tickets on the loaded page (`loadedChanged`) but only a count for new tickets. The candidates are already authorized (`filterAuthorizedTickets`) and limited to the list query's matching set, so returning their IDs reveals nothing the list would not show.

- `countAuthorizedTicketChanges` (in `packages/tickets/src/lib/ticketChangeCounts.ts`) also returns `newTicketIds`, capped at 200 to match the `where` cap.
- `getTicketChangeCounts` returns them, and the fallback snapshot in `ChangedSinceLoad` stores them next to `updatedTicketIds`.
- If more than 200 new tickets exist, the "N new" link focuses on the first 200, and the focus notice says so.

### Banner

Replace the single `#refresh-ticket-list-changes` button in `TicketingDashboard.tsx` with a banner row holding up to three controls:

- `#ticket-list-changes-new` focuses on new tickets (shown when the new count is above 0);
- `#ticket-list-changes-updated` focuses on updated tickets (shown when the updated count is above 0);
- `#ticket-list-changes-refresh` reloads the full list.

Use existing standard components (Button with a link variant) rather than raw styled buttons. The current `live.both.*`, `live.newOne/Many` and `live.updatedOne/Many` strings become separate pluralised strings per control, plus strings for "Refresh list", the focus notice ("Showing {{count}} new tickets", "Showing {{count}} updated tickets", the capped variant) and "Show all tickets". Update every locale in `server/public/locales/*/features/tickets.json` and regenerate the `xx`/`yy` pseudo-locales.

### Leaving focus

- "Show all tickets" drops the overlay and refetches the full list. That load calls `ChangedSinceLoad.load()` as usual, acknowledging what it now shows.
- "Refresh list" (from the banner, in or out of focus) does the same. `refreshListForChanges` in `TicketingDashboardContainer.tsx` must use the full list's filters, not the request currently on screen.
- Any user edit to the filters, board tab or search while focused leaves focus first, then applies the edit to the full list's filters.

## Edition

Community Edition. The ticket list and the live-update banner are CE (`packages/tickets`, `shared/lib/ticketQuery`); nothing here belongs under `ee/`.

## Risks

- Unbounded `ticket_id in` lists: covered by the 200-value cap in the `where` validator.
- Saved views picking up the overlay: covered by keeping focus out of `activeFilters`; a test asserts it.
- A focused ticket deleted or made unreadable before the click is simply absent. The notice count reflects the rows actually returned.

## Acceptance criteria

1. With live changes of both kinds, the banner shows separate "N new", "N updated" and "Refresh list" controls.
2. Clicking "N new" shows exactly those tickets, whatever filters were active, and the "N updated" count stays.
3. Clicking "N updated" shows exactly those tickets, including ones that no longer match the original filters.
4. While focused, further changes keep counting against the full list.
5. "Show all tickets" and "Refresh list" restore the original filters; Refresh clears the counts.
6. The URL, saved board/tenant views and the dirty-view indicator never contain the focus.
7. During counts-only recovery (after an outage or with a search active), "N new" still focuses on the right tickets.
8. All new strings are translated in every locale and the pseudo-locales are regenerated.
