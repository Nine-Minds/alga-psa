# PRD — Cross-Package Import Violation Cleanup

- Slug: `cross-package-cleanup`
- Date: `2026-02-16`
- Status: Draft
- Branch: `phase3-cross-package-cleanup` (fresh from `main`)

## Summary

Eliminate 161 cross-package import violations detected by the `no-feature-to-feature-imports` ESLint rule across the `packages/` directory. Each stage is a self-contained commit followed by a build verification. The work is divided into 7 stages executed sequentially.

## Problem

The monorepo has vertical feature packages (`billing`, `clients`, `tickets`, etc.) that import directly from each other, creating a tangled dependency graph. This makes packages non-independent, complicates testing, and prevents clean extraction. An ESLint rule enforces boundaries but currently only runs against `server/` — the 161 violations in `packages/` are invisible.

Previous attempt (branch `phase3-cross-package-violations-v2`) took a shortcut: whitelisted 76 violations as "hub-composition pairs" without moving code. That approach deferred the actual work and created a large allowlist that masks real violations.

## Goals

1. Reduce 161 cross-package violations to zero via actual code moves (not mass-whitelisting)
2. Fix pre-existing bugs discovered in code review (broken HTML escaping in blocknoteUtils, sequential awaits in batch functions)
3. Each stage produces a green build — no big-bang refactor
4. Extend `npm run lint` to cover `packages/` so violations stay visible

## Non-goals

- Migrating server-side services/models to packages (Phase 4/5 in the old plan)
- Creating new packages beyond what already exists
- Refactoring internal package code beyond what's needed for the move
- Changing runtime behavior (except bug fixes)

## Users and Primary Flows

**Primary user:** Developer team maintaining the monorepo.

**Flow:** After this work, running `npm run lint` catches any new cross-package violation in `packages/`. The dependency graph between vertical packages is clean — vertical-to-vertical imports go through horizontal layers (`core`, `media`, `types`, `ui`) or the composition layer (`msp-composition`).

## Requirements

### Stage 1: Lint infrastructure (0 violations fixed, but makes them visible)

- Expand `npm run lint` glob to include `packages/`
- **BUILD VERIFY**

### Stage 2: ESLint rule — exempt composition layers + reclassify documents (77 violations)

- Remove `client-portal` from `VERTICAL_PACKAGES` — it's a composition layer like `msp-composition` (39 violations)
- Remove `documents` from `VERTICAL_PACKAGES` — it's L2 infrastructure used by 6+ verticals (38 violations)
- Add comment explaining the rationale for each exclusion
- **BUILD VERIFY**

### Stage 3: Move blocknoteUtils to core + fix bugs (5 violations)

- Copy `blocknoteUtils.ts` from `packages/documents/src/lib/` to `packages/core/src/lib/`
- Fix broken HTML escaping in `convertBlockNoteToHTML` codeBlock handler (replace no-op `.replace(/&/g, '&')` with `.replace(/&/g, '&amp;')` etc.)
- Fix broken HTML escaping in default case handler (same issue)
- Sanitize `language` prop in codeBlock to prevent attribute injection
- Add `@blocknote/core` dependency to `@alga-psa/core`
- Add `./lib/blocknoteUtils` export map entry to core's `package.json`
- Replace `documents/src/lib/blocknoteUtils.ts` contents with re-export from core
- Update all callers (documents/documentActions, documents/BlockNoteDocumentHandler, client-portal/client-tickets, projects/projectTaskCommentActions, tickets/commentActions, tickets/optimizedTicketActions, tickets/TicketDetails) to import from `@alga-psa/core/lib/blocknoteUtils`
- Update test mocks (client-tickets.responseSource.test.ts)
- **BUILD VERIFY**

### Stage 4: Consolidate entity image/avatar utilities into media (8 violations)

- Add batch functions (`getEntityImageUrlsBatch`, `getClientLogoUrlsBatch`, `getContactAvatarUrlsBatch`) to `packages/media/src/lib/avatarUtils.ts`
- Fix sequential awaits in `getEntityImageUrlsBatch` — use `Promise.allSettled` for parallel URL resolution
- Delete `packages/documents/src/lib/entityImageService.ts` (293 LOC duplicate — canonical version lives in `packages/media/src/services/EntityImageService.ts`)
- Remove `./lib/entityImageService` export map entry from documents `package.json`
- Update documents `index.ts` to stop re-exporting entityImageService
- Redirect callers to `@alga-psa/media`:
  - `clients/clientActions` (uploadEntityImage, deleteEntityImage)
  - `clients/contactAvatarActions` (uploadEntityImage, deleteEntityImage)
  - `client-portal/clientUserActions` (uploadEntityImage, deleteEntityImage)
  - `tenancy/tenantLogoActions` (uploadEntityImage, deleteEntityImage, EntityType)
  - `tags/usersHelpers` (getUserAvatarUrl)
  - `tickets/optimizedTicketActions` (getClientLogoUrl, getUserAvatarUrl, getClientLogoUrlsBatch)
  - `projects/projectTaskCommentActions` (getEntityImageUrlsBatch)
  - `client-portal/client-client` (getClientLogoUrl)
  - `client-portal/client-project-details` (getEntityImageUrlsBatch)
  - `clients/documentsHelpers` (dynamic imports of avatarUtils)
- Add `@alga-psa/media` dependency to package.json of: client-portal, clients, projects, tenancy, tickets
- Replace `@alga-psa/documents` dependency with `@alga-psa/media` in tags
- **BUILD VERIFY**

### Stage 5: ALLOWED_PAIRS for 2 unavoidable cross-domain data-access pairs (5 violations)

Only for pure data-access where one domain must query another's data and there's no clean move target:

- `integrations -> clients` (4) — emailActions needs `findContactByEmailAddress`, csvMappingModules needs `getAllClients`
- `integrations -> scheduling` (1) — CalendarSyncService reads schedule entries

These are documented in `.ai/stale_code_cleanup_plan.md` Phase 3d for future resolution (extract to horizontal interfaces).

- **BUILD VERIFY**

### Stage 6: Move ticket/billing/survey pickers to horizontal packages (7 violations)

- Move `PrioritySelect`, `CategoryPicker` from `@alga-psa/tickets` to `@alga-psa/ui` (fixes `integrations -> tickets` and `surveys -> tickets` picker imports)
- Move `getAllBoards` to `@alga-psa/core/actions` or `@alga-psa/db/actions` (used by surveys + integrations)
- **BUILD VERIFY**

### Stage 7: Move remaining cross-domain code (10 violations)

- Move company sync adapters (`quickBooksCompanyAdapter`, `xeroCompanyAdapter`) from `billing` to `integrations` (fixes `billing -> integrations`, 2 violations)
- Move `TicketMaterialsCard` to `msp-composition/tickets` (fixes `tickets -> billing`, 1 violation)
- Move `ProjectMaterialsDrawer` + test to `msp-composition/projects` (fixes `projects -> billing`, 2 violations)
- Move TacticalRMM components to `msp-composition/integrations` (fixes `integrations -> assets`, 2 violations)
- Move `InboundTicketDefaultsForm` to `msp-composition/integrations` if it still has violations after Stage 6 picker moves (fixes remaining `integrations -> tickets`)
- **BUILD VERIFY**

### Stage 8: Move composition components to msp-composition (~56 violations)

These are UI components that wire together multiple domains. They belong in the composition layer.

**8a. Client-domain compositions → `msp-composition/clients/` (~26 violations)**
- `ClientTickets.tsx` (8 ticket imports)
- `ContactTickets.tsx` (8 ticket imports)
- `ClientDetails.tsx` (2 ticket + 1 survey imports remaining after documents reclassification)
- `ClientAssets.tsx` (5 asset imports)
- `InteractionDetails.tsx` (2 ticket imports)
- Update server page.tsx imports to reference `@alga-psa/msp-composition/clients`
- Add `@alga-psa/assets`, `@alga-psa/surveys` dependencies to msp-composition

**8b. Scheduling-domain compositions → `msp-composition/scheduling/` (~18 violations)**
- `WorkItemDetailsDrawer.tsx` (2 ticket + 2 project + 2 client imports)
- `WorkItemDrawer.tsx` (2 ticket + 2 project + 2 client imports)
- `WorkItemPicker.tsx` (1 client import)
- `AppointmentRequestsPanel.tsx` (2 ticket imports)
- `TechnicianDispatchDashboard.tsx` (1 ticket import)
- `TimeEntryEditForm.tsx` (1 client import)
- `TimeEntryProvider.tsx` (1 client import)
- Update server page.tsx imports

**8c. Workflow activity compositions → `msp-composition/workflows/` (~9 violations)**
- `ActivityDetailViewerDrawer.tsx` (3 ticket + 2 project + 4 scheduling + 1 document imports)
- `ProjectsSection.tsx` (1 project import)
- `TicketsSection.tsx` (2 client imports)
- Update server page.tsx imports

**8d. Project-domain compositions → `msp-composition/projects/` (~5 violations after documents reclassification)**
- `Projects.tsx` (3 client imports)
- `ProjectQuickAdd.tsx` (1 client import)
- `ProjectDetailsEdit.tsx` (1 client import)
- Update server page.tsx imports

- **BUILD VERIFY**

### Stage 9: Final cleanup + verification

- Run `npm run lint` — confirm 0 (or <=5 allowlisted) violations
- Run `npm run build` — confirm green
- Run `npx vitest run` — confirm tests pass
- Remove any dead code left behind by moves (empty re-export files, unused imports)
- Update `.ai/stale_code_cleanup_plan.md` to reflect completion

## Ensuring No Functionality Breaks

Each stage uses a 3-layer verification:

1. **`npm run build`** — catches broken imports, missing exports, TypeScript type mismatches. Run after every stage.
2. **`npx vitest run`** — runs existing unit/integration tests. Catches behavioral regressions, especially for blocknoteUtils bug fixes and batch function changes.
3. **Re-export shims** — when moving a file (e.g., blocknoteUtils from documents to core), leave a one-line re-export at the old path. This ensures any consumer we missed (dynamic imports, tests, server code) doesn't silently break.

The biggest risk area is Stage 8 (msp-composition moves) since it changes import paths in server `page.tsx` files. The build catches those immediately since Next.js resolves imports at build time.

## Rollout / Migration

- Each stage is a separate commit on branch `phase3-cross-package-cleanup`
- Build + lint verified after each stage before proceeding
- Tests run after stages with logic changes (3, 4, 6)
- The branch can be merged as a single PR or split into per-stage PRs

## Open Questions

1. **Stage 8 sizing:** Moving composition components to `msp-composition` is the largest stage. Should it be split into separate PRs per sub-domain (8a, 8b, 8c, 8d)?

## Acceptance Criteria (Definition of Done)

- [ ] `npm run lint` covers `packages/` and reports <=5 `no-feature-to-feature-imports` violations (the 5 allowlisted data-access pairs)
- [ ] `npm run build` passes
- [ ] `npx vitest run` passes
- [ ] Only 2 ALLOWED_PAIRS remain: `integrations -> clients`, `integrations -> scheduling` (documented for future resolution)
- [ ] Composition patterns are resolved by actual moves to `msp-composition`, not whitelisting
- [ ] Broken HTML escaping in blocknoteUtils is fixed
- [ ] Sequential batch function is parallelized
- [ ] Each stage has a green build before proceeding to the next
