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

- [ ] Finalize storage API contract (operations, error codes, optimistic concurrency model) with DX stakeholders.
- [ ] Define resource hierarchy: tenant → extension install → namespace → key/value records.
- [ ] Produce JSON Schema validation strategy: per-namespace schema registry, version negotiation, and validation failure responses.
- [ ] Specify quotas and limits (per extension install): max namespaces, keys per namespace, value size, total storage.
- [ ] Draft API reference docs and manifest capability requirements.
- [ ] Align security review on capability scopes, RBAC, and audit requirements.

### Phase 2 — Data Modeling & Infrastructure

- [ ] Design Citus schema:
  - [ ] Create partitioned table `ext_storage_records` with distribution key `tenant_id`.
  - [ ] Columns: `tenant_id`, `extension_install_id`, `namespace`, `key`, `value` (JSONB), `metadata` (JSONB), `revision` (BIGINT), `ttl_expires_at`, timestamps.
  - [ ] Unique constraint on (`tenant_id`, `extension_install_id`, `namespace`, `key`).
  - [ ] Supporting indexes for namespace scans and TTL sweeps.
- [ ] Implement schema migrations (BiggerBoat) with down migrations and rollout notes.
- [ ] Add opportunistic TTL cleanup that piggybacks on read/write requests to delete expired records without background jobs.
- [ ] Prepare load testing harness to simulate extension workloads (insert, list, update).
- [ ] Validate shard distribution and index plans in staging; tune connection pool settings.
- [ ] Update backup/restore playbooks to include extension storage tables.

### Phase 3 — Service Implementation

- [ ] Runner host API:
  - [ ] Implement `alga.storage.put/get/delete/list` in Runner (Rust) backed by new storage service client.
  - [ ] Enforce capability checks and quotas before dispatching queries.
  - [ ] Add optimistic concurrency via `ifRevision` header and `revision` increments.
  - [ ] Emit structured logs and metrics (operation, latency, bytes).
- [ ] Storage service layer (TypeScript/Node):
  - [ ] Create module interfacing with Citus via existing pool (`ee/server/src/lib/db`).
  - [ ] Implement transactional operations, schema validation hooks, and quota enforcement.
  - [ ] Introduce caching for schema definitions and quota counters where necessary.
- [ ] API Gateway & SDK:
  - [ ] Expose REST endpoints for iframe clients (e.g., `POST /api/ext-storage/[namespace]`).
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
