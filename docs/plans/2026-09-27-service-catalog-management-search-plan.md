# Service Catalog Management: Search — Implementation Plan

Card: 6f2723b5 "Service Catalog Management Search"
Date: 2026-09-27
Status: plan only (not implemented)

## Goal

Operators on **Billing → Service Catalog** (the "Service Catalog Management" card) can type
a term and narrow the catalog to matching services, combined with the existing Service Type
and Billing Method filters, with correct pagination and totals.

## What exists today

- **Screen:** `packages/billing/src/components/settings/billing/ServiceCatalogManager.tsx`
  (1720 lines), mounted at
  `packages/billing/src/components/billing-dashboard/BillingDashboard.tsx:284` under the
  `service-catalog` tab.
- **Filter bar:** two `CustomSelect`s (Service Type, Billing Method) at
  `ServiceCatalogManager.tsx:1123-1153`, with `QuickAddService` on the right
  (`:1154-1158`). There is no text search.
- **Filter state:** `selectedServiceType` / `selectedBillingMethod` at `:86-87`.
- **Fetching** (`fetchServices`, `:303-360`) has two modes:
  - No filter: server pagination via `getServices(page, pageSize, { item_kind: 'service' })` (`:335`).
  - Any filter active: fetches **everything** with `getServices(1, 1000, …)` (`:316`),
    filters in the browser (`:119-124`, duplicated at `:325-329`), and slices pages locally
    (`:367-370`). Past 1000 services, results are silently wrong.
- **Refetch on filter change** (`:200-211`) only runs when `services.length > 0`. With
  server-side filtering, a filter that returns zero rows would leave `services` empty, and
  after that no filter change would refetch.
- **The server already supports search.** `getServices` in
  `packages/billing/src/actions/serviceActions.ts:296` accepts `ServiceListOptions`
  (`:164-179`): `search` (ILIKE across `service_name`, `description`, `sku` at `:357-365`),
  `billing_method` (`:340-342`), `custom_service_type_id` (`:344-346`), plus `is_active`,
  `category_id`, `sort` and `order`. `totalCount` is computed after filtering (`:386-391`).
  **No server or schema change is needed.**
- **Existing pattern:** `ProductsManager.tsx` (the Products tab next to this one) already
  searches through the same action: `search` state `:60`, passed to `getServices` at
  `:157-164`, with a plain `Input` and a Search button at `:693-710`. Keys live under
  `products.filters.searchPlaceholder` (`server/public/locales/en/msp/billing-settings.json:892`).
- **Debounced search input:** `@alga-psa/ui/components/SearchInput`
  (`packages/ui/src/components/SearchInput.tsx`) has `debounceMs`, `onClear` and `loading`.
  It is already used with `debounceMs={300}` in
  `packages/billing/src/components/billing-dashboard/contracts/ServiceCatalogPicker.tsx:209`.

## Design decisions

1. **Move all filtering to the server.** Search can't be added to the "fetch 1000 and
   filter in the browser" path without keeping the 1000-row limit and a third copy of the
   predicate. `getServices` already takes every filter this screen uses, so
   `fetchServices` becomes a single server-paginated call. This removes both client-side
   predicates and the local slicing.
2. **Search as you type**, using `SearchInput` with `debounceMs={300}` and a clear button.
   It matches the catalog picker on the same product surface. ProductsManager's
   click-to-search button is an older pattern. Don't copy it, and don't change it here.
3. **Search fields:** name, description and SKU, which is what the server already does.
   Services rarely have SKUs, but the query is shared with Products and there is no reason
   to fork it.
4. **Filter changes reset to page 1 and clear the bulk selection.** This matches the current
   behaviour at `:204-208`.

## Changes, in order

### 1. State and fetch (`ServiceCatalogManager.tsx`)

