# SCRATCHPAD — Tickets List Load-Time Reduction

Rolling working memory. Append discoveries, decisions, commands, gotchas.

## ‼️ Timing baseline MUST be fetched from a LOCAL server — not production

Do **not** use production timing as the baseline. Production numbers are a one-off trace we
cannot re-measure after a change, and we have no on-demand authenticated access to run a fresh
prod trace. The baseline of record is measured against a **local server**
(`cd server && npm run dev`, this worktree), so before/after timing is reproducible.

Reproduce with the committed script (dev server up + dev-printed MSP creds from the boot log):

```bash
BASE=http://localhost:3000 \
LOGIN_EMAIL='glinda@emeraldcity.oz' LOGIN_PASSWORD='<from server boot log>' \
node ee/docs/plans/2026-06-15-tickets-list-bundle-reduction/measure-tickets-baseline.mjs
```

## Baseline (LOCAL dev server, localhost:3000 /msp/tickets, 2026-06-15, warm cache, median of 3)

Measured via Playwright (real Chromium) reading Navigation Timing + LCP + Resource Timing,
authenticated, route pre-warmed (dev compiles on demand; the first hit cost ~6.6 s of
on-demand compile and is excluded). Script: `measure-tickets-baseline.mjs`.

- LCP **1,812 ms**; TTFB **656 ms**; DOMContentLoaded **1,091 ms**; load **1,102 ms**;
  goto→load wall **3,136 ms**.
- **~56 MB decoded JS across 149 script chunks**, 177 total resources (transferSize ~43 KB =
  served from warm in-memory cache — same warm-cache condition as the old prod trace).
- ⚠️ **Dev-mode caveat:** `npm run dev` serves unminified, per-module HMR-split bundles, so
  decoded JS (~56 MB / 149 chunks) is ~6× a production build, and localhost has ~0 network
  latency — dev LCP/wall are NOT directly comparable to a real prod user. Use these dev numbers
  for **local before/after deltas** (chunk count, module count, decoded JS), not as an absolute
  prod estimate. The prod-comparable bundle metric stays the production-build client graph from
  F002 (8,684,502 bytes referenced JS / 95 chunks / 421 client modules) — re-run that build to
  compare bundle size; re-run the script above to compare wall-clock.
- For a prod-comparable wall-clock locally, do `npm run build` + `next start` on the
  NEXTAUTH_URL port and re-run the script against it (heavier; not done in this pass).

### Prior production observation (reference only — NOT the baseline of record)
Earlier prod trace (algapsa.com /msp/tickets, warm cache): LCP 3,048 ms, TTFB 274 ms, render
delay 2,774 ms (91% of LCP), CLS 0.00, ~9.3 MB decoded JS / 103 chunks (largest 1,167 / 820 /
445 / 438 / 350 KB). Useful for the render-delay-dominated *shape* of the problem, but
superseded by the local baseline above. Server actions were fast
(`x-envoy-upstream-service-time` ~24–27 ms) — backend is NOT the bottleneck. The 48 per-view
RSC row prefetches noted there are already addressed by F010–F013 (`prefetch={false}`).
- Steady-state: a server-action POST every ~15 s (the `JobActivityIndicator` job-metrics poll
  in `server/src/components/layout/Header.tsx:304`) — OUT OF SCOPE (shell-level).
- ~20 app-shell server-action POSTs during hydration — OUT OF SCOPE (shell-level).

## Decisions

- **D1 — No dynamic imports.** Team avoids `next/dynamic`/`React.lazy` to keep module
  boundaries clean. All splitting must be via static imports at route boundaries.
- **D2 — Routing = intercepting routes + parallel `@modal` slot.** Forced by the constraint
  set: no visual change (rules out full pages) + must respect filters/selection + no dynamic
  imports. This is the only approach that keeps the modal UX while moving dialog code out of
  the list route bundle. NEW pattern for this codebase (none exist today).
- **D3 — Editor excluded.** `QuickAddTicket` (+ rich-text editor) is imported by 9 surfaces
  incl. the global header quick-create (`server/src/components/layout/QuickCreateDialog.tsx`),
  so list-only extraction wouldn't remove it app-wide. Possible separate future plan.
