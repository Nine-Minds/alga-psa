# Storage API Citus Schema Design

This document specifies the relational model for the extension storage service, including table layout, indexing strategy, and distribution choices for Citus.

## Core Table: `ext_storage_records`

| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | `uuid` | Distribution key; all queries filter by tenant. |
| `extension_install_id` | `uuid` | Identifies extension install within tenant. |
| `namespace` | `text` | Lowercase slug, ≤ 64 chars. |
| `key` | `text` | Unique within namespace, ≤ 128 chars. |
| `revision` | `bigint` | Starts at 1, increments on every mutation. |
| `value` | `jsonb` | Stored payload; validated via JSON Schema. |
| `metadata` | `jsonb` | Optional metadata (content type, hints). |
| `ttl_expires_at` | `timestamptz` | Null for indefinite retention. |
| `created_at` | `timestamptz` | Defaults to `now()`. |
| `updated_at` | `timestamptz` | Managed via trigger or application layer. |

### Distribution & Partitioning

- Use Citus `create_distributed_table('ext_storage_records', 'tenant_id')`.
- Co-locate with other tenant-scoped tables to enable shared transactions.
- Optionally sub-partition by `tenant_id` hash + `namespace` for maintenance, but defer unless workloads require it.

### Constraints

- Primary key: `(tenant_id, extension_install_id, namespace, key)`.
- `CHECK (length(namespace) <= 64 AND namespace ~ '^[a-z0-9][a-z0-9-]*$')`.
- `CHECK (length(key) <= 128 AND key !~ '/')`.
- `CHECK (jsonb_typeof(metadata) = 'object')` (null allowed).
- Ensure `revision > 0`.

### Indexes

1. `PRIMARY KEY` covers exact lookups (`get`, `put`, `delete`).
2. Partial index on TTL for opportunistic cleanup:
   ```sql
   CREATE INDEX CONCURRENTLY ext_storage_expired_idx
     ON ext_storage_records (tenant_id, extension_install_id, namespace, key)
     WHERE ttl_expires_at IS NOT NULL;
   ```
   - Enables fast detection of expired records when checking TTL.
3. Namespace scan index:
   ```sql
   CREATE INDEX CONCURRENTLY ext_storage_namespace_idx
     ON ext_storage_records (tenant_id, extension_install_id, namespace, key);
   ```
   - Supports sorted `list` with optional key prefix (combined with `WHERE key LIKE 'prefix%'`).
4. JSONB GIN index (optional, behind feature flag) for metadata queries:
   ```sql
   CREATE INDEX CONCURRENTLY ext_storage_metadata_gin
     ON ext_storage_records USING GIN (metadata);
   ```
   - Enable only if specific workloads justify it; otherwise skip to reduce write amplification.

### Triggers

- `BEFORE INSERT/UPDATE` trigger to enforce `revision` increment (or manage in application).
- `BEFORE INSERT` to set `created_at`, `updated_at`; `BEFORE UPDATE` to refresh `updated_at`.
- TTL cleanup handled in application layer; no trigger required.

## Supporting Table: `ext_storage_schemas`

Stores namespace schema registrations.

| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | `uuid` | Distribution key. |
| `extension_install_id` | `uuid` | Scoped to install. |
| `namespace` | `text` | Matches record namespace. |
| `schema_version` | `integer` | Monotonic increment. |
| `schema_document` | `jsonb` | Raw JSON Schema. |
| `status` | `text` | `active`, `deprecated`, `draft`. |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `created_by` | `uuid` | Host user or service principal. |

- Primary key: `(tenant_id, extension_install_id, namespace, schema_version)`.
- Unique constraint on `(tenant_id, extension_install_id, namespace)` filtered to `status = 'active'`.
- Index on `status` for administrative queries.
- Distribution: `create_distributed_table('ext_storage_schemas', 'tenant_id')`.

## Quota Tracking: `ext_storage_usage`

Aggregates storage usage to avoid recalculating on every request.

| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | `uuid` | Distribution key. |
| `extension_install_id` | `uuid` | |
| `bytes_used` | `bigint` | Updated transactionally with writes. |
| `keys_count` | `integer` | |
| `namespaces_count` | `integer` | Maintained by namespace registration flow. |
| `updated_at` | `timestamptz` | |

- Unique constraint: `(tenant_id, extension_install_id)`.
- Maintained via application-side transactions; optional `CHECK (bytes_used >= 0)`.

## DDL Summary

```sql
CREATE TABLE IF NOT EXISTS ext_storage_records (
  tenant_id uuid NOT NULL,
  extension_install_id uuid NOT NULL,
  namespace text NOT NULL,
  key text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  value jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  ttl_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, extension_install_id, namespace, key),
  CHECK (revision > 0),
  CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object'),
  CHECK (length(namespace) <= 64 AND namespace ~ '^[a-z0-9][a-z0-9-]*$'),
  CHECK (length(key) <= 128 AND key !~ '/')
);

SELECT create_distributed_table('ext_storage_records', 'tenant_id');
```

Repeat analogous statements for `ext_storage_schemas` and `ext_storage_usage`.

## Capacity Planning Notes

- Estimate worst-case row size: 64 KiB value + overhead; confirm shard sizing to keep < 80% of available disk.
- Evaluate autovacuum settings for large JSONB tables; may need per-table thresholds.
- Monitor `pg_stat_statements` for top queries to validate index choices post-launch.

