# Scratchpad — Algadesk Product Seam Remediation

- Plan slug: `2026-05-06-algadesk-remediation-product-seam`
- Created: `2026-05-06`
- Parent plan: `ee/docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam/`
- Reviewed implementation range: `422df13c8..09f09a919`

## What This Is

Working notes for remediating the current Algadesk implementation. This plan exists because the branch has meaningful product-seam work but is not merge-ready. Use this folder as the source of truth for the remediation job.

## Decisions Carried Forward from Parent Plan

- (2026-05-05) Algadesk is an orthogonal product entitlement, not a new PSA tier.
- (2026-05-05) Algadesk includes email-to-ticket and ticket reply/update by email.
- (2026-05-05) Algadesk includes ticket attachments and KB only, not full document management.
- (2026-05-05) Algadesk includes free-form ticket creation only, not service request forms/catalog in v1.
- (2026-05-05) Algadesk excludes SLA module in v1.
- (2026-05-05) Direct browser access behavior is mixed: branded upgrade boundaries for major human-facing PSA areas, product-denied/not-found for internal/API-only routes.
- (2026-05-05) Current routes remain canonical for v1; `/desk/*` aliases can be added later.
- (2026-05-05) Existing background workers/services may remain separate runtime processes for email.
- (2026-05-05) Product seam should be high quality via Algadesk-specific composition, not menu-only hiding.
- (2026-05-06) Remediation should not expand product scope; it should make the current implementation safe, compile, and prove the critical seams.

## Key Review Findings to Remediate

- (2026-05-06) Typecheck fails:
  - `server/src/components/layout/SidebarWithFeatureFlags.tsx`
  - `server/src/types/next-auth.ts`
- (2026-05-06) `ProductProvider` reads `session.user.product_code`, but `packages/auth/src/lib/nextAuthOptions.ts` does not fetch/map `product_code`; Algadesk client UI can resolve as PSA.
- (2026-05-06) `server/src/app/msp/MspLayoutClient.tsx` renders raw children for Algadesk instead of a real sidebar/header shell.
- (2026-05-06) MSP and portal route boundaries are client-side only, so excluded server pages may execute data fetching before boundary UI.
- (2026-05-06) API product enforcement in `ApiBaseController` is bypassed by overridden controllers such as `ApiProjectController.list()`.
- (2026-05-06) Product registry gaps/inconsistencies:
  - `/client-portal/client-settings` visible in portal sidebar but not allowed in registry.
  - `/msp/settings/*` too broadly allowed except SLA.
  - `/api/v1/knowledge-base` does not match existing `/api/v1/kb-articles` route.
  - Missing deny groups for many PSA-only API families.
- (2026-05-06) Metadata/OpenAPI filtering is partial; schemas/permissions/stats can still reveal PSA-only concepts.
- (2026-05-06) `ProductAccessError` has `status = 403`; some API handlers expect `statusCode`, causing possible 500s.
- (2026-05-06) Parent `features.json` and `tests.json` are overclaimed: all items marked implemented despite blockers.
- (2026-05-06) Several tests are source-string contracts, not the behavior/integration coverage their descriptions claim.
- (2026-05-06) Current uncommitted `.env.localtest` contains plaintext DB credentials and must not be committed.
- (2026-05-06) Current uncommitted `package-lock.json` appears to regress package versions and should be reverted unless intentionally required.
- (2026-05-06) Current uncommitted contact-detail changes appear relevant: hide contact documents for Algadesk and avoid fetching documents on `tab=documents`.

## Commands / Validation Run During Review

- `cd server && npm run typecheck -- --pretty false`
  - Result: failed with SidebarWithFeatureFlags generic errors and NextAuth augmentation conflict.
- `cd server && npx vitest run --coverage=false --reporter=dot ../packages/msp-composition/src/tickets/__tests__/MspTicketDetailsContainerClient.test.tsx`
  - Result: failed before tests with `TypeError: createRequire is not a function` from DB/Turbopack path.
- `cd server && npx vitest run --coverage=false --reporter=dot src/test/integration/algadeskTicketCrudRbac.integration.test.ts src/test/integration/algadeskTicketAttachmentDrafts.integration.test.ts`
  - Result: failed because local Postgres was unavailable on `localhost:5432`.
