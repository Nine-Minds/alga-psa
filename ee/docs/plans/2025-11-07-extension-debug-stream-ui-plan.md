# Extension Debug Stream UI Plan (EE Live Debug Console for Runner-Based Extensions)

## Overview

Introduce a first-class "Extension Debug Console" in Alga PSA EE that enables extension authors and internal engineers to observe live stdout/stderr and structured logs for their extensions, scoped to specific extension installs and request flows.

The console will:

- Stream debug events (stdout, stderr, structured logs) in near real time via WebSockets or Server-Sent Events (SSE).
- Correlate events with:
  - `extension_id`, `tenant_id`, `install_id`
  - `request_id`
  - `content_hash` / `version_id`
- Respect multi-tenant boundaries, capabilities, and security requirements.
- Be enabled and heavily constrained in dev/staging; opt-in and time-boxed in production.

This plan builds on the Wasmtime/component-based runner and the existing extension metadata + capability model.

## Goals

- [ ] Provide a dedicated EE UI page for extension debugging with live log streaming.
- [ ] Allow filtering by:
  - Specific request flow (`request_id`),
  - Extension/install,
  - Stream type (stdout, stderr, structured logs).
- [ ] Implement a runner-side debug event pipeline that captures guest stdout/stderr and host logging events in a structured and correlatable way.
- [ ] Enforce strong authorization and isolation: only appropriate users can see logs for a given tenant/extension.
- [ ] Gate the feature with environment flags and capabilities to avoid accidental leakage or resource abuse.

## Non-Goals

- Full-blown distributed tracing across all platform components.
- Long-term persistent log storage or historical search UI.
- Arbitrary tailing of all runner logs for all tenants from EE.
- Overriding the structured provider-based logging model (this feature complements it).

## Architecture

### 1. Debug Event Model

Define a structured debug event that the runner produces for any debuggable signal (stdout/stderr lines, extension log calls, critical host events):

```ts
type ExtDebugEvent = {
  ts: string; // ISO 8601
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  stream: 'stdout' | 'stderr' | 'log';
  tenantId?: string;
  extensionId?: string;
  installId?: string;
  requestId?: string;
  versionId?: string;
  contentHash?: string;

  // Raw or structured content
  message: string;
  fields?: Record<string, unknown>;

  // Safety/limits
  truncated?: boolean;
};
```

Key rules:

- Always include `extensionId` and `requestId` when available.
- Prefer including `tenantId` and `installId` for multi-tenant visibility and auth decisions.
- `message` is bounded in length; large payloads are truncated with `truncated=true`.
- No secrets: message content must not include decrypted secrets; rely on existing capabilities and filters.

### 2. Runner: Capturing stdout/stderr and Logs

Implement capture and routing inside the runner (Rust):

- Location:
  - [`ee/runner/src/engine/loader.rs`](ee/runner/src/engine/loader.rs)
  - [`ee/runner/src/engine/host_api.rs`](ee/runner/src/engine/host_api.rs) (for WIT logging interfaces)
  - New module: `ee/runner/src/engine/debug.rs` or `ee/runner/src/util/debug_stream.rs` for shared plumbing.

Core behaviors:

1. When instantiating a component for execution:
   - Initialize `HostExecutionContext` with:
     - `request_id`, `tenant_id`, `extension_id`, `install_id`, `version_id`, config, providers (already present conceptually).
   - Attach WASI stdout/stderr to custom sinks that:
     - Split by line or chunk.
     - Build `ExtDebugEvent` records with `stream: 'stdout' | 'stderr'`.
     - Dispatch to:
       - `tracing` (with target `ext.stdout` / `ext.stderr`),
       - The Redis publisher (see next section) when debug streaming is enabled.

2. For host-side WIT log functions (e.g. `alga.log` provider):
   - Generate `ExtDebugEvent` with `stream: 'log'` and appropriate `level`.
   - Dispatch similarly via `tracing` and the Redis publisher (when enabled).

3. Configuration:
   - Env flags:
     - `RUNNER_DEBUG_REDIS_URL`
     - `RUNNER_DEBUG_REDIS_STREAM_PREFIX`
     - `RUNNER_DEBUG_REDIS_MAXLEN`
     - `RUNNER_DEBUG_MAX_EVENT_BYTES` (per event cap)
   - Behavior when `RUNNER_DEBUG_REDIS_URL` is unset:
     - Continue emitting to `tracing` only (no debug stream fan-out).

