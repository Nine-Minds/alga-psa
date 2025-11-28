# Extension Storage API Plan

## Overview

- Deliver a durable, host-managed storage API backed by our existing Citus (Postgres) deployment for the EE extension system.
- Provide extensions with structured, multi-tenant storage primitives (namespaced key/value, optional structured collections, blob handles) while the host enforces quotas, schema validation, and tenancy.
- Establish the operational, observability, and rollout guardrails needed to evolve the storage surface without exposing raw database access.

## Goals

- [ ] Ship an initial storage API surface that lets extensions persist and retrieve JSON payloads with transactional guarantees.
- [ ] Enforce per-tenant, per-extension quotas, size limits, and optimistic concurrency.
- [ ] Integrate Runner capability checks so only extensions granted `alga.storage` can access the API.
- [ ] Deliver documentation and SDK updates that make the storage API consumable from both WASM handlers and iframe UIs.

## Non-Goals

- Building a general-purpose relational modeling layer for extensions (future consideration once demand is proven).
- Exposing raw SQL/Redis interfaces or direct database credentials to extensions.
- Implementing durability upgrades for Redis (tracked separately; only revisit if Phase 3 indicates a gap).

## Current State (as of 2025-10-08)

- Runner exposes limited host APIs (http, secrets, logging, metrics); storage capability is scoped for v2 but not yet implemented.
- Persistent data for the EE platform relies on Citus, which provides HA, backups, and tenant sharding. Redis operates as a non-durable cache/stream substrate.
- Extension manifests can request `alga.storage`, but capability enforcement currently rejects all calls.
- No shared schema or tables exist for extension-owned data.

Status update (2025-11-21):
- Runner now exposes `alga.storage` capability backed by the internal API `POST /api/internal/ext-storage/install/{installId}` (see `ee/runner/src/engine/host_api.rs` and `ee/server/src/app/api/internal/ext-storage/install/[installId]/route.ts`).
- Manifest/runtime code paths accept `storage.kv` capability; gateway execute payload includes `install_id`? (still missing) but passes `config/providers/secretEnvelope` and uses install-scoped token headers.
- Quotas/version headers and RBAC beyond token gating remain open; docs still refer to tenant storage service—needs reconciliation with the live capability implementation.

## Risks and Mitigations

- **Unbounded growth / noisy neighbors** → enforce quotas, TTL, and cardinality limits per tenant+extension namespace; surface metrics.
- **Schema drift and breaking changes** → version storage contracts per namespace with JSON Schema validation and change review.
- **Hot partitions** → align Citus distribution key with tenant/extension; add secondary indexes on frequently queried attributes.
- **Abuse or sensitive data exfiltration** → tie access to capability checks, RBAC, and audit logging, and inherit existing egress allowlists.
- **Operational load on primary database** → stage load testing and monitor Citus shards before rollout; add connection pooling and caching where appropriate.

## Design Summary

- Back storage collections with Citus tables using JSONB columns (`value`, `metadata`) and typed primitives for keys, namespaces, version, timestamps.
- Namespace records by `tenant_id`, `extension_install_id`, `logical_namespace`, and `key`.
- Provide base operations: `put` (with optional conditional version), `get`, `list`, `delete`, and `bulkPut`.
- Introduce optional collection types (append-only log, blob references) gated by manifests and quotas, but start with key/value.
- Access via Runner host API `alga.storage.*` (gRPC/JSON over host bridge). API Gateway proxies REST requests from iframe UI to Runner when the extension SDK calls storage endpoints.
- Observability includes structured audit logs, Prometheus metrics (ops, latency, bytes), and dashboards per tenant/extension.

## Phases and TODOs

### Phase 1 — Product & Contract Definition

- [x] Finalize storage API contract (operations, error codes, optimistic concurrency model) with DX stakeholders. See [storage-api-contract.md](../extension-system/storage-api-contract.md).
- [x] Define resource hierarchy: tenant → extension install → namespace → key/value records (documented in [storage-api-contract.md](../extension-system/storage-api-contract.md)).
- [x] Produce JSON Schema validation strategy: per-namespace schema registry, version negotiation, and validation failure responses. See [storage-api-validation.md](../extension-system/storage-api-validation.md).
- [x] Specify quotas and limits (per extension install): max namespaces, keys per namespace, value size, total storage (documented in [storage-api-validation.md](../extension-system/storage-api-validation.md)).
- [x] Draft API reference docs and manifest capability requirements (captured in [storage-api-access-control.md](../extension-system/storage-api-access-control.md)).
- [x] Align security review on capability scopes, RBAC, and audit requirements (see [storage-api-access-control.md](../extension-system/storage-api-access-control.md) for baseline).

