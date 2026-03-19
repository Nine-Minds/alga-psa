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
- (2026-02-28) `packages/documents` local Vitest config only includes `tests/**/*.test.ts`; component tests under `packages/documents/src/components/*.test.tsx` are exercised via `server/vitest.config.ts` path aliases.

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

- (2026-02-28) **F094–F104 implemented**: Phase 5 knowledge base UI components:
  - F094: `KBArticleList` component with filterable article table (status, audience, type, search), pagination, bulk selection, archive/edit/publish actions.
  - F095: `KBArticleEditor` component wrapping `DocumentEditor` with KB metadata sidebar (title, slug, type, audience, category, review cycle).
  - F096: `KBPublishingControls` component for status transitions (Draft→Review→Published→Archived).
  - F097: `KBReviewDashboard` component showing articles awaiting review and overdue reviews.
  - F098: `KBCategoryTree` component for category navigation (reuses standard_categories).
  - F099: `KBStalenessBadge` component showing overdue/due soon review status.
  - F100: `ClientKBPage` component for client portal KB browsing with category sidebar, search, article cards.
  - F101: `ClientKBArticleView` component with read-only article rendering and "Was this helpful?" feedback buttons.
  - F102: KB section added to MSP navigation in `menuConfig.ts` with `/msp/knowledge-base` route.
  - F103: KB link added to client portal navigation in `ClientPortalLayout.tsx` with `/client-portal/knowledge-base` route.
  - F104: Article tagging integration via `TagManager` in `KBArticleEditor`, tag filter in `KBArticleFilters`, `tagIds` filter support in `getArticles()` query.
- (2026-02-28) **F076–F093 implemented**: Phase 5 knowledge base foundation (backend):
  - F076: Migration `20260228300000_create_kb_articles_table.cjs` with slug, article_type, audience, status, review cycle, view/feedback counts, category.
  - F077: Migration `20260228301000_create_kb_article_relations_table.cjs` for related/prerequisite/supersedes relationships.
  - F078: Migration `20260228302000_create_kb_article_templates_table.cjs` with BlockNote JSON template data.
  - F079: Migration `20260228303000_create_kb_article_reviewers_table.cjs` with review status tracking.
  - F080: Migration `20260228304000_add_phase5_kb_tables_rls_policies.cjs` with tenant isolation on all KB tables.
  - F081-F093: KB article actions in `packages/documents/src/actions/kbArticleActions.ts`: `createArticle()`, `updateArticle()`, `publishArticle()`, `archiveArticle()`, `submitForReview()`, `completeReview()`, `getArticles()`, `getArticle()`, `getStaleArticles()`, `recordArticleView()`, `recordArticleFeedback()`, `getArticleTemplates()`, `createArticleFromTicket()`.
- (2026-02-28) **F056–F074 implemented**: Phase 4 shareable document URLs:
  - F056: Migration `20260228200000_create_document_share_links_table.cjs` with token, share_type, password_hash, expiry, max_downloads, download_count, revocation tracking.
  - F057: Migration `20260228201000_create_document_share_access_log_table.cjs` with access logging (IP, user agent, access type, success/failure).
  - F058: Migration `20260228202000_add_phase4_document_share_tables_rls_policies.cjs` with tenant isolation policies.
  - F059-F062: Share link actions in `packages/documents/src/actions/shareLinkActions.ts`: `createShareLink()` with 256-bit token generation and bcrypt password hashing, `getShareLinksForDocument()`, `revokeShareLink()`, `validateShareToken()` using admin connection.
  - F063-F068: API route `server/src/app/api/share/[token]/route.ts` handles file download with password verification, portal auth check, access logging, download count increment, expiry/limit enforcement.
  - F067: API route `server/src/app/api/share/[token]/info/route.ts` returns document metadata without download.
  - F069-F070: Public share landing page at `server/src/app/share/[token]/page.tsx` with password input, download button, expiry/limit status.
  - F071-F072: `ShareLinkDialog` component for creating/managing share links with type selector, password input, expiry picker, max downloads, copy URL, revoke actions.
  - F073: Added `onShare` prop and Share button to `DocumentListView` actions column.
  - F074: Added `documentsWithShareLinks` prop and Link2 indicator icon next to document names.
