# Co-managed tickets in the existing ticket list

- Date: 2026-09-11
- Status: Draft for implementation review
- Slug: `co-managed-ticket-list-unification`

## Summary

Bring the qualified co-managed working and oversight queues into `/msp/tickets`. Keep the existing native ticket dashboard as the MSP-workspace experience, including its board navigation, filters, bundles, display defaults, selection and routed actions. Use the same list frame and table primitives for the qualified source, with controls that match that source's actual capabilities.

The selected design has two visible views, **Working queue** and **Customer oversight**, with an independent workspace selector. **This MSP** is workspace narrowing within Working queue. It is not a third peer view.

This follows the [co-managed foundation](../2026-09-06-co-managed-it-plan.md) and [client integration](../2026-09-11-co-managed-client-integration/PRD.md). Those plans own sponsorship, sharing, licensing, canonical ticket actions and client relationship discovery. This plan owns their integration into the ticket-list application.

## Problem and users

The current global ticket page offers a link to a separate co-managed queue. Operators leave their normal list to find shared work, and the two screens have different navigation, table and filter behavior. Simply passing qualified rows into the native dashboard would be incorrect: its selection, links, metadata loaders, board defaults and mutation routes assume local ticket IDs.

Primary users:

- MSP technicians finding and opening native and shared work assigned or escalated to their organization.
- Service managers inspecting permitted customer-handled tickets without taking responsibility for them.
- Client-scoped operators finding both MSP-owned tickets and shared customer tickets for one local client.
- Native-only users retaining their current board-based work, including when co-managed UI is unavailable.

## Existing implementation

Paths are relative to the repository root. These are inspected behavior and constraints, not proposed component names.

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Global route | `server/src/app/msp/tickets/page.tsx` parses native filters, resolves page-size preference and remembered board/defaults, loads `getConsolidatedTicketListData`, and renders `CoManagedTicketQueueLink` above `MspTicketsPageClient`. | Scope must be resolved before native board restoration can change a qualified URL. The ordinary route's native first render must remain coherent. |
| Composition | `packages/msp-composition/src/tickets/MspTicketsPageClient.tsx` supplies client quick view and renders `TicketingDashboardContainer`. | Preserve this composition and avoid imports from `server/src` into packages. |
| Native controller | `packages/tickets/src/components/TicketingDashboardContainer.tsx` owns native rows/counts/avatar/tag metadata, cached form options, delayed fetches, request generations, preferences, URL synchronization and view resolution. | Keep native queries and effects isolated from the qualified source. A late native response must never overwrite a qualified result. |
| Native screen | `packages/tickets/src/components/TicketingDashboard.tsx` renders heading, Share, Add Ticket, `BoardTabStrip`, optional `BoardHeader`, sticky filter toolbar, chips, Bundled, View, `DataTable`, selection and action dialogs. | Integrate into this hierarchy rather than copying the mockup's application shell. |
| Native filters | Board include/exclude and active/inactive state; local client; user/team/unassigned; canonical status; response state; priority; due date; SLA state; category include/exclude; tags; search. | Preserve all of these in This MSP. The qualified reader cannot silently accept them. |
| Native search | `applyTicketListIndexedSearchFilter` in `packages/tickets/src/actions/optimizedTicketActions.ts` searches permitted ticket/comment index entries, plus title/number, including bundled-child matches. | “Search tickets and comments” is accurate for native mode. Do not downgrade native search to the prototype's title-only behavior. |
| Columns | `packages/tickets/src/lib/ticketColumnCatalog.ts` and `ticket-columns.tsx` fold number/category into Title, include inline tags and bundle context, response-state status treatment, client quick view, assignments and Due/SLA. | Existing column defaults and metadata features remain native. A qualified row cannot be cast to `ITicketListItem` to satisfy the builder. |
| Table fitting | `packages/ui/src/components/DataTable.tsx` and `dataTableColumnFit.ts` measure widths, auto-hide overflow columns, show a hidden-column notice and provide Show all. | The actual table already protects title width. Do not treat the original HTML candidates' 73px title problem as an existing application defect. |
| View defaults | `TicketViewMenu.tsx` and `ticketViewSettings.ts` control columns/order/density and administrator board/tenant defaults. Saved defaults also capture permitted native filters; board scope and transient search are excluded. | Retain this behavior. There is no arbitrary personal named-view registry. Co-managed scope must not leak into globally saved native defaults. |
| Native selection | `TicketsRouteProvider.tsx`, mounted by `server/src/app/msp/tickets/layout.tsx`, stores local IDs/details and rehydrates selection from session storage for routed bulk dialogs. | Qualified selections must not enter this local-ID store or its native modal routes. |
| Native actions | `BulkTicketActionBar.tsx` supports assign, bundle, move, delete, status, priority, tags and due date. Share supports print/options, selected CSV export and import. | Preserve native action eligibility, selected/all-matching behavior and route contracts. |
| Creation and detail | `buildCreateTicketHref` in `packages/tickets/src/lib/createTicketRoute.ts` opens `/msp/create-ticket`. Native row opening uses `/msp/tickets/[id]?returnFilters=…` and announces navigation before pushing. | Use the routed creation form and existing ticket detail. Do not introduce the prototype's inline create form or preview as new product flows. |
| Qualified queue | `packages/co-managed/src/ticketQueue.ts` exposes `view`, `workspaceTenant`, `clientId`, `search`, open/closed/all, four sort keys, direction, page and pageSize. | Reuse the authorized combined query. Counts/export must come from it, not native list totals or concatenated pages. |
| Qualified row | `CoManagedTicketQueueItem` has owner tenant, relationship, ticket ID, workspace name, redacted title/number/status/priority/responsibility/dates/revision. | Board, local client labels, assignments, tags, due dates, response state and SLA fields are not currently in this DTO. |
| Qualified UI/actions | `server/src/components/co-managed/CoManagedTicketQueue.tsx`, `CoManagedTicketBulkHandback.tsx`, and `server/src/lib/actions/coManagedTicketQueueActions.ts`. | Reuse actor binding, full CSV, stale-response invalidation and frozen handback request semantics; replace the duplicate list presentation. |
| Client Tickets | `CoManagedClientIntegration.tsx` currently supplies `<CoManagedTicketQueue clientId={clientId} />` through `ticketsContent` when relationships exist. Ordinary `MspClientTickets.tsx` is a separate cursor-backed list with drawer detail. | Reuse the new qualified list body in that slot. Do not force the global dashboard into the client drawer or replace the native client list unnecessarily. |

