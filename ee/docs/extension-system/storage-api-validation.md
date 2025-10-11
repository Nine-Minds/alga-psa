# Storage API Validation & Quotas

This document expands Phase 1 deliverables for JSON Schema governance and quota enforcement for the extension storage API.

## JSON Schema Strategy

### Registration

- Each extension namespace may register an optional JSON Schema document (Draft 2020-12) during deployment.
- Schemas are stored in host-managed metadata tables and versioned per namespace: `schema_version` increments monotonically.
- Registration paths:
  1. **Manifest declaration** — namespaces include a `schemaReference` pointing to a schema asset within the bundle.
  2. **Out-of-band update** — extensions submit a signed schema update via host admin UI/API, subject to review.
- Schema updates require backward compatibility (new properties optional, enums additive). Breaking changes mandate new namespace or major version review.

### Enforcement

- `storage.put` and `storage.bulkPut` validate payloads before write. Validation errors return `VALIDATION_FAILED` with pointer to failing path.
- `storage.list` and `storage.get` do not revalidate on read; data integrity guaranteed by write path.
- Namespaces without schema default to permissive validation (any JSON allowed) but must still respect size limits.
- Validation happens within the storage service layer to centralize logic and produce consistent error messaging.

### Version Negotiation

- Clients include optional `schemaVersion` when writing; if omitted, latest active version applies.
- When a new schema version is rolled out, previous versions remain accepted for a configurable grace period to allow extension rollouts.
- Audit log captures schema version used per write for troubleshooting.

## Quotas and Limits

### Per Extension Install (Default Values)

- Namespaces: max 32 per install.
- Keys per namespace: soft cap 5,000 (alert at 90%, hard fail at 5,120).
- Value size: max 64 KiB per record (post compression estimate disabled for now).
- Metadata size: max 4 KiB.
- Bulk write batch: ≤ 20 items and ≤ 512 KiB cumulative payload.
- Total storage: 256 MiB per install (sum of JSON payload bytes); configurable per tier.

### Per Tenant Aggregates

- Combined extension storage across installs: soft cap 2 GiB (configurable). Exceeding triggers alerts and rate limiting.
- Request rate: default 200 ops/minute burstable, enforced via shared rate limiter.

### TTL & Retention

- Minimum TTL: 60 seconds. Maximum TTL: 30 days (per record). No TTL → indefinite retention (still counts toward quota).
- Opportunistic cleanup deletes expired records during future reads/writes; background sweeps may be reintroduced if idle datasets accumulate.

### Monitoring & Alerts

- Prometheus metrics expose:
  - `storage_quota_usage_bytes{tenant_id,extension_install_id}`.
  - `storage_namespace_key_count`.
  - `storage_validation_failures_total`.
- Alerting thresholds at 80% and 95% of quota; Slack notifications routed to extension operations channel.

### Override Process

- Overrides initiated via host admin UI; require on-call approval and are tracked in change log.
- Temporary overrides expire after 14 days unless renewed.

## Outstanding Decisions

- Determine automated compatibility checks for schema upgrades (e.g., using `ajv` diff tool).
- Finalize per-plan quota multipliers (enterprise vs. standard tenants).
- Document override escalation runbook in Ops handbook.

