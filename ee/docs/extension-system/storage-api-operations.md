# Storage API Operational Readiness

This document outlines shard validation procedures, connection tuning guidance, and backup/restore updates for the extension storage service.

## Shard Validation Checklist

- After migrations, verify table distribution:
  ```sql
  SELECT logicalrelid, partmethod, colocationid
  FROM pg_dist_partition
  WHERE logicalrelid IN ('ext_storage_records'::regclass,
                         'ext_storage_schemas'::regclass,
                         'ext_storage_usage'::regclass);
  ```
  Expected: `partmethod = 'h'`, shared `colocationid`.
- Confirm reference tables absent (all distributed).
- Run shard health check:
  ```sql
  SELECT shardid, nodename, nodename || ':' || nodeport AS node,
         shardstate, replicationfactor
  FROM pg_dist_shard_placement p
  JOIN pg_dist_shard s USING (shardid)
  WHERE s.logicalrelid = 'ext_storage_records'::regclass
  ORDER BY shardid;
  ```
- Execute smoke query per shard using `citus_shards()` to ensure accessibility.
- Validate DDL compatibility with co-located transactional workflows by executing test transaction across `ext_storage_records` and existing tenant tables.

## Connection & Performance Tuning

- Connection pools:
  - Runner service pool: min 2, max 20 connections per pod; uses PgBouncer transaction pooling.
  - API Gateway interactions reuse existing `ee/server` pool; set `statement_timeout = 750ms`.
- Suggested per-operation timeouts:
  - Reads (`get`, `list`): 250 ms.
  - Writes (`put`, `bulkPut`, `delete`): 500 ms.
- Enable prepared statements for frequent queries; register via `pgbouncer` `prepare_threshold = 0`.
- Autovacuum adjustments:
  - Set `autovacuum_vacuum_scale_factor = 0.05` and `autovacuum_analyze_scale_factor = 0.02` on `ext_storage_records`.
  - Monitor `pg_stat_all_tables` for `n_dead_tup` growth; adjust thresholds as needed.
- Metrics to monitor:
  - `pg_stat_statements` entries for storage queries (latency, calls).
  - Citus coordinator CPU to detect router bottlenecks.

## Backup & Restore Updates

- Include new tables in nightly logical backup job; ensure `pg_dump` filters include `ext_storage_%`.
- Update runbook `db_restore.md`:
  - Add procedure for tenant-scoped restore using `citus_move_shard_placement` to isolate shards.
  - Document cross-check of row counts vs. `ext_storage_usage` metrics post-restore.
- Ensure WAL archiving covers storage writes; adjust retention if volume increases > 10%.
- DR drills: incorporate scenario restoring only extension storage for a tenant while preserving other data; validate access controls post-restore.

## Operational Runbooks to Update

- `infra/docs/db-runbook.md` — add shard validation section.
- `infra/docs/pooling.md` — update connection pool settings.
- `infra/docs/backup-restore.md` — incorporate storage-specific steps and verification checklist.