### Live screen verification

The current worktree's running Next process and listening port were matched before inspecting `/msp/tickets`. The live screen showed the existing dashboard, separate co-managed queue link, All tickets board tab, search/Filters/Bundled/View toolbar, folded title metadata, adaptive hidden-column notice, and native pagination. Filters, View and Share were opened to verify the controls listed above. The configured visible columns in that session were a subset of the catalog, not a new default to hard-code.

The design study under `/tmp/co-managed-unification/` is supplementary and temporary. This document records the durable interaction decisions; implementation does not depend on that directory or its fixture data.

## Goals and boundaries

### Goals

1. Provide one global ticket-list destination with visible working/oversight and workspace context.
2. Retain the full existing native experience in This MSP and preserve native deep links and preferences.
3. Render authorized qualified work with explicit identity, source-supported discovery, and supported handback actions.
4. Preserve local-client scoping across native and shared work, including multiple customer workspaces for one client.
5. Reuse existing creation/detail, query, authorization, export, UI and display contracts where they apply.

### Non-goals

- Rebuilding the application sidebar/topbar, renaming every ticket screen, introducing a new design system, or copying the standalone mockup's CSS.
- Cross-tenant parity for every native filter, comment search, tag editor, bundle, bulk edit, import or print option.
- A new personal saved-query system, named presets, default-pinning feature or automatic scope-preference migration.
- New ticket ownership, mirrored tickets, cross-tenant board/status normalization, new SLA aggregates or a new detail/preview screen.
- Changes to sponsorship setup, licensing, relationship policy, projects or the ticket API's ordinary tenant semantics.

## Scope and navigation contract

### Views and membership