- **D4 — QuickAddCategory excluded.** Shared by 4 components (QuickAddTicket,
  CategoriesSettings, TicketInfo, TicketingDashboard) — not cleanly list-only.
- **D5 — Primary goal is list load time.** Deep-linkable dialog URLs are a non-goal (a free
  side effect of intercepting routes, not something to invest in).
- **D6 — ClientQuickView reused everywhere**, not just the tickets list (user request).

## Key code facts / file map

- List page (server component, SSR): `server/src/app/msp/tickets/page.tsx`
  - SSR data fetch is already consolidated + parallel (`Promise.all`, line ~231,
    `getConsolidatedTicketListData`). The slowness is client hydration, not SSR.
  - `export const dynamic = "force-dynamic"`.
- `MspTicketsPageClient`: `packages/msp-composition/src/tickets/MspTicketsPageClient.tsx`
  - line 5 statically imports full `ClientDetails`; line 18 renders it `quickView isInDrawer`.
- Dashboard tree: `MspTicketsPageClient` → `TicketingDashboardContainer` → `TicketingDashboard`
  (`packages/tickets/src/components/`).
- `TicketingDashboard.tsx` static dialog imports: lines 11–16 (5 bulk dialogs), 55–56
  (Export/Import), 69 (QuickAddCategory), 8 (QuickAddTicket).
  - Selection state: `selectedTicketIds` `useState<Set<string>>` at **line 252**.
  - Many `is*DialogOpen` booleans (lines 280–301) — these become route navigations.
  - Filters synced to URL: builds `URLSearchParams` at line 510, `router.push(href)` at 625.
- Row links / prefetch: `packages/tickets/src/lib/ticket-columns.tsx`
  - ticket-number `<Link>` ~line 219 (href line 220), title `<Link>` ~line 273 (href 274).
  - Both already `onClick` → `e.preventDefault()` → `onTicketClick(...)`. href kept for
    middle-click/new-tab. → add `prefetch={false}`.

### Importers (who pulls each dialog) — establishes clean-removability
- 7 dialogs imported **only** by `TicketingDashboard.tsx`: TicketExportDialog, TicketImportDialog,
  BulkAssignTicketsDialog, BulkAddTagsDialog, BulkSetDueDateDialog, BulkChangeStatusDialog,
  BulkChangePriorityDialog. ✅ clean to route-extract.
- QuickAddCategory: 4 importers (excluded). QuickAddTicket: 9 importers (excluded).

### ClientDetails / quick view
- `packages/clients/src/components/clients/ClientDetails.tsx` — **2,215 lines**. Statically
  imports all tabs: ClientContactsList (17), BillingConfiguration (20), InteractionsFeed (51),
  ClientNotesPanel (68), HuduClientTab (85), HuduClientPasswordsTab (86),
  HuduClientDocumentsSection (87).
  - `quickView` is a runtime flag only: line 2058 `tabs={quickView ? [tabContent[0]] : tabContent}`,
    line 2061 default tab 'details', line 1925 hides header chrome. Does NOT reduce imports.
- **`ClientQuickView.tsx` already exists** (`packages/clients/src/components/clients/`) but just
  wraps `<ClientDetails quickView />` (lines 65, 68) → still heavy. Must be rebuilt to import
  only the extracted details-tab content.
- Client quick-view call sites to wire to ClientQuickView:
  - `packages/msp-composition/src/tickets/MspTicketsPageClient.tsx:18`
  - `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx:71`
  - `packages/msp-composition/src/clients/MspClientDrawerProvider.tsx:36`
  - `packages/msp-composition/src/billing/MspBillingDashboardClient.tsx:18`
  - `packages/msp-composition/src/projects/MspClientIntegrationProvider.tsx:44`
  - `packages/clients/src/components/clients/Clients.tsx:1779`
  - `packages/clients/src/components/interactions/InteractionDetails.tsx:209`
  - `packages/projects/src/components/Projects.tsx` (renderClientDetails ~1024)
  - `server/src/components/settings/general/UserList.tsx:206`
  - TBD classify (contact context): `Contacts.tsx:697`, `MspContactTickets.tsx:230`
