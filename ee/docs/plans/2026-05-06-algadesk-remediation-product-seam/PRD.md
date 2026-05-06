# PRD — Algadesk Product Seam Remediation

- Slug: `2026-05-06-algadesk-remediation-product-seam`
- Date: `2026-05-06`
- Status: Draft
- Parent plan: `ee/docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam/`
- Source design: `docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam-design.md`
- Reviewed implementation range: `422df13c8..09f09a919` on `feature/algadesk-lightweight-ticketing`

## Summary

Remediate the current Algadesk product seam implementation so it satisfies the original product intent: Algadesk must be a coherent help-desk wedge product inside the existing Alga PSA app, with a real product entitlement boundary, a purpose-built Algadesk shell, server-side route/API enforcement, accurate metadata filtering, and confidence-building tests that compile and run.

The remediation job is not a second attempt to expand scope. It is a stabilization and correctness pass over work already implemented in the parent plan. The top priority is to fix blockers identified in review: typecheck failures, missing session product propagation, client-side-only route boundaries, API bypasses in overridden controllers, incomplete registry coverage, metadata leakage, overclaimed checklist status, and non-runnable or low-confidence tests.

## Original Product Intent to Preserve

Algadesk is an orthogonal product entitlement, not a new `solo | pro | premium` tier. It runs from the same codebase, Next.js app, database schema, and background-worker model as Alga PSA. The seam is product/licensing and composition, not a separate physical process.

Algadesk includes:

1. MSP dashboard focused on ticket and email health.
2. Ticket list/detail, comments, assignment, boards, statuses, priorities, categories, tags, response state, attachments, and email conversation context.
3. Clients, contacts, and locations needed for support.
4. Client portal dashboard, free-form tickets, ticket detail/replies, knowledge base, profile, and client settings.
5. Ticket attachments and knowledge base, but not full document management.
6. Email-to-ticket and ticket reply/update by email.
7. Users, teams, ticketing, email channel, client portal, and KB settings required for help desk operations.

Algadesk excludes in v1:

- Billing, invoices, quotes, contracts, contract lines, service catalog, tax/accounting exports.
- Projects and project tasks.
- Time entry, approvals, scheduling, dispatch, calendars.
- Assets/RMM/devices.
- Workflows/automation and service request forms.
- Surveys.
- Extensions framework and extension pages.
- AI/chat.
- Full integrations outside required email-channel paths.
- Full document management, folders, broad sharing, and project/client document surfaces.
- Broad reporting/platform/admin surfaces not required by help desk.

## Current Implementation State and Findings

The current branch contains substantial work: `product_code`, product constants, a registry, an Algadesk composition scaffold, dashboard/settings/ticket/client/portal/email/API boundary work, and many tests. However, review found it is not merge-ready.

### Confirmed blockers

1. **Typecheck fails.**
   - Command: `cd server && npm run typecheck -- --pretty false`
   - Failing files include:
     - `server/src/components/layout/SidebarWithFeatureFlags.tsx`
     - `server/src/types/next-auth.ts`
   - Root issue: product-specific NextAuth augmentation conflicts with `packages/auth/src/types/next-auth.ts`, and registry menu helper generics do not type cleanly with `NavigationSection`.

2. **Client product context defaults Algadesk users to PSA.**
   - `server/src/context/ProductContext.tsx` reads `session.user.product_code`.
   - `packages/auth/src/lib/nextAuthOptions.ts` fetches/maps `plan`, but not `product_code`.
   - Client components using `useProduct()` can expose PSA surfaces for Algadesk tenants.

3. **Algadesk MSP shell bypasses sidebar/header.**
   - `server/src/app/msp/MspLayoutClient.tsx` renders raw children inside `<div data-product-shell="algadesk">` for Algadesk.
   - This does not mount a real Algadesk sidebar/header/layout.

4. **Browser route boundary is client-side only.**
   - MSP and portal layout clients use `usePathname()` and render `ProductRouteBoundary` client-side.
   - Excluded server pages may still execute data fetching before the boundary UI appears.
   - Product boundaries must prevent excluded page execution server-side.

5. **API product enforcement is bypassed by overridden controllers.**
   - `ApiBaseController` checks product access in base CRUD methods.
   - Controllers with overridden methods, e.g. `ApiProjectController.list()`, authenticate and run without calling the product gate.
   - Product API enforcement must be unavoidable for controller-backed routes.

6. **Product registry is incomplete/inconsistent.**
   - Portal sidebar can show `/client-portal/client-settings`, but registry does not allow it.
   - `/msp/settings/*` handling is too broad; direct routes like notifications/extensions/integrations can leak.
   - API routes use mismatched paths, e.g. KB route is `/api/v1/kb-articles`, not `/api/v1/knowledge-base`.
   - Denylist misses multiple PSA route families.

7. **Metadata/OpenAPI filtering is partial.**
   - Endpoint paths are filtered in some places.
   - Schemas, permissions, stats, and other discovery data can still reveal PSA-only surfaces.