- (2026-02-28) **F038–F040 implemented**: Phase 2 folder template management UI:
  - F038: `FolderTemplateList` component in `packages/documents/src/components/settings/` with templates grouped by entity type, default badges, set-default action, delete with confirmation, and edit callbacks.
  - F039: `FolderTemplateEditor` component with drag-and-drop folder reordering, add/remove folders at any depth, client visibility toggles per folder, save/cancel workflow.
  - F040: `DocumentTemplatesSettings` wraps list and editor with create/edit mode switching. Integrated into `SettingsPage.tsx` as "Document Templates" tab, added to `menuConfig.ts` under Work Management section.
  - Components exported via `packages/documents/src/components/settings/index.ts` and re-exported from main `packages/documents/src/components/index.ts`.
- (2026-02-28) **F049–F054 implemented**: Phase 3 client portal documents UI:
  - F049: New client portal documents page at `/client-portal/documents` (`server/src/app/client-portal/documents/page.tsx`).
  - F050: 'Documents' nav link added to `ClientPortalLayout.tsx` between Projects and Appointments.
  - F051: `ClientDocumentsPage` component with collapsible folder tree sidebar and responsive document grid.
  - F052: `FolderTreeNode` (read-only folder tree for portal) embedded in `ClientDocumentsPage`.
  - F053: `DocumentCard` component (view/download only, no edit/delete) with MIME type icons.
  - F054: Search filter in `ClientDocumentsPage`, folder path filtering, pagination controls.
  - Component exported via `packages/client-portal/src/components/index.ts`.
- (2026-02-28) **F043–F048, F055 implemented**: Phase 3 client portal document actions and API access:
  - F043: `getClientDocuments(page, limit, filters)` in `packages/client-portal/src/actions/client-portal-actions/client-documents.ts` with pagination, search, folder, and date filters. Aggregates documents across direct client associations, tickets, project tasks, and contracts.
  - F044: `getClientDocumentFolders()` returns folder tree of client-visible folders.
  - F045: `downloadClientDocument(documentId)` verifies `is_client_visible` and client ownership before allowing download.
  - F046: All client-documents actions wrapped in `withAuth()` enforcing `user_type === 'client'`.
  - F047: File view route extended to check `is_client_visible` for client users (Documents Hub access).
  - F048: File view route extended to support contract-associated document access via `billing_plans.company_id` check.
  - F055: Ticket inline documents bypass `is_client_visible` check (per PRD FR-3.10).
- (2026-02-28) **F041 implemented**: Updated `packages/documents/src/components/Documents.tsx` to call `ensureEntityFolders(entityId, entityType)` on mount when in entity mode (fire-and-forget, silent failure). This completes the lazy folder initialization integration so templates are applied on first Documents tab access.
- (2026-02-28) **F031–F037 implemented**: Phase 2 folder template actions completed:
  - F031: `updateFolderTemplate(templateId, data)` with partial updates (name/entityType/isDefault/items independently), default-template handoff, and atomic item replacement.
  - F032: `deleteFolderTemplate(templateId)` with `document:delete` permission enforcement and FK CASCADE cleanup.
  - F033: `setDefaultTemplate(templateId)` to mark template as default, unsetting previous default for same entity type.
  - F034: `applyTemplateToEntity(templateId, entityId, entityType)` to create entity-scoped folders from template items with idempotent skip of existing paths.
  - F035 & F036: `ensureEntityFolders(entityId, entityType)` now checks `document_entity_folder_init` tracker, applies default template on first access, and records initialization. Idempotent on subsequent calls.
  - F037: `uploadDocument()` now auto-files into first matching entity folder when `folder_path` not set and entity context exists (best-effort, never fails upload).
