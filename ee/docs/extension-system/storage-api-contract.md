# Extension Storage API Contract

> **Status:** Archived. The extension-scoped contract has been superseded by the tenant storage service.

The authoritative API contract, resource model, and request/response semantics are maintained in the [Alga Storage Service documentation](../../../docs/storage-system.md). That specification applies uniformly to extensions, workflows, and any other integration consuming the storage platform.

If you are migrating existing extension code:

- Remove any dependency on `extension_install_id` scoping—the service now keys data by tenant and namespace only.
- Adopt the optimistic concurrency and TTL guidance documented in the official spec.

Legacy details from the Phase 1 extension rollout are intentionally omitted here to avoid divergence from the shared platform documentation.

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
