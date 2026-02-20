# Scratchpad — Storage Extraction & Phase 2 Cleanup

- Plan slug: `storage-extraction-and-phase2-cleanup`
- Created: `2026-02-19`

## What This Is

Rolling notes for the combined PR that finishes Phase 2 remainders and extracts `@alga-psa/storage` from `@alga-psa/documents`.

## Decisions

- (2026-02-19) Storage extraction scope: move file-storage infrastructure only (StorageService, providers, factory, config, types, FileStoreModel). Keep avatar utils + entity image service in documents -- they have circular deps with documentActions.
- (2026-02-19) The `storage/api/` subfolder (key-value storage service) is a DIFFERENT system from file StorageService. Leave it in documents for now -- it's unrelated to the cross-package violation problem.
- (2026-02-19) blocknoteUtils (formatting) is the cleanest extraction candidate (zero deps) but out of scope for this PR. Save for a separate `@alga-psa/formatting` extraction.
- (2026-02-19) Document-association migration: server version uses `BaseModel.getTenant()`, package version uses `requireTenantId()`. Tests mock DocumentAssociation directly -- need to update mock paths. The DocumentAssociation is not exported from `packages/documents/src/models/index.ts` barrel yet -- need to add export.
- (2026-02-19) Email shim: only 1 actual source caller (`surveyService.ts`). The rest are docs/README references (not real imports). Verify at implementation time.
- (2026-02-19) The `server/src/lib/storage/StorageService.ts` file also imports from `@alga-psa/documents` (StorageProviderFactory + generateStoragePath). This is a SEPARATE server-side StorageService wrapper that will need updating too.

## Discoveries / Constraints

- (2026-02-19) StorageService.ts has `@ts-nocheck` at line 1 -- intentional for sharp dynamic import.
- (2026-02-19) StorageService depends on `@alga-psa/event-bus/publishers` for workflow events -- the new storage package will need this dependency.
- (2026-02-19) StorageService depends on `@alga-psa/auth/getCurrentUser` -- import exists but only used in one internal path. Keep dependency.
- (2026-02-19) StorageProviderFactory uses dynamic import for S3 provider (EE only): `await import('./providers/S3StorageProvider')` -- no S3 provider file exists in CE, that's expected.
- (2026-02-19) `server/scripts/portal-domain-sessions-prune.ts` imports from `'server/src/lib/models/PortalDomainSessionToken'` -- this path doesn't exist anymore. The function is exported from `@alga-psa/auth`.
- (2026-02-19) FileStoreModel lives in `packages/documents/src/models/storage.ts` -- must move with StorageService since it's a direct dependency.
- (2026-02-19) External consumers of StorageService (outside documents): billing (1), client-portal (1), jobs (2), server (1) = 5 files.
- (2026-02-19) External consumers of StorageProviderFactory/generateStoragePath (via main documents index): server (3 files).
- (2026-02-19) External consumer of FileStore type: billing (1 file).

## Commands / Runbooks

```bash
# Verify build after changes
npm run build

# Check for remaining references to old paths
grep -r "from '@alga-psa/documents/storage" packages/ server/ ee/ --include="*.ts" --include="*.tsx"
grep -r "StorageProviderFactory.*from '@alga-psa/documents'" packages/ server/ ee/ --include="*.ts" --include="*.tsx"
grep -r "from '@alga-psa/documents/types/storage" packages/ server/ ee/ --include="*.ts" --include="*.tsx"

# Check no references remain to deleted files
grep -r "document-association" server/src/test/ --include="*.ts" --include="*.tsx"
grep -r "lib/models/PortalDomainSessionToken" server/ --include="*.ts"
grep -r "from '@/lib/email'" server/ --include="*.ts" --include="*.tsx"
grep -r "from '../lib/email'" server/ --include="*.ts" --include="*.tsx"
```

## Links / References

- Analysis source: `.ai/stale-code-and-cross-package-analysis.md`
- Previous cleanup plan: `docs/plans/2026-02-17-stale-code-cleanup-phases-2c-2f/`
- Storage source files: `packages/documents/src/storage/`
- Storage config: `packages/documents/src/config/storage.ts`
- Storage types: `packages/documents/src/types/storage.ts`
- Storage model: `packages/documents/src/models/storage.ts`

## Open Questions