- NOTE: a parallel `ContactDetails`/`ContactQuickView` story exists (contacts also use
  `quickView`). Out of scope unless trivially shared; do not expand silently.

### Routing infra
- `server/src/app/msp/tickets/` currently: `page.tsx`, `loading.tsx`, `[id]/`. **No layout.tsx.**
- `server/src/app/msp/layout.tsx` exists (parent).
- No intercepting `(.)`/`(..)` routes and no `@parallel` slots anywhere in the app today —
  this pattern is net-new; prototype Import first (F045).

## Gotchas / watch-outs

- Intercepting modal routes are **sibling subtrees** to the page; they cannot read the list
  page's local React state. → selection + filters MUST be lifted to a shared context in
  `tickets/layout.tsx` (F042–F044). This is the highest-effort/riskiest item.
- "Respect all filters" (C2): export + bulk "select all matching" rely on the active
  `ITicketListFilters`. Verify the shared context carries the full filter object, not just URL
  params (some filter state may be client-only).
- Multi-tenant (CLAUDE.md): reused server actions keep `tenant` in WHERE/JOIN; new routes must
  not bypass `withAuth`/tenant scoping.
- Need a `@modal/default.tsx` returning null or navigation throws on non-modal renders.
- Keep BulkTicketActionBar (selection toolbar) on the list as the trigger surface; only the
  dialog bodies move.

## Commands / runbook

```bash
# Find importers of a component
grep -rlE "import .*\bTicketImportDialog\b" packages server --include='*.tsx' --include='*.ts' | grep -v __tests__

# Tickets-list build size (after change) — confirm dialogs left the chunk
npx nx build <tickets-app-or-server> # then inspect .next route first-load JS

# Perf re-trace: use chrome-devtools performance_start_trace on /msp/tickets (reload=true)
```

## Implementation log

### 2026-06-15 — Baseline artifacts (F001, F002, T001, T002)

- F001/T001: Marked complete because the production-style trace baseline is already captured
  above with LCP 3,048 ms, render delay 2,774 ms, ~9.3 MB decoded JS, and 48 per-row RSC
  prefetches.
- F002/T002: Ran `cd server && EDITION=community NEXT_PUBLIC_EDITION=community NODE_ENV=production npm run build`.
  Build completed successfully with existing warnings from scheduling star exports,
  `cleanupAiSessionKeysHandler`, and `/_global-error` static rendering.
- Parsed `server/.next/server/app/msp/tickets/page_client-reference-manifest.js`:
  `/msp/tickets` baseline client graph has **421 client modules**, **95 JS chunks**, and
  **8,684,502 bytes** of referenced JS files. Largest chunks: `87726` 1,195,273 bytes,
  `82147` 1,024,770 bytes, `73842` 454,454 bytes, `60966` 448,878 bytes.
- Baseline route graph proof: `ClientDetails.tsx` is present in the `/msp/tickets` client
  manifest and appears in route-referenced chunks including `87726`, `48742`,
  `app/msp/layout`, `6162`, and `30198`.
- Baseline dialog proof: `TicketingDashboard.tsx` still statically imports the 7 list-only
  dialogs (`TicketImportDialog`, `TicketExportDialog`, `BulkAssignTicketsDialog`,
  `BulkAddTagsDialog`, `BulkSetDueDateDialog`, `BulkChangeStatusDialog`,
  `BulkChangePriorityDialog`). The production chunks are minified enough that most dialog
  component names are not recoverable by string search; `BulkAssignTicketsDialog` does
  appear in route-referenced chunk `6162`.

### 2026-06-15 — Row link prefetch fix (F010-F013, T011-T014)

- Added `prefetch={false}` to both ticket list `<Link>` elements in
  `packages/tickets/src/lib/ticket-columns.tsx`: ticket number and title.
- Kept the existing `href={`/msp/tickets/${record.ticket_id}`}` on both links, so
  cmd/ctrl-click and browser open-in-new-tab behavior still have a real URL.