- Add `const [searchTerm, setSearchTerm] = useState('')` next to the filter state (`:86-87`).
- Rewrite `fetchServices` (`:303-360`) as one call:
  ```ts
  getServices(pageToFetch, pageSize, {
    item_kind: 'service',
    search: searchTerm.trim() || undefined,
    custom_service_type_id: selectedServiceType === 'all' ? undefined : selectedServiceType,
    billing_method: selectedBillingMethod === 'all' ? undefined : selectedBillingMethod as 'fixed' | 'hourly' | 'usage',
    sort: 'service_name',
    order: 'asc',
  })
  ```
  Then `setTotalCount(response.totalCount)` and `setServices(response.services)`. Keep
  the error handling (`:317-322`) and the page-correction logic (`:350-352`) as they are.
- **Stale responses:** fast typing can resolve requests out of order. Add a request-sequence
  ref (`latestRequestRef`): increment it per call and ignore any response whose id isn't the
  latest. Today's client-side mode never had this problem, because filters didn't trigger
  a network call per keystroke.
- Delete the client-side predicate `filteredServices` (`:119-124`). `memoizedFilteredServices`
  (`:125`, feeding `useRangeSelection` `:130`, `visibleServiceIds` `:137` and the DataTable
  `data` `:1171`) becomes a memo of `services`. Replace the `JSON.stringify` memo key with
  `services` identity, because server responses produce a new array only on fetch.
- Simplify the usage-count effect (`:366-375`) to `loadUsageCounts(services)`, since
  `services` is now always exactly the visible page. Update its dependency list.
- Stale `console.log`s in `fetchServices`/effects (`:307`, `:315`, `:334`) reference the
  removed modes. Remove them where the code they describe is removed.

### 2. Refetch trigger (`:200-211`)

- Add `searchTerm` to the dependency list.
- Replace the `services.length > 0` guard with an `isInitialMountRef` (or skip the first
  run). Otherwise a filter or search that returns zero rows blocks every later refetch,
  including clearing the search.
- Keep `setCurrentPage(1)` + `clearSelection()` + `fetchServices(false)`.

### 3. UI (`:1123-1153`)

- Put a `SearchInput` first in the filter row:
  - `id="service-catalog-search"` (automation id)
  - `value={searchTerm}`, `onChange={e => setSearchTerm(e.target.value)}`, `debounceMs={300}`
  - `onClear={() => setSearchTerm('')}`
  - `placeholder={t('serviceCatalog.filters.searchPlaceholder', { defaultValue: 'Search services by name, SKU, or description...' })}`
  - `className="w-[280px]"` (same width as Products).
- Change the filter container `className="flex space-x-2"` to `flex flex-wrap gap-2` so three
  controls wrap cleanly on narrow widths.
- Don't swap the table for the `LoadingIndicator` on every keystroke. At `:1161-1168` the
  whole table is replaced while `isLoading`, so every debounced search would unmount the
  table and make it flicker. Use the full-page loader only for the initial load
  (`isLoading && services.length === 0 && !hasLoadedOnce`). For refetches, keep the table
  mounted and show `loading` on the `SearchInput`.
- **Empty result:** when `totalCount === 0` and a search or filter is active, show
  "No services match your search." in place of the empty table body, with a "Clear filters"
  action that resets all three controls. Check what `DataTable` renders for empty data
  first. If it doesn't accept an empty-state slot, render the message above/instead of it
  in this component; don't extend DataTable for this card.

### 4. i18n

- Add keys under `serviceCatalog.filters` in
  `server/public/locales/en/msp/billing-settings.json` (block at `:724-729`):
  `searchPlaceholder`, and under `serviceCatalog` add `emptySearch` and `clearFilters`
  (or reuse an existing common "Clear filters" key if `common.json` has one).
- Add the same keys to `de, es, fr, it, nl, pl, pt`, and regenerate the pseudo-locales
  `xx`/`yy` with `scripts/generate-pseudo-locales.cjs`. Run `scripts/validate-translations.cjs`
  and `scripts/find-missing-i18n-keys.cjs`.

### 5. Tests

Add `ServiceCatalogManager.search.contract.test.tsx` beside the existing contract tests. Reuse
the mock harness from `ServiceCatalogManager.bulkActions.contract.test.tsx:17-95`
(`getServicesMock`, etc.). Cases:

