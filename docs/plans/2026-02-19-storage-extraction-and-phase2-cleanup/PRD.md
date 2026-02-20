# PRD — Storage Extraction & Phase 2 Cleanup

- Slug: `storage-extraction-and-phase2-cleanup`
- Date: `2026-02-19`
- Status: Draft
- Analysis source: `.ai/stale-code-and-cross-package-analysis.md`

## Summary

Single PR combining two concerns: (1) finish Phase 2 cleanup remainders (3 small mechanical fixes), and (2) extract `@alga-psa/storage` as a new horizontal package from `@alga-psa/documents`, eliminating ~10 cross-package violations where non-document packages import storage infrastructure from the documents domain package.

## Problem

**Phase 2 remainders:** Three leftover items from previous cleanup phases:
- A broken import in `portal-domain-sessions-prune.ts` (references deleted file)
- 2 test files still importing from a server-side model that should use the package equivalent
- 1 re-export shim (`server/src/lib/email/index.ts`) with 1 source-code caller that should import directly

**Storage in documents:** The `@alga-psa/documents` package houses generic file-storage infrastructure (StorageService, StorageProviderFactory, providers, config, types) that has nothing to do with the documents domain. Five packages (billing, client-portal, jobs, server) import storage from documents, creating cross-package coupling. Storage is a horizontal concern that should be its own package.

## Goals

1. Fix the 3 Phase 2 remainder items (broken import, stale test imports, email shim)
2. Create `@alga-psa/storage` package containing all file-storage infrastructure
3. Update all consumers (5 external + 5 documents-internal) to import from the new package
4. Add re-exports from `@alga-psa/documents` for backwards compatibility
5. Maintain build green throughout
6. Net reduction in cross-package violations

## Non-goals

- No extraction of avatar/image utilities (they depend on documentActions -- circular)
- No extraction of formatting utilities (blocknoteUtils -- separate future PR)
- No extraction of the key-value storage API (`storage/api/` -- different system entirely)
- No behavioral changes to any storage, email, or document functionality
- No new tests beyond verifying existing ones pass
- No Phase 2g (tax import porting) or Phase 3 work

## Users and Primary Flows

Developer experience improvement. No end-user flows affected. File uploads, downloads, image handling, email, and portal domain sessions continue to work identically.

## Requirements

### Functional Requirements

**Part A: Phase 2 Remainders**

- FR-01: Fix broken import in `server/scripts/portal-domain-sessions-prune.ts` -- change `'server/src/lib/models/PortalDomainSessionToken'` to `'@alga-psa/auth'`
- FR-02: Migrate 2 test files off `server/src/models/document-association.ts`:
  - `server/src/test/unit/documentActions.upload.test.ts` -- update mock to use `@alga-psa/documents/models/documentAssociation`
  - `server/src/test/integration/documentPermissionsIntegration.test.ts` -- update import to use `@alga-psa/documents/models/documentAssociation`
  - Add `DocumentAssociation` export to `packages/documents/src/models/index.ts` barrel
  - Delete `server/src/models/document-association.ts`
- FR-03: Update `server/src/services/surveyService.ts` to import from `@alga-psa/email` instead of `../lib/email`
  - Delete `server/src/lib/email/index.ts` if no remaining source-code callers
  - Keep `server/src/lib/email/README.md` if it exists (documentation only)

**Part B: Create `@alga-psa/storage` package**

- FR-04: Create `packages/storage/` with standard NX package scaffolding:
  - `package.json` with name `@alga-psa/storage`, dependencies on `@alga-psa/db`, `@alga-psa/core`, `@alga-psa/auth`, `@alga-psa/event-bus`, `@alga-psa/shared`, `@alga-psa/validation`
  - `project.json` with `tags: ["scope:storage", "type:horizontal"]`
  - `tsconfig.json` extending root
  - `src/index.ts` barrel file

- FR-05: Move these files from `packages/documents/src/` to `packages/storage/src/`:
  - `storage/StorageService.ts` -> `src/StorageService.ts`
  - `storage/StorageProviderFactory.ts` -> `src/StorageProviderFactory.ts`
  - `storage/providers/StorageProvider.ts` -> `src/providers/StorageProvider.ts`
  - `storage/providers/LocalStorageProvider.ts` -> `src/providers/LocalStorageProvider.ts`
  - `config/storage.ts` -> `src/config/storage.ts`
  - `types/storage.ts` -> `src/types/storage.ts`
  - `models/storage.ts` -> `src/models/storage.ts`