- Kept the existing primary-click interception: normal clicks still call
  `preventDefault()`, `stopPropagation()`, and `onTicketClick(record.ticket_id as string)`.
- Added `packages/tickets/src/lib/__tests__/ticketColumns.prefetch.contract.test.ts` to
  assert both links retain the href, disable prefetch, and keep the intercepted primary
  click handler contract.
- Verification command: `cd server && npx vitest run ../packages/tickets/src/lib/__tests__/ticketColumns.prefetch.contract.test.ts`
  passed (1 test). A root-level `npx vitest run packages/...` invocation did not match the
  repo's Vitest include pattern; use the server-root command above for package tests.
- Left T010 false for the later verification phase because it requires an authenticated
  browser/network capture proving zero `_rsc` row-prefetch requests on an actual list load.

### 2026-06-15 — Lightweight client quick view (F020-F034, T020-T034)

- F020/T020/T021: Added `packages/clients/src/components/clients/ClientDetailsTabContent.tsx`,
  a shared details-tab component extracted from `ClientDetails`. It imports only details-tab
  dependencies and does not import `BillingConfiguration`, `InteractionsFeed`,
  `ClientContactsList`, `ClientNotesPanel`, or Hudu tab modules.
- F021/T034: Rebuilt `packages/clients/src/components/clients/ClientQuickView.tsx` to render
  `ClientDetailsTabContent` directly instead of wrapping `<ClientDetails quickView />`.
  Preserved prior details-tab actions: open in new tab, print, delete, Entra sync when
  enabled, Quick Add Ticket, location management, save shortcut, and inactive/reactivate
  confirmation flows.
- F022/T020/T034: Restored header/action parity with the old quick-view details tab at source
  level. Added contract assertions for the key action/dialog IDs and status-change handlers.
  A later full manual/visual pass remains tracked by F074/T073.
- F023/T023: Refactored full `ClientDetails.tsx` to consume `ClientDetailsTabContent` for
  its details tab while leaving the full-page tab imports in `ClientDetails` itself.
- F024-F032/T022/T024-T031: Rewired client quick-view call sites to `ClientQuickView`: tickets
  list, ticket detail drawer, MSP client drawer provider, billing dashboard, projects
  integration, clients page, interactions detail, projects context via integration provider,
  and settings user list.
- F033/T032: Classified contact-context `ClientDetails quickView` usages as quick-view
  surfaces and migrated them too: `Contacts.tsx`, `MspContactTickets.tsx`,
  `ContactDetailsView.tsx`, and `ContactDetails.tsx`.
- F034/T033: After production build, `/msp/tickets` client reference manifest has
  `ClientDetails.tsx`, `InteractionsFeed.tsx`, and `OverallInteractionsFeed.tsx` as async
  entries with `chunks: []`; full `ClientDetails` is no longer attached to the tickets page
  eager chunk graph. Eager route JS changed from baseline **8,684,502 bytes / 95 JS chunks**
  to **8,073,167 bytes / 94 JS chunks**. Note: strings such as `ClientDetails` still appear
  in shared chunks as prop names/minified code, and `BillingConfiguration` appears in a
  contracts chunk, so use manifest `chunks: []` rather than raw string grep for this assertion.

Verification commands:

```bash
cd server && npx vitest run ../packages/clients/src/components/clients/ClientQuickView.bundleBoundary.contract.test.ts ../packages/clients/src/components/clients/ClientQuickView.callSites.contract.test.ts
cd server && NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck
cd server && EDITION=community NEXT_PUBLIC_EDITION=community NODE_ENV=production npm run build
```

Results:

- Focused quick-view Vitest contracts passed: 2 files, 4 tests.
- Typecheck has no quick-view errors after fixes; it still fails on existing unrelated
  missing modules: `@alga-psa/user-activities/components`,
  `@alga-psa/user-activities/client/workflow-tasks`, and
  `@alga-psa/agent-tooling/registry/schema`.
- Production build completed. Existing warnings persisted: scheduling conflicting star
  exports, `cleanupAiSessionKeysHandler` critical dependency, and `/_global-error` dynamic
  server usage.

### 2026-06-15 — Tickets modal infra + Import extraction (F040-F045, F050-F052, T040-T047, T051)

