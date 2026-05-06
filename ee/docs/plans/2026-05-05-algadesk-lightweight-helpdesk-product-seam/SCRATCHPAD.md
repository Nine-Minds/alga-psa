# Scratchpad — Algadesk Lightweight Help Desk Product Seam

- Plan slug: `2026-05-05-algadesk-lightweight-helpdesk-product-seam`
- Created: `2026-05-05`

## What This Is

Working notes for the Algadesk product seam plan. Keep this updated as implementation discovers constraints, changes scope, or adds runbooks.

## Decisions

- (2026-05-05) Algadesk is an orthogonal product entitlement, not a new PSA tier. Rationale: product surface and price/package ladder should evolve independently.
- (2026-05-05) Algadesk includes email-to-ticket and ticket reply/update by email. Rationale: a help desk without email is too weak as an MSP wedge product.
- (2026-05-05) Algadesk includes ticket attachments and KB only, not full document management.
- (2026-05-05) Algadesk includes free-form ticket creation only, not service request forms/catalog in v1.
- (2026-05-05) Algadesk excludes SLA module in v1 while preserving ticket data-model compatibility for possible later lightweight targets.
- (2026-05-05) Direct browser access behavior is mixed: branded upgrade boundaries for major human-facing PSA areas, product-denied/not-found for internal/API-only routes.
- (2026-05-05) Current routes remain canonical for v1; `/desk/*` aliases can be added later.
- (2026-05-05) Existing background workers/services may remain separate runtime processes for email. The seam is licensed product surface, not forcing all work into one process.
- (2026-05-05) Product seam should be high quality via Algadesk-specific composition, not menu-only hiding.
- (2026-05-05) Plan structure intentionally uses many feature checklist items (150+) to express intent and a smaller confidence-building test suite (~20) instead of comprehensive one-test-per-feature coverage.

## Discoveries / Constraints

- (2026-05-05) Existing tier model is rank-based around `solo`, `pro`, and `premium`; it does not model product surface.
- (2026-05-05) Existing sidebar filtering supports `requiredFeature`, but route/API enforcement is not product-aware today.
- (2026-05-05) `server/src/components/layout/DefaultLayout.tsx` imports full PSA cross-feature providers for workflows, scheduling, projects, assets, documents, msp-composition, and chat. Algadesk needs a separate shell/provider stack.
- (2026-05-05) `server/src/app/msp/layout.tsx` registers SLA and schedule-entry integrations at module scope. This must move behind PSA-only registration or become product-aware.
- (2026-05-05) `packages/client-portal` has broad barrels/actions/components that include billing/projects/documents/devices/appointments/notifications. Algadesk portal needs narrowed entrypoints/composition.
- (2026-05-05) `packages/tickets` is relatively clean but still has hard/dynamic seams around email notifications and document uploads that need provider injection or narrowed exports.
- (2026-05-05) Most v1 APIs share `ApiBaseController`; it is the main insertion point for product access after tenant resolution.
- (2026-05-05) API metadata/OpenAPI must be filtered by product; otherwise Algadesk API clients will discover unusable PSA endpoints.

## Commands / Runbooks

- (2026-05-05) Design doc source: `docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam-design.md`.
- (2026-05-05) Plan folder: `ee/docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam/`.
- (2026-05-05) Validate JSON artifacts with `python -m json.tool ee/docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam/features.json >/dev/null` and same for `tests.json`.

## Links / References

- Approved design doc: `docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam-design.md`
- Existing tier constants: `packages/types/src/constants/tenantTiers.ts`
- Existing tier feature mapping: `packages/types/src/constants/tierFeatures.ts`
- Existing MSP layout: `server/src/app/msp/layout.tsx`
- Existing layout/provider stack: `server/src/components/layout/DefaultLayout.tsx`
- Existing menu config: `server/src/config/menuConfig.ts`
- Existing API base controller: `server/src/lib/api/controllers/ApiBaseController.ts`
- Existing ticket page: `server/src/app/msp/tickets/page.tsx`
- Existing client portal package: `packages/client-portal`
- Existing ticket package: `packages/tickets`

## Open Questions

- What exact branded copy and CTA should the upgrade boundary use?
- Should Algadesk retain client/contact notes and interactions in v1?
- Which inbound email providers/settings are required for launch versus later?
- Should `/desk/*` aliases be added immediately after v1 or only when marketing requires them?
- Should Algadesk have product-specific naming in app chrome or inherit existing Alga branding with Algadesk labels?

## Implementation Log

- (2026-05-05) Completed F001-F014 in one entitlement/access foundation slice.
- Added shared product constants/types/resolution in `packages/types/src/constants/productCodes.ts` and exported via `packages/types/src/constants/index.ts`.
- Added tenant interface support for product code in:
  - `packages/types/src/interfaces/tenant.interface.ts`
  - `server/src/interfaces/tenant.interface.tsx`
- Added tenant schema migration `server/migrations/20260505140000_add_tenant_product_code.cjs`:
  - Adds `tenants.product_code`
  - Backfills NULL/empty values to `psa`
  - Adds CHECK constraint (`psa|algadesk`)
  - Sets NOT NULL + default `psa`
  - Down migration drops constraint + column
- Added server product helpers and structured error in `server/src/lib/productAccess.ts`:
  - `ProductAccessError` with stable `status=403` and `code=PRODUCT_ACCESS_DENIED`
  - `getTenantProduct`, `getCurrentTenantProduct`
  - `assertProductAccess`, `assertTenantProductAccess`
  - Unknown non-null `product_code` now fail-closed via `ProductAccessError`.

## Tests Added

- T001: `server/src/test/integration/tenantProductCodeMigration.integration.test.ts`
  - Verifies migration adds `product_code`, enforces default/not-null, allows `algadesk`, rejects invalid values.
- T002: `server/src/test/unit/productAccess.test.ts`
  - Verifies resolver defaults, algadesk pass-through, fail-closed unknown values, and structured denial error behavior.
- Additional type/unit coverage:
  - `packages/types/src/constants/productCodes.test.ts`
  - `packages/types/src/interfaces/tenant.interface.typecheck.test.ts` (added `product_code` assertion)

## Commands Run

- `cd server && npx vitest run ../packages/types/src/constants/productCodes.test.ts ../packages/types/src/interfaces/tenant.interface.typecheck.test.ts src/test/unit/productAccess.test.ts`
  - Result: pass (15 tests)