- (2026-03-01) **F030 implemented**: Added `createFolderTemplate(data)` to `packages/documents/src/actions/folderTemplateActions.ts` with `document:create` permission enforcement, input normalization (`name`, `entityType`, item paths), duplicate/parent-path validation, transactional template+item insertion, parent-child ID mapping via path depth sort, and default-template handoff (unset existing defaults for same entity type when creating `isDefault=true`).
- (2026-03-01) **F029 implemented**: Extended `packages/documents/src/actions/folderTemplateActions.ts` with `getFolderTemplate(templateId)` to fetch a tenant-scoped template plus ordered `document_folder_template_items`, returning `null` when not found and enforcing `document:read` permission + required `templateId` validation.
- (2026-03-01) **F028 implemented**: Added `packages/documents/src/actions/folderTemplateActions.ts` with `getFolderTemplates(entityType?)` (auth-wrapped, `document:read` permission gate, tenant-scoped query against `document_folder_templates`, optional `entity_type` filter, deterministic ordering by entity type/default/name). Exported via `packages/documents/src/actions/index.ts`.
- (2026-03-01) **F027 implemented**: Added migration `server/migrations/20260301100000_add_phase2_document_template_tables_rls_policies.cjs` to enable tenant RLS on `document_folder_templates`, `document_folder_template_items`, and `document_entity_folder_init`, creating idempotent `tenant_isolation_policy` (USING) and `tenant_isolation_insert_policy` (FOR INSERT WITH CHECK) per table with reversible down migration that drops policies and disables RLS.
- (2026-03-01) **F026 implemented**: Added migration `server/migrations/20260228103000_add_document_folder_templates_default_partial_unique_index.cjs` to enforce one default folder template per tenant + entity type via partial unique index `uq_doc_folder_templates_default_per_entity_type` on `(tenant, entity_type) WHERE is_default = true`, with idempotent table/column guards and reversible down migration.
- (2026-03-01) **F025 implemented**: Added migration `server/migrations/20260228102000_create_document_entity_folder_init_table.cjs` to create `document_entity_folder_init` with tenant-scoped composite PK (`tenant`, `entity_folder_init_id`), entity-scope uniqueness (`tenant`, `entity_type`, `entity_id`) for one-time initialization tracking, optional `initialized_from_template_id` FK, supporting indexes, and inline `distributeIfCitus(knex, 'document_entity_folder_init')`.
- (2026-03-01) **F024 implemented**: Added migration `server/migrations/20260228101000_create_document_folder_template_items_table.cjs` to create `document_folder_template_items` with tenant-scoped composite PK (`tenant`, `template_item_id`), template + parent item FKs (cascade delete), folder path uniqueness per template, per-item visibility + sort order metadata, supporting indexes, and inline `distributeIfCitus(knex, 'document_folder_template_items')`.
- (2026-03-01) **F023 implemented**: Added migration `server/migrations/20260228100000_create_document_folder_templates_table.cjs` to create `document_folder_templates` with tenant-scoped composite PK (`tenant`, `template_id`), `name`, `entity_type`, `is_default`, audit columns, supporting indexes/uniqueness, and inline `distributeIfCitus(knex, 'document_folder_templates')`.
- (2026-02-28) **F021 implemented**: Updated `packages/documents/src/actions/documentActions.ts` so `getFolderTree()` selects folder visibility metadata from explicit `document_folders` rows and threads it through `buildFolderTreeFromPaths`; updated `packages/documents/src/components/FolderTreeView.tsx` to render MSP-only disabled visibility indicators per folder via `showVisibilityIndicators`; wired `showVisibilityIndicators` from both `FolderTreeView` usages in `packages/documents/src/components/Documents.tsx`; added focused coverage in `packages/documents/src/components/FolderTreeView.visibility.test.tsx`.
- (2026-02-28) **F020 implemented**: Updated `packages/documents/src/components/DocumentStorageCard.tsx` to support MSP-only visibility controls (`showVisibilityControls`, `onToggleVisibility`, `isVisibilityUpdating`) with client/internal badge + `VisibilityToggle`; wired card-mode usage in `packages/documents/src/components/Documents.tsx` to hide controls for client users by checking `getCurrentUser().user_type`; added focused coverage in `packages/documents/src/components/DocumentStorageCard.visibility.test.tsx`.
- (2026-02-28) **F019 implemented**: Updated `packages/documents/src/components/DocumentListView.tsx` to render an MSP-only visibility column with client/internal badge and `VisibilityToggle`, added optimistic per-row toggle wiring in `packages/documents/src/components/Documents.tsx` via `toggleDocumentVisibility`, and added focused coverage in `packages/documents/src/components/DocumentListView.visibility.test.tsx` (visible in MSP context, hidden otherwise, disabled while updating).
- (2026-02-28) **F018 implemented**: Added `packages/documents/src/components/VisibilityToggle.tsx` (eye/eye-off icon toggle with accessible labels/pressed state), exported it from `packages/documents/src/components/index.ts`, and added focused component tests in `packages/documents/src/components/VisibilityToggle.test.tsx`.
- (2026-02-28) **F017 implemented**: Updated `packages/documents/src/components/FolderTreeView.tsx` to accept optional `entityId`/`entityType` props and load scoped trees via `getFolderTree(entityId ?? null, entityType ?? null)`; wired these props from both folder-mode and entity-mode `FolderTreeView` usages in `packages/documents/src/components/Documents.tsx`.
- (2026-02-28) **F016 implemented**: Updated `packages/documents/src/components/Documents.tsx` entity-mode layout to include `FolderTreeView` sidebar (collapsible, mirrored from folder mode) and added entity-mode folder-path filtering for `documentsToDisplay` so folder selection affects visible docs.
- (2026-02-28) **F015 implemented**: Added `ensureEntityFolders(entityId, entityType)` Phase 1 stub to `packages/documents/src/actions/documentActions.ts`; enforces `document:read` permission, validates both entity scope inputs are present, and returns empty `IFolderNode[]` pending Phase 2 template/init implementation.
- (2026-02-28) **F014 implemented**: Added `toggleFolderVisibility(folderId, isClientVisible, cascade?)` to `packages/documents/src/actions/documentActions.ts` with `document:update` permission enforcement, tenant-scoped folder update, optional cascade to folder/subfolder documents, and entity-aware cascade filtering (`whereExists` for scoped folders, `whereNotExists` for global-only folders).
- (2026-02-28) **F013 implemented**: Added `toggleDocumentVisibility(documentIds, isClientVisible)` to `packages/documents/src/actions/documentActions.ts` with `document:update` permission enforcement, tenant-scoped bulk `UPDATE` on `documents.is_client_visible`, empty-input no-op behavior (`0`), and updated `updated_at` stamping for modified rows.
- (2026-02-28) **F010 implemented**: Updated `packages/documents/src/actions/documentActions.ts` so `getFolderTree()` now treats no entity scope as global-only mode. Explicit folders are constrained to `entity_id IS NULL AND entity_type IS NULL`, and implicit/count queries exclude any documents with associations so entity-linked docs/folders do not leak into tenant-global tree results.
- (2026-02-28) **F009 implemented**: Updated `packages/documents/src/actions/documentActions.ts` so `getFolderTree()` now accepts optional `entityId`/`entityType`. When both are provided, explicit folders are filtered by `document_folders.entity_id/entity_type`, implicit folders are filtered via `document_associations` existence for the same entity scope, and folder counts are enriched using the same entity-scoped association constraint. This keeps tenant/global behavior unchanged while enabling entity-scoped folder trees for Phase 1.
- (2026-02-28) **F008 implemented**: Updated `packages/types/src/interfaces/document.interface.ts` to add `IDocumentFolder` (including `entity_id`, `entity_type`, `is_client_visible`) and expanded `IFolderNode` with optional `entity_id`, `entity_type`, and `is_client_visible` fields so folder action/UI contracts can carry Phase 1 entity scope + visibility metadata.
- (2026-02-27) **F007 implemented**: Updated `packages/types/src/interfaces/document.interface.ts` to add optional `is_client_visible` to `IDocument`, aligning shared type contracts with Phase 1 visibility schema changes and preventing type drift in actions/UI consuming document records.
- (2026-02-27) **F001 implemented**: Added migration `server/migrations/20260227170000_add_entity_scope_to_document_folders.cjs` to add nullable `entity_id` (uuid) and `entity_type` (text) columns to `document_folders` with idempotent checks and inline `distributeIfCitus(knex, 'document_folders')` call.
- (2026-02-27) **F002 implemented**: Added migration `server/migrations/20260227171000_expand_document_folder_uniqueness_to_entity_scope.cjs` to replace `(tenant, folder_path)` uniqueness with COALESCE-based entity-scoped uniqueness on `(tenant, folder_path, COALESCE(entity_id), COALESCE(entity_type))`, preserving global-folder behavior when entity scope is null.
- (2026-02-27) **F003 implemented**: Added migration `server/migrations/20260227172000_add_is_client_visible_to_documents.cjs` to add `documents.is_client_visible` as non-null boolean defaulting to `false`, with idempotent guards in both `up` and `down`.
- (2026-02-27) **F004 implemented**: Added migration `server/migrations/20260227173000_add_is_client_visible_to_document_folders.cjs` to add `document_folders.is_client_visible` as non-null boolean defaulting to `false`, with idempotent guards in both `up` and `down`.
- (2026-02-27) **F005 implemented**: Added migration `server/migrations/20260227174000_add_document_folders_rls_policies.cjs` to enable RLS on `document_folders` and enforce tenant isolation via `tenant_isolation_policy` (USING) and `tenant_isolation_insert_policy` (FOR INSERT WITH CHECK), with idempotent `DROP POLICY IF EXISTS` guards and reversible down migration.
- (2026-02-27) **F006 implemented**: Added migration `server/migrations/20260227175000_add_documents_client_visibility_partial_index.cjs` to create partial index `idx_documents_tenant_client_visible_true` on `documents(tenant, is_client_visible)` with predicate `WHERE is_client_visible = true`, guarded by idempotent table/column existence checks and reversible `DROP INDEX IF EXISTS` in down.

