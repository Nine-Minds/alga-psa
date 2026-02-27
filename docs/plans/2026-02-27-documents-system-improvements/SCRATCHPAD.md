# Scratchpad — Documents System Improvements

- Plan slug: `2026-02-27-documents-system-improvements`
- Created: `2026-02-27`

## What This Is

Rolling notes for the 5-phase documents system overhaul: entity-scoped folders, visibility controls, folder templates, client portal documents hub, share URLs, and knowledge base foundation.

## Decisions

- (2026-02-27) **KB articles ARE documents** — `kb_articles` table extends `documents` via FK, not a parallel entity. Articles inherit versioning, block content, associations, tags, previews for free.
- (2026-02-27) **Lazy folder initialization** — Entity folders created on first document-tab access, not on entity creation. Avoids empty folder bloat.
- (2026-02-27) **`is_client_visible` defaults to `false`** — Existing documents remain invisible to client portal until explicitly toggled. Safe default.
- (2026-02-27) **Inline ticket doc display keeps current behavior** — Ticket docs shown on ticket detail regardless of `is_client_visible`. The flag only governs the Documents Hub.
- (2026-02-27) **Share URLs proxy through server** (not direct S3 presigned URLs) to maintain access logging and download counting.
- (2026-02-27) **Public share URLs are feasible** — `ee/server/src/lib/storage/s3-client.ts` already has `getPresignedGetUrl`/`getPresignedPutUrl` working for bundles/exports.
- (2026-02-27) **Dual KB pattern** — Internal (technicians) vs external (clients) KB with strict audience separation via `audience` column, following IT Glue/Hudu best practices.

## Discoveries / Constraints

- (2026-02-27) `document_folders` table has NO RLS policies — needs adding in Phase 1.
- (2026-02-27) `document_folders` unique constraint is `(tenant, folder_path)` — must be widened to include entity scope.
- (2026-02-27) Tag system already supports `'knowledge_base_article'` as `TaggedEntityType` in `shared/interfaces/tag.interfaces.ts`.
- (2026-02-27) Standard reference data seed (`server/seeds/dev/78_standard_reference_data.cjs`) already has "Knowledge Base" category with subcategories: FAQs, Self-Service Articles, Troubleshooting Guides.
- (2026-02-27) Client portal currently shows documents ONLY embedded in tickets (`getClientTicketDocuments`) and project tasks (`getClientTaskDocuments`). No standalone Documents page.
- (2026-02-27) Client portal nav is in `packages/client-portal/src/components/layout/ClientPortalLayout.tsx`.
- (2026-02-27) `documentActions.ts` is ~2900 lines — be careful with merge conflicts.
- (2026-02-27) **Inline Citus distribution pattern** — New tables use `distributeIfCitus(knex, tableName)` helper defined inline in each migration file. Called right after `createTable`. No separate `ee/server/migrations/citus/` files needed. Reference: `server/migrations/20260219000001_create_sla_policies.cjs`. No triggers allowed (Citus constraint).
- (2026-02-27) MinIO buckets already have public download access configured in docker-compose test setup.
- (2026-02-27) `document_associations` entity_type CHECK constraint has been expanded multiple times via migrations — any new entity types need a migration to update the CHECK.

- (2026-02-27) **Test infrastructure**: Vitest (not Jest) for unit + integration tests, Playwright for e2e. Three tiers:
  - **Tier 1 (Unit)**: Pure functions + mocked server actions via `vi.mock()`. Fast, no infra needed.
  - **Tier 2 (Component)**: `@vitest-environment jsdom` + `@testing-library/react`. All server calls mocked.
  - **Tier 3 (Integration)**: Real Postgres via `TestContext` + `createTestDbConnection()`. Drops/recreates test DB.
  - **Tier 4 (E2E)**: Playwright + real browser + real app. Existing document e2e tests: `document-crud-operations.playwright.test.ts`, `document-entity-associations.playwright.test.ts`, `document-permissions.playwright.test.ts`.
- (2026-02-27) **Vitest config**: `server/vitest.config.ts` has ~50 path aliases. Global setup mocks UI reflection + auth + translations.
- (2026-02-27) **Test helpers**: `server/test-utils/testContext.ts` (TestContext), `server/test-utils/dbConfig.ts` (createTestDbConnection), `ee/server/src/__tests__/utils/test-context-e2e.ts` (E2ETestContext).

## Commands / Runbooks

- Run CE migrations: `cd server && npx knex migrate:latest`
- Run EE/Citus migrations: `cd ee/server && npx knex migrate:latest`
- Run document tests: `npx jest --testPathPattern=document`

## Links / References

- Existing roadmap: `.ai/documentation_improvements/documents-system-roadmap.md`
- Implementation plan: `.ai/documentation_improvements/documents-improvements-plan.md`
- Key source files:
  - `packages/documents/src/actions/documentActions.ts` — core CRUD (~2900 lines)
  - `packages/documents/src/components/Documents.tsx` — main UI (folder mode + entity mode)
  - `packages/documents/src/components/FolderTreeView.tsx` — folder tree
  - `packages/types/src/interfaces/document.interface.ts` — type defs
  - `packages/client-portal/src/components/layout/ClientPortalLayout.tsx` — portal nav
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` — `getClientTicketDocuments`
  - `server/src/lib/utils/documentPermissionUtils.ts` — permission utils
  - `server/src/app/api/documents/view/[fileId]/route.ts` — file serving + permissions
  - `ee/server/src/lib/storage/s3-client.ts` — presigned URL support
  - `shared/interfaces/tag.interfaces.ts` — tag types (already has `knowledge_base_article`)
  - `server/seeds/dev/78_standard_reference_data.cjs` — KB categories already seeded

## Open Questions

- Should the client portal Documents page be behind a feature flag initially?
- Should folder templates be seeded with defaults (e.g., "MSP Client Default") or start empty?
- For KB articles, should `audience = 'public'` articles be accessible without any login at all (fully public)?

## Work Log

- (2026-02-27) **F001 implemented**: Added migration `server/migrations/20260227170000_add_entity_scope_to_document_folders.cjs` to add nullable `entity_id` (uuid) and `entity_type` (text) columns to `document_folders` with idempotent checks and inline `distributeIfCitus(knex, 'document_folders')` call.
