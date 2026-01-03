# Scratchpad — Extension Scheduler Host API

- Plan slug: `extension-scheduler-host-api`
- Created: `2026-01-02`

## What This Is

Rolling notes for implementing the scheduler host API capability. Captures discoveries, decisions, and implementation details.

## Decisions

- (2026-01-02) Use host API pattern (like `cap:http.fetch`, `cap:storage.kv`) rather than manifest-declared schedules — simpler conceptually, maximum flexibility for extension authors.
- (2026-01-02) Extensions reference endpoints by path (e.g., `/sync`) not UUID — server resolves path to `endpoint_id` using the installed version's endpoint table.
- (2026-01-02) Reuse existing `extensionScheduleActions.ts` logic — no duplication of validation, quotas, or job runner integration.

## Discoveries / Constraints

### Capability System

- (2026-01-02) Capabilities defined in `ee/server/src/lib/extensions/providers.ts`:
  ```typescript
  export const KNOWN_PROVIDER_CAPABILITIES = [
    'cap:context.read',
    'cap:secrets.get',
    'cap:http.fetch',
    'cap:storage.kv',
    'cap:log.emit',
    'cap:ui.proxy',
    'cap:user.read',
  ] as const;
  ```
- (2026-01-02) Default capabilities (always granted): `cap:context.read`, `cap:log.emit`, `cap:user.read`
- (2026-01-02) `isKnownCapability()` validates capability strings; `coerceProviders()` normalizes input

### Host Bindings Pattern

- (2026-01-02) SDK interface in `sdk/extension-runtime/src/index.ts`:
  ```typescript
  export interface HostBindings {
    context: { get(): Promise<ContextData> };
    secrets: SecretsHost;
    http: HttpHost;
    storage: StorageHost;
    logging: LoggingHost;
    uiProxy: UiProxyHost;
  }
  ```
- (2026-01-02) Extensions receive `HostBindings` as second argument to handler functions
- (2026-01-02) Runner implements these interfaces and communicates with host server

### Runner Execution Flow

- (2026-01-02) Runner backend defined in `ee/server/src/lib/extensions/runner/backend.ts`
- (2026-01-02) `RunnerExecutePayload` includes `providers?: unknown` array — this is how capabilities are communicated
- (2026-01-02) Runner receives `POST /v1/execute` with JSON payload including providers list
- (2026-01-02) Runner is responsible for implementing host bindings based on granted providers

### Existing Schedule Actions

- (2026-01-02) All CRUD in `ee/server/src/lib/actions/extensionScheduleActions.ts`:
  - `listExtensionSchedules(extensionId)` — list schedules for an install
  - `createExtensionSchedule(extensionId, input)` — create with validation
  - `updateExtensionSchedule(extensionId, scheduleId, input)` — update with reschedule logic
  - `deleteExtensionSchedule(extensionId, scheduleId)` — delete with job cancellation
  - `runExtensionScheduleNow(extensionId, scheduleId)` — immediate trigger
- (2026-01-02) Validation includes: cron format, timezone, endpoint ownership, quotas (50 max, 5-min minimum)
- (2026-01-02) Uses `ensureExtensionPermission()` for auth — we need equivalent for host API context

### Key Implementation Gap

- (2026-01-02) Current actions use `getCurrentUser()` and `hasPermission()` — host API calls come from Runner, not user session
- (2026-01-02) Need to create internal versions that accept install context directly (tenant_id, install_id) rather than deriving from user session
- (2026-01-02) Could wrap existing actions or create parallel internal functions

## Commands / Runbooks

- Validate plan: `python3 ~/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-01-02-extension-scheduler-host-api`

## Links / References

- Capability definitions: `ee/server/src/lib/extensions/providers.ts`
- SDK host bindings: `sdk/extension-runtime/src/index.ts`
- Runner backend: `ee/server/src/lib/extensions/runner/backend.ts`
- Schedule actions: `ee/server/src/lib/actions/extensionScheduleActions.ts`
- Sample extension using host APIs: `sdk/samples/component/service-proxy-demo/src/handler.ts`
- Parent plan (scheduled tasks): `ee/docs/plans/2026-01-01-extension-scheduled-tasks/`

## Implementation Notes

### Endpoint Resolution