## Recent Validation

- (2026-03-01) **E2E tests implemented** (T020, T042-T045): Created `server/src/test/e2e/document-system.playwright.test.ts` with Playwright E2E tests for:
  - T020: Ticket detail page inline documents section shows all attached documents regardless of is_client_visible flag
  - T042: Create entity-scoped folders for client, upload document, toggle visibility, verify client portal Documents hub
  - T043: Generate public share link, open in incognito browser, verify download without auth
  - T044: Create KB article, publish with audience='client', verify client portal KB section with feedback buttons
  - T045: Configure folder template as default, open new client Documents tab, verify folders auto-created
- (2026-03-01) **Integration tests implemented** (T001-T006, T009-T013, T015-T019, T022-T028, T031-T039): Created integration test files:
  - `server/src/test/integration/documentEntityFolders.integration.test.ts` (T001-T006)
  - `server/src/test/integration/documentFolderTemplates.integration.test.ts` (T009-T013)
  - `server/src/test/integration/clientPortalDocuments.integration.test.ts` (T015-T019)
  - `server/src/test/integration/documentShareLinks.integration.test.ts` (T022-T028)
  - `server/src/test/integration/kbArticles.integration.test.ts` (T031-T039)
- (2026-02-28) **Component tests implemented** (T007, T008, T014, T021, T029, T030, T040, T041):
  - T007: Documents.drawer.test.tsx - "renders FolderTreeView sidebar in entity mode" (already existed)
  - T008: DocumentListView.visibility.test.tsx and VisibilityToggle.test.tsx (already existed)
  - T014: FolderTemplateEditor.test.tsx - template name, entity type, folder tree, visibility toggles
  - T021: ClientDocumentsPage.test.tsx - folder tree, document cards, search filter, view/download only
  - T029: ShareLinkDialog.test.tsx - share type selector, password input, expiry picker, existing links with copy/revoke
  - T030: page.test.tsx (share/[token]) - document info, download button, password input, expiry/limit messages
  - T040: KBArticleEditor.test.tsx - metadata sidebar, DocumentEditor wrapper, tags, statistics
  - T041: KBPublishingControls.test.tsx - status transitions (draft→review→published→archived)
