# Extension Upload Proxy and Streaming Plan

## Overview

- Replace browser → S3 direct uploads with a server‑proxied streaming upload.
- Stream request body from the browser into the app server and directly to S3 without buffering the whole file in memory or on disk.
- Reuse existing finalize path which validates, hashes from S3, and performs canonicalization and registry upsert.

## Goals

- [ ] Eliminate browser‑direct S3 PUTs for extension bundles.
- [ ] Stream uploads end‑to‑end (browser → server → S3) with minimal memory use.
- [ ] Maintain immutability via staging keys and copy‑on‑finalize to canonical.
- [ ] Keep current finalize flow and registry logic intact to reduce risk.
- [ ] Preserve current RBAC/rate‑limit patterns on API endpoints.

## Non‑Goals

- Multipart chunked upload UI with progress bars (can be a follow‑up).
- Altering registry or manifest validation semantics.
 

## Current State (as of 2025‑08‑21)

- Client component `ee/server/src/components/settings/extensions/InstallerPanel.tsx` calls server action `extInitiateUpload` to obtain a presigned S3 PUT URL and uploads the file directly from the browser to S3, then calls `extFinalizeUpload`.
- Server actions live in `ee/server/src/lib/actions/extBundleActions.ts` and handle presign, finalize, and abort.
- API routes under `ee/server/src/app/api/ext-bundles/*` provide HTTP surfaces for initiate, finalize, and abort with RBAC and rate limiting.
- Storage helpers under `ee/server/src/lib/storage/*` provide S3 client abstraction with streaming GET and streaming/small PUT.

Status update (2025-11-21):
- Streaming upload proxy is implemented at `server/src/app/api/ext-bundles/upload-proxy/route.ts` with rate limiting, size cap (200 MiB), and staging keys; browser-to-S3 direct PUTs are no longer required for the supported flow.
- Finalize/abort routes remain the same; copy-to-canonical continues to use `sha256/<hash>/bundle.tar.zst` layout.
- Installer UI still calls presign+finalize; need to confirm adoption of the new upload-proxy in UI/client actions.

## Risks and Considerations

- Large request bodies must be streamed; avoid buffering in Node runtime.
- Enforce size limits to prevent abuse and oversized uploads (200 MiB cap today).
- Ensure RBAC parity with existing endpoints (`x-alga-admin: true` or insecure bypass env for local/dev).
- Handle client aborts gracefully; partial S3 writes should fail cleanly without leaving garbage (PutObject is atomic; multipart may leave orphaned uploads in future work).
- Maintain immutability: use staging keys for uploads and copy to canonical on finalize as done today.

## Design Options Considered

1) Keep presigned PUT but proxy via service worker: rejected (still client→S3).
2) Add server route that uploads via SDK with buffering: rejected (memory pressure).
3) Add server route that streams request body into S3 PutObject: chosen (simple and streaming‑friendly). Future: upgrade to multipart lib for resilience and progress reporting.

## Chosen Design

- New route: `POST /api/ext-bundles/upload-proxy` (Node runtime)
  - Query params: `filename` (string), `size` (number), `declaredHash` (optional sha256 hex)
  - Headers: use `content-type` or default `application/octet-stream`; RBAC via `x-alga-admin: true` or insecure bypass env
  - Body: raw file bytes (ReadableStream)
  - Behavior:
    - Validate RBAC and rate limit (reuse existing helpers/patterns from initiate/finalize/abort routes)
    - Validate inputs and ensure `size` ≤ cap; optionally validate `content-length` if present
    - Compute a staging key: `sha256/_staging/<uuid>/bundle.tar.zst`
    - Stream `req.body` to S3 using `createS3BundleStore().putObject(key, nodeStream, { contentType, ifNoneMatch: '*' })`
    - Return `{ upload: { key, strategy: 'staging' }, filename, size }`
  - Errors: 400 BAD_REQUEST, 403 RBAC_FORBIDDEN, 429 RATE_LIMIT, 500 INTERNAL_ERROR (concise JSON)

- Client changes in `InstallerPanel.tsx`
  - Replace initiate + presigned PUT with a single `fetch('/api/ext-bundles/upload-proxy?...', { method: 'POST', body: file })`
  - Use returned `upload.key` then call `extFinalizeUpload({ key, size, ... })` as today
  - Keep MANIFEST_REQUIRED prompt behavior unchanged
  - Abort: only call `extAbortUpload` if we hold a staging key

## Phases and TODOs

### Phase 1 — Server Route Implementation

