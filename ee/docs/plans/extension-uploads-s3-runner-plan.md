# EE Plan: Extension Uploads via S3, Runner Wiring, and Developer Workflow

Status: Draft
Owner: Platform/EE
Last Updated: 2025-08-10

This plan implements admin upload/install of extensions to S3, verifies and registers them in the Registry v2, wires the Runner to fetch by content hash, and delivers a developer build/sign/publish workflow.

## Architecture References
- [ee/docs/extension-system/README.md](ee/docs/extension-system/README.md)
- [ee/docs/extension-system/overview.md](ee/docs/extension-system/overview.md)
- [ee/docs/extension-system/serving-system.md](ee/docs/extension-system/serving-system.md)
- [ee/docs/extension-system/development_guide.md](ee/docs/extension-system/development_guide.md)
- [ee/server/src/components/settings/extensions/Extensions.tsx](ee/server/src/components/settings/extensions/Extensions.tsx)
- [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38), [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45)
- Gateway scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)

## Deliverables
- S3-backed, content-addressed Bundle Store with immutability and pre-signed upload support
- Admin Upload/Install flow with verification and Registry v2 persistence
- Runner integration to fetch/serve bundles and UI by content hash
- Developer scripts for pack/sign/publish and updated documentation

Status update (2025-11-21):
- Bundle store and Runner integration are live: Runner serves ext-ui by content hash; gateway forwards execute payloads with content hash/version/config/providers/secretEnvelope.
- Upload proxy implemented at `server/src/app/api/ext-bundles/upload-proxy/route.ts` with streaming to S3 and 200 MiB cap; finalize/abort routes unchanged.
- Admin install UI exists; pack/sign/publish scripts shipped via `alga` client SDK; docs exist but need refresh for proxy adoption.

## Storage Layout (S3)
Content-addressed, write-once objects:

```
sha256/<content_hash>/
  ├── bundle.tar.zst
  ├── manifest.json        # optional duplicate for quick reads
  ├── entry.wasm           # optional duplicate
  └── precompiled/
      └── <target>.cwasm   # optional Wasmtime precompiled module
```

## Configuration (env)
- STORAGE_S3_ENDPOINT
- STORAGE_S3_ACCESS_KEY
- STORAGE_S3_SECRET_KEY
- STORAGE_S3_REGION
- STORAGE_S3_BUCKET
- STORAGE_S3_FORCE_PATH_STYLE (true for MinIO)
- BUNDLE_STORE_BASE (default: sha256/)
- RUNNER_BASE_URL, RUNNER_PUBLIC_BASE
- EXT_GATEWAY_TIMEOUT_MS
- SIGNING_TRUST_BUNDLE
- EXT_EGRESS_ALLOWLIST (Runner)

## Phased TODO by Milestone (Dependent Order)

Milestone naming:
- M1: Storage + Verification + Registry (server APIs stubbed)
- M2: Admin UI + API integration (end-to-end upload/install on MinIO)
- M3: Runner S3 integration (execute + serve UI)
- M4: Docs + Tooling finalized; E2E green

### M1 — Storage, Verification, Registry (foundations)
Prereqs: none

- [x] Storage: implement [ee/server/src/lib/storage/s3-client.ts](ee/server/src/lib/storage/s3-client.ts) using @aws-sdk/client-s3 and presigner
- [x] Storage: implement [ee/server/src/lib/storage/bundles/types.ts](ee/server/src/lib/storage/bundles/types.ts) (interfaces, key policy)
- [x] Storage: implement [ee/server/src/lib/storage/bundles/s3-bundle-store.ts](ee/server/src/lib/storage/bundles/s3-bundle-store.ts) (HEAD/GET/PUT, immutability, multipart)
- [x] Storage: unit tests against MinIO (pre-signed PUT/GET/HEAD, multipart happy/sad paths)
- [x] Verification: implement [ee/server/src/lib/extensions/bundles/verify.ts](ee/server/src/lib/extensions/bundles/verify.ts) (sha256, signature verify, size limits)
- [x] Manifest: implement [ee/server/src/lib/extensions/bundles/manifest.ts](ee/server/src/lib/extensions/bundles/manifest.ts) (schema validation, endpoint extraction)
- [x] Registry: extend [ee/server/src/lib/extensions/registry-v2.ts](ee/server/src/lib/extensions/registry-v2.ts) to create version with content_hash/runtime/ui/api
- [x] API scaffolds (stub only):
  - [x] Create [ee/server/src/app/api/ext-bundles/initiate-upload/route.ts](ee/server/src/app/api/ext-bundles/initiate-upload/route.ts) returning 501 Not Implemented
  - [x] Create [ee/server/src/app/api/ext-bundles/finalize/route.ts](ee/server/src/app/api/ext-bundles/finalize/route.ts) returning 501 Not Implemented
  - [x] Create [ee/server/src/app/api/ext-bundles/abort/route.ts](ee/server/src/app/api/ext-bundles/abort/route.ts) returning 501 Not Implemented