- `cd server && npx vitest run ../packages/types/src/constants/productCodes.test.ts ../packages/types/src/interfaces/tenant.interface.typecheck.test.ts src/test/unit/productAccess.test.ts src/test/integration/tenantProductCodeMigration.integration.test.ts`
  - Result: integration suite could not run in this environment because Postgres was not reachable on `localhost:5432` (`ECONNREFUSED`).

## Gotchas

- Repository `test:local` script currently passes an invalid flag to the installed `dotenv` CLI (`-e ../.env.localtest`), so direct `vitest` invocation was used.
- DB-backed integration test is present and meaningful, but executing it requires a running test Postgres instance.
- (2026-05-05) Completed F015 by introducing client-safe product context in `server/src/context/ProductContext.tsx` and wiring it into `server/src/app/msp/MspLayoutClient.tsx`.
- Added unit coverage for product context resolution in `server/src/test/unit/context/ProductContext.test.tsx`.
- (2026-05-05) Completed F016/F017/F018 compatibility/docs pass.
- Added explicit orthogonality documentation comments in:
  - `packages/types/src/constants/tenantTiers.ts`
  - `packages/types/src/constants/addOns.ts`
  - `server/src/lib/productAccess.ts`
- Added regression assertion in `packages/types/src/constants/productCodes.test.ts` that product entitlement work does not alter tier or add-on resolution behavior.
- (2026-05-05) Completed F019-F034 and T003 with a pure product surface registry module: `server/src/lib/productSurfaceRegistry.ts`.
- Registry now includes:
  - Product capability definitions (`psa` + `algadesk`)
  - MSP and client portal route-group behavior maps (`allowed`, `upgrade_boundary`, `not_found`)
  - API group behavior map (`allowed|denied`) and metadata visibility filtering
  - Static/dynamic matcher helpers
  - Path behavior resolvers for routes and APIs
  - Menu + portal navigation filtering helpers
  - Fail-closed unknown behavior for Algadesk
  - `/desk/*` alias normalization mapped to MSP route groups
- Added `server/src/test/unit/productSurfaceRegistry.test.ts` to validate representative route/API classifications and fail-closed behavior.
- (2026-05-05) Completed F035/F036/F037 by extending `server/test-utils/testDataFactory.ts#createTenant` with optional `productCode` input and default `product_code: 'psa'`.
- Added/update contract test `server/src/test/unit/testDataFactory.test.ts` to enforce default + explicit Algadesk fixture support.
- (2026-05-05) Completed F038 by threading optional product entitlement through provisioning flows:
  - Added `productCode?: 'psa' | 'algadesk'` to EE tenant creation interfaces in `ee/server/src/interfaces/tenant.interfaces.ts` and `ee/temporal-workflows/src/types/workflow-types.ts`.
  - Passed `productCode` through workflow activity invocation in `ee/temporal-workflows/src/workflows/tenant-creation-workflow.ts`.
  - Updated tenant creation DB write in `ee/temporal-workflows/src/db/tenant-operations.ts` to set `tenantData.product_code` when provided.
  - Updated provisioning surfaces to accept/set product entitlement:
    - `ee/server/src/app/api/v1/tenant-management/create-tenant/route.ts`
    - `ee/server/src/services/provisioning/types/tenant.schema.ts`
    - `ee/server/src/services/provisioning/tenantService.ts`
- (2026-05-05) Completed F039/F040 by ensuring tier transitions do not write product entitlement:
  - Added regression assertions in `ee/server/src/__tests__/unit/stripeService.tierPricing.test.ts` that tenant update payloads do not include `product_code`.
  - Added focused IAP transition guard test `ee/server/src/__tests__/unit/stripeService.productCodePreservation.test.ts`.
- (2026-05-05) Command run: `cd ee/server && npx vitest run src/__tests__/unit/stripeService.tierPricing.test.ts src/__tests__/unit/stripeService.productCodePreservation.test.ts`.
  - Result: failed before test execution in this environment due to module resolution (`Cannot find package '@/lib/db/db'`) from `ee/server` Vitest context.
- (2026-05-05) Completed F041 by exposing `product_code` in admin-only tenant listing response at `ee/server/src/app/api/v1/tenant-management/tenants/route.ts`.
- (2026-05-05) Completed F042: existing down migration in `server/migrations/20260505140000_add_tenant_product_code.cjs` already safely drops product-code constraint then column when present.
- (2026-05-05) Completed F043-F060 and T004 with new `@alga-psa/algadesk-composition` scaffold:
  - Added package scaffold and exports in:
    - `packages/algadesk-composition/package.json`
    - `packages/algadesk-composition/project.json`
    - `packages/algadesk-composition/src/index.ts`
  - Added focused composition entrypoints for MSP, portal, tickets, clients/contacts, settings, KB, and providers in:
    - `packages/algadesk-composition/src/msp/index.ts`
    - `packages/algadesk-composition/src/portal/index.ts`
    - `packages/algadesk-composition/src/tickets/index.ts`
    - `packages/algadesk-composition/src/clients/index.ts`
    - `packages/algadesk-composition/src/settings/index.ts`
    - `packages/algadesk-composition/src/kb/index.ts`
    - `packages/algadesk-composition/src/providers/index.ts`
  - Dependencies intentionally constrained to `@alga-psa/types` only.
  - Added static guard test `server/src/test/unit/algadeskCompositionDependencyGuard.test.ts` asserting:
    - Package exists with required exports.
    - Package dependencies exclude blocked domains (billing/projects/assets/scheduling/SLA/workflows/surveys/extensions/AI/reporting).
    - Source imports do not reference blocked package domains.
- (2026-05-05) Command run: `cd server && npx vitest run src/test/unit/algadeskCompositionDependencyGuard.test.ts`.
  - Result: pass (2 tests).
- (2026-05-05) Completed F061-F067 MSP layout seam increment:
  - `server/src/app/msp/layout.tsx` now resolves `productCode` via `getCurrentTenantProduct()` and passes it to the client layout.
  - Moved SLA/schedule integration registration out of module scope and gated registration to PSA-only (`productCode === 'psa'`).
  - `server/src/app/msp/MspLayoutClient.tsx` now branches shell rendering by product: PSA keeps `DefaultLayout`; Algadesk uses a distinct shell path (`data-product-shell="algadesk"`) without forcing full PSA layout providers.