| View/workspace | Membership | Source |
| --- | --- | --- |
| Working queue / This MSP | Native tickets in the home workspace under existing native filters. | Existing native controller and `fetchTicketsWithPagination`. |
| Working queue / All workspaces | Native tickets plus currently permitted shared tickets with MSP responsibility or an explicit MSP user/team assignment. | `getCoManagedTicketQueueAction({ view: 'working' })`. |
| Working queue / one customer workspace | The working subset in that owner workspace. | Same qualified action with `workspaceTenant`. |
| Customer oversight / All workspaces or one customer workspace | Currently permitted customer-owned tickets, including customer-responsible tickets. Native tickets are excluded. | Same qualified action with `view: 'oversight'`. |

Visibility alone does not place a ticket in Working queue or start an MSP SLA. Preserve the current query's treatment of redacted responsibility/assignment fields. A ticket with hidden membership-driving fields must not be included through a fabricated browser-side inference.

This MSP is absent from the oversight workspace choices. Changing to oversight from This MSP selects All workspaces explicitly. Customer-workspace selection can be retained between working and oversight when still valid. An explicit workspace ID that becomes unavailable must produce a scoped unavailable/empty result and a clear reset action; do not silently widen it to All workspaces.

### URL and initial-entry policy

Add a shared parser/serializer for a discriminated list scope. Proposed query names:

```text
/msp/tickets?queueView=working&workspace=all
/msp/tickets?queueView=working&workspace=msp
/msp/tickets?queueView=oversight&workspace=<owner-tenant-id>
```

Use `clientId`, `searchQuery`, `page` and `pageSize` as common presentation parameters. Qualified-only state uses `queueState=open|closed|all`, `queueSort=updated|created|title|number`, and `queueDirection=asc|desc`. These map to the existing action's `state`, `sort`, `direction` and `search`. Names are proposed contracts to implement, not existing support.

Compatibility decisions:

- Existing URLs without `queueView` retain native behavior, including bare `/msp/tickets`, native filter links, return links, remembered board and page-size preference. When shared UI is enabled this is visibly Working queue / This MSP.
- Explicit qualified scope outranks remembered native board/default state. No native filter or sort is silently applied to qualified data.
- Selecting All workspaces or following a co-managed working entry enters the combined source. Co-managed work links use the explicit qualified URL; they do not depend on the native entry default.
- Selecting This MSP restores the last native snapshot for the mounted authenticated list scope, or the existing native default if none exists. Preserve its complete filters, page/sort, bundle setting and appearance. Do not restore old bulk selections across a source switch.
- Switching to a qualified source initializes supported filters explicitly. A selected client can carry across; an embedded client is always fixed. Do not silently reuse a native canonical status ID, board ID or native-only search interpretation. Retain native state for returning to it.
- Browser Back/Forward restores the encoded scope and filters as a unit. Local search/filter changes use replacement history; explicit view/workspace navigations create history entries. Keep the existing navigation-in-flight guard.
- Qualified page sizes use the existing table choices within the reader's 1–100 limit. Default to a valid existing user preference, otherwise the native default of 10. The prototype's eight-row pages are not a product requirement.
- Qualified Reset clears supported list filters and pagination but retains the selected view/workspace and any fixed client. Global client narrowing can be cleared; client-drawer context cannot.

The native-entry default deliberately differs from the prototype's all-workspaces landing. It avoids replacing remembered board workflows as a side effect of UI unification. Making combined work the future bare-route default requires a separate explicit product decision.

## UI integration

### Existing frame and component ownership

Keep the current heading/action row, toolbar treatment, product theme tokens, translations, automation IDs and table pagination vocabulary. Place the working/oversight control and workspace selector below the heading and above the native board strip or qualified toolbar. Remove the separate “Co-managed ticket queues” link once it has been replaced by this control.

Use a thin app-owned coordinator, proposed as `UnifiedMspTicketList`, composed by the ticket page:

1. It resolves the requested presentation scope and client-side co-managed availability.
2. It mounts exactly one active data controller: the existing native `MspTicketsPageClient` path or the refactored qualified list.
3. It supplies the scope controls through an optional presentation slot. Package components do not import app actions or feature-boundary implementations.
4. Extract a small `TicketListShell` from the current dashboard's structural markup for heading/actions, scope, optional board content, toolbar and results. It owns no requests, authorization or selection.
5. Refactor `CoManagedTicketQueue` to use this frame and `DataTable`. Do not render another standalone page with its own heading beneath the native dashboard.

