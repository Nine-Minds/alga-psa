# MinIO E2E Walkthrough: Upload → Finalize → List

This document provides a concrete, step-by-step manual validation flow for uploading an extension bundle to S3-compatible storage (MinIO), finalizing the bundle, and verifying visibility in the Extensions list using the Install page UI.

Links to relevant routes and UI pages:
- Initiate upload API: [ee/server/src/app/api/ext-bundles/initiate-upload/route.ts](ee/server/src/app/api/ext-bundles/initiate-upload/route.ts:1)
- Finalize API: [ee/server/src/app/api/ext-bundles/finalize/route.ts](ee/server/src/app/api/ext-bundles/finalize/route.ts:1)
- Abort API: [ee/server/src/app/api/ext-bundles/abort/route.ts](ee/server/src/app/api/ext-bundles/abort/route.ts:1)
- Install UI page: [ee/server/src/app/msp/settings/extensions/install/page.tsx](ee/server/src/app/msp/settings/extensions/install/page.tsx:1)
- Extensions list UI: [ee/server/src/components/settings/extensions/Extensions.tsx](ee/server/src/components/settings/extensions/Extensions.tsx:1)

Prerequisites
- MinIO is running and accessible.
- The following environment variables are configured for the server:
  - STORAGE_* variables for S3/MinIO connectivity (endpoint, bucket, access key, secret, region, path-style).
  - EXT_BUNDLES_ALLOW_INSECURE=true for local RBAC bypass during manual validation, or alternatively set header x-alga-admin: true on requests.
- RUNNER_* variables are NOT required for this walkthrough.

Step 1 — Prepare a sample bundle.tar.zst and manifest.json
- Create a minimal manifest.json. Example:
  {
    "extension": "example.ext",
    "version": "1.0.0",
    "entry": {
      "wasm": "entry.wasm"
    },
    "ui": {
      "basePath": "/",
      "assets": []
    }
  }
- Prepare a bundle.tar.zst file that includes at least the files your manifest references, e.g. entry.wasm (can be a placeholder for this validation) and any UI assets. The file name must be bundle.tar.zst.

Step 2 — Use the Install Page UI
- Navigate to /msp/settings/extensions/install.
- Fill the fields:
  - File: Select your bundle.tar.zst.
  - declaredHash (optional): Provide a known sha256 of your bundle.tar.zst if you have precomputed it.
  - contentType: application/octet-stream.
  - cache-control (optional): e.g. public, max-age=31536000 (or leave empty).
  - Manifest JSON: Paste the minimal manifest from Step 1.

Step 3 — Initiate Upload
- Click the initiate/upload action in the UI.
- Verify a presigned URL is rendered (HTTP PUT URL to S3/MinIO), along with any required headers.

Step 4 — Upload to S3 (PUT)
- From the UI, trigger the upload of bundle.tar.zst to the provided presigned URL (HTTP PUT).
- Verify the UI status shows the object has been uploaded successfully (HTTP 200/204). If your UI shows progress or completion indicators, confirm they complete without error.

Step 5 — Finalize
- Click finalize in the UI.
- Verify the success payload includes:
  - extension: The extension identifier (e.g., example.ext).
  - version: The version from manifest.json (e.g., 1.0.0).
  - contentHash: The canonical sha256 hash computed by the server.
  - canonical key/path in S3 (see below).

Step 6 — Verify S3 Object in Canonical Location
- In MinIO UI or using an S3 client, verify the bundle is present at:
  sha256/<contentHash>/bundle.tar.zst
- If path-style addressing is required, ensure your client is configured accordingly.

Step 7 — Verify Manifest Copy
- Confirm manifest.json is duplicated at the canonical path alongside the bundle:
  sha256/<contentHash>/manifest.json

Step 8 — Verify in Extensions List
- Navigate to /msp/settings/extensions.
- Confirm the newly uploaded extension and version are visible in the list.

Step 9 — Abort Flow (Optional)
- To validate abort behavior, initiate an upload but do not finalize. Instead, trigger abort (either via UI if exposed, or via the API).
- Verify the staging path/object (non-canonical) is cleaned up or marked aborted per implementation, and that the canonical path is not created.

Troubleshooting
- 403 Forbidden (RBAC):
  - For local testing, set EXT_BUNDLES_ALLOW_INSECURE=true on the server.
  - Alternatively, send header x-alga-admin: true with requests (ensure your UI or HTTP client includes it).
- 429 Rate Limiting:
  - Retry after backoff. Confirm any rate-limit windows configured in the server.
- 400 Invalid manifest or hash:
  - Ensure manifest.json is valid JSON and includes the required fields (extension, version, entry.wasm path).
  - If declaredHash is provided, it must match the server-computed hash of the uploaded bundle.
- MinIO path-style issues:
  - Enable path-style addressing in clients (e.g., usePathStyle: true).
  - Verify endpoint and region values match your MinIO configuration.
  - Ensure bucket exists and credentials are correct.

References
- Initiate: [ee/server/src/app/api/ext-bundles/initiate-upload/route.ts](ee/server/src/app/api/ext-bundles/initiate-upload/route.ts:1)
- Finalize: [ee/server/src/app/api/ext-bundles/finalize/route.ts](ee/server/src/app/api/ext-bundles/finalize/route.ts:1)
- Abort: [ee/server/src/app/api/ext-bundles/abort/route.ts](ee/server/src/app/api/ext-bundles/abort/route.ts:1)
- Install UI: [ee/server/src/app/msp/settings/extensions/install/page.tsx](ee/server/src/app/msp/settings/extensions/install/page.tsx:1)
- Extensions list: [ee/server/src/components/settings/extensions/Extensions.tsx](ee/server/src/components/settings/extensions/Extensions.tsx:1)