- (2026-05-05) Completed F068-F087 by product-filtering sidebar navigation through the registry helper:
  - Updated `server/src/components/layout/SidebarWithFeatureFlags.tsx` to apply `filterMenuSectionsByProduct(productCode, ...)` using `ProductContext`.
  - Algadesk now keeps only route-allowed main navigation entries from the existing menu config, which removes PSA-only areas (billing/projects/assets/schedule/time/workflows/surveys/extensions/service-requests, etc.) while keeping dashboard/tickets/clients/contacts/KB/settings/profile/security.
  - PSA tenant behavior remains unchanged (`productCode: psa` keeps full allowed menu set).
- (2026-05-05) Command run: `cd server && npx vitest run src/test/unit/productSurfaceRegistry.test.ts`.
  - Result: pass (7 tests).
- (2026-05-05) Completed F088 by making MSP shell branding product-aware without changing PSA shell behavior:
  - `server/src/components/layout/Sidebar.tsx` now accepts `appDisplayName` and `appLogoAlt` props (defaults preserve PSA).
  - `server/src/components/layout/SidebarWithFeatureFlags.tsx` sets Algadesk branding labels when `productCode === 'algadesk'`.
  - `server/src/app/msp/MspLayoutClient.tsx` uses product-aware client UI shell title (`Algadesk MSP` vs `MSP Portal`).
- (2026-05-05) Completed T005 with component coverage in `server/src/test/unit/layout/SidebarWithFeatureFlags.productShell.test.tsx`:
  - Asserts Algadesk shell filters out blocked modules and uses Algadesk branding labels.
  - Asserts PSA shell still includes representative PSA modules and uses AlgaPSA branding labels.
- (2026-05-05) Command run: `cd server && npx vitest run src/test/unit/layout/SidebarWithFeatureFlags.productShell.test.tsx`.
  - Result: pass (2 tests).
- (2026-05-05) Completed F089-F102 and T007 with an Algadesk-specific dashboard composition.
- Added dashboard data action `server/src/lib/actions/algadeskDashboardActions.ts` with tenant-scoped summaries for:
  - open ticket count
  - awaiting customer / awaiting internal counts
  - ticket aging buckets (<2d, 2-7d, >7d)
  - recently updated tickets
  - email channel health summary from `email_providers`
- Added Algadesk dashboard UI `server/src/components/dashboard/AlgadeskDashboard.tsx` with helpdesk-only cards/sections and no PSA-only widgets.
- Updated `server/src/app/msp/dashboard/page.tsx` to resolve tenant product and render Algadesk dashboard for `algadesk` while preserving existing PSA dashboard behavior.
- (2026-05-05) Completed F103-F109 and F111-F123 plus T006 with Algadesk settings tab composition narrowing.
- Added product-aware settings tab allowlist helper: `server/src/lib/settingsProductTabs.ts`.
- Updated `server/src/components/settings/SettingsPage.tsx` to:
  - resolve current product via `useProduct()`
  - filter available tabs to Algadesk-approved scope (general/users/teams/ticketing/email/client-portal)
  - fail closed to `general` when excluded `tab` query params are requested.
- Updated sidebar settings mode filtering:
  - `server/src/components/layout/Sidebar.tsx` accepts `settingsSectionsOverride`.
  - `server/src/components/layout/SidebarWithFeatureFlags.tsx` passes product-filtered settings sections.
- Updated registry behavior in `server/src/lib/productSurfaceRegistry.ts`:
  - added explicit Algadesk `not_found` route behavior for `/msp/settings/sla`
  - added Algadesk query-tab filtering for `/msp/settings?tab=...` links in menu filtering.

## Tests Added

- T006: `server/src/test/unit/settings/settingsProductTabs.test.ts`
  - Asserts Algadesk-approved settings tabs are present and excluded tabs (billing/SLA/projects/time-entry/integrations/extensions/experimental) are not allowed.
- T007: `server/src/test/unit/dashboard/AlgadeskDashboard.contract.test.ts`
  - Asserts Algadesk dashboard contains ticket/email summary sections and excludes PSA-only widget labels.

## Commands Run

- `cd server && npx vitest run src/test/unit/dashboard/AlgadeskDashboard.contract.test.ts src/test/unit/settings/settingsProductTabs.test.ts src/test/unit/layout/SidebarWithFeatureFlags.productShell.test.tsx src/test/unit/productSurfaceRegistry.test.ts`
  - Result: pass (13 tests).
- (2026-05-05) Completed F110 by adding an explicit Knowledge Base settings entry for Algadesk.
- Added `knowledge-base` settings tab in `server/src/components/settings/SettingsPage.tsx` with focused KB management handoff link to `/msp/knowledge-base`.
- Added settings nav item in `server/src/config/menuConfig.ts` and extended product allowlists for `knowledge-base` in:
  - `server/src/lib/settingsProductTabs.ts`
  - `server/src/lib/productSurfaceRegistry.ts`
- Updated T006 assertion coverage to include Algadesk KB tab allowlist expectation.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/settings/settingsProductTabs.test.ts src/test/unit/productSurfaceRegistry.test.ts src/test/unit/layout/SidebarWithFeatureFlags.productShell.test.tsx`
  - Result: pass (11 tests).
- (2026-05-05) Completed F124-F140 and T008 with product-aware ticket list composition.
- Added Algadesk-safe SLA filter seam in ticket list stack:
  - `server/src/app/msp/tickets/page.tsx`
  - `packages/tickets/src/components/TicketingDashboardContainer.tsx`
  - `packages/tickets/src/components/TicketingDashboard.tsx`
- Behavior:
  - Algadesk tenants now render ticket list with `allowSlaStatusFilter=false` and URL `slaStatusFilter` is ignored.
  - PSA tenants keep existing SLA filter behavior.
  - Core ticket list filters (board/status/priority/category/client/search/tags/assignee/team/unassigned/due-date/response-state), sorting, and pagination remain unchanged.
- Added test coverage:
  - `server/src/test/unit/app/msp/tickets/page.productComposition.test.tsx`
  - Asserts Algadesk disables SLA filter composition while PSA preserves it.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/app/msp/tickets/page.productComposition.test.tsx src/test/unit/productSurfaceRegistry.test.ts src/test/unit/layout/SidebarWithFeatureFlags.productShell.test.tsx`
  - Result: pass (11 tests).