- Typing a term calls `getServices` with `{ search: '<term>', item_kind: 'service' }` and page 1
  after the debounce (fake timers). It is not called per keystroke.
- Search combines with Service Type and Billing Method: one call carries all three options.
  Assert that `getServices` is **never** called with page size 1000.
- Changing the search while on page 3 resets to page 1 and clears the bulk selection.
- Zero results, then clearing the search, refetches. This is a regression test for the
  `services.length > 0` guard.
- Out-of-order responses: the older resolved response doesn't overwrite the newer one.
- The empty state renders and "Clear filters" resets all controls.
- The existing bulkActions and rollout contract tests still pass, and their mocks still
  satisfy the new call shape.

Integration: the ILIKE path in `getServices` is shared with Products. Add or extend an
integration test (see `integration-testing` skill conventions) asserting that
`getServices(1, 10, { item_kind: 'service', search: 'x' })` excludes products and other
tenants' rows, and that `totalCount` reflects the filter.

### 6. Manual smoke

Billing → Service Catalog:
1. Search a partial name; the count and pages reflect matches.
2. Combine search with a billing method filter.
3. Search for a term with no match; the empty state shows, and Clear restores the list.
4. Page 2, then search; you land on page 1 with the selection cleared.
5. Edit a service found by search; the row updates and the search is preserved.

## Non-goals

- Products tab search UX (`ProductsManager.tsx` click-to-search). This stays unchanged, apart
  from a possible `LEVERAGE` marker (see Risks).
- Server-side changes to `getServices` or new search fields (for example, service type name or
  unit of measure). Adding `st.name` to the search is a possible follow-up.
- Full-text or trigram search indexes. ILIKE over one tenant's catalog is adequate at
  catalog sizes. Revisit only if the catalog query shows up in slow-query logs.
- An active/inactive status filter, category filter, column sorting, or URL-persisted filter
  state on this screen.
- Search inside `ServiceCatalogPicker`, the contract wizards or the quote editor. They
  already use `searchServiceCatalogForPicker`.
- Refactoring the page-preservation hacks around update/delete (`:478-511`, `:566-591`).
  They should keep working unchanged, but cleaning them up is out of scope.

## Risks

- **Selection and range-select semantics.** `useRangeSelection` (`:129-131`) and
  `visibleServiceIds` currently operate on `memoizedFilteredServices`. Previously, when a
  filter was active, the DataTable got *all* filtered rows and paginated them itself. Now it
  gets exactly one page. Confirm the DataTable doesn't slice again: with `totalItems` set it
  should treat `data` as the current page, as the unfiltered path already does. Also confirm
  that "select all visible" still means the visible page.
- **Refetch race / page drift.** `handlePageChange` (`:626-636`) and the filter effect both
  call `fetchServices`. The request-sequence guard covers this. Without it, a debounced
  search that lands during a page change can show page-N results under page 1.
- **Post-mutation refetches** (`fetchServices(true)` after edit/delete, `:506`, `:586`, and
  `onServiceAdded={fetchServices}` at `:1155`) now include the active search. That's the
  desired behaviour, but a just-created service that doesn't match the current search will
  seem to "vanish". Accept this, and note it in the smoke test. Also note that
  `onServiceAdded={fetchServices}` passes no args, so `preservePage` is `undefined`, which
  is falsy and gives page 1. That's fine, but keep it that way.
- **Behaviour change for large catalogs.** Tenants with more than 1000 services currently get
  truncated filter results. After this change they get correct ones. This is a user-visible
  change, and it's a fix.
- **LIKE wildcards.** User input containing `%` or `_` is interpolated into the ILIKE pattern
  at `serviceActions.ts:358` (and the picker at `:219`), so `_` matches any character. It's
  harmless (parameterized, no injection), but results may be broader than typed. Escaping is
  a shared-server change and out of scope. Drop a `// LEVERAGE: pattern ilike-search` marker
  at both sites if this is touched.
- **Leverage note.** Products and Service Catalog managers now each hand-roll the same
  "search + selects + server paginate + request guard" list shape. Mark both with
  `// LEVERAGE: pattern catalog-list-query — …` rather than extracting a hook in this card.