- (2026-03-01) Ran focused unit coverage for template create/list/detail actions: `cd server && npx vitest run src/test/unit/documentFolderTemplateActions.test.ts --config vitest.config.ts` (pass, 10 tests).
- (2026-03-01) Ran focused unit coverage for template list/detail actions: `cd server && npx vitest run src/test/unit/documentFolderTemplateActions.test.ts --config vitest.config.ts` (pass, 7 tests).
- (2026-03-01) Ran focused unit coverage for template-list action: `cd server && npx vitest run src/test/unit/documentFolderTemplateActions.test.ts --config vitest.config.ts` (pass, 3 tests).
- (2026-03-01) Verified migration module exports load: `node -e "const m=require('./server/migrations/20260301100000_add_phase2_document_template_tables_rls_policies.cjs'); console.log(typeof m.up, typeof m.down);"` → `function function`.
- (2026-03-01) Verified migration module exports load: `node -e "const m=require('./server/migrations/20260228103000_add_document_folder_templates_default_partial_unique_index.cjs'); console.log(typeof m.up, typeof m.down);"` → `function function`.
- (2026-03-01) Verified migration module exports load: `node -e "const m=require('./server/migrations/20260228102000_create_document_entity_folder_init_table.cjs'); console.log(typeof m.up, typeof m.down);"` → `function function`.
- (2026-03-01) Verified migration module exports load: `node -e "const m=require('./server/migrations/20260228101000_create_document_folder_template_items_table.cjs'); console.log(typeof m.up, typeof m.down);"` → `function function`.
- (2026-03-01) Verified migration module exports load: `node -e "const m=require('./server/migrations/20260228100000_create_document_folder_templates_table.cjs'); console.log(typeof m.up, typeof m.down);"` → `function function`.
- (2026-02-28) Ran focused folder visibility indicator component tests: `cd server && npx vitest run ../packages/documents/src/components/FolderTreeView.visibility.test.tsx --config vitest.config.ts` (pass, 2 tests).
- (2026-02-28) Ran focused visibility component tests for list + card views: `cd server && npx vitest run ../packages/documents/src/components/DocumentStorageCard.visibility.test.tsx ../packages/documents/src/components/DocumentListView.visibility.test.tsx --config vitest.config.ts` (pass, 6 tests).
- (2026-02-28) Ran focused DocumentListView + VisibilityToggle component tests: `cd server && npx vitest run ../packages/documents/src/components/DocumentListView.visibility.test.tsx ../packages/documents/src/components/VisibilityToggle.test.tsx --config vitest.config.ts` (pass, 6 tests).
- (2026-02-28) Ran focused visibility toggle component tests: `cd server && npx vitest run ../packages/documents/src/components/VisibilityToggle.test.tsx --config vitest.config.ts` (pass, 3 tests).
- (2026-02-28) Re-ran focused entity-mode sidebar component test with entity scope prop assertions: `cd server && npx vitest run ../packages/documents/src/components/Documents.drawer.test.tsx -t "renders FolderTreeView sidebar in entity mode" --config vitest.config.ts` (pass, 1 test).
- (2026-02-28) Ran focused entity-mode sidebar component test: `cd server && npx vitest run ../packages/documents/src/components/Documents.drawer.test.tsx -t "renders FolderTreeView sidebar in entity mode" --config vitest.config.ts` (pass, 1 test).
- (2026-02-28) Re-ran folder operations unit suite after adding ensureEntityFolders stub coverage: `cd server && npx vitest run src/test/unit/documentFolderOperations.test.ts --config vitest.config.ts` (pass, 41/41).
- (2026-02-28) Ran folder operations unit suite after adding folder visibility toggle unit coverage: `cd server && npx vitest run src/test/unit/documentFolderOperations.test.ts --config vitest.config.ts` (pass, 38/38).
- (2026-02-28) Ran folder operations unit suite after adding bulk visibility toggle: `cd server && npx vitest run src/test/unit/documentFolderOperations.test.ts --config vitest.config.ts` (pass, 33/33).
- (2026-02-28) Re-ran unit tests for folder operations after global-only folder filtering updates: `cd server && npx vitest run src/test/unit/documentFolderOperations.test.ts --config vitest.config.ts` (pass, 30/30).
- (2026-02-28) Ran unit tests for folder operations: `cd server && npx vitest run src/test/unit/documentFolderOperations.test.ts --config vitest.config.ts` (pass, 30/30).
- (2026-02-28) Built types package successfully: `npx nx build @alga-psa/types`.
- (2026-02-27) Verified migration module exports load: `node -e "const m=require('./server/migrations/20260227174000_add_document_folders_rls_policies.cjs'); console.log(typeof m.up, typeof m.down);"` → `function function`.
- (2026-02-27) Verified migration module exports load: `node -e "const m=require('./server/migrations/20260227175000_add_documents_client_visibility_partial_index.cjs'); console.log(typeof m.up, typeof m.down);"` → `function function`.
