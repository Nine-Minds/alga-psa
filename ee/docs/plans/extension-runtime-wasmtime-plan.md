# Extension Runtime Wasmtime Integration Plan

## Problem

The current EE Runner can serve static bundles, but executing dynamic JavaScript-based WebAssembly components fails because we do not yet supply the Wasmtime host plumbing that `componentize-js` expects. The runner must evolve into a capability-rich runtime that safely executes customer extensions, exposing the `alga:extension/*` interfaces while enforcing time, memory, and logging requirements.

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
