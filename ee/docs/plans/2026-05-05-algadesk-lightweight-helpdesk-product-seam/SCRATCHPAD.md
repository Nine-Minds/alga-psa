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