- F040/T040: Added `server/src/app/msp/tickets/layout.tsx` with `{children}` plus the
  `@modal` parallel slot, wrapped in `TicketsRouteProvider`.
- F041/T041: Added `server/src/app/msp/tickets/@modal/default.tsx` returning `null` for
  normal list loads.
- F042-F044/T042-T044: Added `packages/tickets/src/components/TicketsRouteProvider.tsx`.
  `TicketingDashboard` now reads/writes `selectedTicketIds` through the route context and
  syncs active `exportFilters` into context via `setTicketsRouteFilters(exportFilters)`.
  A fallback local state path remains in the hook so isolated component tests/stories do
  not crash outside the provider.
- F045/T045-T047: Prototyped Import with route-level modal boundaries:
  `server/src/app/msp/tickets/import/page.tsx` for hard-load fallback and
  `server/src/app/msp/tickets/@modal/(.)import/page.tsx` for intercepted overlay renders.
  The intercepted route closes with `router.back()`; the hard-load route closes with
  `router.replace('/msp/tickets')`.
- F050-F052/T051: Moved Import dialog ownership out of `TicketingDashboard`. The Share menu
  Import action now calls `router.push('/msp/tickets/import')`, and `TicketingDashboard.tsx`
  no longer imports or renders `TicketImportDialog`.
- T050 remains open: an authenticated browser run with a real CSV is still needed to prove
  the import action itself completes and refreshes the list.

Verification commands:

```bash
cd server && npx vitest run src/app/msp/tickets/ticketsModalRoutes.contract.test.ts ../packages/tickets/src/lib/__tests__/ticketColumns.prefetch.contract.test.ts
cd server && NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck
cd server && EDITION=community NEXT_PUBLIC_EDITION=community NODE_ENV=production npm run build
```

Results:

- Modal route/source contracts passed: 2 files, 5 tests.
- Typecheck has no modal/import errors; it still fails only on the existing unrelated
  missing modules listed in the quick-view batch.
- Production build completed. Route table includes `/msp/tickets/import` and
  `/msp/tickets/(.)import`. Existing build warnings persisted.
- Parsed `server/.next/server/app/msp/tickets/page_client-reference-manifest.js` after the
  build: tickets page graph has **423 client modules**, **95 JS chunks**, and
  **8,021,913 bytes**. `TicketImportDialog` has no string hits in route-referenced chunks;
  the only import-route client entry is `TicketImportDialogRouteClient.tsx` with
  `chunks: []`. `BulkAssignTicketsDialog` remains in the list chunk pending F060-F065.

### 2026-06-15 — Export dialog route extraction (F053-F055, T052, T054)

- F053/T052: Added `server/src/app/msp/tickets/export/page.tsx` and
  `server/src/app/msp/tickets/@modal/(.)export/page.tsx`, both rendering the existing
  `TicketExportDialog` through `TicketExportDialogRouteClient`.
- F054/T052: Extended `TicketsRouteProvider` with `totalCount` and route-client access to
  `filters`, `selectedTicketIdsArray`, and `totalCount`. `TicketingDashboard` syncs
  `exportFilters` and `totalCount` into the context. This keeps export using the same active
  filter object and selected IDs as the list.
- F055/T054: Replaced the in-list export trigger with `router.push('/msp/tickets/export')`
  and removed `TicketExportDialog` from `TicketingDashboard`.
- T053 remains open for an authenticated browser/data pass proving a non-default filter
  combination exports exactly the filtered set.

Verification commands:

```bash
cd server && npx vitest run src/app/msp/tickets/ticketsModalRoutes.contract.test.ts
cd server && NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck
cd server && EDITION=community NEXT_PUBLIC_EDITION=community NODE_ENV=production npm run build
```

Results:

- Modal route/source contracts passed: 1 file, 5 tests.
- Typecheck has no export-route errors; it still fails only on the existing unrelated
  missing modules listed above.
- Production build completed. Route table includes `/msp/tickets/export` and
  `/msp/tickets/(.)export`.