- (2026-05-05) Completed F141 by validation of existing bulk move constraints.
- Current ticket bulk move path already only accepts `destinationBoardId` + `destinationStatusId` (`packages/tickets/src/components/TicketingDashboard.tsx`, `packages/tickets/src/actions/ticketActions.ts`), with board/status validation server-side and no bulk move hooks for excluded PSA operations.
- (2026-05-05) Completed F142/F144/F145 with product-aware ticket detail composition routing.
- Updated `server/src/app/msp/tickets/[id]/page.tsx` to resolve tenant product and branch details mode:
  - Algadesk path disables survey fetch, omits associated assets panel, bypasses AI chat boundary, and passes `isAlgadeskMode=true`.
  - PSA path preserves existing behavior.
- Updated `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx` with `isAlgadeskMode`:
  - Omits project task create/link/badge composition hooks in Algadesk mode (F167/F168/F169).
  - Omits interval/time management composition hooks in Algadesk mode (F170/F171).
  - Omits survey summary card in Algadesk mode (F173).
- Combined with detail-page associated-assets omission and AI boundary bypass:
  - Omits associated assets panel in Algadesk mode (F172).
  - Removes AI detail context wrapper in Algadesk mode (F174).

## Tests Added

- `server/src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx`
  - Asserts Algadesk detail path sets `isAlgadeskMode=true` and omits associated assets.
  - Asserts PSA detail path remains in standard mode and keeps survey summary fetch behavior.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'`
  - Result: pass (4 tests).
- (2026-05-05) Completed F143 with explicit Algadesk quick-add form composition wiring from MSP ticket list.
- Added product-aware quick-add flag flow:
  - `server/src/app/msp/tickets/page.tsx` now passes `useAlgadeskQuickAddForm` based on tenant product.
  - `packages/tickets/src/components/TicketingDashboardContainer.tsx` and `packages/tickets/src/components/TicketingDashboard.tsx` thread the flag into `QuickAddTicket`.
  - `packages/tickets/src/components/QuickAddTicket.tsx` now supports `isAlgadeskMode` and fail-closes asset-prefill linkage in Algadesk mode (`asset_id` not submitted, asset banner hidden).
- Updated test `server/src/test/unit/app/msp/tickets/page.productComposition.test.tsx` to assert Algadesk receives quick-add safe composition flag while PSA does not.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'`
  - Result: pass (4 tests).
- (2026-05-05) Completed F165/F166 by removing SLA status and SLA breach badges from Algadesk ticket detail.
- Added `hideSlaStatus` composition seam threaded through ticket detail stack:
  - `packages/tickets/src/components/ticket/TicketInfo.tsx`
  - `packages/tickets/src/components/ticket/TicketDetails.tsx`
  - `packages/tickets/src/components/ticket/TicketDetailsContainer.tsx`
  - `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx` (sets `hideSlaStatus` when `isAlgadeskMode=true`).
- Behavior:
  - Algadesk ticket detail now hides SLA status block and SLA breach indicators.
  - PSA ticket detail retains existing SLA rendering behavior.
- Validation:
  - `src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx` still passes and confirms Algadesk detail composition mode.
  - A direct package-level TicketDetailsContainer test run is currently blocked in this environment by a pre-existing module-resolution issue (`next-auth` `./lib/env` specifier) under this Vitest context.
- (2026-05-05) Completed F146-F164 and F175; validated Algadesk ticket detail core composition remains intact while PSA-only controls stay excluded.
- Added/expanded contract coverage in `packages/msp-composition/src/tickets/__tests__/MspTicketDetailsContainerClient.test.tsx`:
  - New Algadesk-focused test (`T009`) asserts core ticket detail payload wiring remains present (metadata options, conversation/comments, documents/attachments, client/contact context, assignment/reference options) while SLA/project/time controls are omitted.
  - Added PSA default-mode assertion that project/time and SLA composition hooks remain available for PSA tenants.

## Commands Run (additional)

- `cd server && npx vitest run ../packages/msp-composition/src/tickets/__tests__/MspTicketDetailsContainerClient.test.tsx src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'`
  - Result: pending (run after this scratchpad update).
- (2026-05-05) Adjusted T009 coverage location: package-level msp-composition test execution is currently blocked in this environment by existing cross-package module resolution (`@alga-psa/authorization/kernel` through tickets action graph), so T009 assertions were added to the existing server page-composition unit test instead.
- Updated `server/src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx` Algadesk assertions to verify core ticket detail data remains wired: comments/conversation payload, documents/attachments payload, status/priority/category options, and client/contact context, while retaining Algadesk PSA-surface omissions already covered (no associated assets, no survey fetch).

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'`
  - Result: pass (4 tests).
- (2026-05-05) Completed F176-F189 quick-add/reference-data seam verification based on existing QuickAddTicket behavior plus targeted Algadesk-safe asset prefill contract coverage.
- Added quick-add test case in `packages/tickets/src/components/__tests__/ticket-inline-add-prefill.test.tsx`:
  - `T010` asserts PSA mode shows linked-asset banner and submits `asset_id`, while Algadesk mode hides banner and omits `asset_id` from ticket create payload.
- Environment constraint: direct execution of package-level quick-add test suite remains blocked in this Vitest context by pre-existing `next-auth` deep import resolution (`Missing "./lib/env" specifier in "next-auth" package`).
- (2026-05-05) Completed F190-F193 by verification: existing shared MSP clients/contacts list+detail routes already render for Algadesk tenants and are explicitly allowlisted in `productSurfaceRegistry` (`/msp/clients`, `/msp/contacts`). No additional composition fork required for these four baseline renderability items.
- (2026-05-05) Completed client-detail exclusion slice for Algadesk: F202/F203/F204/F205/F207/F209/F210.
- `server/src/app/msp/clients/[id]/page.tsx` now resolves tenant product and passes `isAlgadeskMode` into `ClientDetails`; Algadesk path skips document fetch and survey-summary fetch.
- `packages/clients/src/components/clients/ClientDetails.tsx` now filters tabs in Algadesk mode to remove PSA-only client surfaces (`assets`, `billing`, `billing-dashboard`, `documents`, `tax-settings`) and suppresses survey summary card rendering.
- Added unit coverage: `server/src/test/unit/app/msp/clients/[id]/page.productComposition.test.tsx` verifying Algadesk vs PSA composition behavior (document/survey fetch suppression and mode flag propagation).
- (2026-05-05) Completed F194/F195/F196/F197/F198/F199/F200/F201 and T012 with a client/contact composition safety pass for Algadesk.
- Product-aware contact detail composition:
  - Updated `server/src/app/msp/contacts/[id]/page.tsx` to resolve tenant product and pass `isAlgadeskMode` into contact detail.
  - Algadesk path now skips document fetch even on direct `?tab=documents` requests.