Extensions will reference endpoints by path:
```typescript
await host.scheduler.create({ endpoint: '/sync', cron: '0 * * * *' });
```

Server-side resolution:
```sql
SELECT id FROM extension_api_endpoint
WHERE version_id = $versionId
  AND path = $path
  AND method IN ('GET', 'POST');
```

### Internal API vs Action Reuse

Two approaches for server-side handler:

**Option A: Internal HTTP API**
- Create `/api/internal/extensions/scheduler/*` routes
- Runner calls these with auth token identifying install
- Routes delegate to modified action functions

**Option B: Direct action adaptation**
- Create `*ForInstall` variants of existing actions
- Accept `(tenantId, installId, ...)` instead of using `getCurrentUser()`
- Runner calls these via RPC mechanism

Recommendation: Start with Option A for clearer separation; consider B if performance is an issue.

### Context Passing to Runner

The Runner receives execution context:
```typescript
{
  context: {
    tenant_id: string,
    registry_id: string,
    install_id: string,
    version_id: string,
    content_hash: string,
    // ...
  },
  providers: ['cap:scheduler.manage', ...],
  // ...
}
```

Runner can use `install_id` and `tenant_id` from context to scope all scheduler operations.

## Open Questions (Resolved)

- How does Runner currently call back to host for `cap:storage.kv`?
  - **Answer**: HTTP callback to internal API endpoint `/api/internal/ext-storage/install/[installId]`
  - Runner uses `STORAGE_API_BASE_URL` and `RUNNER_STORAGE_API_TOKEN` env vars
  - Auth via `x-runner-auth` header

- Should we expose `runNow()` via the host API, or is that admin-only?
  - **Answer**: Admin-only. Extensions should not be able to bypass scheduling.

- Do we need a `getEndpoints()` API so extensions can discover their own schedulable endpoints?
  - **Answer**: Yes! Added `getEndpoints()` to return all endpoints with `schedulable` flag.

## Implementation Summary (2026-01-02)

### Files Created/Modified

**Server-side:**
- `ee/server/src/lib/extensions/providers.ts` — Added `cap:scheduler.manage` to `KNOWN_PROVIDER_CAPABILITIES`
- `ee/server/src/lib/extensions/schedulerHostApi.ts` — New internal API for schedule operations
- `ee/server/src/app/api/internal/ext-scheduler/install/[installId]/route.ts` — Internal REST endpoint for Runner callbacks

**SDK:**
- `sdk/extension-runtime/src/index.ts` — Added `SchedulerHost` interface and all related types

**Runner (Rust):**
- `ee/runner/wit/extension-runner.wit` — Added scheduler types and interface
- `ee/runner/src/providers/mod.rs` — Added `CAP_SCHEDULER_MANAGE` constant
- `ee/runner/src/engine/host_api.rs` — Full scheduler host implementation with HTTP callbacks

**Sample Extension:**
- `sdk/samples/component/scheduler-demo/` — Full sample extension demonstrating:
  - Self-configuration on `/api/setup` endpoint
  - Listing schedules
  - Deleting schedules
  - Schedulable endpoints (`/api/status`, `/api/heartbeat`)

### Key Patterns Used

1. **HTTP Callback Pattern**: Runner uses HTTP POST to internal API (same as `cap:storage.kv`)
2. **Install Context**: Derived from install config lookup using `installId` in URL path
3. **Endpoint Resolution**: Extensions specify "METHOD /path", server resolves to `endpoint_id`
4. **Error Translation**: HTTP status codes mapped to WIT error enums

### Completed (2026-01-02)

All 84 features are now implemented:

- [x] F067: Expose metrics for scheduler API calls — Added OpenTelemetry metrics (counter, histogram, errors) to `schedulerHostApi.ts`
- [x] F071: Document scheduler host API in SDK documentation — Created comprehensive guide at `sdk/docs/guides/scheduler-host-api.md`
- [x] F080: Rate limiting on create/update operations via host API — Added in-memory sliding window rate limiter (10 ops/min) to internal API route

### Testing Notes

The Runner Rust code compiles successfully (`cargo check` passes).
Sample extension handler tests defined but require running in WASM context.
Full integration testing requires:
1. Install sample extension with `cap:scheduler.manage`
2. Call `/api/setup` endpoint
3. Verify schedules created in database and job runner