### 3. Runner: Redis Debug Stream Publisher

Instead of an in-memory hub, the runner now serializes each `ExtDebugEvent` and appends it to a Redis Stream. Key points:

- Stream naming: `${RUNNER_DEBUG_REDIS_STREAM_PREFIX}{tenantId}:{extensionId}` (tenant falls back to `unknown` when unavailable).
- Command: `XADD <stream> MAXLEN ~ <maxLen> field value ...` with a small bounded payload.
- Each message includes the fields consumed by EE (`ts`, `level`, `stream`, `tenant`, `extension`, `install`, `request`, `version`, `content_hash`, `message`, `truncated`).
- If Redis is down, we log and drop events (mirroring logs via `tracing` so operators can still inspect pod logs).
- Future back-pressure: consider local ring buffer to avoid blocking extension execution if Redis is temporarily unavailable.

Security note:

- Redis credentials are provided via `RUNNER_DEBUG_REDIS_URL` (or a mounted secret). ACLs should scope the runner to `XADD` only for the debug keyspace.

### 4. EE Backend: WebSocket/SSE Proxy

Add an EE API endpoint that exposes a controlled live debug stream to authenticated users.

Suggested route:

- `ee/server/src/app/api/ext-debug/stream/route.ts` (Next.js App Router)
- URL example:
  - `/api/ext-debug/stream?extensionId=...&tenantId=...&installId=...&requestId=...`

Behavior:

1. Authentication:
   - Require standard session auth.
   - Confirm user has one of:
     - Internal operator role, or
     - Tenant admin for `tenantId`, or
     - Extension owner / partner developer tied to the specified extension/install.
   - Deny if user attempts to observe another tenant’s data.

2. Authorization:
   - Check:
     - The requested `extensionId` belongs to the caller’s accessible scope.
     - If `tenantId` is provided, it matches caller’s tenant context (unless internal).
     - Optional: extension manifest/capabilities include something like `cap:debug.logs` or a server-side allowlist for debug streaming.

3. Subscription handshake:
   - On connection:
     - Build a subscription filter object:
       - Always include `extensionId`.
       - Include `tenantId` / `installId` if supplied.
       - Include `requestId` if provided for per-flow focus.
     - Call runner internal API or RPC:
       - e.g., `POST /internal/runner/debug/subscribe` with filter and a signed token,
       - Runner returns `debug_session_id`.
     - Start a streaming loop that:
       - Pulls `ExtDebugEvent` from runner (via:
         - a streaming HTTP endpoint,
         - or a long-lived connection,
         - or a broker / message bus, depending on infra),
       - Forwards events to the client via WebSockets or SSE.

4. Transport details:

- Recommended for simplicity:
  - SSE for first implementation:
    - One-way stream, simple to proxy.
    - Events framed as `data: { ...ExtDebugEvent... }\n\n`.
  - WebSockets if bidirectional control desired later:
    - e.g., changing filters, pausing, etc.

5. Limits and lifecycle:

- Enforce:
  - Max session duration (e.g. 5–15 minutes; extendable).
  - Close stream when:
    - TTL exceeded,
    - User navigates away,
    - Runner cancels subscription.
- Provide:
  - `x-debug-truncated: true` or event-level `truncated` when server-side limits hit.
  - Clear documentation in UI when data may be incomplete.

### 5. EE UI: Extension Debug Console

Add a dedicated page that consumes the stream:

Suggested route:

- `/msp/extensions/[extensionId]/debug`
- For internal operators:
  - Additional entry: `/ee/extensions/[extensionId]/debug`

Features:

- Filters:
  - Extension (from URL).
  - Tenant/install (dropdown or inferred from context).
  - Request mode:
    - “All requests” for that extension/install.
    - “Specific request” by `requestId`.
- Stream viewer:
  - Connect/disconnect button.
  - Live log panel:
    - Color-coded:
      - stdout (neutral),
      - stderr (red),
      - structured logs (level-specific colors).
    - Shows timestamp and key metadata (tenant, install, req id).
  - Controls:
    - Pause/resume auto-scroll.
    - Toggle stdout/stderr/log.
    - Clear buffer.
- DX helpers:
  - Show “How to correlate” help:
    - e.g., “Use `request_id` from extension errors or logs to narrow to a single flow.”
  - For dev:
    - Example snippet for extension authors:
      - `logInfo("debug marker: X")` usage,
      - explaining how it appears in the console.

### 6. Capabilities, Flags, and Safety

