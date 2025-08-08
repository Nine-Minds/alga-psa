# Extension Security & Signing

This document describes the security model for the Enterprise extension system with a focus on bundle signing, verification, isolation, and policy enforcement.

## Principles
- No tenant code runs inside the host app process
- All code executes out‑of‑process in the Runner under strict limits
- Bundles are immutable, content‑addressed, and signed; verified on install and on load
- Capabilities, egress, and quotas are enforced at both gateway and Runner

## Signed, Content‑Addressed Bundles

- Compute a SHA256 over the canonical bundle (manifest, WASM, assets)
- Store artifacts in object storage under `sha256/<hash>` paths
- Sign the bundle with the publisher certificate; publish `SIGNATURE`
- Registry records `content_hash`, `signature`, publisher, and optional SBOM reference

## Verification Flow

On install and on load:
1. Load trust bundle from `SIGNING_TRUST_BUNDLE` (PEM)
2. Validate signature against `content_hash` and publisher cert
3. Abort install/load if verification fails; mark version as invalid

## Gateway Policies

- Route: `/api/ext/[extensionId]/[...]`
- Resolve tenant install/version and endpoint from manifest
- Enforce:
  - Header allowlist (strip end‑user `authorization`)
  - Request/response size caps
  - Timeouts (`EXT_GATEWAY_TIMEOUT_MS`)
  - Per‑tenant rate limits

## Runner Isolation

- Wasmtime with pooling allocator, epoch timeouts, memory caps, optional fuel
- Host APIs (`alga.*`) implement capability checks and per‑tenant egress allowlists
- Secrets retrieved via a broker; no plaintext secret storage in bundles
- Structured errors with clear codes (timeout, memory_limit, quota_exceeded, bad_handler, internal)

## Quotas & Observability

- Quotas enforced per tenant/extension for concurrency and rate
- Execution logs persisted with correlation IDs to `extension_execution_log`
- Prometheus metrics for duration, memory, fuel, egress bytes, and errors

## Best Practices for Publishers

- Request only necessary capabilities (least privilege)
- Keep bundles small; paginate and filter server‑side
- Maintain SBOMs; update dependencies proactively
- Use reproducible builds and deterministic packaging
- Consider AOT precompilation (cwasm) for cold start reduction

## Out of Scope (Initial)
- Complex PKI/marketplace workflows and CA hierarchies
- Bring‑your‑own containers and arbitrary runtimes

## References
- [Manifest v2](manifest_schema.md)
- [API Routing Guide](api-routing-guide.md)
- [Registry Implementation](registry_implementation.md)
