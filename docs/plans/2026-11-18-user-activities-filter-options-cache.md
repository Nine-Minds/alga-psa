# User Activities filter options: cache and batch the reference lists

Ticket: alga-2026-0003109 (PBNJ Consulting, Phill Hodgkinson). Branch: `feature/user-activities-cache-filter-options-so-the-filt`.

## Problem

On User Activities the filter bar fills in after the activity data. The tenant that reported it has 2 tickets and 1 scheduled item, so the activity query is not the cost. Each visit fetches every filter option list again from scratch.

### What the page does on mount

`packages/user-activities/src/hooks/useActivityFilterOptions.ts` runs three mount effects (lines 62–108). They make five server-action calls, and a sixth when exactly one prioritized type is selected (lines 47–60):

| Call | Server code the page hits | App queries |
|---|---|---|
| `getAllBoards(true)` | `packages/reference-data/src/actions/boardActions.ts:8`, the `@alga-psa/reference-data/actions` copy. A second copy, `packages/tickets/src/actions/board-actions/boardActions.ts:178`, is not used here. | 1 (`boards`, whole table) |
| `getStatuses('ticket')` | `packages/reference-data/src/actions/status-actions/statusActions.ts:53` | 1 (`statuses`, ticket type, board-scoped rows) |
| `ctx.getProjectsWithPhases()` | `packages/projects/src/actions/projectActions.ts:804`, supplied through `MspActivityCrossFeatureProvider.tsx:211` | permission check, then 3 parallel bulk reads (projects, phases, status mappings with 2 left joins), then `filterAuthorizedProjects`. No N+1. |
| `findAllTagsByType('ticket')` | `packages/tags/src/actions/tagActions.ts:778` | `resolveTagReadScope`, then 1 `DISTINCT ON` read with two `EXISTS` subqueries |
| `findAllTagsByType('project_task')` | same | same |

Every call also pays a fixed auth prelude in `withAuth` / `withOptionalAuth` (`packages/auth/src/lib/withAuth.ts:151`): session and revocation check, user-with-roles load, a co-managed acceptance check, and a transaction (`BEGIN`/`COMMIT`).

### Measured SQL cost

I timed the list queries in `psql` against the local `server` database. The tenant was the largest local one, "Oz": 34 boards, 74 ticket statuses, 27 projects, 23 phases, 146 status mappings, 37 tag definitions.

| Query | Time (warm) |
|---|---|
| boards | 0.5–1.6 ms |
| ticket statuses | 0.3–0.7 ms |
| projects / phases / status mappings | 0.2–0.5 / 0.2–0.3 / ~2.6 ms |
| tags (ticket) / tags (project_task) | 0.2–0.8 / 0.2 ms |

**The card's hypothesis that `getProjectsWithPhases` dominates is not supported.** Its SQL is about 3 ms in total. No single list query is expensive.

### Where the time goes: one serial lane for all server actions

Next 16.4.2 runs client-invoked server actions **one at a time**. `callServer` resolves to `next/dist/client/sequential-call-server.js`, which puts every action into the router action queue. `app-router-instance.js` (`runAction` / `runRemainingActions`, lines ~30–75) starts the next action only after the previous one settles. The concurrent variant sits behind `experimental.concurrentRouterQueue`, which defaults to `false` (`config-shared.d.ts:1928`). It is not enabled in `server/next.config.mjs`.

As a result:

