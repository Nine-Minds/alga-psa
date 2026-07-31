# Fix email log pagination snap-back

Branch: `fix/email-log-pagination`

## Problem

On `/msp/email-logs` (System Monitoring → Email Logs), clicking page 2 renders page 2
momentarily, then the table snaps back to page 1. Pagination beyond page 1 is unusable.

## Diagnosis (confirmed in code)

`server/src/app/msp/email-logs/EmailLogsClient.tsx` fetches through a `fetchLogs`
`useCallback` whose dependency array includes `page` (line 135). Two filter effects list
`fetchLogs` in their dependencies and both call `fetchLogs({ page: 1 })`:

- debounced text-filter effect (lines 139–150)
- discrete-filter effect (lines 153–163)

Clicking page 2 runs `setPage(2)` and fetches page 2 — but the state change recreates
`fetchLogs`, which retriggers both filter effects, which immediately refetch page 1 and
overwrite the result. The `hasInitialized*` refs only guard each effect's first run, not
subsequent `fetchLogs` identity changes.

Two adjacent defects on the same screen, in scope:

1. **Default `pageSize` mismatch** — the client seeds `pageSize: 50`
   (`EmailLogsClient.tsx:45`) while the server action defaults to 25
   (`packages/email/src/actions/emailLogActions.ts:147`).
2. **Empty-then-populate flash** — `page.tsx` is `force-dynamic` but never passes
   `initialLogs`/`initialMetrics` (props the client already supports), so first paint is
   always an empty table followed by a client fetch.

Out of scope (noted, untouched): `getEmailLogsForTicket` silently caps at 200 rows with no
pagination — a different UI surface.

## Fix: single state-driven fetch effect

Restructure `EmailLogsClient` so there is exactly one fetch path and handlers only set
state. The snap-back bug becomes structurally impossible: no `useCallback` identity in any
dependency array, no competing effects.

### 1. `EmailLogsClient.tsx`

**State.** Keep the existing query state (`page`, `pageSize`, `sortBy`, `sortDirection`,
`status`, `startDate`, `endDate`, `recipientEmail`, `ticketNumber`). Add
`debouncedRecipient` and `debouncedTicket`, synced from the raw text values by one 300ms
debounce effect. Add a `refreshKey` counter.

**Fetch effect.** One `useEffect` calls `getEmailLogs` with the current query state. Its
dependencies are exactly the real query inputs: `page`, `pageSize`, `sortBy`,
`sortDirection`, `status`, `startDate`, `endDate`, `debouncedRecipient`,
`debouncedTicket`, `refreshKey`. Details:

- A request-sequence ref (`const seq = ++seqRef.current`; ignore the result unless
  `seq === seqRef.current`) so a stale response resolving late cannot overwrite a newer
  one. Rapid page clicks currently race.
- Do **not** write `result.page`/`result.pageSize` back into state — client state is the
  source of truth; only `setLogs(result.data)` and `setTotal(result.total)`. This removes
  the other half of the feedback loop.
- Skip the very first run when `initialLogs` was provided (one ref guard — the only ref
  that remains).

**Handlers become pure setters.**

- `onPageChange` → `setPage(n)`
- `onItemsPerPageChange` → `setPageSize(n); setPage(1)`
- `onSortChange` → `setSortBy(...); setSortDirection(...); setPage(1)`
- discrete filter changes (`status`, `startDate`, `endDate`) → set value; also `setPage(1)`
- debounce effect, when it commits a text value → also `setPage(1)`
- Refresh button → `setRefreshKey(k => k + 1); void fetchMetrics()`

React batches setter pairs, so "filter change while on page 3" produces one fetch of
page 1 with the new filter. Delete `fetchLogs`, both `hasInitialized*` refs, and every
direct `fetchLogs(...)` call site.

The `LEVERAGE: pattern datatable-filter-paging` marker at line 94 stays — this is still
the per-table pattern, just a correct instance of it.

### 2. `page.tsx` — SSR seeding

In the server component, call
`getEmailLogs({ page: 1, pageSize: 50, sortBy: 'sent_at', sortDirection: 'desc' })` and
`getEmailLogMetrics()`, pass results as `initialLogs`/`initialMetrics`. Wrap in
try/catch falling back to `undefined` props so a server-side failure degrades to today's
client-fetch behavior instead of breaking the page.

### 3. `emailLogActions.ts` — default alignment

Change the `getEmailLogs` default `pageSize` from 25 to 50 to match the UI seed.

## Verification

Live against the wired dev stack (`http://localhost:3880/msp/email-logs`, Compose project
`alga-psa-local-test`, Postgres on 5472). If the local DB has fewer than ~51 email log
rows, seed enough via SQL for the tenant to produce multiple pages.

1. Click page 2 → page 2 renders **and stays**; page 3 likewise.
2. On page 3, change the status filter → returns to page 1 showing filtered results.
3. Type in the recipient filter → single debounced fetch, page resets to 1.
4. Change page size → table reloads at page 1 with the new size.
5. Refresh button → logs and metrics refetch, current filters preserved.
6. Hard-reload the page → first paint shows rows (no empty-table flash).
7. Rapid-click pages 2→3→4 → final table shows page 4's rows (no stale overwrite).
