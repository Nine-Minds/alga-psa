# Extension Runtime Metadata & Secrets Delivery Plan (Component Model Edition)

## Overview

- Deliver tenant/install-scoped configuration and secrets (e.g., Alga API keys) to Wasm extensions while keeping values encrypted at rest and never logging plaintext.
- Anchor the execution platform on the Wasmtime **component model** with WIT-defined host interfaces so guest bindings are generated automatically—no handwritten Rust or AssemblyScript shims required.
- Reuse the existing composite secret provider (`shared/core/secretProvider`) and Vault-backed infrastructure described in `docs/secrets_management.md`, ensuring local Docker-secret flows continue to work while production relies on Vault.
- Provide an opinionated SDK toolchain (generated from WIT) inside `./sdk` so extension authors can consume secrets and metadata from TypeScript or other supported languages without touching low-level Wasm plumbing.

## Goals

- [ ] Model Runner → guest contracts (context, secrets, storage, http) as WIT interfaces and adopt Wasmtime component instantiation for `/v1/execute`.
- [ ] Ensure secrets/config metadata reach the guest runtime via auditable, capability-gated channels, honoring install-level scoping and fast rotation.
- [ ] Generate language bindings (starting with JavaScript/TypeScript via `wit-bindgen`/`jco`, expanding to Rust/TinyGo later) and package them under `sdk/` for frictionless developer use.
- [ ] Integrate secret delivery with the composite `secretProvider` chain (Vault in production, filesystem/Docker in local/dev) so control plane and Runner share a single source of truth.
- [ ] Preserve existing operational safeguards: no secrets in logs, deterministic access audits, hot-rotation support.

## Non-Goals

- Replacing the current secret storage stack; the Runner consumes `secretProvider` output rather than maintaining its own key store.
- Shipping a full JS VM-in-Wasm runtime; extensions still compile to Wasm modules/components provided by developers.
- Providing advanced SDK abstractions (e.g., preconfigured HTTP clients) in the first phase—focus on foundational bindings, with niceties deferred to follow-up work.

## Current State (2025-10-29)

- Runner requests/responses (`ee/runner/src/models.rs`) contain only `context`, `http`, and `limits`; secret metadata is absent.
- `HostExecutionContext` (loader) tracks IDs but holds no config/secret payloads.
- Host imports in `ee/runner/src/engine/host_api.rs` are hand-wired functions for logging, storage, and http. No `alga.secrets` surface exists, and everything assumes the “module” Wasmtime API (no component model).
- Gateway route (`ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts`) proxies to Runner without fetching install metadata/secrets.
- Control-plane services already use `shared/core/secretProvider.ts` to resolve secrets via env/filesystem/Vault; Runner has no equivalent integration.
- SDK packages in `./sdk` focus on CLI/iframe tooling; there is no generated guest runtime or host binding package.

## Requirements & Constraints

- **Component Model First**: All new host/guest contracts are described in WIT, compiled to Wasmtime components, and wired via the component linker. Legacy func imports should be bridged only temporarily.
- **Capability Enforcement**: Secret/config access must respect manifest capabilities (e.g., `secrets.get`, `config.read`), enforced host-side.
- **Secret Provenance**: Values originate from the composite secret provider (Vault → Docker secrets). The control plane encrypts/encapsulates material before sending it to Runner.
- **Rotation & Caching**: Envelope/tokens carry version + expiry. Runner caches decrypted material briefly (LRU keyed by tenant/install/version) and refreshes automatically on rotation.
- **DX**: Guest developers import generated bindings (e.g., `@alga/wasm-runtime`) and call `secrets.get('key')` without writing allocator glue.
- **Security**: Plaintext secrets never land in logs, crash reports, or idempotency caches. Vault credentials/tokens are mounted per `docs/secrets_management.md`.

## Proposed Architecture

### 1. WIT Interface Definitions

- Create `wit/extension-runner.wit` capturing:
  - `interface alga.context` (request IDs, tenant/extension/install IDs, config map).
  - `interface alga.secrets` with `get(key: string) -> result<string, SecretError>` and `list() -> list<string>` (optional).
  - `interface alga.http`, `alga.storage`, and logging (future consolidation of existing host APIs).
- Define capability annotations (e.g., custom WIT metadata) to mark imports requiring specific manifest scopes.
- Generate bindings using `wit-bindgen` / `jco` for JS/TS, `wit-bindgen rust` for Rust guest experiments, etc.

### 2. Runner Component Host

- Migrate Runner execution path to Wasmtime component APIs:
  - Compile guest Wasm bundles into components (or adapt existing modules via `componentize-js/componentize-py` where applicable).
  - Instantiate with a host-defined world implementing the WIT interfaces.
- Reimplement host functions in terms of WIT—e.g., secrets host uses typed handles instead of raw memory pointers.
- Update `/v1/execute` handler to populate the component host context with:
  - `config` map (non-secret metadata).
  - `secret_envelope` (encrypted payload or fetch token).
  - Capability flags derived from manifest.

### 3. Secret Transport & Decryption

- Control plane service (invoked by Gateway) fetches install config + secrets via `secretProvider`.
- Secrets are packaged as:
  - Option A: Vault-transit encrypted blob. Runner mounts a Vault token/data key (Docker secret) and decrypts locally.
  - Option B: Short-lived signed token. Runner redeems via an internal secrets broker that fronts `secretProvider` (mTLS, auditable).