8. **Product-denied errors are not consistently mapped to 403.**
   - `ProductAccessError` uses `status = 403`.
   - Some API error handlers honor `statusCode`, so product denial can become 500.
   - Some route handlers catch product denial as generic errors.

9. **Test/checklist status is overclaimed.**
   - Parent `features.json` marks 356/356 implemented.
   - Parent `tests.json` marks 27/27 implemented.
   - This does not reflect current blockers.
   - Many tests are source-string contracts rather than behavior/integration tests matching their descriptions.

10. **There are unsafe/unrelated uncommitted changes.**
    - `.env.localtest` contains plaintext DB credentials and must not be committed.
    - `package-lock.json` has package version regressions and should be reviewed/reverted unless intentional.
    - Uncommitted contact-detail changes appear relevant, but must be isolated from unrelated local changes.

## Goals

1. Make the branch compile.
2. Make product entitlement available consistently on server and client session contexts.
3. Render a real Algadesk MSP shell with sidebar/header while avoiding full PSA cross-feature providers.
4. Enforce product route boundaries server-side before excluded page data fetching.
5. Make API product gates unavoidable for controller-backed and standalone API routes.
6. Complete and correct the product surface registry for browser, portal, API, settings, and metadata use cases.
7. Ensure ProductAccessError maps to structured 403 responses everywhere product guards are used.
8. Replace misleading or non-runnable tests with a small set of real confidence-building tests.
9. Correct the parent checklist status or explicitly annotate it as superseded by this remediation plan.
10. Preserve existing PSA behavior.

## Non-goals

1. Do not add new Algadesk product scope beyond the parent PRD.
2. Do not create a separate app, database, process, or repository.
3. Do not redesign ticketing, client portal, email, or API frameworks beyond what is needed for enforcement.
4. Do not strive for comprehensive test coverage.
5. Do not commit local secrets or incidental lockfile noise.
6. Do not mark remediation features/tests implemented until verified by compiling/running relevant checks.

## Target Users and Flows

### Remediation engineer

1. Starts from the current feature branch.
2. Cleans local/uncommitted noise.
3. Fixes compile/session/registry/enforcement blockers.
4. Runs targeted confidence-building tests.
5. Updates plan status honestly.
6. Hands off a branch that can be reviewed without hidden PSA leaks.

### Algadesk MSP user after remediation

1. Logs into an Algadesk tenant.
2. Sees an Algadesk-branded shell with help-desk navigation, not raw page content.
3. Can access dashboard, tickets, clients, contacts, KB, and allowed settings.
4. Direct hits to excluded PSA pages are blocked server-side before data fetching.

### Algadesk API consumer after remediation

1. Uses an API key for an Algadesk tenant.
2. Allowed APIs work.
3. PSA-only APIs fail with structured 403 product-denied responses even when a controller overrides base CRUD methods.
4. Metadata/OpenAPI/docs do not expose denied PSA paths, schemas, permissions, or misleading stats.

## Functional Requirements

### Hygiene and baseline

1. Keep remediation work isolated from local env and lockfile noise.
2. Do not commit `.env.localtest` credential changes.
3. Revert or justify `package-lock.json` version changes before merge.
4. Record current known blockers and commands in the remediation scratchpad.

### Type/session remediation

1. Define `product_code` in the shared NextAuth type augmentation used by both package and server consumers.
2. Remove conflicting duplicate declarations.
3. Fetch `product_code` with tenant subscription/product info.
4. Persist `product_code` onto JWT token on initial sign-in and refresh paths.
5. Copy `product_code` from JWT token into `session.user`.
6. Keep `plan`, addons, and trial fields unchanged.
7. Make `ProductProvider` resolve Algadesk correctly from session.
8. Add tests proving Algadesk sessions do not default to PSA.

### Algadesk shell remediation

1. Replace raw Algadesk children rendering with a real Algadesk shell.
2. Shell must include sidebar, header/app chrome, main content area, and product branding.
3. Shell must avoid full PSA providers for workflows, scheduling, projects, assets, SLA, surveys, extensions, and AI chat.
4. Sidebar filtering must typecheck and preserve PSA behavior.
5. Settings navigation must align with route registry and allowed tabs.

### Server route boundary remediation

1. Add server-side product route guard helpers.
2. Apply guards before excluded server page data fetching.
3. Ensure major excluded MSP routes render upgrade boundary or not-found according to registry.
4. Ensure major excluded portal routes render upgrade boundary or not-found according to registry.
5. Keep client-side boundary only as a secondary safety net, not primary enforcement.
6. Ensure allowed Algadesk pages still render their Algadesk compositions.

### Registry remediation