Keep the existing native controller and its data shape. Qualified rows use their own typed model. Do not generalize all native actions into a new universal table engine merely to share markup.

### Capability matrix

| Capability | This MSP | Qualified working/oversight |
| --- | --- | --- |
| Board strip/header, pinned/transient inactive boards, board stats/defaults | Existing behavior. | Absent. Owning customer board is not an MSP board. |
| Client picker | Existing authorized local client picker. | Reuse authorized local client options; fixed label in client context. |
| Search | Existing ticket/comment indexed search. | Ticket title and number only, labeled accordingly. |
| Filters | Full current native set. | Workspace, local client, open/closed/all. No native ID pickers. |
| Sort | Existing native allowed keys and table sorting. | Updated/created/title/number and direction. Non-supported headers are not sortable. |
| Bundled/individual, child expansion | Existing behavior and loaders. | Flat authoritative tickets; no bundle toggle or native child fetch. |
| View | Existing columns/order/density and authorized board/tenant save/reset. | Supported optional columns and density only; no writes of qualified scope into native defaults. |
| Share | Existing print/options, selected export and import routes. | Full filtered qualified CSV, explicitly independent of handback selection. No native selected-export/import/print handlers. |
| Create | Existing Add Ticket routed flow. | Add MSP ticket through the same `/msp/create-ticket` route with permitted local-client prefill. |
| Selection/actions | Existing range/page/all-matching selection and native bulk routes. | Current-page handback selection of eligible shared records only; no mixed native bulk operations. |
| Ticket opening | Existing native route and return filters. | Dispatch native rows to native detail and shared rows to the existing qualified detail route, both in the MSP shell. |

Native-only tools remain available by choosing This MSP; they are not recreated against incomplete qualified rows. Supported controls use shared `ClientPicker`, select/input/button components rather than the mockup's native HTML form widgets.

### Qualified columns and table fitting

Default qualified columns: Title, Status, Priority, Responsible organization, Updated. Number and workspace appear together under Title. Owner workspace is mandatory identity context, including on native records in a combined result. Do not substitute local client name for it.

- Preserve canonical status/priority text without inventing missing color metadata or performing owner-unqualified reference lookups.
- Show “MSP also assigned” for customer-responsible records only when the new authorized assignment-presence field explicitly says true. Do not synthesize it from being in the working list.
- Restricted fields have explicit unavailable treatment; hidden values must not participate in display text, sorting, search or export enrichment.
- Reuse the title-cell presentation where practical through a narrow presentational extraction. Keep native category/tag/bundle metadata in native mode; qualified identity has different data.
- Preserve title readability and workspace identity at narrow widths. Use the existing overflow tooltips and table scrolling.
- The current `DataTable` has automatic fitting but no caller-selectable fit/scroll policy. Add an optional `columnFitMode: 'auto' | 'scroll'` with `auto` as the unchanged default. Qualified lists use `scroll` so responsibility and identity do not silently disappear behind adaptive hiding. The native hidden-column notice and Show all remain unchanged.
- Qualified View may hide Status, Priority and Updated and adjust density. Title/workspace and responsibility are fixed. Reuse appearance primitives or parameterize the menu's supported column descriptors; do not extend the native catalog with unsupported keys that other ticket surfaces begin rendering.
- Qualified display adjustments are session/view-local in this scope. Existing native saved defaults are not overwritten. No new preference table or settings migration is required.

## Data and action contracts

### Qualified identity

Keep data and display identity distinct:

```ts
type TicketListIdentity =
  | { kind: 'native'; tenant: string; ticketId: string }
  | { kind: 'shared'; tenant: string; relationshipId: string; ticketId: string };
```

The native controller can retain its native row model; this union describes qualified list adaptation and navigation. Use deterministic qualified keys for table `id`, selection, request caches and automation IDs. A shared record's `ticketId` is never rewritten to a synthetic UUID or fed into a local-ID metadata/mutation loader.

`ticket-columns.tsx` currently hard-codes native Link hrefs. Reusing it requires an explicit identity/href seam or extracting the title presentation. Changing only `onRowClick` leaves number/title links and modified-click behavior incorrect. Preserve Ctrl/Cmd click and disable per-row prefetch as the current builder does.

