# Runner S3 Integration Guide

This document specifies how the Runner integrates with S3-compatible storage (e.g., MinIO) to fetch extension bundles by content hash and serve static UI assets.

Links:
- Overview: [ee/docs/extension-system/overview.md](ee/docs/extension-system/overview.md:1)
- Serving system: [ee/docs/extension-system/serving-system.md](ee/docs/extension-system/serving-system.md:1)

## Responsibilities

- Fetch and cache extension bundle by content hash:
  - Download canonical object from S3 at:
    - sha256/<content_hash>/bundle.tar.zst
    - sha256/<content_hash>/manifest.json
  - Verify integrity (content hash, size if provided), and only accept immutable artifacts.
- Serve extension UI assets:
  - Public base: ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/…
  - Static assets resolved from the unpacked bundle according to manifest.json (e.g., index.html, JS/CSS assets, media).
- Execution API:
  - Expose an HTTP endpoint to execute extension handlers when invoked by Gateway:
    - POST /v1/execute
  - Ensure runtime fetches entry.wasm (or equivalent) mapped by content_hash and reuses local cache.

## Configuration Parity with Server

The Runner should use the same S3 settings as the server for consistent access and path semantics.

Required environment variables:
- STORAGE_ENDPOINT: S3/MinIO endpoint (e.g., http://localhost:9000 for MinIO).
- STORAGE_BUCKET: Bucket name used to store bundles.
- STORAGE_REGION: Region string; for MinIO use a placeholder like us-east-1 unless configured otherwise.
- STORAGE_ACCESS_KEY: Access key.
- STORAGE_SECRET_KEY: Secret key.
- STORAGE_USE_PATH_STYLE: true to force path-style addressing for MinIO.
- STORAGE_TLS: Optional; set true if using HTTPS and the cert is trusted (otherwise provide appropriate trust settings).

Runner-specific:
- RUNNER_PUBLIC_BASE: Base URL path to serve UI (e.g., /runner).
- RUNNER_CACHE_DIR: Filesystem directory for caching fetched bundles (e.g., /var/cache/alga-runner or ./.cache/runner for local).
- RUNNER_MAX_CACHE_SIZE_BYTES: Optional LRU cap for cache eviction.
- RUNNER_OFFLINE: Optional; if true, disables network fetches and requires bundles to be pre-cached.

Server parity notes:
- The server writes bundles to canonical S3 paths under sha256/<hash>/. The Runner must only read from canonical locations and never mutate them.
- If the server enforces declaredHash, the Runner should assume sha256/<hash>/… objects are immutable.

## Cache Behavior and Integrity

- On first request for {extensionId, content_hash}:
  - Fetch sha256/<content_hash>/manifest.json, validate basic fields (extension, version, entry paths).
  - Fetch sha256/<content_hash>/bundle.tar.zst, verify sha256(content) equals content_hash.
  - Unpack into RUNNER_CACHE_DIR/<content_hash>/… with a marker indicating successful extraction (e.g., .ready).
- Subsequent requests:
  - Serve from cache if .ready is present.
  - For HTTP GETs of UI assets, set ETag to the content hash or the asset’s digest.
  - Respect If-None-Match and return 304 when ETag matches for immutable assets.
- Eviction:
  - If RUNNER_MAX_CACHE_SIZE_BYTES is set, implement LRU eviction of least-recently-used content hashes.

## HTTP Flows

- Execution (from Gateway to Runner):
  - POST /v1/execute
    - Body includes { extensionId, content_hash, handler, payload, tenant, … }.
    - Runner ensures bundle for content_hash is present (fetch+cache if missing), loads entry.wasm, and executes handler.

- UI (from Browser to Runner):
  - GET ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/index.html
  - GET ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/assets/<file>
  - The Runner maps the path to RUNNER_CACHE_DIR/<content_hash>/ui/… (or equivalent layout from the bundle).
  - Set headers:
    - Cache-Control: public, max-age=31536000, immutable (safe for immutable paths)
    - ETag: "<content_hash>" or strong per-asset digest
    - Content-Type: resolved from file extension

## Expected S3 Paths

Canonical objects written by the server:
- sha256/<hash>/bundle.tar.zst
- sha256/<hash>/manifest.json

The Runner must not depend on non-canonical staging keys; only canonical content-hash keys are considered valid.

## Immutability and Conditional Requests

- All content under sha256/<hash>/ is immutable.
- For GET of UI assets, use ETag based on content hash (or a per-file digest within the bundle).
- Honor If-None-Match to enable 304 responses and reduce bandwidth.
- Do not attempt to overwrite or delete S3 objects; cache management is local.

## Acceptance Checks (Local Runner with MinIO)

- With MinIO configured via STORAGE_* and path-style:
  - Given a content hash H from a finalized upload:
    - Runner fetches sha256/H/manifest.json and sha256/H/bundle.tar.zst.
    - Runner unpacks and serves UI at:
      - ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/H/index.html returns 200
      - Subsequent GETs with If-None-Match: "H" return 304
  - Execute flow:
    - POST /v1/execute with content_hash H executes against entry.wasm and returns a handler result or structured error.

## Notes

- entry.wasm resolution:
  - The manifest’s entry.wasm path is relative to the bundle root; ensure it is present after unpacking.
- Security:
  - Validate manifest format and restrict file types and paths during unpack to avoid path traversal.
  - Consider running Wasm in a sandbox with appropriate capabilities.
- Timeouts and retries:
  - On transient S3 errors, implement exponential backoff for fetches.
  - Fail closed if content hash validation fails.

## References

- Overview: [ee/docs/extension-system/overview.md](ee/docs/extension-system/overview.md:1)
- Serving system: [ee/docs/extension-system/serving-system.md](ee/docs/extension-system/serving-system.md:1)