### Phase 2 — Data Modeling & Infrastructure

- [x] Design Citus schema (see [storage-api-schema.md](../extension-system/storage-api-schema.md)):
- [x] Create partitioned table `ext_storage_records` with distribution key `tenant`.
  - [x] Columns: `tenant_id`, `extension_install_id`, `namespace`, `key`, `value` (JSONB), `metadata` (JSONB), `revision` (BIGINT), `ttl_expires_at`, timestamps.
  - [x] Unique constraint on (`tenant_id`, `extension_install_id`, `namespace`, `key`).
  - [x] Supporting indexes for namespace scans and TTL sweeps.
- [x] Implement schema migrations (BiggerBoat) with down migrations and rollout notes (see [storage-api-rollout.md](../extension-system/storage-api-rollout.md)).
- [x] Add opportunistic TTL cleanup that piggybacks on read/write requests to delete expired records without background jobs (documented in [storage-api-rollout.md](../extension-system/storage-api-rollout.md)).
- [x] Prepare load testing harness to simulate extension workloads (insert, list, update) (outlined in [storage-api-rollout.md](../extension-system/storage-api-rollout.md)).
- [x] Validate shard distribution and index plans in staging; tune connection pool settings (see [storage-api-operations.md](../extension-system/storage-api-operations.md)).
- [x] Update backup/restore playbooks to include extension storage tables (guidance in [storage-api-operations.md](../extension-system/storage-api-operations.md)).

### Phase 3 — Service Implementation

- [x] Runner host API:
  - [x] Implement `alga.storage.put/get/delete/list` in Runner (Rust) backed by new storage service client.
  - [ ] Enforce capability checks and quotas before dispatching queries.
  - [x] Add optimistic concurrency via `ifRevision` header and `revision` increments.
  - [ ] Emit structured logs and metrics (operation, latency, bytes).
- [ ] Storage service layer (TypeScript/Node):
- [x] Storage service layer (TypeScript/Node):
  - [x] Create module interfacing with Citus via existing pool (`ee/server/src/lib/db`).
  - [x] Implement transactional operations, schema validation hooks, and quota enforcement.
  - [x] Introduce caching for schema definitions and quota counters where necessary.
- [ ] API Gateway & SDK:
  - [x] Expose REST endpoints for iframe clients (e.g., `POST /api/ext-storage/[namespace]`).
  - [ ] Update iframe SDK and WASM client to call the new host API methods.
  - [ ] Add integration tests covering storage flows (Runner ↔ storage ↔ DB roundtrip).

### Phase 4 — Observability, Security, and Rollout

- [ ] Add Prometheus dashboards and alerts for operation throughput, error rates, quota near-exhaustion, and latency.
- [ ] Wire audit logs to central pipeline (tenant id, extension id, namespace, operation, actor).
- [ ] Pen-test and threat model the new surface; ensure no cross-tenant leakage in queries.
- [ ] Document runbooks: quota breach, shard saturation, schema update process.
- [ ] Stage rollout:
  - [ ] Enable capability for selected internal extensions.
  - [ ] Validate load tests and real usage metrics.
  - [ ] Gradually enable for beta partners, then GA.
- [ ] Post-GA cleanup: finalize docs, sunset temporary feature flags, log final status.

## Dependencies & Coordination

- Runner team for host API implementation and capability enforcement.
- Database platform team for Citus schema review, migration scheduling, and capacity planning.
- Security/compliance for data handling approvals and audit log schema.
- DX docs & SDK teams for developer documentation and client library updates.

## Acceptance Criteria

- [ ] Extensions with `alga.storage` capability can perform CRUD operations with consistent results across Runner and iframe SDK.
- [ ] Storage tables exhibit expected performance under simulated production load (p95 latency < defined SLO).
- [ ] Quotas prevent unbounded growth and surface actionable alerts when near limits.
- [ ] Audit logs trace all storage mutations with tenant/extension attribution.
- [ ] Documentation (API reference, examples) published in `ee/docs/extension-system`.

## Rollback Plan

- Disable `alga.storage` capability flag to stop extension access while keeping data intact.
- Revert Runner host API deployment if regressions surface.
- Roll back database migrations via BiggerBoat down migrations if schema changes must be undone (requires maintenance window).
- Restore from Citus backups if data corruption occurs; coordinate with DB team for tenant-scoped restores.

## Future Enhancements

- Add specialized collections (append-only logs, counters, queues) based on extension demand.
- Explore Redis-backed accelerators for high-throughput patterns once HA Redis is available.
- Introduce fine-grained access policies and per-record ACLs for multi-actor extensions.
- Provide analytics snapshots and export tooling for extension data portability.