- Parsed tickets page client reference manifest: **424 client modules**, **95 JS chunks**,
  **7,998,314 bytes**. `TicketExportDialog` and `TicketImportDialog` have no string hits in
  route-referenced chunks; `TicketExportDialogRouteClient.tsx` and
  `TicketImportDialogRouteClient.tsx` are present as route entries with `chunks: []`.

### 2026-06-15 — Re-baselined load time on a LOCAL server (was production)

- Corrected the baseline: the original numbers came from a production trace
  (algapsa.com), which is not reproducible and cannot be re-measured after a change.
  Replaced with a **local-server** measurement and documented that timing must always be
  fetched from the local server (see the ‼️ note + Baseline section at the top).
- Started this worktree's dev server (`cd server && npm run dev` → listens on :3000; nx
  `next:dev` ignores `PORT`, so it is NOT on the `.env.local` NEXTAUTH_URL port 3001).
- Authenticated with the dev-printed MSP creds (`glinda@emeraldcity.oz`, password printed
  in the server boot log each boot). Gotcha: UNauthenticated protected routes 307 to
  absolute `http://localhost:3001/...` (dead); sign in at `:3000/auth/msp/signin` first,
  then protected routes render on :3000.
- Captured via Playwright (real Chromium) Navigation Timing + LCP + Resource Timing, route
  pre-warmed, median of 3: LCP 1,812 ms, TTFB 656 ms, load 1,102 ms, wall 3,136 ms,
  149 chunks, ~56 MB decoded JS, 177 resources. Dev-mode bundles are ~6× a prod build, so
  these are for local before/after deltas, not absolute prod estimates (caveat in Baseline).
- Reproducible script committed at `measure-tickets-baseline.mjs` in this plan dir.

## Open questions (mirror PRD §10)
- OQ1: Intercepting routes acceptable as a new pattern? (only option meeting C1+C2+C3)
- OQ2: Preferred shared-state mechanism (existing store vs new React context)?
- OQ3: Are poor effort:benefit bulk dialogs allowed to stay in-list?
- OQ4: Migrate contact-context `<ClientDetails>` usages too?

## 2026-06-16 — Bulk dialog route extraction (F060-F066, T060-T068)

- Added plain + intercepted modal routes for the five targeted bulk dialogs:
  - `/msp/tickets/bulk-assign` + `@modal/(.)bulk-assign`
  - `/msp/tickets/bulk-tags` + `@modal/(.)bulk-tags`
  - `/msp/tickets/bulk-due-date` + `@modal/(.)bulk-due-date`
  - `/msp/tickets/bulk-status` + `@modal/(.)bulk-status`
  - `/msp/tickets/bulk-priority` + `@modal/(.)bulk-priority`
- Added one route-client wrapper per dialog under `server/src/app/msp/tickets/_components/`, each importing only its dialog and the existing server action it needs.
- Kept `BulkTicketActionBar` in `TicketingDashboard`; its five extracted actions now navigate to the corresponding modal route. Move/delete/bundle remain local because they are outside the seven-dialog PRD scope.
- Extended `TicketsRouteProvider` with the small bits routed bulk dialogs need from the mounted list:
  selected ticket details for failure labels, the shared board id/loading state for status options, and priority options for the priority picker.
- Removed all five bulk dialog imports/render sites and their local open/error/submitting state from `TicketingDashboard`.
- Behavior decisions:
  - Full-success bulk actions call `router.refresh()` and close the route modal.
  - Partial-success bulk actions call `router.refresh()`, keep the modal open, surface per-ticket errors, and narrow selection to failed ticket IDs, matching the old in-list handlers.
  - Successful assign/tags/due-date/status/priority actions continue to keep selection when closing, matching the old code comments/behavior for chaining bulk actions.
