# Enterprise Build Workflow: pack → sign → publish

This guide outlines the enterprise pipeline to build, package, sign, and publish extension bundles to S3-compatible storage (e.g., MinIO), and references related docs and APIs. Use the `alga` Client SDK CLI for packing, signing, and publishing.

References
- Development Guide: [ee/docs/extension-system/development_guide.md](ee/docs/extension-system/development_guide.md:1)
- Runner S3 Integration: [ee/docs/extension-system/runner-s3-integration.md](ee/docs/extension-system/runner-s3-integration.md:1)
- Upload Proxy API (streaming, 200 MiB cap): [ee/server/src/app/api/ext-bundles/upload-proxy/route.ts](ee/server/src/app/api/ext-bundles/upload-proxy/route.ts:1)
- Finalize API: [ee/server/src/app/api/ext-bundles/finalize/route.ts](ee/server/src/app/api/ext-bundles/finalize/route.ts:1)

## Objectives and Pipeline

The enterprise pipeline is responsible for taking a compiled extension, producing an integrity-verifiable bundle, optionally signing it, and publishing it to the canonical, immutable S3 location based on its content hash.

Stages:
1) Build: Produce compiled assets (e.g., entry.wasm, UI assets, manifest.json) in a dist directory.
2) Pack: Create bundle.tar.zst from the dist directory and compute sha256.
3) Sign (optional): Produce a SIGNATURE file tied to the bundle with the chosen algorithm.
4) Publish: Stream the bundle via upload‑proxy, then finalize with manifest/signature.

Output:
- S3 canonical objects are written to:
  - sha256/<hash>/bundle.tar.zst
  - sha256/<hash>/manifest.json

## Example Commands

Install the CLI (local dev):
- In the monorepo: `npm run build:sdk && npm -w sdk/alga-client-sdk link`
- Then run: `alga --help`

Assumptions:
- Your extension build outputs to ./my-extension/dist and includes manifest.json at that path.
- You have Node 18+ available.

- Pack
  alga pack ./my-extension/dist ./out/bundle.tar.zst

- Sign (optional; placeholder)
  alga sign ./out/bundle.tar.zst --algorithm cosign

- Publish
  alga publish --bundle ./out/bundle.tar.zst --manifest ./my-extension/dist/manifest.json --declared-hash <sha256>

Notes:
- The pack step writes a sidecar SHA file (bundle.sha256 or <basename>.sha256). You can use this value as the --declared-hash in publish to enforce integrity at the server.
- The sign step currently writes a placeholder SIGNATURE file next to the bundle. If provided to publish (via --signature and --signature-algorithm), it will be forwarded to finalize. Replace with real signing logic in your environment.

## Environment Requirements and Local MinIO

Server/Storage configuration (server process):
- STORAGE_S3_ENDPOINT: e.g., http://localhost:9000 (MinIO)
- STORAGE_S3_BUCKET: e.g., alga-bundles
- STORAGE_S3_REGION: e.g., us-east-1
- STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY: MinIO credentials
- STORAGE_S3_FORCE_PATH_STYLE: true (required for MinIO)
- STORAGE_S3_BUNDLE_BUCKET: optional separate bucket for bundles (required by server code in this setup)
- EXT_BUNDLES_ALLOW_INSECURE: true (for local/manual validation), or send header x-alga-admin: true
- RUNNER_* not required for publishing (see Runner doc for serving/execution config)

MinIO local setup:
- Run MinIO locally and create the configured bucket.
- Ensure path-style access and credentials align with the server config.
- Validate access using the E2E walkthrough: [ee/docs/extension-system/e2e-minio-walkthrough.md](ee/docs/extension-system/e2e-minio-walkthrough.md:1)

CLI (via alga-client-sdk):
- Pack: `alga pack <inputDir> <outputBundlePath>`
- Sign: `alga sign <bundlePath> --algorithm cosign|x509|pgp`
- Publish: `alga publish --bundle <bundle> --manifest <manifest.json> [...options]`

Auth for local/manual runs:
- Set ALGA_ADMIN_HEADER=true in the environment to automatically inject x-alga-admin: true on API calls from publish.ts.

## CI Example Outline

This is an outline; adapt to your CI system (GitHub Actions, GitLab CI, Jenkins, etc.).

Environment variables/secrets (CI):
- SERVER_BASE: Base URL of the server (e.g., https://ee.example.com or http://localhost:3000 in local CI)
- ALGA_ADMIN_HEADER=true (for non-production/internal pipelines only)
- STORAGE_* vars should be set on the server side; CI does not require them unless testing end-to-end with a local server+MinIO instance.

Pipeline steps:
- Step 1: Build extension
  - Run your package build (e.g., npm ci && npm run build) producing ./my-extension/dist with manifest.json.
- Step 2: Pack
  - alga pack ./my-extension/dist ./out/bundle.tar.zst
  - Extract the sha256 from ./out/bundle.sha256 for later steps (or capture console output).
- Step 3: Sign (optional)
  - alga sign ./out/bundle.tar.zst --algorithm cosign
  - Store SIGNATURE as an artifact if you need auditability.
-- Step 4: Publish
  - alga publish \
      --bundle ./out/bundle.tar.zst \
      --manifest ./my-extension/dist/manifest.json \
      --declared-hash <sha256> \
      --server "$SERVER_BASE" \
      --signature ./out/bundle.tar.zst.SIGNATURE \
      --signature-algorithm cosign
  - Parse the output JSON { extension, version, contentHash } for downstream steps or notifications.
- Step 5: Validate (optional)
  - Optionally perform a GET on server endpoints or MinIO to confirm the objects exist at sha256/<contentHash>/...
  - For end-to-end UI checks, consider a smoke test that loads the extension UI in a test environment.

## Notes and Best Practices

- Immutability:
  - Ensure published bundles are content-addressed via sha256; treat canonical paths as immutable.
- Caching:
  - Downstream Runner and browser clients should leverage immutable URLs and ETag/If-None-Match semantics for efficient serving. See: [ee/docs/extension-system/runner-s3-integration.md](ee/docs/extension-system/runner-s3-integration.md:1)
- Manifests:
  - Keep manifest.json minimal but sufficient: extension, version, entry.wasm path, and UI asset mapping. Validate JSON strictly in CI.
- Error handling:
  - The publish script prints detailed errors for initiate/PUT/finalize failures. Monitor CI logs and surface them in notifications.

## Related Docs

- Development Guide: [ee/docs/extension-system/development_guide.md](ee/docs/extension-system/development_guide.md:1)
- E2E Walkthrough (MinIO): [ee/docs/extension-system/e2e-minio-walkthrough.md](ee/docs/extension-system/e2e-minio-walkthrough.md:1)
- Runner S3 Integration: [ee/docs/extension-system/runner-s3-integration.md](ee/docs/extension-system/runner-s3-integration.md:1)
- Upload Proxy API: [ee/server/src/app/api/ext-bundles/upload-proxy/route.ts](ee/server/src/app/api/ext-bundles/upload-proxy/route.ts:1)
- Finalize API: [ee/server/src/app/api/ext-bundles/finalize/route.ts](ee/server/src/app/api/ext-bundles/finalize/route.ts:1)
