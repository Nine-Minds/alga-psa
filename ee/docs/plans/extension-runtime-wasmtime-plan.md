# Extension Runtime Wasmtime Integration Plan

## Problem

The current EE Runner can serve static bundles, but executing dynamic JavaScript-based WebAssembly components fails because we do not yet supply the Wasmtime host plumbing that `componentize-js` expects. The runner must evolve into a capability-rich runtime that safely executes customer extensions, exposing the `alga:extension/*` interfaces while enforcing time, memory, and logging requirements.

Status update (2025-11-21):
- Runner now executes Component Model artifacts via Wasmtime; host APIs (context, logging, http.fetch, storage.kv, secrets) implemented in `ee/runner/src/engine/host_api.rs` and backed by install-scoped config/providers/secretEnvelope.
- Gateway sends componentized execute envelopes (no handler path) to `/v1/execute` with `content_hash`, `version_id`, config, providers, and secret envelopes.
- Remaining work: align WIT surface and capability list with manifest schema, add pool/limit tuning docs, and wire install_id propagation from gateway (open item A1 in alignment plan).

## Goals

1. Ship a Wasmtime-backed execution layer that instantiates Component Model artifacts produced by `componentize-js`.
2. Implement the host-side capability interfaces (context, logging, HTTP, storage, secrets, UI proxy) used by customer extensions.
3. Maintain the existing bundle fetch/cache flow while swapping in the new runtime for `POST /v1/execute`.
4. Provide guardrails (timeouts, memory caps, pooling allocator) and observability to debug tenant extensions.
5. Unblock the container integration test and future end-to-end scenarios.

## Relationship to 2025-10-29 Extension Runtime Plan

This execution plan supplies the engineering detail behind the [Extension Runtime Metadata & Secrets Delivery Plan](2025-10-29-extension-runtime-metadata-plan.md):

- **Phase 2 – Runner Component Host:** Sections 1–3 below map directly to the Phase 2 checklist (Wasmtime component APIs, host functions, secret envelope handling). When these tasks land we should check off the corresponding items in the master plan rather than treat them as already complete.
- **Phase 3 – SDK & Tooling:** The runtime capabilities implemented here are the backing services the SDK bindings use. Coordination with the SDK team ensures generated packages target the same WIT contracts.
- **Phase 4 – Rollout:** The integration/regression testing and observability work feed into the Phase 4 milestones before we invite partners onto the platform.

Keep both documents in sync: update the top-level plan as we complete milestones, and adjust this execution plan if the master roadmap changes.

## Non-Goals

- Porting the entire wasmCloud lattice (NATS control plane, host policy engine, etc.).
- Supporting arbitrary preview2 modules beyond the interfaces required for Alga PSA extensions.

## Approach

### 1. Prototype Runtime Host (Week 1)

- Build a standalone smoke test binary that:
  - Uses `wasmtime::component::Component` and `Linker`.
  - Hard-codes minimal host functions (`alga:extension/context`, `alga:extension/logging`).
  - Executes a sample handler produced by `componentize-js` and asserts the JSON response.
- Establish default limits (`MAX_LINEAR_MEMORY`, `MAX_COMPONENT_SIZE`, `MAX_COMPONENTS`) mirroring our docs.

### 2. Implement Capability Providers (Week 2)

- Map each interface to Rust implementations:
  - `context` → extracts request metadata supplied by the runner.
  - `logging` → forwards to `tracing`.
  - `http` → proxied via our allowlisted client.
  - `storage` / `secrets` → reuse existing service abstractions.
  - `ui-proxy` → bridge to iframe proxy routes.
- Write unit tests per capability (mocked backends) calling the provider functions directly.

### 3. Integrate With Runner ModuleLoader (Week 3)

- Extend `ModuleLoader::execute_handler` to:
  - Instantiate the component with the new runtime host.
  - Configure `PoolingAllocationConfig` and epoch-based timeouts.
  - Cleanly tear down the store per request to avoid cross-tenant state.
- Keep bundle fetching/caching unchanged.

### 4. Hardening & Observability (Week 4)

- Emit structured logs around handler execution (tenant, extension, duration).
- Surface capability calls (e.g., HTTP targets, storage keys) with sampling.
- Add guardrail tests:
  - Timeouts (long-running component).
  - Memory limit enforcement.
  - Capability denial (missing allowlist entry).

### 5. Integration & Regression Tests (Week 5)

- Update `runner_container_executes_dynamic_component`:
  - Expect the handler JSON body.
  - Optionally assert a log line shows the handler ran.
- Add Wasmtime host smoke tests to CI (no container) using the helper binary.
- Document how to generate fixture components and run tests locally.