- [ ] Create `ee/server/src/app/api/ext-bundles/upload-proxy/route.ts` (Node runtime)
  - [ ] Reuse RBAC (insecure bypass + `x-alga-admin`) and rate limiting helpers from neighbors
  - [ ] Parse `filename`, `size`, optional `declaredHash` from query (or JSON with metadata, but prefer query + raw body for simplicity)
  - [ ] Validate `size` > 0 and ≤ 200 MiB cap
  - [ ] Validate `declaredHash` if provided (sha256 lowercase hex)
  - [ ] Determine `content-type` from request header, default to `application/octet-stream`
  - [ ] Convert `ReadableStream` → Node stream via `Readable.fromWeb(req.body!)`
  - [ ] Stream to S3 using `createS3BundleStore().putObject(key, stream, { contentType, ifNoneMatch: '*' })`
  - [ ] Return JSON `{ upload: { key, strategy: 'staging' }, filename, size }`
  - [ ] Structured logs: request, validation failures, success, and errors
  - [ ] Unit test for validation helpers where feasible; smoke test locally

### Phase 2 — Client Integration

- [ ] Update `ee/server/src/components/settings/extensions/InstallerPanel.tsx`
  - [ ] Remove presigned upload flow and all `extInitiateUpload` usage
  - [ ] Send `fetch('/api/ext-bundles/upload-proxy?filename=...&size=...', { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream', 'x-alga-admin': 'true' } })`
  - [ ] Parse response, get `upload.key`
  - [ ] Call `extFinalizeUpload({ key: upload.key, size: file.size })`
  - [ ] Preserve manifest prompt on MANIFEST_REQUIRED
  - [ ] On reset/cancel, call `extAbortUpload({ key })` if the key exists and is staging

### Phase 3 — Observability, Docs, and Rollout

- [ ] Add dashboard/log queries for `upload-proxy` success rate, latency, size distribution, error rates
- [ ] Update internal docs on the new flow
- [ ] Deploy and monitor in non‑prod, then prod
- [ ] Cleanup: remove presigned upload logic and dead code in UI
- [ ] Optional: remove/deprecate `initiate-upload` API route if not used elsewhere

## Endpoint Spec — `POST /api/ext-bundles/upload-proxy`

- Query
  - `filename`: string (required)
  - `size`: number (required; ≤ 200 MiB)
  - `declaredHash`: string (optional; sha256 hex)
- Headers
  - `content-type`: defaults to `application/octet-stream`
  - `x-alga-admin: true` (if insecure bypass not set)
  - `content-length`: optional; if present and numeric, cross‑check with `size`
- Body
  - Raw file bytes (ReadableStream)
- 200 Response
  - `{ upload: { key: string, strategy: 'staging' }, filename: string, size: number }`
- Errors
  - 400 `{ error, code: 'BAD_REQUEST' }`
  - 403 `{ error, code: 'RBAC_FORBIDDEN' }`
  - 429 `{ error, code: 'RATE_LIMIT' }`
  - 500 `{ error, code: 'INTERNAL_ERROR' }`

## Security & Compliance

- Reuse RBAC gate and rate limits to match existing endpoints.
- Keep size caps; optionally enforce content‑length vs provided `size` for consistency.
- Immutability ensured via staging writes and finalize COPY to canonical with If‑None‑Match semantics.
- Do not persist temp files; stream only.

## Observability

- Structured logs on route: request received, validation errors, S3 put start/end, duration, bytes uploaded, actor key, and result.
- Client: log which upload path is active and basic timings.
- Server: emit error codes consistent with existing ext‑bundles routes for centralized alerting.

## Rollback Plan

- Use standard deployment rollback to revert to the previous commit if issues are discovered post‑deployment.
- If the `initiate-upload` route was removed and needs restoration, revert the specific removal commit.
- No schema/data migrations involved.

## Acceptance Criteria

- [ ] Uploads succeed via proxy path across supported environments (dev/staging/prod) within file size cap.
- [ ] Memory profiles show no full‑file buffering on server for typical upload sizes.
- [ ] Finalize continues to function as before, including MANIFEST_REQUIRED behavior and registry updates.
- [ ] RBAC and rate limiting match current endpoints.
- [ ] Clear logs for success/failure and ability to attribute to proxy path.

## Future Enhancements

- Multipart upload for resilience, pause/resume, and progress reporting (`@aws-sdk/lib-storage`).
- Optional fast‑path: trust stream‑computed hash from proxy to skip rehashing in finalize (behind a flag, with safeguards).
- SSE/WebSocket progress channel for UI feedback on large uploads.