- FR-06: Update all internal imports within moved files to use relative paths within the new package

- FR-07: Set up `package.json` exports for the new package:
  - `.` -> main barrel (StorageService, StorageProviderFactory, generateStoragePath, types)
  - `./StorageService` -> `src/StorageService.ts`
  - `./types/storage` -> `src/types/storage.ts`
  - `./providers/StorageProvider` -> `src/providers/StorageProvider.ts`
  - `./config/storage` -> `src/config/storage.ts`

**Part C: Update consumers**

- FR-08: Update 5 external consumers of `StorageService` to import from `@alga-psa/storage/StorageService`:
  - `packages/billing/src/actions/invoiceJobActions.ts`
  - `packages/client-portal/src/actions/client-portal-actions/client-project-details.ts`
  - `packages/jobs/src/lib/jobService.ts`
  - `packages/jobs/src/lib/jobs/jobScheduler.ts`
  - `server/src/lib/imports/importActions.ts`

- FR-09: Update 3 server consumers of `StorageProviderFactory`/`generateStoragePath` to import from `@alga-psa/storage`:
  - `server/src/services/pdf-generation.service.ts`
  - `server/src/app/api/documents/view/[fileId]/route.ts`
  - `server/src/lib/storage/StorageService.ts`

- FR-10: Update 1 consumer of `FileStore` type to import from `@alga-psa/storage/types/storage`:
  - `packages/billing/src/services/pdfGenerationService.ts`

- FR-11: Update 5 documents-internal consumers to import from `@alga-psa/storage/StorageService` (or relative within-package path):
  - `packages/documents/src/handlers/OfficeDocumentHandler.ts`
  - `packages/documents/src/handlers/GenericFileDocumentHandler.ts`
  - `packages/documents/src/handlers/ImageDocumentHandler.ts`
  - `packages/documents/src/handlers/PDFDocumentHandler.ts`
  - `packages/documents/src/actions/file-actions/fileActions.ts`
  - `packages/documents/src/actions/documentActions.ts`

- FR-12: Update `packages/documents/src/lib/entityImageService.ts` -- it imports StorageService, update path to `@alga-psa/storage/StorageService`

**Part D: Backwards compatibility**

- FR-13: Add re-exports to `packages/documents/`:
  - In `src/index.ts`: re-export `StorageProviderFactory`, `generateStoragePath` from `@alga-psa/storage`
  - In `package.json` exports: keep `./storage/StorageService` pointing to `@alga-psa/storage/StorageService` (or re-export wrapper)
  - In `package.json` exports: keep `./types/storage` pointing to `@alga-psa/storage/types/storage` (or re-export wrapper)
- FR-14: Add `@alga-psa/storage` as dependency in `packages/documents/package.json`

### Non-functional Requirements

- Build must be green after the full PR
- No runtime behavioral changes to any storage, upload, download, or email functionality
- The `@alga-psa/storage` package must be tagged `type:horizontal` so the ESLint cross-package rule allows any package to import from it

## Data / API / Integrations

No database, API, or integration changes. The `external_files` table continues to be accessed via `FileStoreModel` -- just from a different package location.

## Security / Permissions

No security implications. All code changes are import-path redirections or file moves with identical implementations.

## Rollout / Migration

No migration needed. Changes are internal to the build system. Ship as a single branch merged to main.

The re-exports in `@alga-psa/documents` ensure any consumers we miss (or that are added between now and merge) continue to work.

## Open Questions

None -- all details verified via codebase analysis on 2026-02-19.

## Acceptance Criteria (Definition of Done)

1. `server/scripts/portal-domain-sessions-prune.ts` imports from `@alga-psa/auth` and compiles
2. `server/src/models/document-association.ts` is deleted; tests import from `@alga-psa/documents/models`
3. `server/src/lib/email/index.ts` is deleted; `surveyService.ts` imports from `@alga-psa/email`
4. `packages/storage/` exists with all 7 moved files
5. All 14 external + internal consumers updated to import from `@alga-psa/storage`
6. `@alga-psa/documents` re-exports storage symbols for backwards compatibility
7. `npm run build` passes
8. No new lint errors
