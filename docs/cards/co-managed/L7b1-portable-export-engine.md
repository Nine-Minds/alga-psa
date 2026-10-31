# L7b1 — Portable export engine (records & files)
Reviewer question: "Can a customer admin export their workspace's records and files in a portable archive?"
Base: main @ 22d6e42ed4   Reference: `feature/co-managed-it @ 2d00cb6f0e` (base `7e8d87a948`), re-cut by path, never cherry-picked
Ticket: alga-2026-0002864   Design: docs/plans/2026-10-26-cm-l7b1-plan.md
Ships dark: every entry point sits behind the `co-managed` capability (`serves`).

## 1. Scope paths (owned)
| Path (glob) | Kind | Notes |
|---|---|---|
| `packages/co-managed/src/portableContributorRegistry.ts` | code | NEW. The contributor contract (references / columns / export / retain / validate) and registry |
| `packages/co-managed/src/portableCoreRegistry.ts` | code | NEW. Composition of the core contributors; L7b3 domains register here |
| `packages/co-managed/src/portable{Core,Work,Asset,Workflow}Export.ts` | code | contributors `core`, `work`, `assets`, `workflows` |
| `packages/co-managed/src/portable{Asset,Work,Workflow}Catalog.ts`, `portableRecordValidation.ts`, `portableMarkupReferences.ts`, `portableRichTextReferences.ts` | code | column/reference catalogs and validators |
| `packages/co-managed/src/portableWorkspaceGraph.ts` | code | REWRITTEN. Edges, collect, canonical digests, retain check |
| `packages/co-managed/src/portableWorkspaceManifest.ts` | code | REWRITTEN. Manifest v2 over registry sections, exclusions, optional vault |
| `packages/co-managed/src/portable{Archive,BlobStaging,Download,Export,NativeFilePath,Snapshot,TemporaryDirectory,Transfer}.ts` | code | format and safety primitives (restored, unchanged) |
| `ee/server/src/lib/co-managed/portable{WorkspaceExport,ExportHandler,VaultExport}.ts` | code | EE surface; coordinator is registry-driven |
| `ee/server/src/lib/credentials/portable.ts` | code | vault seal only (restore function dropped); KDF/cipher params recorded in the envelope |
| `packages/ee/src/lib/co-managed/portableExportHandler.ts` | code | CE stub: `available: false`, 404, never throws |
| `server/src/app/api/co-management/export/route.ts`, `server/src/app/msp/co-management/export/page.tsx`, `server/src/lib/actions/coManagedPortableExportActions.ts`, `server/src/components/co-managed/CoManagedPortableExport.tsx` | code | gated entry points |
| `server/src/lib/portableTemporaryRecovery.ts` | code | dead-but-tested (see section 3) |
| `server/src/middleware.ts` | code | exact-path API-key exemption for `/api/co-management/export` |
| `server/src/lib/productSurfaceRegistry.ts` | code | page rule `msp_co_management_export` and API rule `api_co_management_export` |
| `server/src/components/co-managed/CoManagedCustomerHome.tsx` | code | mounts the capability-gated export entry (customer side only) |
| `server/public/locales/en/msp/licensing.json` | i18n | `coManaged.portableExport.*` |
| `server/src/test/unit/product/coManagedPortable*.test.ts`| test | |
Shared files (hunk-level): `packages/co-managed/package.json` (+`@alga-psa/storage` dependency, no export-map change: callers use relative paths); `server/src/test/unit/capability/capabilityEntryPoints.contract.test.ts` (`EXPECTED_FAMILY_FILE_COUNTS` 10→11, 0→1, 16→17, 36→37).

## 2. Reference pull and divergences
| Reference | This card | Why |
|---|---|---|
| `portableWorkspaceExport.ts` imports each domain exporter and hand-builds sections | iterates `registry.list()`; knows no domain | the registry is the deliverable; L7b3 adds domains without touching the engine |
| per-domain `export*`/`retain*` public functions, payload wrapped with `capturedAt` + sha256 | functions are private; each contributor exposes `{records, annotations}` | digests are over canonical sorted-key JSON of records; no timestamps, so identical data digests identically |
| manifest v1: fixed sections (core, work, documents, assets, operational, workflows, engagement), conversation/supplemental/remote-meeting files | manifest v2: `sections[]` per contributor, `references[]` edges (resolved/external), `exclusions[]`, `blobs[]` | open set of domains |
| vault mandatory in the manifest | optional; absence recorded as `credential_vault` exclusion | a records-and-files export must not depend on it |
| vault envelope params implicit in code | `kdf` / `cipher` recorded in the envelope and checked by the manifest | reader never guesses |
| `portableWorkspaceGraph` validated 7 hard-wired sections | validates contributors' own declarations plus edges; undelivered parents are `external` | documents/time/meetings/conversations belong to L7b3 |
| `tenant-export-activities.ts`: `native_time_tracking_sessions` added to the table list | not ported; the file is unchanged versus main (no hook either) | time domain (L7b3). An earlier draft of this card added an ungated temp-dir sweep to every tenant export, deep-importing the package from the worker; removed: the export streams from the app replica, so the worker never creates portable temp dirs. L7b1 makes no change to `tenant-export-activities.ts`; the reference line was L7b3 time domain |
| Deep relative imports of `packages/co-managed/src/*` | consumers use `@alga-psa/co-managed/<subpath>` | package boundary; subpath exports added to `packages/co-managed/package.json` (portableExport, portableTransfer, portableSnapshot, portableTemporaryDirectory, portableWorkspaceGraph, portableCoreRegistry, portableContributorRegistry, portableArchive, portableWorkspaceManifest, portableDownload) |
| `middleware.ts` exemption | added, exact path `/api/co-management/export` | same as reference; the form POST is session-authenticated in-route |
| `productSurfaceRegistry.ts` | edited (earlier "do not edit" overridden by review): page `/msp/co-management/export` psa allowed / algadesk not_found / co_managed allowed; API `/api/co-management/export` psa allowed / algadesk denied / co_managed allowed | L4a shipped no rule; a co_managed customer otherwise gets not_found/denied. The capability gate still decides admission |
| route/page/action ungated by capability adapters; UI used `useProduct` | `capabilityRouteGuard` / `requireCapabilityForPage` / `requireCapabilityForAction` (`serves`); client `useCapability('co-managed')` | neutrality; `FORCE_CAPABILITIES=co-managed:off` gives 404 / notFound / not-found |
| `restorePortableCredentialVault`, `portableRestoreIdentity.ts`, `portableWorkflowHistory.ts`, all restore files | dropped | restore is out of scope |