## Phase 2 Execution Checklist (Secrets & Service Proxy)

We can now execute `componentize-js` artifacts in-process and inside the runner container. Phase 2 focuses on delivering secure metadata/secrets handling and the service proxy surface from the [metadata plan](2025-10-29-extension-runtime-metadata-plan.md). Use this checklist to track remaining work:

1. **Secret envelope flow**
   - [x] Exercise inline envelopes via `resolve_secret_material` unit tests (`secret_material_tests.rs`).
   - [x] Ensure component execution succeeds when `cap:secrets.get` is granted and returns `SecretError::Denied` otherwise (`wasmtime_host_smoke.rs`).
   - [ ] Add a runner integration test where `/v1/execute` receives a secret envelope, decrypts it, and the component echoes the value (future work once Vault wiring is ready).

2. **Service proxy capability**
   - [x] Ship sample component/UI showing `cap:http.fetch`, `cap:ui.proxy`, and secrets interplay (`sdk/samples/component/service-proxy-demo`, `sdk/samples/extension-ui/service-proxy-demo`).
   - [x] Teach the runtime bindings about `uiProxy.callRoute` so both `componentize-js` and custom hosts can invoke the proxy (`sdk/extension-runtime`).
   - [x] Implement the runner-side UI proxy forwarding logic, including capability enforcement and HTTP forwarding tests (`ee/runner/tests/wasmtime_host_smoke.rs`).
   - [ ] Add a container integration that exercises the proxy end-to-end against the gateway once the ext-proxy route is available.

3. **Gateway alignment**
   - [ ] Confirm `/api/ext-proxy/[extensionId]/...` emits the expected `endpoint: "ui-proxy:<route>"` shape and passes secret/config versions through headers.
   - [ ] Document the install config requirements (`ALGA_API_KEY` secret name, optional `algaApiBase`) for partner teams.

4. **Observability & redaction**
   - [x] Log capability usage with redacted identifiers (already available in `engine::loader` / `http::server`).
   - [ ] Capture proxy invocations (route, status) and extend structured logging so operators can audit service proxy usage without exposing payloads.

5. **Developer experience**
   - [x] Provide Vitest-friendly mock hosts in `@alga/extension-runtime` so SDK samples run without the runner.
   - [ ] Update SDK docs/tutorials to reference the new service proxy sample and outline the end-to-end flow (component → runner → Alga API → UI proxy).

Keep this checklist synchronized with the master metadata plan as we close the remaining gaps.

### Runtime environment configuration

The runner now expects explicit configuration when the UI proxy capability is enabled:

- `UI_PROXY_BASE_URL` (required): Base URL for forwarding `ui_proxy.call_route` requests, e.g. `http://localhost:3000/api/ui-proxy`. The runner appends `/<extensionId>/<route>` to this base when dispatching.
- `UI_PROXY_AUTH_KEY` (optional): Shared secret the runner includes as `x-runner-auth` when calling the gateway. Leave unset for unauthenticated proxies in development.
- `UI_PROXY_TIMEOUT_MS` (optional, default `5000`): Per-request timeout for proxy calls. Useful for tightening SLAs in QA.

Tests and docs should mention these vars so developers wire them before exercising the proxy path locally.

## Risks & Mitigations

- **Async/task model mismatch:** rely on the ComponentizeJS example host to mirror expectations and add integration tests early.
- **Capability complexity:** start with logging/context, iterate capability-by-capability to isolate issues.
- **Performance regression:** monitor heap and startup time after enabling pooling allocator; add metrics for component instantiation latency.

## Deliverables

- Updated runner runtime code with Wasmtime host integration.
- Capability provider modules with tests.
- Passing container integration test executing a dynamic component.
- Documentation describing runtime configuration and fixture regeneration.

## Success Criteria

- Extensions built with the Alga PSA toolchain execute successfully via `/v1/execute`.
- Container test verifies end-to-end dynamic execution.
- Runtime enforces configured limits and surfaces actionable logs/metrics.

## Status Tracking

- ✅ In-process Wasmtime smoke coverage via `ee/runner/tests/wasmtime_host_smoke.rs` ensures component handlers execute without Docker.
- ✅ Guardrail unit tests live in `ee/runner/src/engine/loader.rs` covering epoch timeouts and linear-memory caps; allowlist validation tests reside in `ee/runner/src/engine/host_api.rs`.
- ✅ Capability instrumentation now logs HTTP, storage, and secrets usage with redacted identifiers for observability.
- ✅ UI proxy host routes requests through the runner using `UI_PROXY_BASE_URL` + optional auth key; smoke tests cover success/denied paths.
