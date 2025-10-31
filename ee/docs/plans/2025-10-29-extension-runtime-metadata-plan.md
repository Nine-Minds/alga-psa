# Extension Runtime Metadata & Secrets Delivery Plan (Componentize-JS First)

## Overview

- Deliver tenant/install-scoped configuration and secrets (e.g., Alga API tokens) to Wasm extensions while keeping values encrypted at rest and never logging plaintext.
- Standardize extension builds on the Wasmtime component model and [`componentize-js`](https://github.com/bytecodealliance/componentize-js) so developers ship typed components instead of raw Wasm modules.
- Reuse the existing composite secret infrastructure (`shared/core/secretProvider`, Vault, Docker secrets per `docs/secrets_management.md`) for both control plane storage and Runner decryption.
- Treat host functionality (secrets, outbound HTTP, UI proxy calls) as declarative “capability providers” exposed via WIT, inspired by wasmCloud’s provider model.
- Provide an opinionated SDK pipeline in `./sdk` that wraps generated bindings so TypeScript developers can consume secrets/config without writing Rust or manual ABI glue, mirroring wasmCloud’s `wash` developer experience.

## Goals

- [ ] Define WIT worlds for Runner ↔ guest interactions (context, secrets, HTTP, storage, logging, UI proxy) and instantiate components via Wasmtime’s component APIs.
- [ ] Shape host functionality as modular capability providers with explicit manifests so extensions declare the providers they need at publish time.
- [ ] Integrate `componentize-js` (currently v0.19.3, released 2025-10-27 per `CHANGELOG.md`) into the build pipeline so JS/TS projects emit `.wasm` components with stable metadata.
- [ ] Publish SDK packages (initially JS/TS) generated from WIT so developers retrieve secrets via `await ctx.secrets.get(...)` with minimal boilerplate.
- [ ] Keep rotation fast: cache decrypted material briefly, respect version stamps, and rely on the composite secret provider as the system of record.

## Non-Goals

- Replacing the secret provider stack—Vault/Docker secrets remain authoritative; the Runner consumes its outputs.
- Shipping a JS VM in the Runner; extensions still compile to Wasm components using `componentize-js`.
- Solving deep observability/runbook requirements in this pass (tracked separately once the foundation ships).
- Providing backward compatibility adapters for legacy module-based extensions; the focus is the new component-based pipeline.

## Current State (2025-10-29)

- Runner request model (`ee/runner/src/models.rs`) lacks config/secret fields; host context in `ee/runner/src/engine/loader.rs` tracks IDs only.
- Host imports in `ee/runner/src/engine/host_api.rs` are hand-wired functions (logging, http, storage) built for module-style Wasmtime; no `alga.secrets` surface exists.
- Gateway proxy (`ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts`) forwards to `/v1/execute` without fetching install metadata or secrets.
- Control-plane services already depend on `shared/core/secretProvider.ts` to source secrets from env/filesystem/Vault (documented in `docs/secrets_management.md`); Runner has no integration.
- `./sdk` contains CLI tooling and iframe helpers but no generated runtime bindings or component build pipeline.

## Tooling Status Snapshot (Oct 2025)

- `componentize-js` latest tag `v0.19.3` (2025-10-27) fixes duplicate export naming, updates dependencies (`orca_wasm` → `wirm`), and keeps StarlingMonkey aligned—ensuring the `jco` toolchain is active and maintained.
- Recent releases (`v0.19.2`, `v0.19.1`) focus on Windows CI stability and StarlingMonkey updates, confirming cross-platform support and ongoing maintenance cadence.
- The toolchain now emits full component metadata compatible with Wasmtime 19.x+; we should plan to pin to `componentize-js` ≥ `0.19.3` and track upstream changelog for breaking changes.

## Requirements & Constraints

- **Component Model First**: All new host APIs are defined in WIT and surfaced to guests through Wasmtime component instantiation. No new raw `func_wrap` imports.
- **Secret Provenance**: The control plane packages secrets using `secretProvider` as Vault transit ciphertext. Runner decrypts using Vault tokens mounted as Docker secrets.
- **Capability Enforcement**: Access to secrets/config is gated by manifest-declared scopes (`secrets.get`, `config.read`) and enforced in the host implementation.
- **Componentize-JS Pipeline**: JS/TS extensions must build via `componentize-js` (`jco`) with a standardized project template in `sdk/`. The pipeline outputs `.wasm` + metadata for publishing.
- **Rotation & Caching**: Envelopes include `version`/`expires_at`; Runner caches decrypted material in an LRU keyed by `(tenant, install, version)` with short TTL.
- **DX**: Generated bindings (JS/TS) expose ergonomic helpers (`ctx.secrets.get`, `ctx.http.fetch`) and hide low-level ABI concerns.
- **Security**: Plaintext secrets never hit logs, idempotency caches, or panic traces. Structures holding secrets must not implement `Debug` output. Browser/iframe surfaces never receive secrets; UI flows rely on host proxy APIs instead.

## Proposed Architecture

### 1. WIT Worlds & Capability Provider Surface

- Author `wit/extension-runner.wit` describing:
  - `interface alga.context` (IDs, config map, request metadata).
  - `interface alga.secrets` (`get`, optional `list`, structured errors).
  - `interface alga.http`, `alga.storage`, `alga.log`, and `alga.ui_proxy` (for host-mediated UI actions).
- Encode capability requirements using custom metadata (e.g., `@requires("cap:secrets.get")`) so registry validation, host enforcement, and generated bindings stay in sync.
- Version the WIT world and publish alongside the SDK to support additive evolution.

### 2. Capability Provider Catalog

- Treat each host feature as a provider, similar to wasmCloud:
  - Core providers: secrets, outbound HTTP, storage, logging.
  - UI proxy provider: exposes predefined host endpoints extensions can call from the browser via gateway.
  - Future providers: messaging, scheduler hooks, custom domain integrations.
- Maintain provider definitions (WIT imports + manifest identifiers) so the registry knows which providers an extension needs and operators can enable/disable them per tenant.
- Document provider lifecycle (enable/disable, version bump) and align on naming (`cap.alga.secrets`, `cap.alga.ui_proxy`, etc.).

### 3. Control Plane, Gateway & Declarative Metadata

- Extend control-plane schema (`tenant_extension_install_config`, `tenant_extension_install_secrets`) storing Vault-transit ciphertext via `secretProvider`.
- Capture provider requirements in install metadata: manifest declares required providers; registry enforces availability before activation.
- Create service endpoint (`POST /internal/runner/install-config`) returning `{config, secret_envelope, provider_flags, version}`.
- Update Gateway to:
  - Fetch install config/secrets before invoking Runner.
  - Attach provider flags + version headers (`x-ext-config-version`, `x-ext-secrets-version`).
  - Expose host proxy routes (UI → gateway → runner handler) mapped to the `alga.ui_proxy` provider so browser clients never see secrets.

### 4. Runner Component Host Runtime

- Upgrade Wasmtime to a component-ready release and instantiate components via `componentize-js` metadata.
- Extend host context to store config maps, provider flags, and secret envelopes.
- Implement provider dispatch: the runner mounts each capability provider implementation (e.g., secrets provider decrypts Vault ciphertext mounted at `/run/secrets/...`).
- Secret redemption: decrypt Vault transit ciphertext in-process using mounted tokens/keys, populate short-lived cache keyed by `(tenant, install, version)`.
- Ensure provider calls zeroize buffers, apply capability checks, and emit structured errors.

### 5. Developer Workflow & CLI (Componentize-JS Pipeline)

- Ship `sdk/packages/component-runtime-template` mirroring wasmCloud’s `wash` flow:
  1. `alga-cli new component` scaffolds TS project with tests and provider manifests.
  2. `alga-cli dev` builds via `componentize-js`, spins up a local runner shim, and exercises provider routes (including UI proxy).
  3. `alga-cli publish` bundles `.wasm`, `.wit`, provider manifest, and metadata.json for registry upload.
- Validate toolchain versions (`componentize-js` ≥ 0.19.3, Wasmtime version) and fail fast if mismatched.
- Provide smoke tests that run components against mocked capability providers to catch ABI drift before upload.

### 6. SDK Distribution & Samples

- Publish `@alga/extension-runtime` (JS/TS) wrapping generated bindings with helpers (`createHandler`, `ctx.secrets.get`, `ctx.uiProxy.call`).
- Ship UI-side helpers (`@alga/extension-ui`) that call gateway proxy endpoints with tenant/install context.
- Document workflows in `sdk/docs`: local dev loop, invoking provider APIs, using UI proxy without handling secrets.
- Provide runnable samples mirroring wasmCloud’s language examples (TypeScript initially, add Rust/TinyGo later via `wit-bindgen`).

## Implementation Phases

### Phase 0 — Design & Toolchain Alignment

- [ ] Finalize WIT interface set and capability annotations.
- [ ] Pin toolchain versions (`componentize-js` ≥ 0.19.3, Wasmtime ≥ component-ready release) and capture upgrade strategy.
- [ ] Define secret envelope format (Vault transit ciphertext) and required Vault roles/tokens to mount into Runner containers.
- [ ] Design the capability provider catalog (IDs, manifests, lifecycle) and document how providers map to WIT imports.

### Phase 1 — Control Plane & Gateway

- [ ] Implement schema migrations and persistence for config + secrets (ciphertext via `secretProvider`).
- [ ] Build the install-config service endpoint returning config + envelopes + version metadata.
- [ ] Update Gateway to call the endpoint, enrich execute payloads, and emit version headers.
- [ ] Implement host-side proxy routes (UI → gateway → runner handler) so iframe code can trigger backend actions without receiving secrets directly.
- [ ] Validate manifest/provider declarations during publish and record provider enablement per install.

### Phase 2 — Runner Component Host

- [ ] Upgrade Runner to Wasmtime component APIs and instantiate components for `/v1/execute`.
- [ ] Implement host functions per WIT (context, secrets, http, storage, logging) with capability checks.
- [ ] Add secret envelope redemption via Vault transit decryption (token mounted as Docker secret) plus short-lived cache; ensure no secret leakage in logs/traces.
- [ ] Wire provider registry inside the runner so each capability (secrets, ui_proxy, etc.) can be swapped/extended without touching core execute logic.

### Phase 3 — SDK & Tooling (Componentize-JS Pipeline)

- [ ] Build the `componentize-js` project template and integrate it into `alga-cli`.
- [ ] Generate JS/TS bindings from WIT, publish `@alga/extension-runtime`, and document usage.
- [ ] Provide sample extension + automated test to validate secrets retrieval through the new host interface.
- [ ] Enforce component artifact validation in the publishing pipeline (reject raw Wasm uploads).
- [ ] Add UI SDK helpers demonstrating the proxy pattern (UI calling gateway endpoints backed by runner handlers).
- [ ] Deliver local dev commands (`alga-cli dev`) that spin up mocked capability providers to mirror wasmCloud’s `wash` workflow.

### Phase 4 — Rollout

- [ ] Ship an internal extension end-to-end (control plane → gateway → runner → component) to validate secrets delivery.
- [ ] Open beta to selected partners once SDK and tooling stabilize; iterate on developer feedback.
- [ ] Track follow-up work for observability, telemetry, and runbooks separately.

## Dependencies & Coordination

- Runner/Wasmtime specialists to handle component host migration.
- Platform/infra teams for Vault policies and Docker-secret delivery of runner tokens.
- Secrets platform owners maintaining `secretProvider` APIs and Vault transit setup.
- DX/docs teams for SDK publishing, tutorials, and developer onboarding.
- Registry/publishing pipeline owners to enforce component artifact requirements and provider declarations.
- Future capability provider owners (e.g., messaging, analytics) to contribute host implementations once the catalog is seeded.

## Open Questions

- Additional guest languages: after JS/TS, should we generate Rust/TinyGo bindings via `wit-bindgen` to broaden support?
- WIT versioning: how do we communicate additive changes to developers and keep bindings in sync (semver for WIT packages)?
- How do we expand the host proxy catalog over time (e.g., standardized UI → gateway endpoints) to cover common extension UI use cases?
- What guardrails are needed in `alga-cli` to detect mismatched `componentize-js` versions or incompatible Wasmtime features?

## Alternatives Considered

1. **Handwritten Wasmtime host imports (status quo)**  
   Pros: minimal change to existing Runner code.  
   Cons: every capability requires manual glue; no generated SDK; developers must handle ABI details. Rejected.

2. **Embed QuickJS or another JS runtime in Runner**  
   Pros: lets developers ship plain JS without compilation.  
   Cons: larger attack surface, dual runtime maintenance, and still requires secret plumbing; diverges from Wasm-component-first direction.

3. **Expose secrets via HTTP endpoints or storage APIs**  
   Pros: simple to implement.  
   Cons: weak capability enforcement, higher leakage risk, and no alignment with future component-based contracts.