Exit criteria (unblock M2):
- [x] S3 bundle store passes unit tests and enforces immutability
- [x] verify.ts computes sha256 and validates signature with SIGNING_TRUST_BUNDLE
- [x] manifest.ts validates against v2 schema and extracts endpoints/ui
- [x] Registry writes succeed in isolation (unit/integration)

### M2 — Admin Upload APIs and Install UI (E2E on MinIO)
Prereqs: complete M1

- [x] API: implement [ee/server/src/app/api/ext-bundles/initiate-upload/route.ts](ee/server/src/app/api/ext-bundles/initiate-upload/route.ts) (pre-signed PUT/multipart, canonical key synthesis, immutability checks)
- [x] API: implement [ee/server/src/app/api/ext-bundles/finalize/route.ts](ee/server/src/app/api/ext-bundles/finalize/route.ts) (compute sha256 over S3 object, verify signature/manifest, write registry)
- [x] API: implement [ee/server/src/app/api/ext-bundles/abort/route.ts](ee/server/src/app/api/ext-bundles/abort/route.ts) (multipart cleanup)
- [x] Permissions/RBAC: admin-only access to ext-bundle endpoints and Install page
- [x] Observability: structured logs for upload → verify → registry writes
- [x] Limits/Policy: size caps, rate limits, and content-type checks
- [x] Admin UI: implement [ee/server/src/app/msp/settings/extensions/install/page.tsx](ee/server/src/app/msp/settings/extensions/install/page.tsx) (initiate → client S3 PUT → finalize)
- [ ] E2E: local MinIO flow (initiate → PUT → finalize) shows extension on list [ee/server/src/components/settings/extensions/Extensions.tsx](ee/server/src/components/settings/extensions/Extensions.tsx)

Exit criteria (unblock M3):
- [ ] Upload/install completes end-to-end on MinIO; registry reflects new version with content_hash
- [ ] Overwrite attempts rejected; logs and error messages clear
- [ ] Admin UI resilient to common errors (size exceeded, bad signature, bad manifest)

### M3 — Runner S3 Integration (execution + UI serving)
Prereqs: complete M2

- [ ] Runner: add S3 client and read-only bundle fetcher (code in Runner repo; mirrored config names)
- [ ] Runner: implement ensureModuleCached(content_hash) and ensureUiCached(content_hash)
- [ ] Runner: on cache miss, GET sha256/<hash>/entry.wasm or bundle.tar.zst; verify sha256 (+ signature); optionally precompile Wasmtime module
- [ ] Runner: serve UI at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...] with immutable headers
- [ ] Runner: integration test executing a sample extension and loading iframe UI
- [ ] Config parity checks between app and runner (S3, trust bundle, allowlist)

Exit criteria (unblock M4):
- [ ] Gateway → Runner request executes extension handler and returns normalized response
- [ ] Iframe loads from Runner at the content-addressed path and renders

### M4 — Developer Tooling, Docs, and Final E2E
Prereqs: complete M3

- [x] Dev Tooling: implement [ee/tools/ext-bundle/pack.ts](ee/tools/ext-bundle/pack.ts) (produce bundle.tar.zst + sha256)
- [x] Dev Tooling: implement [ee/tools/ext-bundle/sign.ts](ee/tools/ext-bundle/sign.ts)
- [x] Dev Tooling: implement [ee/tools/ext-bundle/publish.ts](ee/tools/ext-bundle/publish.ts) (call initiate, PUT, finalize)
- [ ] Docs: update [ee/docs/extension-system/development_guide.md](ee/docs/extension-system/development_guide.md) with pack/sign/publish flow
- [x] Docs: add [ee/docs/extension-system/enterprise-build-workflow.md](ee/docs/extension-system/enterprise-build-workflow.md)
- [ ] CI: example workflow build → pack → sign → publish (MinIO/env-specific)
- [ ] Security review: signature policy with SIGNING_TRUST_BUNDLE, egress allowlist, bucket IAM/ACL
- [ ] Final E2E: template extension from build to UI+API working through Gateway → Runner

## Acceptance Criteria
- Admin uploads bundle via install page and completes finalize; extension appears in list and is toggleable
- S3 contains bundle at sha256/<hash>/bundle.tar.zst; HEAD forbids overwrite attempts
- Registry version includes content_hash, runtime, ui entry, and api endpoints from manifest
- Runner fetches module/UI by content hash on cache miss and serves iframe at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/index.html
- Documentation includes developer workflow and CI examples; scripts run locally against MinIO

## Risks & Mitigations
- Large bundles exceed server limits → Prefer pre-signed PUT and multipart; tight server-side caps
- Signature ecosystem variance → Pluggable verifier; fail closed when trust bundle configured
- Config drift between app and runner → Shared config doc and parity checks in CI
- Overwrite/immutability violations → HEAD-before-write + optional bucket policy to deny overwrite
