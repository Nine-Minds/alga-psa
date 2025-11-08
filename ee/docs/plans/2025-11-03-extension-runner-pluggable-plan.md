# Extension Runner Pluggable Deployment Plan (Docker & Knative Backends)

## Overview

- Allow the extension gateway to target multiple runner backends (Knative in production, Docker in local/dev) without code changes in extension bundles.
- Keep the developer ergonomics of a single exposed port (`localhost:3000`) by proxying Runner endpoints/UI through Next.js when running locally.
- Preserve the existing Knative deployment model while introducing a first-class Docker Compose workflow for iterative testing.

## Goals

- [ ] Introduce a `RunnerBackend` abstraction that encapsulates execute/UI/health operations for the gateway.
- [ ] Provide configuration to select `knative` or `docker` backends via environment variables with sane defaults.
- [ ] Add a gateway proxy route so extension UI assets can be served through the same origin as the main application.
- [ ] Package a Docker Compose setup and helper scripts that run the Runner container locally alongside the Next.js gateway.
- [ ] Document the new workflow and add smoke tests covering both backends.

## Non-Goals

- Replacing the existing Knative deployment or Temporal domain provisioning flows in production.
- Modifying Runner execution safety limits (memory, CPU, timeout) or capability provider contracts.
- Introducing a new public load balancer component solely for local development.
- Refactoring bundle storage/S3 access patterns.

## Current State (Nov 2025)

- Gateway fetches `POST ${RUNNER_BASE_URL}/v1/execute` directly; static UI references `${RUNNER_PUBLIC_BASE}/ext-ui/...`.
- RUNNER_BASE_URL is typically a Knative service URI inside the cluster; local testing requires hand-running the Rust binary and updating env vars manually.
- No formal abstraction exists for the runner; only one backend (Knative) is assumed throughout the TypeScript code.
- UI assets are not proxied—developers must align iframe origins manually when overriding `RUNNER_PUBLIC_BASE`.
- Docker assets exist for Runner, but there is no supported compose scenario that ties Runner + gateway together on a single port.

## Requirements & Constraints

- **Single origin**: Locally, developers hit `http://localhost:3000` for both app and extension UI; no additional LB container should be required.
- **Pluggable interface**: Gateway must select backends through DI/config without branching logic sprinkled across routes.
- **Configuration parity**: Environment variable surface must clearly separate shared settings (timeouts, headers) from backend-specific values.
- **Security parity**: Docker backend should respect the same auth headers, service tokens, and logging redaction rules as Knative.
- **Observability**: Health checks and structured logging should include backend identity for troubleshooting.

## Proposed Architecture

### 1. Runner Backend Abstraction

- Create `RunnerBackend` interface (TypeScript) with methods such as `execute(req)`, `resolveUiUrl(extId, hash, path)`, and `health() / metadata()`.
- Implement `KnativeRunnerBackend` (current behaviour) and `DockerRunnerBackend` (connects to Docker container host/port).
- Provide a factory that selects backend based on `RUNNER_BACKEND` env var (`knative` default).

### 2. Gateway Proxy Layer

- Replace direct `fetch(${RUNNER_BASE_URL}/v1/execute)` with backend calls that return typed results and centralize error handling.
- Add Next.js route (e.g., `/runner/[...path]`) that proxies static UI assets via the backend, so iframe URLs use the primary origin.
- Update `buildExtUiSrc()` to rely on backend helper for consistent URL construction.

### 3. Docker Backend Runtime Package

- Author `docker-compose.runner-dev.yml` defining `extension-runner` service (build from existing Dockerfile, expose 8080 internally).
- Create helper commands (`npm run dev:runner`, `./scripts/dev-runner.sh`) to spin up Runner + Next dev with proper env defaults (`RUNNER_BACKEND=docker`, `RUNNER_DOCKER_HOST=http://extension-runner:8080`, `RUNNER_PUBLIC_BASE=http://localhost:3000/runner`).
- Ensure Docker backend rewrites public UI URLs to `/runner/...` while targeting the container internally.

### 4. Tooling & Testing

- Extend SDK/CLI dev commands to detect Docker backend and optionally build/push bundles into mounted volumes.
- Add smoke tests that run with `RUNNER_BACKEND=docker` (mock Runner responses) to validate routing.
- Update E2E suite to cover both backends where feasible or stub Docker backend via test doubles.

### 5. Documentation & Developer Workflow

- Document env matrix, start/stop commands, and troubleshooting tips in `docs/extension-system/development_guide.md`.
- Provide guidance for switching between backends without restarting (e.g., env var change + server reload).
- Highlight parity expectations (timeouts, auth tokens) and backend-specific caveats (e.g., no auto domain mapping in Docker mode).

## Implementation Phases

### Phase 0 — Design & Config Audit

- [ ] Finalize backend interface shape and config naming.
- [ ] Inventory env variables (`RUNNER_BASE_URL`, `RUNNER_PUBLIC_BASE`, timeouts) and plan migration/aliases.
- [ ] Decide on logging/telemetry structure for backend selection.

### Phase 1 — Abstraction & Knative Parity

- [x] Implement `RunnerBackend` interface + factory with Knative backend using existing logic.
- [x] Refactor gateway execute/UI code paths to use the abstraction without changing behaviour.
- [x] Add feature flag / env validation ensuring fallback remains backwards compatible.

### Phase 2 — Docker Backend & Proxy Routing

- [x] Implement Docker backend (internal base URL, optional health check endpoint).
- [x] Add `/runner/[...path]` proxy route and update UI helpers to leverage backend URLs.
- [x] Ensure headers (auth, caching) and error propagation match production behaviour.

### Phase 3 — Local Dev Tooling

- [x] Ship Docker Compose file + scripts to run Runner + gateway with shared `.env`.
- [x] Update CLI/SDK docs to reference new workflow; add convenience commands for bundling & install loops.
- [ ] Add smoke tests (unit/integration) covering Docker backend selection.

### Phase 4 — Rollout & Docs

- [x] Update developer docs, onboarding guides, and `.env.example`.
- [ ] Gather feedback from internal extension teams; iterate on ergonomics (auto restart, log streaming).
- [ ] Monitor for issues when switching between backends; add troubleshooting section.

## Dependencies & Coordination

- DevOps: Compose file review, Runner image tags, local secrets management.
- Runner team: Validate Docker runtime behaviour (env parity, secrets mount paths).
- Gateway team: Assist with proxy route, auth enforcement, and caching headers.
- DX/Docs: Document workflow & update SDK tutorials.

## Open Questions

- Should we support hot swapping backends without restarting Next.js? (Env reload vs. app restart.)
- How do we handle TLS/HTTPS locally if required for some browser APIs? (Proxy + mkcert?)
- Do we need watch mode for Runner container rebuilds, or are manual rebuilds sufficient?
- Should the Docker backend support optional port forwarding for direct UI asset access (bypassing proxy)?

## Next Steps

1. Draft `RunnerBackend` interface and share with gateway + runner stakeholders for feedback.
2. Prototype proxy route + Docker backend to validate single-origin behaviour.
3. Prepare Compose stack and developer script for local testing.
4. Schedule verification sessions (DX + extension teams) before rolling out docs.
