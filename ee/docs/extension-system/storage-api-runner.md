# Runner Host API Implementation Plan

This document captures the Runner changes required to expose the `alga.storage.*` host functions. The implementation now lives inside the existing host API module (`ee/runner/src/engine/host_api.rs`) so that storage primitives sit alongside logging and HTTP fetch.

## Module Structure

- `ee/runner/src/engine/loader.rs`
  - Extends the `Limits` store data to carry `HostExecutionContext` (tenant, extension, install ids).
  - Passes execution context from the HTTP server into the store before invoking the guest handler.
- `ee/runner/src/engine/host_api.rs`
  - Registers new `alga.storage.put/get/list/delete/bulk_put` imports.
  - Uses the shared `reqwest` client to call the storage service exposed by the host app.
  - Serializes guest requests/responses as JSON and streams them through wasm memory, mirroring `alga.http.fetch`.
- `ee/runner/src/http/server.rs`
  - Adds `install_id` (when provided) to the execution context forwarded to the engine.

## Runtime Configuration

- `STORAGE_API_BASE_URL` — base URL for the host-side storage API (e.g. `https://app.internal/api`).
- `RUNNER_STORAGE_API_TOKEN` — shared secret presented in the `x-runner-auth` header.
- Existing `HTTP_CLIENT` lazy singleton is reused for storage requests.

## Host API behaviour

- Each storage host function expects a JSON payload matching the TS contract (e.g. `{ "namespace": "settings", "key": "foo", ... }`).
- The helper `storage_request()` appends the `operation` field and POSTs to `/api/internal/ext-storage/install/{installId}`.
- Responses are returned to the guest as JSON. Errors bubble up as traps with descriptive messages (HTTP status + body).
- Host functions require an `install_id`; if the execution context is missing one the call fails with `install_id not available`.

## Follow-ups

- Capability gating: once the manifest pipeline surfaces granted capabilities to the runner, validate that the current extension install has `alga.storage` before forwarding requests.
- Structured metrics/logs: instrument the helper to emit operation/latency counters via `tracing` and Prometheus exporters.

## Host Function Signatures

```rust
pub async fn storage_put(ctx: &InvocationContext, request: PutRequest) -> Result<PutResponse, StorageError>;
pub async fn storage_get(ctx: &InvocationContext, request: GetRequest) -> Result<GetResponse, StorageError>;
pub async fn storage_list(ctx: &InvocationContext, request: ListRequest) -> Result<ListResponse, StorageError>;
pub async fn storage_delete(ctx: &InvocationContext, request: DeleteRequest) -> Result<(), StorageError>;
pub async fn storage_bulk_put(ctx: &InvocationContext, request: BulkPutRequest) -> Result<BulkPutResponse, StorageError>;
```

- Requests map 1:1 with JSON contract defined in [storage-api-contract.md](storage-api-contract.md).
- Responses include revision metadata as documented.
- `StorageError` enumerates domain errors: `Unauthorized`, `NamespaceDenied`, `RevisionMismatch`, `QuotaExceeded`, `ValidationFailed`, `NotFound`, `Transport`.

## Capability Enforcement

- `InvocationContext` includes manifest capabilities. Implement helper:

```rust
fn ensure_capability(ctx: &InvocationContext, namespace: &str, operation: StorageOperation) -> Result<(), StorageError>;
```

- `StorageOperation::Read` or `StorageOperation::Write`.
- Validates:
  - `alga.storage` present with namespace grant.
  - Operation permitted (`read` vs `write`).
  - Namespace declared in manifest; otherwise `NamespaceDenied`.
- Enforce maximum namespace count from manifest to prevent dynamic expansion.

## Request Flow

1. Host function receives WASI call, constructs internal request type.
2. `ensure_capability` validates access; failure short-circuits.
3. Populate tenant/install identifiers from `InvocationContext`.
4. Forward request to storage service client (Node API) via gRPC/HTTP.
5. Translate service response to host response, mapping errors appropriately.
6. Emit metrics (`storage_host_ops_total`, `storage_host_latency_seconds`) with labels: operation, result.
7. Log with structured fields (tenant hash, install id hash, namespace, operation, result).

## Concurrency & Retries

- Use Runner's shared async runtime; storage client should leverage connection pool with `max_conns = 10`.
- Retries:
  - Retry on transient network errors up to 2 times with exponential backoff (100ms base).
  - Do not retry on application errors (`RevisionMismatch`, `ValidationFailed`, etc.).
- Propagate `ifRevision` semantics to service; no local caching.

## Testing Strategy

- Unit tests for `ensure_capability` covering manifest permutations.
- Integration tests in Runner crate using mocked storage service (e.g., `tower::Service` stub).
- End-to-end tests as part of Phase 3 integration (Runner + storage service + database).

## Telemetry

- Metrics:
  - `storage_host_request_duration_seconds` (histogram).
  - `storage_host_inflight_requests`.
  - `storage_host_errors_total` with error code labels.
- Tracing:
  - Attach span `storage.host.<operation>`; include tenant/install hashed identifiers.
- Logging:
  - Success: debug level sampled.
  - Errors: warn with error code, namespace, op.

## Feature Flags & Rollout

- Guard host APIs behind `cfg(feature = "storage_api")` and runtime flag `storage_api_enabled`.
- Integrate with existing feature gate configuration service (environment-level toggle).
- For preview/beta, restrict to allowlisted extension IDs checked during capability validation.

## Dependencies

- Storage service client crate (Phase 3 service layer).
- Manifest capability metadata (ensured by existing registry).
- Telemetry infrastructure for metrics/traces.