To avoid accidental misuse:

- Capability gating:
  - Optionally require a capability at install/manifest level:
    - `cap:debug.logs` or similar; when absent, EE refuses debug sessions for that extension except for privileged internal users.
- Environment flags (runner + EE):
  - `RUNNER_DEBUG_REDIS_URL`
  - `RUNNER_DEBUG_REDIS_STREAM_PREFIX`
  - EE-side:
    - `EXT_DEBUG_UI_ENABLED`
- Rate limiting:
  - EE API-level rate limits per user/tenant.
  - Runner-level caps on sessions and throughput.
- Data retention:
  - By design, this feature is for *live* debugging:
    - Buffers are short-lived.
    - Persistent historical logs remain in standard infra (e.g. Loki/ELK) under operator control.

### 7. Implementation Phases

#### Phase 1 — Runner Event Capture

- [x] Implement `ExtDebugEvent` type and the Redis publisher in the runner.
  - Implemented in `ee/runner/src/engine/debug.rs` and `debug_redis.rs`.
- [x] Route:
  - WIT log provider calls to event producer.
    - Implemented in `ee/runner/src/engine/host_api.rs` to forward `log_info/log_warn/log_error` into Redis.
  - WASI stderr wired to event producer (initial implementation).
    - Implemented in `ee/runner/src/engine/loader.rs` via a custom `stderr` pipe that forwards guest stderr lines into Redis when enabled.
  - (Optional stdout mirroring remains off by default to avoid noise; can be added later if needed.)
- [ ] Add basic unit tests:
  - stdout/stderr captured and tagged with correct metadata.

#### Phase 2 — Internal Streaming API (Legacy)

- [ ] (Deprecated) The original SSE endpoint at `/internal/ext-debug/stream` has been removed now that Redis fan-out is the canonical path.
- [x] Implement EE backend `/api/ext-debug/stream`:
  - Implemented at `server/src/app/api/ext-debug/stream/route.ts`:
    - AuthN + AuthZ via existing helpers.
    - Forwards `extensionId`/`tenantId`/`installId`/`requestId` filter to runner using `x-ext-debug-filter`.
    - Relays SSE stream response directly to clients.
- [ ] Add integration tests / local harness:
  - Fake extension emitting stdout/structured logs.
  - Confirm events appear via `/api/ext-debug/stream`.

#### Phase 3 — EE Debug Console UI

- [x] Build `/msp/extensions/[extensionId]/debug` page:
  - Implemented at `server/src/app/msp/extensions/[extensionId]/debug/page.tsx`.
  - Connects to `/api/ext-debug/stream` using `EventSource`.
  - Supports filters for `tenantId`, `installId`, and `requestId`.
  - Renders a live console with:
    - stdout/stderr/log classification,
    - connection state,
    - auto-scroll toggle,
    - bounded history to avoid unbounded memory.
- [x] Add navigation entry points:
  - Implement by linking from the extensions settings UI at `/msp/settings?tab=extensions`:
    - For each extension row, add a "Debug Console" action targeting:
      - `/msp/extensions/{extensionId}/debug`
      - Optionally preserve `tenantId`/`installId` in query params.
    - This hooks the existing settings-based extensions screen (the canonical management surface) directly into the debug page for the selected extension.
- [x] Document how extension authors:
  - Inline help on the debug page explains:
    - Required runner configuration (`RUNNER_DEBUG_REDIS_URL`, stream prefix, Redis ACL credentials).
    - Using structured logging helpers instead of printing secrets.
    - Using `x-request-id` / `context.request_id` and filters to follow specific request flows.

#### Phase 4 — Hardening & Production Policy

- [ ] Add capability and tenant-scoped policy checks.
- [ ] Add robust truncation, redaction (optional regex-based guardrails), and audit logs:
  - Who opened debug sessions, for which extension/tenant, and when.
- [ ] Define environment policies:
  - Fully enabled in dev/staging.
  - In prod:
    - Off by default.
    - Can be enabled per tenant/extension with admin approval or for time-limited debugging.

#### Phase 5 — Distributed Event Bus (Redis Streams)

_Motivation: In production, Knative fans requests across runner pods. A Redis-backed fan-out ensures the debug console aggregates logs across all pods and avoids the Kourier routing issues we hit with `runner.msp.svc.cluster.local`._