- Updated `packages/clients/src/components/contacts/ContactDetails.tsx` with `isAlgadeskMode` prop and Algadesk tab filtering that removes the documents tab while preserving details/tickets/notes and existing CRUD/contact-edit surfaces.
- Added unit coverage:
  - `server/src/test/unit/app/msp/contacts/[id]/page.productComposition.test.tsx` verifies Algadesk vs PSA contact detail behavior (document fetch suppressed for Algadesk, preserved for PSA).
  - `server/src/test/unit/clients/algadeskClientContactComposition.contract.test.ts` verifies client/contact CRUD + support context wiring remains intact for Algadesk composition (client/contact tickets, client locations, contact phone numbers, additional emails, notes), and confirms contact detail page product-safe mode wiring.

## Commands Run (additional)

- `cd server && npx vitest run 'src/test/unit/app/msp/clients/[id]/page.productComposition.test.tsx' 'src/test/unit/app/msp/contacts/[id]/page.productComposition.test.tsx' src/test/unit/clients/algadeskClientContactComposition.contract.test.ts`
  - Result: pass (7 tests).
  - Note: test run emits existing Next request-scope warnings from `getServerTranslation` cookie detection in this unit context; assertions still pass.
- (2026-05-05) Completed F206/F208/F211 with tighter Algadesk-safe client detail composition gating.
- Updated `packages/clients/src/components/clients/ClientDetails.tsx`:
  - Added `shouldRenderPsaOnlyClientSurfaces` guard to avoid invoking excluded cross-feature callbacks in Algadesk mode.
  - Guarded excluded tab callback execution for client assets and client documents so Algadesk mode does not execute those callbacks before tab filtering.
  - Expanded Algadesk excluded tab set to fail-closed for client `projects` and service catalog aliases (`service-catalog`, `services`) in addition to existing excluded domains.
- Updated static contract coverage in `server/src/test/unit/clients/algadeskClientContactComposition.contract.test.ts` to assert:
  - explicit exclusion tokens for projects/service catalog
  - PSA-only callback guard presence in client detail composition.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/clients/algadeskClientContactComposition.contract.test.ts 'src/test/unit/app/msp/clients/[id]/page.productComposition.test.tsx'`
  - Result: pass (5 tests).
- (2026-05-05) Completed F212-F218 and T013 with KB composition/API contract coverage.
- Added `server/src/test/unit/kb/algadeskKnowledgeBase.contract.test.ts`:
  - Verifies MSP and portal KB page compositions are wired (`/msp/knowledge-base`, `/client-portal/knowledge-base`).
  - Verifies KB list/view/create/edit/publish surfaces are exposed via API route handlers (`kb-articles` list/item/publish/archive routes).
  - Verifies KB UI components do not link to full document-library routes (`/msp/documents`, `/client-portal/documents`).
- Scope note: this is confidence-building contract coverage (static/route-surface) consistent with plan non-goal of exhaustive per-feature integration.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/kb/algadeskKnowledgeBase.contract.test.ts`
  - Result: pass (3 tests).
- (2026-05-05) Completed F219 by introducing a composed ticket-attachment upload provider seam for ticket rich-text flows.
- Added composed upload provider in `packages/msp-composition/src/tickets/composedClipboardActions.ts`:
  - `uploadTicketAttachmentDocument(formData, { userId, ticketId })` delegates to documents upload action from composition layer.
- Threaded upload provider through ticket detail composition chain:
  - `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx`
  - `packages/tickets/src/components/ticket/TicketDetailsContainer.tsx`
  - `packages/tickets/src/components/ticket/TicketDetails.tsx`
  - `packages/tickets/src/components/ticket/TicketInfo.tsx`
  - `packages/tickets/src/components/ticket/TicketConversation.tsx`
- Result: ticket description/comment clipboard image uploads can be provided by composition injection rather than relying on ticket components to directly resolve document upload actions.
- (2026-05-05) Completed F220 by introducing a composed ticket-attachment draft-delete provider seam.
- Threaded a delete-provider callback through ticket detail composition (`TicketDetailsContainer` -> `TicketDetails` -> `TicketInfo`/`TicketConversation`) and wired `deleteDraftClipboardImages` from msp-composition.
- Result: Algadesk ticket clipboard-draft cleanup now uses composition-provided delete action wiring instead of relying only on local fallback behavior.

## Commands Run (additional)

- `cd server && npx vitest run ../packages/tickets/src/components/ticket/useTicketRichTextUploadSession.test.tsx src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'`
  - Result: pass (9 tests).
- `cd server && npx vitest run ../packages/msp-composition/src/tickets/__tests__/MspTicketDetailsContainerClient.test.tsx src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'`
  - Result: package test blocked by existing Vitest mock/export mismatch in this environment (`@alga-psa/auth` mock missing `withAuthCheck`); server page-composition tests still pass.
- (2026-05-05) Completed F221 by introducing a composed ticket-attachment view/download URL resolver seam.
- Added `resolveTicketAttachmentViewUrl` in `packages/msp-composition/src/tickets/composedClipboardActions.ts` and threaded it through ticket detail composition (`TicketDetailsContainer` -> `TicketDetails` -> `TicketInfo`/`TicketConversation`) into `useTicketRichTextUploadSession`.
- `useTicketRichTextUploadSession` now accepts `resolveDocumentViewUrl` so Algadesk ticket components can resolve attachment URLs via composition rather than hardcoded URL construction in component logic.
- Added hook-level coverage in `packages/tickets/src/components/ticket/useTicketRichTextUploadSession.test.tsx` to assert injected URL-resolver behavior.
- (2026-05-05) Completed F222 by disabling folder selection for Algadesk ticket attachment uploads.
- Added composition flag `disableAttachmentFolderSelection` (set to `isAlgadeskMode`) through ticket detail composition to ticket documents section.
- Added `forceUploadToRoot` support in documents component wiring so entity-mode uploads bypass folder chooser when this flag is enabled.
- Added contract coverage: `server/src/test/unit/tickets/algadeskAttachmentComposition.contract.test.ts`.
- Command run: `cd server && npx vitest run src/test/unit/tickets/algadeskAttachmentComposition.contract.test.ts ../packages/tickets/src/components/ticket/useTicketRichTextUploadSession.test.tsx src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'` -> pass (12 tests).
- (2026-05-05) Completed F223/F224 by gating Algadesk ticket attachment surfaces away from broad document management affordances.
- Added documents component controls:
  - `allowDocumentSharing` to suppress share-link dialog/actions.
  - `allowLinkExistingDocuments` to suppress "link existing documents" picker in entity mode.
