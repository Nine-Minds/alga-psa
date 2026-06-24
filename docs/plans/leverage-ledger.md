# Leverage ledger

Tracking for cross-cutting leverage candidates (no single home) and decisions.
Inline markers are the per-site ledger; `grep -rn "LEVERAGE:"` is the count.

---

## datatable-client-paging — friction

- **What:** Every client-side consumer of `@alga-psa/ui/components/DataTable` re-derives the
  same controlled paging state — `const [currentPage] = useState(1)` / `const [pageSize] =
  useState(10)` plus a `handlePageSizeChange` that sets size and resets the page to 1 — and threads
  all four (`currentPage` / `onPageChange` / `pageSize` / `onItemsPerPageChange`) back into the
  table.
- **Root cause (wrong layer):** `DataTable` is *half-controlled*. It keeps its own
  `{pageIndex, pageSize}` state and syncs from the controlled props via effects, and it renders the
  items-per-page selector but delegates the actual size change back to the parent
  (`onItemsPerPageChange`, with no internal `setPageSize`). So a consumer that just wants default
  client paging with a working size selector is forced to hold the state anyway.
- **Where (~13 sites, all marked):**
  - `packages/ui/src/components/DataTable.tsx` (engine root-cause marker)
  - `packages/jobs/src/components/monitoring/RecentJobsDataTable.tsx`
  - `server/src/app/client-portal/request-services/my-requests/MyRequestsTable.tsx`
  - `server/src/app/msp/service-requests/ServiceRequestsManagementPage.tsx` (no-op variant — dummy `currentPage={1}` / `onPageChange={() => {}}`)
  - `server/src/components/settings/general/{UserList,BoardsSettings,ChecklistTemplatesSettings,InteractionTypeSettings,InteractionStatusSettings}.tsx`
  - `server/src/components/settings/profile/ApiKeysSetup.tsx`
  - `server/src/components/settings/secrets/SecretsManagement.tsx`
  - `server/src/components/settings/security/{AdminApiKeysSetup,AdminWebhooksSetup}.tsx` (AdminWebhooksSetup has 2 instances — two components)
- **Variants worth noting (not separately marked):** some consumers opt out of the awkward API by
  hardcoding — `pageSize={999} // Show all users` (`UserRoleAssignment.tsx`), `pageSize={10}`
  (`TeamDetails.tsx`). The spread of strategies (thread state / no-op props / hardcode) is itself
  evidence the paging contract is unclear.
- **Gate:** frequency saturated (≫3, verbatim); cost low per site but correctness-adjacent (page
  reset on size change is easy to forget); stable (shape has stopped moving — identical across all
  sites); leverage high (one fix removes the block everywhere + clarifies the contract).
- **Axis-2 (how to land):** **promote-to-plan / staged-migration.** Wide blast radius across an
  exported UI primitive with ~13 callers. Candidate call-site-first shape: let `DataTable` own
  client paging by default (uncontrolled), exposing the items-per-page selector without requiring
  the parent to hold `pageSize`; keep the controlled props as an opt-in escape hatch for
  server-side paging. Migrate callers, then delete the boilerplate.
- **Status:** watching (markers placed this pass — detection only, no extraction).

---

## datatable-paging-remount — friction

- **What:** `key={`${currentPage}-${pageSize}`}` on `<DataTable>` to remount the entire table and
  force paging to apply — a sharper symptom of the same half-controlled engine as
  [[datatable-client-paging]].
- **Where (2 sites, marked):** `UserList.tsx`, `RecentJobsDataTable.tsx`.
- **Gate:** friction (weighs heavy — direct evidence the layer is wrong); fixing the root cause
  above removes the need for the remount hack entirely.
- **Status:** watching (resolve together with `datatable-client-paging`).

---

## datatable-filter-paging — pattern

- **What:** Tables with filters re-implement the same list-controller shape with no shared layer:
  filter state, a 300ms debounce on text search, "reset page to 1" on every filter/size/sort
  change, and either a client-side `filteredX` `useMemo` or a server fetch state machine.
- **Where (strong instances, marked):**
  - `packages/tickets/src/components/TicketingDashboard.tsx` (**largest instance** — full server list-query: filter state + 500ms search debounce + reset-page + manual fetch + URL sync; added 2026-06-19 during the ticket-list redesign)
  - `server/src/components/settings/profile/ApiKeysSetup.tsx` (client filter + debounce + reset)
  - `server/src/components/settings/security/AdminApiKeysSetup.tsx` (near-identical to ApiKeysSetup — the two files are ~95% duplicate components, a separate candidate)
  - `server/src/app/msp/email-logs/EmailLogsClient.tsx` (server variant: fetch + debounce + reset + manual sort)
- **Lighter / partial instances (not marked — different/smaller shape):**
  - `SecretsManagement.tsx` (search-only `filteredSecrets`, no debounce, no page reset)
  - `ServiceRequestsManagementPage.tsx` (`showArchived` toggle → `visibleDefinitions`)
  - `UserList.tsx` (`selectedClientId` → `visibleUsers`)
  - `AdminWebhooksSetup.tsx` inbound deliveries (server paging + `inboundDeliveryStatusFilter`)
- **Gate:** frequency strong; cost medium (debounce + page-reset coordination is easy to get
  subtly wrong); leverage high. Missing layer, not a wrong one → **extract** a `useListController`
  / `useFilteredTable` hook (filters + paging + sort + debounce + reset, client or server).
- **Axis-2 (how to land):** bounded-now to promote-to-plan — a hook is additive (callers migrate
  incrementally), but coordinating with the `datatable-client-paging` engine revision argues for a
  single plan.
- **Status:** watching.

---

## filter-descriptor-table — pattern

- **What:** Within a single filtered list, each filter dimension's three facts — *is it active*,
  *its human label*, and *how to clear it* — get written once per consumer of that knowledge. In
  `TicketingDashboard` that's now three copies: the toolbar control's `onValueChange`, the
  `activeFilterCount` memo, and the `activeFilterChips` memo. Adding the chips this session was the
  third hand-written copy across ~12 dimensions (board, client, assignee, team, unassigned, status,
  response, priority, due, sla, category, tags).
- **Where:** `packages/tickets/src/components/TicketingDashboard.tsx` (marked at `activeFilterChips`).
- **Gate:** frequency 3 copies × ~12 dimensions; cost medium (every new filter or chip must touch
  all three in sync — drift = a chip that doesn't clear, or a miscount); stability good (filter set
  is stable); leverage real but **local to one component** so far.
- **Shape if extracted:** one `FILTER_DESCRIPTORS` list of `{ key, isActive(filters), label(filters,
  lookups), clear() }`; the count, the chips, and (eventually) the controls all derive from it.
- **Axis-2:** in-pass/bounded-now — self-contained to this component, no API ripple. Worth doing if
  a 4th consumer of the per-dimension knowledge appears (e.g. a saved-views feature).
- **Status:** watching (1 component; revisit if it recurs in another filtered list, at which point
  it converges with `datatable-filter-paging`).

## Notes

- `ApiKeysSetup.tsx` and `AdminApiKeysSetup.tsx` are near-duplicate components (profile vs admin
  API keys). Worth a separate `apikeys-setup-dup` candidate if it recurs / diverges — left
  unmarked this pass to keep the table-focused ledger clean.