### Reader changes

Reuse `getCoManagedTicketQueue`, `exportCoManagedTicketQueue` and their actor-bound server actions. Add only the projections needed for this list:

1. Optional `fields.has_msp_assignment: boolean`. Return true/false only when assignment aliases are visible under the existing `assignmentVisible` policy. Omit when redacted. Compute from the qualified MSP reference's user/team assignment within the existing query, not a browser directory lookup. Keep native assignment display native; the explanatory marker is for shared rows.
2. Constrain workspace choices to the selected authorized local client before search/state/pagination, while retaining the current view's authority boundaries. Today the `workspaces` subquery reads the whole `authorized` relation even when `clientId` filters result rows. Do not derive options from the displayed page or expose a foreign workspace directory.

The explicit This MSP option is supplied by the authenticated home context and does not depend on a native ticket being present in the result. All-workspaces labels mean all currently authorized workspaces in the selected view/client scope, not all tenants or private customer boards.

Do not add board, assignee names, client names, SLA, tags or due-date enrichment merely to mimic the richer native DTO. The assignment boolean does not establish write permission. Existing handback eligibility and command authorization remain authoritative.

Rows, search, sort, state, counts and full CSV continue to use one authorized SQL relation. The current open/closed counts are computed after the state filter; do not present them as independent unfiltered state-tab totals. One filtered total and the table range are sufficient.

### Controller and server-rendered entry

- Parse explicit scope before native board-memory/default logic. Native URLs keep the current SSR path and preference resolution.
- For explicit qualified URLs, render a neutral ticket loading/fallback frame until the client release boundary resolves. Feature-specific controls and loading content mount only after the boundary is usable; do not flash native rows labeled as combined data. Do not fetch qualified data in the server page as a way around the UI-only boundary.
- Native fallback must be available through the ordinary native bootstrap/controller. A qualified route must not be blocked by a discarded native-filter query or an error in irrelevant native metadata loading. Native bootstrap can be lazy for explicit qualified entry.
- Stop inactive controllers, metadata requests and URL writers. Carry applied filters separately from drafts and reset pagination on the same transitions the current controller supports.
- Key qualified requests by authenticated home identity, scope, workspace, client, applied filters, page and sort. Ignore stale list/export results after those values change, navigation begins, or the feature content unmounts.

### Creation and return navigation

Use `buildCreateTicketHref`; preserve the existing lazy-loaded routed form and create shortcut. On qualified screens label the action **Add MSP ticket**. A customer workspace filter never changes ownership of new records. Only an authorized local client selection may prefill client fields.

After creation, refresh the active list under its existing scope. If the new native ticket is outside the current customer-only/oversight view, provide a clear success link to the created native ticket rather than silently switching workspace or claiming it appears in the current list. Do not duplicate the creation form to obtain this behavior.

Extend the return-filter codec to preserve qualified scope, not arbitrary browser-supplied destinations. Shared detail already lives at `/msp/co-management/tickets/[customerTenant]/[relationshipId]/[ticketId]`; add a validated ticket-list return target to that route's presentation if needed. Native detail must also return to a combined list when opened from one. Client-drawer native behavior remains its existing drawer composition.

### Shared handback selection and recovery

Refactor the current `CoManagedTicketBulkHandback` so row checkboxes and the action composer share one selection. Remove its duplicate separate checklist once table selection is authoritative.

- Native rows and customer-responsible rows are not handback-selectable. Eligibility preserves the existing relationship, visible MSP responsibility and numeric revision requirements. Do not infer additional closed-ticket eligibility from the prototype; use the existing domain command's rules.
- The header checkbox means all eligible rows on this page. Maximum batch remains 100. Native all-matching selection and its persisted `TicketsRouteProvider` state remain native-only.
- Clear qualified selection when the applied query or page changes. Do not restore native selection when switching sources, and clear any old native modal selection before entering qualified work.
- Require the shared IT note, preserve its audience wording, and freeze resource/operation/revision/note on submission.
- Reuse the exact batch on uncertain transport outcomes. The backend's same-command retry is the recovery mechanism; do not invent a “check status” endpoint or issue new operation IDs. Prevent a second composer or scope/page changes from replacing unresolved intent.
- Retain unresolved command intent outside transient row/result components and persist the exact replay command before first submission in actor/home-qualified session storage, with a version, expiry and logout cleanup. Restore it as unresolved and reauthorize through the existing command. A browser draft is never authority or proof of completion. If storage is unavailable, communicate that reload recovery is unavailable and retain same-session recovery; never manufacture a new request identity to compensate.
- Show per-item success, changed, forbidden, invalid and read-only results. On completion, re-read the current authorized queue; handback can remove a row from working while retaining it in oversight. Do not optimistically recreate or mirror a native ticket.