- Threaded Algadesk-safe flags through ticket detail composition and ticket documents section:
  - `disableAttachmentSharing` / `disableAttachmentLinking` set from `isAlgadeskMode` in `MspTicketDetailsContainerClient`.
- Updated static contract assertions in `server/src/test/unit/tickets/algadeskAttachmentComposition.contract.test.ts`.
- Command run: `cd server && npx vitest run src/test/unit/tickets/algadeskAttachmentComposition.contract.test.ts ../packages/tickets/src/components/ticket/useTicketRichTextUploadSession.test.tsx src/test/unit/app/msp/tickets/page.productComposition.test.tsx 'src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx'` -> pass (12 tests).
- (2026-05-05) Completed F225 by asserting rich-text image uploads remain ticket/comment scoped.
- Expanded `useTicketRichTextUploadSession` test coverage to verify uploads are invoked with explicit `{ userId, ticketId }` metadata.
- Command run: `cd server && npx vitest run ../packages/tickets/src/components/ticket/useTicketRichTextUploadSession.test.tsx src/test/unit/tickets/algadeskAttachmentComposition.contract.test.ts` -> pass (8 tests).
- (2026-05-05) Completed F226 by strengthening/validating ticket-attachment authorization contract coverage.
- Updated `packages/tickets/src/actions/comment-actions/clipboardImageDraftActions.contract.test.ts` assertions to match current injected delete implementation (`input.deleteDocumentFn(...)`) and explicit ticket-association check.
- Command run: `cd server && npx vitest run ../packages/tickets/src/actions/comment-actions/clipboardImageDraftActions.contract.test.ts ../packages/tickets/src/components/ticket/useTicketRichTextUploadSession.test.tsx` -> pass (10 tests).
- (2026-05-05) Completed F227-F243 with product-aware client-portal shell composition.
- Server/client layout threading:
  - `server/src/app/client-portal/layout.tsx` now resolves tenant product via `getCurrentTenantProduct()` and passes `productCode` into `ClientPortalLayoutClient`.
  - `server/src/app/client-portal/ClientPortalLayoutClient.tsx` now passes `productCode` to `ClientPortalLayout`.
- Client portal shell updates:
  - `packages/client-portal/src/components/layout/ClientPortalLayout.tsx` now threads `productCode` to sidebar and marks shell root with `data-product-shell`.
  - `packages/client-portal/src/components/layout/ClientPortalSidebar.tsx` now applies Algadesk-specific nav composition:
    - keeps dashboard/tickets/knowledge-base/profile and client settings (when permitted)
    - hides billing/projects/devices/documents/appointments/request-services/extensions
    - keeps PSA behavior unchanged by default (`productCode='psa'`).
- Added/updated contract coverage:
  - `server/src/test/unit/client-portal/clientPortalProductLayout.contract.test.ts`
  - `packages/client-portal/src/components/layout/ClientPortalSidebar.contract.test.ts`
- Command run: `cd server && npx vitest run src/test/unit/client-portal/clientPortalProductLayout.contract.test.ts ../packages/client-portal/src/components/layout/ClientPortalSidebar.contract.test.ts` -> pass (8 tests).
- (2026-05-05) Completed F244-F261 and T014 via client-portal ticketing/shell contract verification.
- Added `server/src/test/unit/client-portal/algadeskPortalTicketing.contract.test.ts` to validate:
  - dashboard/ticket list/detail surfaces remain wired
  - free-form ticket creation inputs and visibility-group board enforcement
  - portal ticket detail hides internal-comment tab and keeps public reply/status flows
  - portal ticket pages avoid billing/project navigation links
- Command run: `cd server && npx vitest run src/test/unit/client-portal/algadeskPortalTicketing.contract.test.ts src/test/unit/client-portal/clientPortalProductLayout.contract.test.ts` -> pass (8 tests).
- (2026-05-05) Completed F262 and T021 with focused Algadesk Email Channels settings composition.
- Updated `server/src/components/settings/SettingsPage.tsx` email tab rendering:
  - Algadesk now uses `EmailProviderConfiguration` (inbound mailbox/channel-focused settings surface).
  - PSA retains existing `EmailSettings` composition unchanged.
- Added `server/src/test/unit/settings/algadeskEmailChannelsComposition.contract.test.ts` to assert product-aware composition switch in settings.
- (2026-05-05) Completed F263 and T022 by validating existing inbound mailbox/channel configuration seams.
- Added `server/src/test/unit/settings/algadeskInboundEmailChannelConfiguration.contract.test.ts` asserting:
  - inbound provider setup UI covers Gmail/Microsoft/IMAP mailbox channel configuration
  - provider persistence contract includes `provider_type`, `mailbox`, `is_active`, and `inbound_ticket_defaults_id`
- Command run: `cd server && npx vitest run src/test/unit/settings/algadeskInboundEmailChannelConfiguration.contract.test.ts src/test/unit/settings/algadeskEmailChannelsComposition.contract.test.ts` -> pass (2 tests).
- Note: legacy `EmailProviderConfiguration` component tests currently fail in this environment due to pre-existing DB/mocking issues (ECONNREFUSED + missing mock export for `getInboundTicketDefaults`); product-seam contracts were added to keep this plan slice verifiable without DB coupling.
- (2026-05-05) Completed F264-F271 and T023 using existing email-channel form/status seams plus contract coverage.
- Added `server/src/test/unit/settings/algadeskEmailChannelMappingsAndHealth.contract.test.ts` validating:
  - outbound identity seam persists mailbox-based channel identity
  - inbound defaults form includes board/category/priority mapping + active toggle
  - provider card exposes connection status, last-sync health, webhook-expiry context, and last error state