1. Correct MSP settings route and tab behavior.
2. Allow `/client-portal/client-settings` for Algadesk.
3. Deny excluded portal surfaces consistently.
4. Correct API allowed route names, especially `/api/v1/kb-articles`.
5. Add missing API deny groups for financial, quotes, contracts, contract-line variants, services/products, accounting exports, platform/admin, tenant management, feature flags, full documents, automation/workflows, AI/chat, assets/RMM, scheduling/time, projects, surveys, extensions, and broad integrations.
6. Add representative tests for exact paths and unknown path fail-closed behavior.

### API remediation

1. Move product API enforcement to a place every authenticated API controller path must pass, such as authentication/context creation or a required wrapper.
2. Audit overridden controllers and custom route handlers.
3. Add product guards to standalone API route handlers outside `ApiBaseController`.
4. Ensure denied Algadesk API requests return structured 403 responses.
5. Ensure allowed Algadesk APIs continue to work.
6. Ensure PSA APIs remain unchanged.

### Metadata/OpenAPI remediation

1. Filter endpoint path lists by product.
2. Filter OpenAPI paths by product.
3. Filter schemas/models where they only support denied endpoints.
4. Filter generated permission metadata by product.
5. Filter stats/counts so Algadesk metadata is not misleading.
6. Preserve full PSA metadata for PSA tenants.

### Product error remediation

1. Standardize product-denied errors on `statusCode = 403` and `code = PRODUCT_ACCESS_DENIED`.
2. Update `handleApiError` or error classes so both `status` and `statusCode` product errors map to 403.
3. Ensure standalone route handlers return 403 for product denial rather than 500.
4. Add tests around representative API and route handlers.

### Contact/detail and document leak remediation

1. Fold in the relevant uncommitted contact document hiding changes.
2. Ensure Algadesk contact detail does not fetch contact documents for `tab=documents`.
3. Ensure Algadesk contact detail does not render the Documents tab.
4. Preserve PSA contact document behavior.
5. Add behavior/component tests for both Algadesk and PSA contact detail.

### Test remediation

1. Fix existing runnable tests that fail before executing.
2. Fix Playwright T015 helper signatures and route assumptions.
3. Ensure DB-backed tests use real database behavior and clean up tenant data.
4. Downgrade or rewrite source-string contract tests whose names claim integration behavior.
5. Add a small number of high-confidence tests for compile/session/shell/route/API/metadata/portal/email behavior.
6. Do not mark remediation tests implemented until they are runnable or explicitly documented as requiring external DB/browser prerequisites.

### Plan/checklist remediation

1. Create this remediation plan as the source of truth for fixing the current branch.
2. Update the parent plan scratchpad to reference this remediation plan if desired.
3. Revisit parent `features.json` and `tests.json` implementation status after remediation, or explicitly mark the parent plan superseded for implementation tracking.
4. Keep remediation `features.json` and `tests.json` honest.

## Security / Permissions

1. Product access is a security boundary in addition to UI composition.
2. Algadesk must fail closed on unknown product, unknown route group, or unknown API group.
3. Algadesk API keys must not access denied PSA endpoints even with broad RBAC permissions.
4. Product-denied errors should not expose sensitive implementation details.
5. Route guards must prevent excluded page data fetching, not merely hide rendered output.

## Rollout / Migration Notes

1. Remediation should preserve the existing `product_code` migration if it is correct.
2. Existing tenants should remain PSA by default.
3. Ensure auth/session changes are backward-compatible for sessions without `product_code` during rollout.
4. If token/session refresh behavior means old sessions lack `product_code`, define fallback behavior and force refresh strategy.
5. Keep the final branch reviewable: one or more commits focused on remediation categories, not mixed with env/lockfile noise.

## Open Questions

1. Should route guarding be implemented through middleware using session token product_code, page-level server helpers, or both?
2. Should Algadesk shell reuse the existing Sidebar component with a minimal provider stack, or introduce a dedicated Algadesk shell component?
3. How aggressively should metadata schema filtering remove PSA models that are shared by allowed and denied routes?
4. Which existing source-contract tests should be retained as lightweight guardrails after behavior tests are added?
5. Should the parent plan's 356 implemented feature flags be reset, partially corrected, or left with a superseded note?

## Acceptance Criteria

1. `cd server && npm run typecheck -- --pretty false` passes.
2. Algadesk `product_code` is present in JWT/session and `useProduct()` resolves Algadesk correctly.
3. Algadesk MSP tenants see a real shell/sidebar/header with only allowed navigation.
4. Direct server-side access to representative excluded MSP and portal routes does not execute excluded page data fetching.
5. Representative overridden API controllers deny Algadesk access before returning PSA data.
6. Standalone denied API routes return structured 403 product-denied responses.
7. Metadata/OpenAPI/docs no longer expose denied Algadesk API paths and do not leak obvious PSA-only permissions/stats.
8. Contact documents are hidden and not fetched for Algadesk, while PSA behavior remains unchanged.
9. The highest-risk tests run or have clearly documented external prerequisites.
10. Parent plan status is reconciled or explicitly superseded by this remediation plan.
