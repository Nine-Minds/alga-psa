# Extension Storage API Contract

This document defines the Phase 1 storage contract for EE extensions, covering resource hierarchy, operations, request/response models, and concurrency semantics. The contract is the basis for Runner host API implementation, REST proxy endpoints, and SDK support.

## Resource Hierarchy

```
tenant_id
  └─ extension_install_id
       └─ namespace (string ≤ 64 chars, lowercase slug, scoped to extension install)
            └─ key (string ≤ 128 chars, utf-8, forward-slash not allowed)
                 └─ record { revision, value, metadata, ttl_expires_at, created_at, updated_at }
```

- `tenant_id` — host-generated UUID; distribution key within Citus.
- `extension_install_id` — unique per tenant + extension version; used for capability scoping.
- `namespace` — logical buckets defined by extension manifests. Extensions may register up to 32 namespaces.
- `key` — unique within a namespace; combined with namespace and extension install forms the primary identifier.
- `record` — JSON document (`value`) plus optional `metadata` and housekeeping fields.

## Base Operations

| Operation | Capability | Description | Notes |
|-----------|------------|-------------|-------|
| `storage.put` | `alga.storage` | Upsert a record with optional optimistic concurrency | Rejects payloads > 64 KiB; increments `revision` |
| `storage.get` | `alga.storage` | Retrieve a single record by namespace/key | Supports conditional fetch if `If-Revision-Match` provided |
| `storage.list` | `alga.storage` | List records within a namespace, filtered by key prefix and metadata | Pagination via `cursor` |
| `storage.delete` | `alga.storage` | Delete a record, optionally using revision guard | No-op delete returns success |
| `storage.bulkPut` | `alga.storage` | Transactionally write ≤ 20 records | Each record subject to size/quota constraints |

Future operations (append log, blob handles) are out of scope for Phase 1.

## Request / Response Models

### `storage.put`

- Request body:
  ```jsonc
  {
    "namespace": "settings",
    "key": "invoice-defaults",
    "value": { /* JSON payload */ },
    "metadata": { "contentType": "application/json" },
    "ttlSeconds": 86400,
    "ifRevision": 12 // optional optimistic concurrency guard
  }
  ```
- Response:
  ```jsonc
  {
    "namespace": "settings",
    "key": "invoice-defaults",
    "revision": 13,
    "ttlExpiresAt": "2025-10-08T19:00:00Z",
    "createdAt": "2025-10-07T19:00:00Z",
    "updatedAt": "2025-10-08T18:59:59Z"
  }
  ```
- Errors:
  - `REVISION_MISMATCH` — request `ifRevision` does not match stored revision.
  - `QUOTA_EXCEEDED` — namespace or tenant quota hit.
  - `VALIDATION_FAILED` — JSON Schema validation error.

### `storage.get`

- Request query:
  ```
  namespace=settings&key=invoice-defaults
  ```
- Headers:
  - `If-Revision-Match` (optional) — fetch only if revision matches.
- Response body:
  ```jsonc
  {
    "namespace": "settings",
    "key": "invoice-defaults",
    "revision": 13,
    "value": { /* JSON payload */ },
    "metadata": { "contentType": "application/json" },
    "ttlExpiresAt": "2025-10-08T19:00:00Z",
    "createdAt": "2025-10-07T19:00:00Z",
    "updatedAt": "2025-10-08T18:59:59Z"
  }
  ```
- Errors:
  - `NOT_FOUND` — record missing or expired.
  - `REVISION_MISMATCH` — when `If-Revision-Match` fails.

### `storage.list`

- Request body:
  ```jsonc
  {
    "namespace": "settings",
    "cursor": "opaque-token", // optional
    "limit": 50,
    "keyPrefix": "invoice-",
    "includeMetadata": true
  }
  ```
- Response body:
  ```jsonc
  {
    "items": [
      {
        "namespace": "settings",
        "key": "invoice-defaults",
        "revision": 13,
        "value": { /* truncated unless includeValues true */ },
        "metadata": { "contentType": "application/json" }
      }
    ],
    "nextCursor": null
  }
  ```
- Notes:
  - Default limit 25; max limit 100.
  - Optional `includeValues` flag (default false) to omit large payloads when only keys needed.

### `storage.delete`

- Request body:
  ```jsonc
  {
    "namespace": "settings",
    "key": "invoice-defaults",
    "ifRevision": 13
  }
  ```
- Response: HTTP 204 with no body on success.
- Errors mirror `REVISION_MISMATCH` and `NOT_FOUND`.

### `storage.bulkPut`

- Request body:
  ```jsonc
  {
    "namespace": "settings",
    "items": [
      {
        "key": "invoice-defaults",
        "value": { /* JSON payload */ },
        "metadata": {},
        "ttlSeconds": 86400,
        "ifRevision": null
      }
    ]
  }
  ```
- Constraints:
  - Max 20 items per call, cumulative payload ≤ 512 KiB.
  - Fails fast with `BULK_PARTIAL_FAILURE` if any record violates validation/quota.
- Response mirrors `storage.put` for each item:
  ```jsonc
  {
    "items": [
      {
        "key": "invoice-defaults",
        "revision": 13,
        "ttlExpiresAt": "2025-10-08T19:00:00Z"
      }
    ]
  }
  ```

## Concurrency & Consistency

- Each record maintains a `revision` counter starting at 1. Writes increment revision atomically.
- `ifRevision` guards enforce optimistic concurrency; Runner returns `409 REVISION_MISMATCH` if mismatch.
- Reads are strongly consistent; `storage.get` returns the latest committed record.
- `storage.list` guarantees results consistent with the snapshot at query start (transactional).

## TTL and Expiration Semantics

- Extensions may set `ttlSeconds` (min 60, max 30 days). Absent TTL implies indefinite retention subject to quota.
- Expired records are soft-deleted on access (reads/writes) by the opportunistic cleanup hook.
- `ttlExpiresAt` is returned so clients can monitor refresh cycles.

## Error Codes (Shared)

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `REVISION_MISMATCH` | 409 | Optimistic concurrency failure |
| `QUOTA_EXCEEDED` | 429 | Namespace or tenant quota exceeded |
| `VALIDATION_FAILED` | 400 | JSON Schema validation error details |
| `NOT_FOUND` | 404 | Record not found or expired |
| `UNAUTHORIZED` | 403 | Missing `alga.storage` capability |
| `RATE_LIMITED` | 429 | Global rate limiting triggered |
| `INTERNAL_ERROR` | 500 | Unexpected server failure |

## Runner Integration Surface

- Internal endpoint: `POST /api/internal/ext-storage/install/{installId}` guarded by `RUNNER_STORAGE_API_TOKEN`.
- Body schema matches the contracts above with an added `operation` field (e.g., `{ "operation": "put", ... }`).
- Responses mirror the public REST endpoints so the runner can forward them directly to guest code.

## Open Items

- Define JSON Schema registration flow (see Phase 1 validation strategy).
- Confirm pagination cursor encoding (opaque Base64 vs. encrypted token).
- Decide SDK default behavior for `includeValues` on list (likely false).