- Envelope metadata includes `version`, `expires_at`, `key_id`.
- Runner maintains an in-memory LRU keyed by `(tenant_id, install_id, version)` storing decrypted secret maps with TTL.

### 4. SDK & Developer Experience

- Add `sdk/runtime-bindings/` package published as `@alga/extension-runtime`:
  - Bundles JavaScript/TypeScript bindings generated from WIT (via `jco componentize` or `wit-bindgen js`).
  - Provides a CLI template for creating TypeScript handlers that compile to Wasm components using `componentize-js`.
  - Exposes ergonomic helpers: `import { handler } from '@alga/extension-runtime'; export default handler(async ({ secrets, config, http }) => { ... });`
- Update `alga-cli` to scaffold projects using the new runtime package, compile to component artifacts, and bundle them for upload.
- Document usage in `sdk/docs` with examples retrieving a secret and calling an Alga API.

### 5. Compatibility & Migration

- Maintain a fallback path for legacy modules during transition:
  - Bridge WIT interfaces to existing func imports via adapter components.
  - Allow mixed deployments while partners migrate to the new SDK.
- Provide validation in registry/publish pipeline ensuring bundles adhere to component format and declare capabilities consistent with WIT interfaces.

## Implementation Phases

### Phase 0 — Design & Alignment

- [ ] Finalize WIT world/interface definitions covering context, secrets, config, http, and storage.
- [*] Align with Security and DX on capability metadata encoded in WIT (e.g., custom annotations).
- [ ] Define secret envelope/token format and Vault roles required for Runner decryption.
- [ ] Identify tooling requirements (`wit-bindgen`, `componentize-js`, Wasmtime version upgrade).

### Phase 1 — Control Plane & Gateway

- [ ] Extend control-plane schema with `tenant_extension_install_config` and `tenant_extension_install_secrets` (ciphertext via secretProvider).
- [ ] Implement service endpoint `POST /internal/runner/install-config` returning `{ config, secrets_envelope, version }`.
- [ ] Update Gateway route to call the endpoint before invoking Runner, attaching config inline and secrets envelope out-of-band (header + request field).
- [ ] Propagate version headers (`x-ext-config-version`, `x-ext-secrets-version`) for observability.

### Phase 2 — Runner Component Host

- [ ] Upgrade Runner to Wasmtime >= component-ready release; enable component instantiation in `ModuleLoader`.
- [ ] Implement host world for WIT interfaces (context, secrets, config, logging, http, storage).
- [ ] Integrate envelope redemption (Vault token mounted via Docker secret or broker call) and short-lived LRU cache.
- [ ] Ensure logs/traces redact secret values and omit envelopes from idempotency cache.

### Phase 3 — SDK & Tooling

- [ ] Generate JS/TS bindings from WIT and publish `@alga/extension-runtime`.
- [ ] Extend `alga-cli` to scaffold component-based projects, run `componentize-js`/`jco` during build, and validate manifests declare required capabilities.
- [ ] Provide TypeScript sample extension demonstrating `await secrets.get('alga_api_key')` and outbound API calls.
- [ ] Document build/deploy steps in `sdk/docs` and update developer onboarding materials.

### Phase 4 — Migration & Backwards Compatibility

- [ ] Introduce adapter components letting legacy modules run temporarily (mapping old raw host imports to WIT functions).
- [ ] Add registry validations to enforce component artifacts for new uploads after grace period.
- [ ] Communicate migration timelines, provide linting/check scripts in `alga-cli`.

# Phase 5 — Rollout (High-Level)

- [ ] Enable component-based execution for an internal extension, exercising secret retrieval end to end.
- [ ] Gradually open access to pilot partners once SDK and migration tooling stabilize.
- [ ] Track follow-up work for observability, telemetry, and runbooks separately once the foundation is in place.

## Dependencies & Coordination

- Wasmtime/component model expertise (Runner team) for host migration.
- Platform/infra for Vault policies, token delivery, Docker secret management.
- Secrets platform owners maintaining `secretProvider` APIs and Vault transit setup.
- DX/docs teams for SDK publishing and developer education.
- Registry/publishing pipeline updates for component validation.

## Open Questions

- Should we adopt a broker service for secrets redemption (token-based) or rely on direct Vault transit decryption inside Runner? Trade-offs: latency vs. operational simplicity.
- Which guest languages should we support beyond TypeScript in the first wave (Rust, TinyGo, Python via componentize-py)?
- How do we version WIT interfaces to allow backwards-compatible additions while keeping generated bindings stable?
- What policy governs capability metadata in WIT (e.g., custom key vs. forthcoming official annotations)?
- Do we expose secrets to iframe UI contexts, and if so, how do we keep parity with component-world contracts?

## Alternatives Considered

1. **Handwritten host imports (status quo)**  
   Pros: minimal change to Runner internals.  
   Cons: every new capability requires manual glue; devs must write Rust/AssemblyScript wrappers; language support limited. Rejected in favor of component model.

2. **Embed JavaScript engine in Runner for TS extensions**  
   Pros: extremely low barrier for devs.  
   Cons: larger attack surface, harder to sandbox, still need secret plumbing, and diverges from Wasm-first architecture.

3. **Expose secrets via HTTP endpoints**  
   Pros: trivial implementation.  
   Cons: weak capability enforcement, logs risk, increased latency, breaks isolation.