- [ ] Provision a Redis cluster/namespace dedicated to short-lived “debug events” with strong authentication and TTL defaults (e.g., 15 min retention).
- [ ] Define stream partitioning: e.g., `ext-debug:<extension_id>` or sharded by `tenant_id:extension_id`. Document key structure, retention policy, and serialization (JSON `ExtDebugEvent`).
- [ ] Extend the runner:
  - Add optional `RUNNER_DEBUG_REDIS_URL`, `RUNNER_DEBUG_REDIS_STREAM_PREFIX`, `RUNNER_DEBUG_REDIS_MAXLEN` (and future TLS/password flags) env vars so operators can point at the shared Redis cluster without changing code.
  - On each event, enqueue to Redis Streams (or Pub/Sub) with bounded async buffering; Redis replaces the in-memory `DebugHub` entirely.
  - Tag events with a monotonic sequence (`xadd` ID) to preserve ordering.
  - Include metrics + back-pressure handling (drop oldest events, emit warnings) when Redis is unavailable.
- [ ] Reuse existing Redis stream plumbing where possible:
  - `server/src/lib/eventBus/index.ts` already manages `XADD`/`XREADGROUP`, consumer groups, trimming, and retry logic.
  - `shared/workflow/streams/redisStreamClient.ts` shows how to wrap publish/read/ack helpers.
  - Mirror those patterns for debug streams (new `DebugStreamClient`) instead of reinventing connection management.
- [ ] Build a lightweight “debug-stream fan-out” worker (can live inside the EE server or as a sidecar) that tails Redis Streams via consumer groups, applies filters server-side, and relays to subscribers.
- [ ] Security: reuse existing `x-runner-auth` token for publishing auth, and create a dedicated Redis ACL role that only allows XADD/XLEN on the debug keys.

#### Phase 6 — EE Proxy Migration to Redis Streams

- [ ] Update `/api/ext-debug/stream` so that, when the Redis-backed mode is enabled (`EXT_DEBUG_STREAM_MODE=redis`), it:
  - Validates the user/session as before.
  - Registers/updates a consumer group per `extensionId` (e.g., `ee-debug-ui`).
  - Issues `XREADGROUP` with filters (`tenantId`, `installId`, `requestId`) applied server-side before emitting SSE events.
  - Implements heartbeats + idempotent acking so abandoned sessions don’t stall the stream.
- [ ] Add multi-tenant scoping at the stream level by embedding tenant + install IDs in stream entries and filtering at the EE layer.
- [ ] Provide fallbacks: if Redis is unavailable, drop back to the legacy per-pod proxy with an explicit warning in the UI (“live stream limited to a single runner pod”).
- [ ] Update the debug console copy to explain that live events now aggregate across all runner replicas (when Redis mode is active).

#### Phase 7 — Remove Per-Pod Dependency & Operability

- [ ] Once the Redis path is proven in production, disable direct `/internal/ext-debug/stream` access from EE (keep it only for diagnostics).
- [ ] Simplify runner configuration: require either Redis streaming _or_ a dedicated `runner-private` ClusterIP if Redis is disabled, so we do not rely on Kourier host matching.
- [ ] Add observability:
  - Metrics for stream lag, consumer group backlog, dropped events.
  - Alerting when Redis retention drops events because of sustained back-pressure.
- [ ] Document upgrade/rollback steps so operators can toggle between legacy and Redis-backed streaming without dropping all sessions.

## Dependencies & Coordination

- Runner team:
  - Implement `ExtDebugEvent`, stdout/stderr capture, DebugHub, and internal streaming API.
- EE server/gateway team:
  - Add `/api/ext-debug/stream` with proper auth.
  - Wire request_id propagation end-to-end.
- Platform/Infrastructure:
  - Operate the Redis cluster/streams (Phase 5+) with appropriate ACLs, backups, and monitoring.
  - Expose a stable internal DNS name (or service) for the runner if Redis is disabled, so EE does not depend on Kourier host headers for intra-cluster calls.
- DX/Docs:
  - Update `ee/docs/extension-system/development_guide.md` and related docs to include:
    - How to use the debug console.
    - Expected constraints and policies.
- Security/compliance:
  - Review exposure model, logging content policies, and retention defaults.

## Summary

This plan introduces a focused, auth-aware Extension Debug Console within EE that streams live debug events from the Wasmtime-based runner, scoped by extension/install/request. It is:

- Concrete enough to implement incrementally.
- Safe for multi-tenant environments when flags and capabilities are observed.
- Highly valuable for extension authors who need real-time visibility into their code without direct infrastructure access.