## 3. Out of scope
| Behaviour | Owner |
|---|---|
| Any restore | later card |
| Time, schedule, meeting, conversation, document contributors and their files | L7b3 |
| initializeApp / job wiring | later card |
| Migrations, L7a tables, evidence/ledger/census scripts | none |
| `portableTemporaryRecovery.ts` is **dead but tested**: nothing starts it; `coManagedPortableTemporaryRecovery.test.ts` pins its behaviour so the wiring card inherits a proven sweeper | wiring card |
Dropped integration cases: `coManagedPortableEngagement`, `coManagedPortableOperational`, `coManagedPortableRemoteMeeting`, `coManagedPortableSupplementalFiles` `.cases.ts` (time, schedule, meeting, conversation and document domains — L7b3). Not ported either: the restore unit tests (`RestoreIdentity`, `WorkspaceRestore{Files,Records,Vault}`, `portableRestoreRecoverySchedule`, `portableRestoreUploadCleanupHandler`).
The Done-when list names three integration helpers (`coManagedPortable{Asset,Workflow,WorkspaceExport}Cases`); they need the L0–L6 schema-clone fixtures (`withVaultFixture`, relationships) and were not ported; see section 6.

## 4. Flag gating points
| Surface | Gate | Closed result |
|---|---|---|
| `POST /api/co-management/export` | `capabilityRouteGuard('co-managed', tenant, 'serves')`, tenant from the session | exact 404 body of a missing record; handler never runs |
| `/msp/co-management/export` page | `requireCapabilityForPage('co-managed', tenant, 'serves')` | `notFound()` |
| `getCoManagedPortableExportScreenAction` | `requireCapabilityForAction('co-managed', tenant, 'serves')` first statement | `CapabilityUnavailableError`, before any DB or actor work |
| `CoManagedPortableExportEntry` / `CoManagedFeatureBoundary` | `useCapability('co-managed')` | renders nothing; no nav entry for unserved tenants (mounted only in `CoManagedCustomerHome`, the customer side of `/msp/co-managed`; unserved tenants never reach that page) |
| CE build | `packages/ee/.../portableExportHandler.ts` | `available: false`; page renders an "unavailable" notice, route answers 404 JSON; never throws |
| Temporal worker | guarded `import()` of `portableTemporaryDirectory` | resolution or load failure is swallowed; no module-scope co-managed import |
The AST gate-coverage contract (`capabilityEntryPoints.contract.test.ts`) covers the route, page and action. The product-surface rules above admit the page and route for psa and co_managed products; the capability gate then decides per tenant.

## 5. Migrations
None.

## 6. Acceptance bar
Registry contract (stub + real asset contributor, bad contributors rejected), manifest round-trip and determinism, tenant isolation (every export read goes through `tenantDb` bound to the verified actor tenant; one allowlisted global read asserted against `tenantTableMetadata`), path safety, exclusions, gate (`FORCE_CAPABILITIES=co-managed:off`), worker boot, archive/transfer/download/temp-dir/records/vault units.
Archive: `alga-workspace-archive` v1 (magic header, scrypt, AES-256-GCM, 4 MiB frames; 1 TiB container, 64 MiB metadata, 100k blobs, 100k rows per table). Download is streamed from the app route with a size cap, not an S3 presign.
Vault: shipped as an optional, passphrase-encrypted envelope reusing `ee/server/src/lib/credentials/encryption.ts`; it needs no new table or EE config. When it cannot be produced the manifest records `credential_vault` as an exclusion and the export still succeeds.
Not run: DB-backed integration tests (no database reachable for this card: port 5472 belongs to another stack and rejects credentials). The vault-through-DB path (`exportCoManagedPortableVault`, `withCoManagedExportAdmin`, snapshot export) and the end-to-end `prepareCoManagedPortableWorkspaceExport` are therefore unexercised here.

## 9. Dependencies
Hard: L0a (`packages/co-managed`, capability adapters).   Soft: L0g. Consumers: L7b3 (domain contributors), restore.

## 10. LEVERAGE markers added/resolved
`grep -rn "LEVERAGE:" packages/co-managed/src/portable*`:
- pattern `portable-export-is-snapshot-retain` (x4): a contributor's export is its retain at the shared snapshot.
- pattern `portable-contributor-boilerplate` (x4): admission wrapper, permission check, tenantDb handle, JSON round-trip repeated per contributor.
- friction `global-table-read`: `tenantDb` refuses global tables; one allowlisted unscoped read.
- friction `manifest-inlines-records`: records inside the 64 MiB-capped manifest.