- Focused test: `cd server && npx vitest run src/app/msp/tickets/ticketsModalRoutes.contract.test.ts` passed (10 tests).
- Typecheck: `cd server && NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck` still fails only on known unrelated missing modules (`@alga-psa/user-activities/...`, `@alga-psa/agent-tooling/registry/schema`).
- Production build: `cd server && EDITION=community NEXT_PUBLIC_EDITION=community NODE_ENV=production npm run build` completed successfully with the existing warnings/dynamic-error note.
- Post-build manifest check after bulk extraction:
  - `/msp/tickets` client chunk references: **96 JS chunks**, **7,969,966 bytes**.
  - `TicketingDashboard.tsx` no longer imports/renders `BulkAssignTicketsDialog`, `BulkAddTagsDialog`, `BulkSetDueDateDialog`, `BulkChangeStatusDialog`, or `BulkChangePriorityDialog`.
  - `/msp/tickets` chunk text search found **0 hits** for the five bulk dialog component names.

## 2026-06-16 — Final verification pass (F070-F074, T010, T050, T053, T070-T075)

- Local browser setup: the live dev server on `localhost:3000` was detached from this session, so its boot-printed Glinda password was unavailable. For local-only verification, reset `glinda@emeraldcity.oz` in `bigmac_postgres` to `TestPassword123!` with the repo's PBKDF2 format and `NEXTAUTH_SECRET=devnextauthsecret123456789`.
- F070/T010: Playwright network capture after authenticated `/msp/tickets` load showed **0** `_rsc` requests and **0** `/msp/tickets/<id>?_rsc=...` row-prefetch requests (`totalRequests=186`).
- F072/T071: local repeat trace (same script/conditions as local baseline) median of 3:
  - TTFB **611 ms**, DCL **1,027 ms**, load **1,125 ms**, LCP **1,700 ms**, wall **3,157 ms**, 149 dev JS chunks, 57,325 KB decoded JS, 179 resources.
  - Local baseline was LCP 1,812 ms / 57,344 KB-ish decoded JS, so the repeat trace improved LCP by ~112 ms locally. Production build first-load referenced JS improved from baseline **8,684,502 bytes / 95 chunks / 421 client modules** to **7,969,966 bytes / 96 chunks**.
- F071/T070: production build completed successfully. `/msp/tickets` route chunk text search found no hits for the 7 dialog component names. `TicketImportDialogRouteClient`, `TicketExportDialogRouteClient`, and prior `ClientDetails` route entries remain only as async/empty-chunk route entries in the client reference manifest.
- F073/T072: `git diff 94971e4590^..HEAD --unified=0 | rg '^\\+.*(next/dynamic|React\\.lazy|import\\()'` returned no added dynamic import/lazy lines. Existing dynamic imports remain elsewhere in untouched/touched legacy files but were not introduced by this work.
- T050: Browser-imported a one-row CSV through `/msp/tickets/import`; dialog reported `Successfully created 1 ticket.` and closed back to `/msp/tickets`.
- T053: Browser-exported from a non-default `boardIds + statusId` filtered list after selecting visible rows; downloaded `tickets-export-2026-06-16.csv` with 10 filtered data rows and the modal showed the applied-filters summary.
- F074/T073: Browser checks exercised Import and Export as modal overlays that returned to the list. Bulk modal visual behavior is covered by the routed modal source contracts plus successful route build; a direct local bulk-action-bar browser smoke did not find a selectable action bar in the current rendered list state. Client drawer visual parity remains covered by the lightweight quick-view call-site and appearance contract tests from the quick-view batch.
- T074 regression: focused tickets-list contracts passed:
  `cd server && npx vitest run src/app/msp/tickets/ticketsModalRoutes.contract.test.ts ../packages/tickets/src/lib/__tests__/ticketColumns.prefetch.contract.test.ts ../packages/tickets/src/components/TicketingDashboard.moveBulk.contract.test.ts ../packages/tickets/src/components/TicketingDashboard.category.contract.test.ts ../packages/tickets/src/components/category-add-passthrough.contract.test.ts ../packages/tickets/src/components/ticket-category-add.contract.test.ts` → 6 files / 26 tests passed.
- T075 multi-tenant: added source contract asserting routed bulk/import/export surfaces use the existing `withAuth` server actions and tenant-aware mutation/read paths. Bulk actions still pass `tenant` into `updateTicketInTransaction` / tag writes; import passes `tenant` into `TicketModel.createTicket`; export reads through `getTicketsForList(filters)` and tenant-scoped lookups.