- Should `server/src/lib/storage/StorageService.ts` (server-side wrapper around documents' StorageProviderFactory) also be updated or moved? It's a different file from the package StorageService. For this PR: just update its import from `@alga-psa/documents` to `@alga-psa/storage`.

## 2026-02-20 Updates
- F001: Updated `server/scripts/portal-domain-sessions-prune.ts` to import `pruneExpiredPortalDomainOtts` from `@alga-psa/auth` to fix broken path.
- F002: Exported `DocumentAssociation` from `packages/documents/src/models/index.ts` barrel for package consumers.
- F003: Updated `documentActions.upload.test.ts` to mock/import `DocumentAssociation` from `@alga-psa/documents/models/documentAssociation`.
- F004: Switched `documentPermissionsIntegration.test.ts` to import `DocumentAssociation` from the documents package model path.
- F005: Removed obsolete `server/src/models/document-association.ts` after test imports migrated.
- F006: Updated `server/src/services/surveyService.ts` to import `TenantEmailService` from `@alga-psa/email`.
- F007: Deleted `server/src/lib/email/index.ts` shim after confirming no source imports remain.
- F008: Created `packages/storage/package.json` scaffold with required dependencies and build/typecheck scripts.
- F009: Added `packages/storage/project.json` with `scope:storage` + `type:horizontal` tags.
- F010: Added `packages/storage/tsconfig.json` extending the root config.
- F011: Moved `packages/documents/src/types/storage.ts` to `packages/storage/src/types/storage.ts`.
- F012: Moved `packages/documents/src/config/storage.ts` to `packages/storage/src/config/storage.ts`.
- F013: Moved `StorageProvider` base class to `packages/storage/src/providers/StorageProvider.ts`.
- F014: Moved `LocalStorageProvider` to `packages/storage/src/providers/LocalStorageProvider.ts`.
- F015: Moved FileStoreModel (`models/storage.ts`) into `packages/storage/src/models/storage.ts`.
- F016: Moved `StorageProviderFactory.ts` into `packages/storage/src/StorageProviderFactory.ts`.
- F017: Moved `StorageService.ts` to `packages/storage/src/StorageService.ts`.
- F018: Fixed relative imports inside storage package files (`StorageProviderFactory`, `StorageService`, provider classes) after move.
- F019: Added `packages/storage/src/index.ts` barrel exporting storage services, models, config, and types.
- F020: Added `exports` map to `packages/storage/package.json` for storage subpath entrypoints.
- F021: Updated billing `invoiceJobActions.ts` to import `StorageService` from `@alga-psa/storage`.
- F022: Updated client portal `client-project-details.ts` to import `StorageService` from `@alga-psa/storage`.
- F023: Updated jobs `jobService.ts` to import `StorageService` from `@alga-psa/storage`.
- F024: Updated jobs `jobScheduler.ts` to import `StorageService` from `@alga-psa/storage`.
- F025: Updated `server/src/lib/imports/importActions.ts` to import `StorageService` from `@alga-psa/storage`.
- F026: Updated `server/src/services/pdf-generation.service.ts` to import storage helpers from `@alga-psa/storage`.
- F027: Updated documents view API route to import `StorageProviderFactory` from `@alga-psa/storage`.
- F028: Updated server wrapper `StorageService` to import storage helpers from `@alga-psa/storage`.
- F029: Updated billing `pdfGenerationService.ts` to import `FileStore` from `@alga-psa/storage/types/storage`.
- F030: Updated document handlers to import `StorageService` from `@alga-psa/storage/StorageService`.
- F031: Updated `fileActions.ts` to import `StorageService` from `@alga-psa/storage/StorageService`.
- F032: Updated `documentActions.ts` to import `StorageService` from `@alga-psa/storage/StorageService`.
- F033: Updated `entityImageService.ts` to import `StorageService` from `@alga-psa/storage/StorageService`.
- F034: Re-exported `StorageProviderFactory` and `generateStoragePath` from `@alga-psa/storage` in documents index.
- F035: Added documents package export for `./types/storage` and added thin re-export stubs for `StorageService` and storage types.
- F036: Added `@alga-psa/storage` dependency to `packages/documents/package.json`.
- F037: Added `@alga-psa/storage` dependency to billing, client-portal, and jobs package.json files.
- F038: Verified original storage implementation files removed from documents package; only thin re-export shims remain for compatibility.
- F039: Registered `@alga-psa/storage` path mappings in `tsconfig.base.json` (project.json already added earlier).
