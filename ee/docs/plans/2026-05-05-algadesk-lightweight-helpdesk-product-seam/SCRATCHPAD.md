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