- The `Promise.all([getAllBoards, getStatuses])` and `Promise.all([tags, tags])` in the hook do **not** run in parallel. Each pair is two queued round trips.
- On mount, the page shares this lane with several other callers:
  - every `useUserPreference`, which makes two serial actions each (`getCurrentUser` then `getUserPreference`, `packages/user-composition/src/hooks/useUserPreference.ts:79–112`): view mode, `activitiesTableFilters`, list view mode, ungrouped-collapsed;
  - the activity groups load;
  - the activities fetch, which waits for the saved-filters preference to resolve (#4217, `ActivitiesDataTableSection.tsx:287–290`).
- Each list costs a full HTTP round trip plus the auth prelude, not 1 ms of SQL. Five option actions mean five serialized round trips. On a remote production client that is likely hundreds of milliseconds to over a second, even though the SQL is single-digit milliseconds.
- In the filter bar, the tag and project controls are **hidden** until their arrays are non-empty (`ActivitiesTableFilters.tsx:827`, `:851`, `:870`). Board and status controls render with empty option lists. Nothing blocks rendering in code, but the user sees controls appear late and shift the layout. That matches the report.

### Not established

- **Wall-clock timings for the whole page.** The card's dev server on 3223 was suspended by the board during this design step: the step does not own it, and it was suspended again right after a restart. No browser network trace was taken. Dev-mode timings would also be distorted by on-demand compilation. The round-trip claim rests on the Next queue code and the SQL timings above, not on a stopwatch.
- **Which piece the reporter saw finish last in production.** From effect order, the option actions are queued at mount commit. The preference reads are queued one commit later. `getActivities` is queued after the saved-filters preference resolves. Option fetches therefore usually reach the server before the data request. The bar can still look later because its controls only appear when their arrays fill, and because the lane is shared with the other mount actions. The Draft Implementation step must record a before/after network trace on a real browser (see Slice 5) to settle this.

## Mechanism

**Use SWR, which the repo already uses. Add a small reference-list layer on top of it, plus one batched server action so a cold load is one round trip instead of five.**

### Existing caching convention reused

- `swr` is a root dependency (`package.json:222`, `^2.3.0`). It is already the client cache convention in 43 files, for example:
  - `packages/assets/src/components/MaintenanceCommandCenter.tsx:200–202`: keyed `useSWR` over server actions;
  - `packages/assets/src/components/AssetForm.tsx:176` and `packages/msp-composition/src/tickets/ReceiveEquipmentDialog.tsx:49`: invalidation through `useSWRConfig().mutate`.

  There is no app-root `SWRConfig` provider override. The default cache is module-global, so it **survives client-side navigation** (leave User Activities and come back) and is dropped on a full reload or sign-out. That is the lifetime "a second visit" needs.
- No `@tanstack/react-query` is used.
- `unstable_cache` appears only for tenant branding and theme (`packages/tenancy/src/actions/tenant-actions/*`). It does not fit here, because tag and project lists are **user-scoped**: `resolveTagReadScope` and `filterAuthorizedProjects` narrow them per user.
- Inside `user-activities` there are two hand-rolled caches: `useActivitiesCache.ts:18–22`, a TTL map, and the `MyActivityGroupsProvider` store. They are a sign this package keeps re-inventing a query cache. They are left alone here and marked as a pattern for later.
- Provider-supplied fetchers (ui defines the context, the MSP composition layer injects the actions) follow the `ClientPickerSearchProvider` pattern from #4411 (`packages/msp-composition/src/clients/MspClientTagsProvider.tsx:30–37`). The new layer follows the same split.

### The layer

1. **`packages/ui/src/lib/referenceData/`** (client, no domain imports):
   - `ReferenceDataProvider` takes `load(keys: ReferenceListKey[]) => Promise<Partial<Record<key, unknown>>>` and an identity `scope` (tenant + user id).
   - `useReferenceLists(keys, { freshForMs })` reads each list from SWR under `['ref', scope, key]`. It works out which keys are missing or older than their freshness window and fetches **all of those in one `load` call**: one server action, one lane slot. It writes each result into its own SWR key and returns `{ data, isLoading }` per key.
   - `invalidateReferenceList(key | key[])` calls the global `mutate` on matching keys. The caller does not need the scope or SWR internals.
   - A list registry, `ReferenceListKey` = `'boards' | 'ticketStatuses' | 'ticketTags' | 'projectTaskTags' | 'projectsWithPhases' | 'priorities:ticket' | 'priorities:project_task'`, with each key's freshness policy (below). Adding a picker list means adding a key, not a hook.
2. **`packages/msp-composition/src/referenceData/referenceDataActions.ts`** (server, `'use server'`):
   - One `withAuth` action, `loadReferenceLists(keys)`. It runs the existing list functions for the requested keys **in parallel on the server** under one auth prelude, and returns a keyed record.
   - The composition layer is the only one allowed to import reference-data, tags and projects together.
   - It reuses the existing query bodies by extracting each action's body into a plain function that takes `(trx/knex, tenant, user)`. The four existing exported actions stay and call the same functions, so other callers are unaffected.
   - A permission denial or tag error for one key returns that key as an error marker without failing the batch. This keeps today's per-list degradation.
3. **`MspReferenceDataProvider`** mounts in `WorkspaceProviders.tsx` beside `MspActivityCrossFeatureProvider`. It supplies `load = loadReferenceLists` and the scope from the session.
4. **`useActivityFilterOptions`** becomes a thin call: `useReferenceLists(['boards','ticketStatuses','ticketTags','projectTaskTags','projectsWithPhases', …priorityKey])`. It returns the same `ActivityFilterOptions` shape plus a per-list `loading` map. `ctx.getProjectsWithPhases` is no longer used by this hook. The cross-feature context member stays for other consumers.

### Freshness policy (stale-while-revalidate)

| Key | Fresh for | When stale or invalidated |
|---|---|---|
| `boards`, `ticketStatuses`, `ticketTags`, `projectTaskTags`, `priorities:*` | 5 min | Cached value renders at once; background refetch in one batched call |
| `projectsWithPhases` | 0 (always revalidate on mount) | Cached value renders at once; background refetch every visit |

Within 5 minutes, a second visit sends **no** action for boards, statuses or tags (acceptance criterion 2). Projects always revalidate in the background, so a new project appears on the next visit without a full reload (criterion 3). The user never waits for it, because the cached list is already shown. Ticket and task tags get explicit invalidation (below) because tags are created inline all over the app. The 5-minute window bounds staleness for changes made by *other* users or in other tabs.

## Invalidation matrix

| Change | Where it happens (client chokepoint) | Invalidates | Fallback if a site is missed |
|---|---|---|---|
| Board create / update / delete / reorder | `packages/tickets/src/components/settings/BoardsSettings.tsx`, `packages/onboarding/src/components/steps/TicketingConfigStep.tsx` | `boards`, `ticketStatuses` (statuses are board-scoped) | 5 min freshness |
| Ticket status create / update / delete | `packages/reference-data/src/components/dialogs/StatusDialog.tsx` and the board-status editor in `BoardsSettings` | `ticketStatuses` | 5 min freshness |
| Tag create / delete / rename / recolor, first or last mapping of a tag | `packages/tags/src/context/TagContext.tsx`, `TagManager.tsx`, `QuickAddTagPicker.tsx` | `ticketTags` / `projectTaskTags` for the tagged type (the list only includes tags with a mapping or reference) | 5 min freshness |
| Priority create / update / delete | priority settings (reference-data) | `priorities:*` | 5 min freshness |
| Project create / update / activate / deactivate / delete | `ProjectQuickAdd.tsx`, `ProjectDetailsEdit.tsx`, `ProjectActiveToggle.tsx`, `Projects.tsx`, `ApplyTemplateDialog.tsx` | `projectsWithPhases` | revalidated on every mount |
| Phase add / edit / delete, project status mapping change | `PhaseQuickAdd.tsx`, `PhaseListItem.tsx`, `ProjectDetail.tsx`, `ProjectStatusSettings.tsx`, `TemplateStatusManager.tsx` | `projectsWithPhases` | revalidated on every mount |
| Role or permission change (affects tag or project visibility) | none on the client | none | 5 min freshness / next mount; full reload on sign-in again |
| Tenant or user switch, sign-out | full navigation | entire cache (module reload); keys are also scoped by tenant + user | none needed |

Invalidation calls are added only at those chokepoints, after the mutation succeeds. A missed call costs at most 5 minutes of staleness for the reference lists, or one navigation for projects. It never causes wrong filtering: a stale option id just matches fewer rows, as it does today when a board is deleted.

## Filter bar: never blocked, rendered progressively

- The bar already renders before any list arrives (`ActivitiesDataTableSection.tsx:589`, `ActivitiesCardsView.tsx:80`). Type toggles, date range, search, the closed toggle and the client picker (server-search, #4411) work at once.
- Change: the tag and project controls **render while loading instead of being hidden**. They show their trigger in a disabled "Loading…" state using the existing `CustomSelect`/`TreeSelect`/`TagFilter` disabled props, then enable when the list arrives. They hide only when the loaded list is truly empty. Board and status selects show the same disabled-loading state. This removes the late layout shift.
- On a warm cache every control is enabled on first render.
- Each list renders as soon as its own data is in. A slow `projectsWithPhases` revalidation never holds back boards or tags, because they are separate SWR keys and only the cold first load shares one batched round trip.
- Saved filters that reference options not loaded yet keep working: filters hold ids, and the summary labels (`ActivitiesTableFilters.tsx:581–623`) fill in once names arrive. #4217's ordering is untouched. `getActivities` still waits only on `filterState.isReady` (the saved-filters preference), never on option lists.

## Files and layers touched

- `packages/ui/src/lib/referenceData/` (new): provider, `useReferenceLists`, `invalidateReferenceList`, key registry and freshness policy.
- `packages/ui/src/context/index` or a lib export: export the above.
- `packages/msp-composition/src/referenceData/` (new): `loadReferenceLists` server action and `MspReferenceDataProvider`.
- `server/src/components/layout/WorkspaceProviders.tsx`: mount the provider.
- `packages/reference-data/src/actions/boardActions.ts`, `status-actions/statusActions.ts`, `priorityActions.ts`; `packages/tags/src/actions/tagActions.ts`; `packages/projects/src/actions/projectActions.ts`: extract each list body into an un-wrapped function that the existing action and the batch both call. Exported behaviour does not change.
- `packages/user-activities/src/hooks/useActivityFilterOptions.ts`: rewrite on `useReferenceLists`.
- `packages/user-activities/src/components/filters/ActivitiesTableFilters.tsx`: loading-state rendering.
- The mutation chokepoints listed in the matrix: one `invalidateReferenceList(...)` line each.
- **No `package.json` or `package-lock.json` change.** `swr` is already a root dependency, and `packages/assets` imports it the same way without a package-level entry.

## Implementation slices (in order, each with its tests)

1. **Reference-list layer in ui.** Provider, hook, invalidation, registry.
   - Unit tests (vitest + `SWRConfig` with a fresh `provider: () => new Map()`):
     - a cold mount of N keys calls `load` once with all N;
     - a remount within freshness calls `load` zero times;
     - a stale key alone is refetched and returns cached data meanwhile;
     - `projectsWithPhases` refetches on every mount;
     - `invalidateReferenceList('boards')` triggers a refetch of that key only;
     - a different scope (user) does not see another scope's data;
     - an error marker for one key leaves the other keys populated.
2. **Batched server action.**
   - Extract the list bodies.
   - Add `loadReferenceLists` with parallel execution and per-key error isolation.
   - Integration test against the test DB: the batch result equals the individual actions for the same user (boards, statuses, tags for both types, projects, priorities).
   - Permission test: a user without `project:read` gets an error marker for `projectsWithPhases` only, and the existing tag read-scope still narrows tags.
3. **Rewire `useActivityFilterOptions`** and mount `MspReferenceDataProvider`.
   - Update `UserActivitiesDashboard.hydration.test.tsx` mocks.
   - New hook test: first render returns cached lists synchronously when SWR is pre-seeded.
   - Regression test for #4217: the first `fetchActivities` call carries the saved filters and is not delayed by option loading (keep or extend the existing hydration test).
4. **Progressive filter bar.** `ActivitiesTableFilters` renders the tag, project, board and status controls in a disabled loading state, and hides them only for a loaded empty list.
   - Component tests for loading, empty and loaded states.
   - The client picker and date controls are interactive while lists load.
5. **Invalidation wiring and measurement.**
   - Add `invalidateReferenceList` at each chokepoint in the matrix.
   - Test that a project created via `ProjectQuickAdd` shows up in the activities project filter on return without a reload (Playwright, or a component test with a shared SWR cache).
   - **Record a before/after browser network trace** of `/msp/user-activities` on the dev stack (`alga-dev browser-get-network`): count server-action POSTs on a cold and a warm visit, with timings. Expected: 5–6 option actions become 1 cold and 0–1 warm (the projects revalidation). Put the numbers in the PR.

## Risks

- **Stale lists across users or tabs** for up to 5 minutes. This is accepted for filter options. Explicit invalidation covers same-session edits.
- **Scope key correctness.** If the scope is missing or wrong, one user could see another user's narrowed tag or project list within the same browser session. Mitigation: the scope is required; the hook does not fetch without it; there is a slice-1 test for this. A sign-out is a full navigation anyway.
- **Extracting action bodies** touches widely used actions. Mitigation: the existing exports keep their signatures and wrappers, and the existing tests for those actions must stay green.
- **The batch returns all lists at once.** A cold load still waits for the slowest list's SQL, about 3 ms. That is negligible next to removing four round trips.
- **The serial action lane remains for everything else** on the page (preferences). See "Not doing".

## Deliberately not doing

- **Not enabling `experimental.concurrentRouterQueue`.** It is a global, experimental change to every server action's ordering, which is out of scope for this ticket.
- Not caching activity data or changing `useActivitiesCache`. A `// LEVERAGE: pattern query-cache` marker goes on it and on `MyActivityGroupsProvider` as candidates to move onto the same SWR layer later.
- Not collapsing the page's `useUserPreference` calls (two serial actions each) into `useUserPreferencesBatch`. It is a real lane cost, but a separate change. It is marked with `// LEVERAGE: friction preference-lane`.
- No server-side `unstable_cache` or Redis cache for these lists. The SQL is about 1–3 ms and user-scoped, so the round trip, not the query, is the cost.
- No RSC prefetch in `page.tsx`. It would re-run on every navigation and defeat the warm client cache that acceptance criterion 2 asks for.
- No migration of other pickers (workflow designer `getProjectsWithPhases`, ticket filters) in this change. The layer is built so they can adopt it with a key each.

## Acceptance criteria check

| Criterion | How it is met |
|---|---|
| Filter bar renders no later than the activity list on a small tenant | Controls render immediately in a loading state. A cold load needs one batched action, a warm load none. Verified by the slice-5 trace. |
| A second visit within the cache lifetime does not refetch boards, statuses or tags | 5-minute freshness in SWR's navigation-surviving cache. Slice-1 test and slice-5 trace. |
| A new project appears in the project filter without a full app reload | `projectsWithPhases` revalidates on every mount and is invalidated at project mutation sites. Slice-5 test. |
| Saved filters still apply before the first data request (#4217) | `getActivities` gating is unchanged. Slice-3 regression test. |

## What Draft Implementation should hand back

- Slices 1–5 committed separately on this branch, each with its tests passing.
- The before/after network trace numbers: action count and timings for a cold and a warm visit.
- A confirmation that the four existing actions' tests still pass after extraction.
- A list of any mutation chokepoints found beyond the matrix, and whether each one was wired.
- An explicit statement that `package.json` and `package-lock.json` are unchanged.
