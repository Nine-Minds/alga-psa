# Storage API Rollout & Testing Guide

This document covers database migration execution, TTL cleanup implementation details, and load-testing plans for the extension storage service.

## BiggerBoat Migration Plan

### Migration Contents

- Migration `20251008120000_create_ext_storage_tables.ts` will:
  1. Create `ext_storage_records`, `ext_storage_schemas`, and `ext_storage_usage` tables with constraints per [storage-api-schema.md](storage-api-schema.md).
  2. Call `create_distributed_table` for each table (deferred until after creation).
  3. Create required indexes (`PRIMARY KEY`, namespace scans, TTL partial index).
  4. Add triggers for `updated_at` maintenance if handled at DB layer.

- Down migration drops indexes, shrinks tables, and removes distribution metadata in reverse order.

### Execution Steps

1. **Develop**: run migration locally against dev cluster; ensure DDL works in single-node mode.
2. **Staging**:
   - Apply migration via BiggerBoat deployment job.
   - Validate distributed table placement (`select logicalrelid, colocationid from pg_dist_partition`).
   - Smoke-test CRUD using migration verification script.
3. **Production**:
   - Schedule change window (low traffic).
   - Run migration with `--safe` flag; monitor for lock contention (< 2s expected).
   - Verify indexes exist (`\d+ ext_storage_records`) and distribution status.
4. Post-deploy: tag migration commit and update runbook with execution timestamp.

### Rollback

- If issues detected before GA, execute down migration; requires draining writes.
- Post-GA, prefer forward fix; down migration only if data not yet onboarded.

## Opportunistic TTL Cleanup

- Cleanup occurs during read/write operations:
  1. Before fulfilling `get` or `list`, query for expired records within the targeted tenant/install namespace using partial index.
  2. Delete expired rows within same transaction; track number of deletions for metrics.
  3. During `put`/`bulkPut`, delete existing expired row prior to insert to avoid `revision` mismatch.
- Add sampling hook to occasionally sweep namespaces even on read-only workloads (`list` operations trigger cleanup every N calls).
- Log cleanup metrics: `ttl_cleanup_deletes_total` with labels for tenant/extension blurred to avoid high cardinality (use hashed id).
- Fallback plan: if opportunistic cleanup insufficient (monitored via backlog metric), introduce lightweight scheduled job later.

## Load Testing Harness

- Tooling: extend existing `ee/packages/loadgen` with scenario `ext-storage`.
- Scenarios:
  - **CRUD mix**: 70% reads, 25% writes, 5% deletes at target 200 ops/min per install.
  - **Bulk writes**: chained `bulkPut` operations with varying payload sizes to test quota enforcement.
  - **List scans**: test pagination and key prefix queries across 5k records.
- Data generation:
  - Synthetic tenants (50), installs per tenant (3), namespaces per install (5).
  - Values 1–64 KiB using fixture templates.
- Success criteria:
  - p95 latency < 150 ms for reads, < 250 ms for writes.
  - No unexpected deadlocks or hot shard concentration.
  - Quota violations raise expected errors.
- Harness output pushes metrics to Influx/Grafana and exports JSON report for regression tracking.

## Verification Checklist

- [ ] Migration applied in staging; tables and indexes present.
- [ ] Opportunistic TTL cleanup deletes expired records during test runs.
- [ ] Load testing harness reports metrics within target SLOs.
- [ ] Alerts configured for TTL backlog (`ttl_expired_rows_pending`) remain within threshold.