- Command run: `cd server && npx vitest run src/test/unit/settings/algadeskEmailChannelsComposition.contract.test.ts src/test/unit/settings/algadeskInboundEmailChannelConfiguration.contract.test.ts src/test/unit/settings/algadeskEmailChannelMappingsAndHealth.contract.test.ts` -> pass (3 tests).
- (2026-05-06) Completed F272-F280 by validating existing unified inbound email processing implementation already satisfies the feature slice.
- Implementation evidence in `shared/services/email/processInboundEmailInApp.ts`:
  - Creates new tickets from inbound email and maps destination defaults (`board_id`, `category_id`, `priority_id`) via `resolveEffectiveInboundTicketDefaults` + `createTicketFromEmail` (F272/F273/F274/F275).
  - Resolves sender contact when possible and applies fallback behavior for unknown senders (domain/client fallback + unmatched sender metadata) (F276/F277).
  - Adds public comments for inbound replies through reply-token/thread-header matching via `createCommentFromEmail` (F278).
  - Persists message/thread identifiers in ticket/comment metadata and uses them for thread lookup/idempotency (F279).
  - Dedupes repeated inbound events by pre-create checks for existing ticket/comment message IDs (F280).
- Coverage references already present in shared tests:
  - `shared/services/email/__tests__/processInboundEmailInApp.test.ts`
  - `shared/services/email/__tests__/processInboundEmailInApp.additionalPaths.test.ts`
  - `server/src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts`
- Command run: `cd server && npx vitest run src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts` -> pass (8 tests).
- Note: shared inbound-email unit tests live outside the current server Vitest include globs in this environment, so direct invocation from root reports `No test files found`; existing shared test files remain the primary coverage artifact for this slice.
- (2026-05-06) Completed F281 and F282 by validating existing outbound-notification and ticket-detail email-context seams.
- Implementation evidence:
  - `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` sends external-contact outbound email when a comment is public and from an internal agent (`isPublicComment && isFromAgent`) and routes through `sendNotificationIfEnabled` (feature-flag/preference-aware) (F281).
  - `packages/tickets/src/components/ticket/TicketDetails.tsx` renders ticket email context composition (`TicketEmailNotifications`) and inbound-origin metadata labels; detail context surfaces are already wired in MSP ticket detail composition tests (F282).
- (2026-05-06) Completed F283/F284/F285 with explicit product gating on inbound email webhook, IMAP management, and OAuth routes.
- Added product assertions on server email routes:
  - `server/src/app/api/email/oauth/initiate/route.ts`
  - `server/src/app/api/email/oauth/imap/initiate/route.ts`
  - `server/src/app/api/email/oauth/imap/callback/route.ts`
  - `server/src/app/api/email/imap/resync/route.ts`
  - `server/src/app/api/email/imap/reconnect/route.ts`
  - Each now calls `assertTenantProductAccess(... capability: 'email_to_ticket', allowedProducts: ['psa', 'algadesk'])`.
- Added tenant product checks to webhook handlers:
  - `packages/integrations/src/webhooks/email/handlers/googleWebhookHandler.ts`
  - `packages/integrations/src/webhooks/email/handlers/microsoftWebhookHandler.ts`
  - `packages/integrations/src/webhooks/email/imap.ts`
  - Handlers now fail closed for unknown tenant `product_code` values before enqueueing inbound pointer jobs.
- Added contract coverage:
  - `server/src/test/unit/email/algadeskEmailRouteProductGate.contract.test.ts`
- Commands run:
  - `cd server && npx vitest run src/test/unit/email/algadeskEmailRouteProductGate.contract.test.ts` -> pass (1 test).
  - `cd server && npx vitest run src/test/unit/tickets/TicketDetails.emailNotifications.integration.test.ts src/test/unit/notifications/ticketEmailSubscriber.watchers.test.ts` -> pass (8 tests).
- (2026-05-06) Completed F286 by verification of existing settings-product filtering:
  - `server/src/lib/settingsProductTabs.ts` excludes broad `integrations` tab for Algadesk.
  - `server/src/components/settings/SettingsPage.tsx` applies product-tab allowlist and keeps focused `email` tab for channel configuration.