### Failures and redaction

Use loading, empty, zero-results, unavailable, restricted-field and retry states with shared UI primitives. Keep filters usable where recovery permits, and distinguish a genuinely empty permitted list from a failed read.

Preserve the current behavior of invalidating qualified rows/counts after failed authorization-sensitive reads and exports. The existing export action throws without a reliable transport-versus-permission classification, and `coManagedTicketQueue.test.tsx` explicitly tests removal of stale contents after export authority is lost. Therefore this plan does **not** adopt the prototype's unconditional “failed export keeps rows” behavior. Retaining rows would require a separately supported, sanitized error distinction; it is not necessary for this integration.

## Client and legacy entry integration

- Use the refactored qualified list body in `CoManagedClientIntegration`'s existing `ticketsContent` slot. Pass fixed `clientId`, an instance-specific ID prefix and embedded presentation mode. Omit a second page heading and global client selector.
- Match all authorized relationships for that local client. Do not choose a single relationship for list discovery or replace client scoping with workspace scoping.
- Keep the ordinary `MspClientTickets` experience when the feature slot is unavailable or the client has no relationship. Preserve its native drawer opening and create prefill.
- Update actual co-managed work entry links to the canonical explicit `/msp/tickets` scope. Keep `/msp/co-managed/tickets` as a client-gated compatibility adapter using the same parser and target, not a second list or backend flag redirect. Preserve supported client/filter intent from future bookmarked URLs.
- Keep existing qualified ticket routes. Direct detail access continues under ordinary authorization and the inherited UI boundary.

## Inherited release and product boundary

Original T21/T22 remain requirements of this relocation. Use the existing exact client-side `release-v1-6-feature` boundary; only resolved, enabled, error-free state mounts shared controls and starts feature reads. Product eligibility is the actual sponsoring PSA product, not `!isAlgaDesk` and not a tier guess.

Off/loading/unknown/error states remove shared controls, list content and portaled feature dialogs while ordinary native ticket behavior remains available. Submitted commands retain backend semantics and must not be canceled or replayed with a fresh identity by UI teardown. Re-enabling must not resurrect stale rows or auto-submit a saved batch.

Do not add release-flag checks to route registration, API/server actions, query policy, handback commands or workers. AlgaDesk and co-managed customer native ticket screens keep their existing product paths; this sponsor aggregation does not enroll them as MSP sponsors.

## Implementation sequence

Estimated checklist size: approximately 40 atomic features and 20 high-impact verification cases. Most native behavior is retained, not rewritten.

| Milestone | Work | Exit evidence |
| --- | --- | --- |
| M1: Scope and identity contracts | Parser/serializer, source discrimination, native compatibility/default rules, qualified identities and navigation seams. | Scope/URL/identity tests, including explicit co-managed intent versus remembered board and detail navigation. |
| M2: Qualified read projection | Assignment-presence redaction, client-constrained workspace options, unchanged combined query/count/export contracts. | Real migrated database happy/guard cases; no client-side concatenation or unqualified enrichment. |
| M3: Existing list composition | Extract frame and safe presentation seams, compose one active source, optional DataTable scroll fitting, preserve native filter/board/view behavior. | Native regression checks and source-switch component tests; existing title/number links and metadata calls remain source-correct. |
| M4: Qualified interactions | Supported toolbar/columns, count/pagination, routed create/detail/return, qualified CSV, integrated handback and recovery. | Interaction tests for applied filters, export, collisions, partial/uncertain commands and real query revalidation. |
| M5: Entry points and acceptance | Client embedded reuse, legacy entry adapter, inherited boundaries, translations, theme/responsive/keyboard journeys. | Real global/client native-plus-shared journeys, T21/T22 cases, affected typechecks and recorded evidence. |