- `cd server && npx playwright test --list src/test/e2e/algadesk-portal-ticketing.playwright.test.ts`
  - Result: listed one test, but static inspection found helper signature and route issues.

## Files / Areas to Inspect First

- Product auth/session:
  - `packages/auth/src/lib/nextAuthOptions.ts`
  - `packages/auth/src/types/next-auth.ts`
  - `server/src/types/next-auth.ts`
  - `server/src/context/ProductContext.tsx`
- Product registry and errors:
  - `server/src/lib/productSurfaceRegistry.ts`
  - `server/src/lib/productAccess.ts`
- MSP shell/routes:
  - `server/src/app/msp/layout.tsx`
  - `server/src/app/msp/MspLayoutClient.tsx`
  - `server/src/components/layout/SidebarWithFeatureFlags.tsx`
  - `server/src/components/layout/Sidebar.tsx`
- Portal shell/routes:
  - `server/src/app/client-portal/layout.tsx`
  - `server/src/app/client-portal/ClientPortalLayoutClient.tsx`
  - `packages/client-portal/src/components/layout/ClientPortalSidebar.tsx`
- API enforcement:
  - `server/src/lib/api/controllers/ApiBaseController.ts`
  - `server/src/lib/api/controllers/ApiProjectController.ts`
  - Other overridden controllers: financial, invoice, quote, assets, tags, client custom methods.
  - Standalone API routes under `server/src/app/api/**`.
- Metadata/OpenAPI:
  - `server/src/lib/api/controllers/ApiMetadataController.ts`
  - `server/src/lib/api/services/MetadataService.ts`
  - `server/src/lib/api/openapi/**`
- Contact/document leak:
  - `packages/clients/src/components/contacts/ContactDetails.tsx`
  - `server/src/app/msp/contacts/[id]/page.tsx`

## Implementation Notes

- Prefer centralizing API product enforcement in a method that every authenticated controller path must execute, rather than relying on every override to remember `assertProductApiAccess()`.
- Server-side route guards may need page-level helpers for excluded pages because server layouts do not naturally receive pathname in the same way client layouts do.
- If middleware is considered for route boundaries, it must have trustworthy product information. That likely depends on fixing auth/JWT product_code propagation first.
- Preserve PSA behavior in every remediation patch; regression tests should include representative PSA routes/API metadata.
- Keep source-string contract tests only as supplemental guardrails; do not rely on them as the only proof for DB/API/browser behavior.

## Open Questions

- Should server route enforcement be middleware-first, page-helper-first, or both?
- Should Algadesk shell be a minimal wrapper around existing Sidebar/Header primitives or a new product-specific shell component?
- Should parent plan implemented booleans be reset or annotated as superseded?
- Which inbound email provider path is the minimum runnable behavior test for remediation?

## Remediation Execution Log

- (2026-05-06) Completed hygiene baseline items R001-R005.
- (2026-05-06) Isolated local-secret/local-env noise by intentionally leaving `.env.localtest` modified and excluding it from staged remediation commits.
- (2026-05-06) Isolated lockfile drift by intentionally leaving `package-lock.json` unstaged pending explicit dependency intent.
- (2026-05-06) Removed transient review artifact `progress.md`.
- (2026-05-06) Established commit hygiene runbook: stage by explicit path only, verify with `git status --short` before each commit.
- (2026-05-06) Reconfirmed reviewed range/blockers in this scratchpad and PRD remain the active remediation baseline.
- (2026-05-06) Completed auth/session/type remediation batch (R006-R023) plus sidebar typing fixes (R066-R067).
- Shared NextAuth augmentation now owns `product_code`; server local augmentation reduced to shared import only to avoid declaration drift.
- `fetchTenantSubscriptionInfo` now selects and returns `tenants.product_code`; JWT callback sets/refreshes `token.product_code`; session callback maps to `session.user.product_code` with PSA fallback for rollout compatibility.
- `ProductProvider` now reads typed `session.user.product_code` directly (no unsafe cast).
- `filterMenuSectionsByProduct` generic was relaxed to accept structural section types without requiring `Record<string, unknown>`, resolving `SidebarWithFeatureFlags` type errors.
- Validation run (pass): `cd server && npm run typecheck -- --pretty false`.
- Validation run (pass): `cd server && npx vitest run src/test/unit/context/ProductContext.test.tsx --reporter=dot`.