- (2026-05-06) Completed F287/F288 by product-gating notifications email-template surfaces for Algadesk.
  - Updated `server/src/components/settings/general/NotificationsTab.tsx`:
    - Added product-aware email tab allowlist for Algadesk (`settings`, `categories`, `telemetry`).
    - Removed `email-templates` tab from Algadesk composition while preserving PSA behavior.
    - Sanitized direct `section=email-templates` query access by restricting valid tabs in Algadesk mode.
  - Updated `server/src/app/msp/settings/notifications/page.tsx`:
    - Added product-aware email tab allowlist for Algadesk (`settings`, `categories`).
    - Removed `email-templates` tab from direct notifications route in Algadesk mode while preserving PSA behavior.
    - Sanitized direct `tab=email-templates` query access by restricting valid tabs in Algadesk mode.
  - Added contract test T024: `server/src/test/unit/settings/algadeskEmailTemplateAutomationBoundary.contract.test.ts` asserting Algadesk-specific tab gating in both compositions.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/settings/algadeskEmailTemplateAutomationBoundary.contract.test.ts src/test/unit/settings/algadeskEmailChannelsComposition.contract.test.ts src/test/unit/settings/algadeskInboundEmailChannelConfiguration.contract.test.ts`
  - Result: pass (4 tests).
- (2026-05-06) Completed F289-F307 and T025 via shared route-boundary composition in layout clients.
  - Added reusable branded boundary component:
    - `server/src/components/product/ProductRouteBoundary.tsx`
    - Handles both `upgrade_boundary` and `not_found` registry outcomes with scoped dashboard return links for MSP and client portal.
  - Wired registry-backed gating in MSP layout:
    - `server/src/app/msp/MspLayoutClient.tsx`
    - Resolves `resolveProductRouteBehavior(productCode, pathname)` and renders `ProductRouteBoundary` for non-allowed Algadesk routes.
  - Wired registry-backed gating in client portal layout:
    - `server/src/app/client-portal/ClientPortalLayoutClient.tsx`
    - Resolves `resolveProductRouteBehavior(productCode, pathname)` and renders `ProductRouteBoundary` for non-allowed Algadesk routes.
  - Effect:
    - Algadesk direct hits to excluded MSP major routes (billing/projects/assets/schedule/dispatch/time/workflows/surveys/extensions/reports/service-requests) now consistently render an upgrade boundary.
    - Algadesk direct hits to internal/test MSP route groups (`/msp/test*`) resolve to product not-available boundary.
    - Algadesk direct hits to excluded portal routes (billing/projects/devices/documents/appointments/request-services/extensions) now render portal boundary.
    - PSA behavior remains unchanged because layout gating applies only when `productCode === 'algadesk'`.
  - Added contract test `server/src/test/unit/product/productRouteBoundaryComposition.contract.test.ts`.

- `cd server && npx vitest run src/test/unit/product/productRouteBoundaryComposition.contract.test.ts src/test/unit/productSurfaceRegistry.test.ts`
  - Result: pass (10 tests).
- (2026-05-06) Completed F308-F332 and F336 with centralized API controller product gating.
  - Updated `server/src/lib/api/controllers/ApiBaseController.ts`:
    - Added `assertProductApiAccess()` invoked immediately after authentication in list/get/create/update/delete handlers.
    - Resolves tenant product via `getTenantProduct(...)` and API behavior via `resolveProductApiBehavior(...)`.
    - Added structured `ProductDeniedApiError` (`statusCode: 403`, `code: PRODUCT_ACCESS_DENIED`) for denied Algadesk API groups.
  - Result: API-key paths that use `ApiBaseController` now enforce product boundary centrally while preserving existing PSA behavior (`psa` routes continue as allowed by registry).
  - Added contract test T026:
    - `server/src/test/unit/api/apiBaseController.productAccess.contract.test.ts`.

- `cd server && npx vitest run src/test/unit/api/apiBaseController.productAccess.contract.test.ts src/test/unit/productSurfaceRegistry.test.ts`
  - Result: pass (8 tests).
- (2026-05-06) Completed F333/F334/F335/F354 and T027 via product-aware metadata/OpenAPI filtering.
  - Updated `server/src/lib/api/controllers/ApiMetadataController.ts`:
    - Applies `assertProductApiAccess` across metadata controller endpoints (same guard model as ApiBaseController flow).
    - Filters `/api/v1/meta/endpoints` response to only product-visible endpoint paths using `isApiVisibleInMetadata(productCode, endpoint.path)`.
    - Filters `/api/v1/meta/openapi` `paths` object to only product-visible paths for current tenant product.
  - PSA preservation: visibility filter returns full metadata for `psa` rules, preserving existing PSA metadata output.
  - Added contract test:
    - `server/src/test/unit/api/apiMetadataController.productVisibility.contract.test.ts`.

- `cd server && npx vitest run src/test/unit/api/apiMetadataController.productVisibility.contract.test.ts src/test/unit/api/apiBaseController.productAccess.contract.test.ts src/test/unit/productSurfaceRegistry.test.ts`
  - Result: pass (9 tests).
- (2026-05-06) Completed F337/F338/F339/F340/F341/F342/F345/F346/F347/F348 and alias completion F355/F356 with representative server-action product assertions.
- Added shared guard `shared/services/productAccessGuard.ts`:
  - `assertPsaOnlyTenantAccess(tenantId, capability)` resolves tenant `product_code` from admin DB and fail-closes non-PSA or misconfigured tenants.
  - Includes structured `ProductAccessError` (`status=403`, `code=PRODUCT_ACCESS_DENIED`).
- Added PSA-only guard calls in representative excluded-domain server actions:
  - Billing: `packages/billing/src/actions/taxRateActions.ts`
  - Projects: `packages/projects/src/actions/projectTaskExportActions.ts`
  - Scheduling/time: `packages/scheduling/src/actions/timeEntryTicketActions.ts`
  - Assets/RMM: `packages/assets/src/actions/clientLookupActions.ts`
  - Workflow: `server/src/lib/actions/workflow-bundle-v1-actions.ts`
  - Surveys: `packages/surveys/src/actions/survey-actions/surveyMetricsActions.ts`
  - Full document-management: `packages/documents/src/actions/shareLinkActions.ts`
- Added contract coverage `server/src/test/unit/product/serverActionProductAccess.contract.test.ts` to assert representative guards remain present and guard uses structured ProductAccessError fields.
- F346 rationale: existing `algadesk-composition` dependency guard already blocks imports of excluded domains (including extensions) from Algadesk composition package, satisfying “avoid importing denied server action modules from Algadesk composition” at package-boundary level.
- F355/F356 rationale: route registry already maps optional `/desk/*` aliases without requiring aliases for launch via `normalizePathname` in `server/src/lib/productSurfaceRegistry.ts`.

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/product/serverActionProductAccess.contract.test.ts src/test/unit/productAccess.test.ts`
  - Result: pass (9 tests).
- (2026-05-06) Completed F343/F344 with extension and AI/chat boundary assertions.
- Added extension product gates (`extension_actions`) in EE action surfaces:
  - `ee/server/src/lib/actions/extMenuActions.ts`
  - `ee/server/src/lib/actions/extensionDomainActions.ts`
  - `ee/server/src/lib/actions/installDomainActions.ts`
- Added AI/chat product gates (`ai_chat`) in representative chat server endpoints:
  - `server/src/app/api/chat/v1/execute/route.ts`
  - `server/src/app/api/chat/v1/completions/route.ts`
  - `server/src/app/api/chat/v1/completions/stream/route.ts`
  - Each now requires session tenant and asserts PSA-only product access.
- Updated product access contract test to include extension and AI/chat representative files:
  - `server/src/test/unit/product/serverActionProductAccess.contract.test.ts`

## Commands Run (additional)

- `cd server && npx vitest run src/test/unit/product/serverActionProductAccess.contract.test.ts`
  - Result: pass (2 tests).
- (2026-05-06) Completed F349/F350/F351/F352/F353 via explicit PSA-preservation contract coverage.
- Added `server/src/test/unit/product/psaPreservation.contract.test.ts` to assert PSA fallback branches remain in:
  - MSP dashboard/settings/tickets/client-detail composition files
  - client portal sidebar default PSA composition branch
- Command run:
  - `cd server && npx vitest run src/test/unit/product/psaPreservation.contract.test.ts src/test/unit/product/serverActionProductAccess.contract.test.ts`
  - Result: pass (4 tests).