M2 can proceed after the M1 DTO decisions. M3 follows the scope contract. M4 depends on M2/M3. Retire the old standalone list only after M5's client and compatibility paths use the new composition.

No database migration is expected for the two projection changes. If implementation discovers a schema or index requirement, update the PRD and add migrated PostgreSQL/Citus evidence rather than introducing an untracked migration. Do not broaden this plan into a new query engine or dashboard analytics project.

## Verification

The test checklist consolidates representative journeys instead of repeating the existing co-managed backend matrix. Required anchors:

- Native: `packages/tickets/src/lib/boardTabs.test.ts`, `ticketViewSettings.test.ts`, `ticketListUrlSync.test.ts`, `components/TicketingDashboardContainer.urlSync.contract.test.tsx`, `components/__tests__/TicketsRouteProvider.selectionPersistence.test.tsx`, and `lib/__tests__/ticketColumns.prefetch.contract.test.ts`.
- Qualified UI/actions: `server/src/test/unit/product/coManagedTicketQueue.test.tsx`, `coManagedTicketQueueActions.test.ts`, and `coManagedTicketBulkHandback.test.tsx`.
- Database: extend the relevant queue/handback cases in `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts` or extract a focused registered case module using that migrated disposable-database harness. Include a real happy query and a guard/redaction/revocation query; source-string assertions do not establish data behavior.
- Shared table: existing `DataTable` interaction and column-fit tests, plus a targeted default-auto versus opt-in-scroll regression.
- Composition: existing client-integration/boundary tests and new coordinator tests at the app-owned seam.

Browser evidence must come from the running application after implementation, with the real native control set, not the fixture-backed HTML mockup. Record revision, source scope, role/feature state, route, expected/observed outcome and sanitized artifact location. This planning pass verifies the existing baseline only.

## Risks and review points

1. **Entry default:** this draft preserves current native bare-route/remembered-board behavior. Confirm before implementation if the intended product change also includes making all-workspaces Working queue the default; that changes SSR and preference migration scope.
2. **False native compatibility:** a qualified record padded with native fields can reach local tag, board, avatar, export or mutation handlers. Type/source separation and negative-call tests are mandatory.
3. **Saved-default leakage:** `captureTicketViewSettings` captures new filter keys unless excluded. Keep scope state outside native filters and add explicit exclusion/validation if a shared type is extended.
4. **Transient scope narrowing:** hidden workspace choices or revoked access must not silently broaden results. Client option discovery is independent of current page and result count.
5. **Return navigation and active requests:** the native dashboard has an explicit regression guard against URL writes after navigation. A second scope controller must not recreate that race.
6. **Shared component reach:** changes to DataTable and title/View primitives affect other surfaces. Additive defaults and focused regression checks are required.

## Acceptance criteria

- `/msp/tickets` provides working/oversight and workspace navigation with one visible list and one active data source.
- Existing native URLs, remembered board/defaults, filters, bundles, visible/hidden columns, Share, create/detail and native bulk workflows continue under This MSP.
- Qualified working membership includes native plus MSP-responsible or explicitly assigned shared work; oversight excludes native and includes authorized customer-handled work.
- A local-client filter includes native and all authorized shared relationships before search, counts, pagination and CSV. Embedded reset cannot leave the client.
- Workspace, relationship and ticket identities survive duplicate numbers/UUIDs, all link affordances, selections, returns and retries.
- Qualified controls advertise only supported fields/actions. Native comment search and native saved defaults keep their actual semantics.
- Creation uses the existing routed form with explicit MSP ownership; shared detail uses the existing MSP-shell route with a correct list return target.
- Shared handback uses a single table selection, required shared note, immutable retry identities, per-item outcomes and authorized refresh.
- Unavailable/redacted/stale/error states do not leak old records or imply empty data; release-boundary teardown preserves ordinary native work and backend independence.
- The feature/test checklists have implementation evidence, including real database guards and application-browser journeys. Prototype checks are not substituted for product evidence.
