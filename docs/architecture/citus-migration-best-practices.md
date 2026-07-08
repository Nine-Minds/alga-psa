# CitusDB Migration Best Practices

This document outlines best practices for writing database migrations that work correctly with both standard PostgreSQL and CitusDB (distributed PostgreSQL).

## Key Differences with CitusDB

CitusDB distributes tables across multiple worker nodes (shards). This creates unique challenges for migrations:

1. **Distributed Data**: Table data is split across multiple physical tables (shards)
2. **Coordinator vs Workers**: The coordinator node has metadata, workers have actual data
3. **Query Routing**: Some queries run on coordinator, some on workers, some on both
4. **Schema Changes**: DDL operations may need to be applied to both coordinator and shards

## Common Issues

### Issue 1: ALTER TABLE NOT NULL Fails Despite No NULL Values

**Symptom**: Migration fails with "column contains null values" even though SELECT queries show 0 NULL values.

**Cause**:
- SELECT queries may only check coordinator or cached data
- ALTER TABLE validates across ALL shards, which may find NULL values queries missed
- Metadata sync issues between coordinator and workers

**Solution**: Use the Citus-aware approach shown in migration `20251113120000_add_project_number.cjs`:

```javascript
// Check if this is a Citus distributed table
const isCitus = await knex.raw(`
  SELECT EXISTS (
    SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'table_name'::regclass
  ) as is_distributed
`);

if (isCitus.rows[0]?.is_distributed) {
  // Set NOT NULL on all shards first
  await knex.raw(`
    SELECT * FROM run_command_on_shards(
      'table_name',
      $$ALTER TABLE %s ALTER COLUMN column_name SET NOT NULL$$
    )
  `);

  // Update coordinator metadata
  await knex.raw(`
    UPDATE pg_attribute
    SET attnotnull = true
    WHERE attrelid = 'table_name'::regclass
    AND attname = 'column_name'
    AND attnotnull = false
  `);
} else {
  // Standard PostgreSQL
  await knex.raw(`ALTER TABLE table_name ALTER COLUMN column_name SET NOT NULL`);
}
```

### Issue 2: Data Backfill Not Visible Immediately

**Symptom**: UPDATE statements complete successfully, but subsequent SELECT shows unchanged data.

**Cause**: Eventual consistency in distributed systems - changes take time to propagate across shards.

**Solution**:
- Add delays after bulk updates (3-5 seconds)
- Use raw SQL queries to force fresh reads
- Query actual rows, not just COUNT(*), to force distributed query execution

```javascript
// After backfill
await new Promise(resolve => setTimeout(resolve, 5000));

// Force distributed check by querying actual rows
const nullProjects = await knex.raw(`
  SELECT project_id, tenant, project_name
  FROM projects
  WHERE column_name IS NULL
  LIMIT 100
`);
```

### Issue 3: Transaction Isolation Problems

**Symptom**: Changes made in same migration aren't visible to later queries in the migration.

**Cause**: Citus doesn't support all operations inside transactions.

**Solution**: Disable transactions for migrations with distributed operations:

```javascript
// At end of migration file
exports.config = { transaction: false };
```

### Issue 4: ALTER ... SET NOT NULL Fails After Distributing a Non-Empty Table

**Symptom**: `ALTER TABLE x ALTER COLUMN c SET NOT NULL` fails with `column "c" of relation "x" contains null values`, even though every `SELECT ... WHERE c IS NULL` (including per-shard checks and backfills) returns zero rows and the distributed data is fully populated.

**Cause**: `create_distributed_table('x', ...)` was run while `x` already contained rows, and the official follow-up was **not** run. Citus copies the existing rows into the shard tables (`x_<shardid>`) but **leaves the originals in the coordinator's physical heap for the parent relation**. Those shadow rows are unreachable by every Citus-routed statement (all DML is rewritten to the shards), so backfills and `SELECT` checks correctly see them as gone. But `ALTER TABLE ... SET NOT NULL` is core PostgreSQL DDL — `ATRewriteTable` scans the parent relation's physical heap directly and trips over the stranded rows' NULL values.

**Solution**: Run Citus's supported cleanup, `truncate_local_data_after_distributing_table('x')`, after distributing the table. It empties only the coordinator-local parent heap of distributed tables — never shard data. If a **non-distributed** table holds an FK referencing `x`, the function refuses to run (it will not implicitly TRUNCATE-cascade a local table). The correct fix is to make that referrer a proper distributed table co-located with `x` (not to drop/recreate the FK, and never to mutate `pg_dist_*` catalogs). See `server/migrations/20260513100800_distribute_email_reply_tokens.cjs`.

**The rule**: any migration that runs `create_distributed_table()` on a table that may already contain rows MUST immediately follow with `truncate_local_data_after_distributing_table()` on that table. Skipping it is invisible until the first parent-heap-scanning DDL (like `SET NOT NULL`) runs — possibly many migrations later.

## Best Practices

### 1. Always Check for Citus (Safely)

Before performing DDL that might behave differently on Citus, check if the table is distributed. **Important**: Wrap the check in try-catch since `pg_dist_partition` doesn't exist in standard PostgreSQL:

```javascript
let isCitusDistributed = false;
try {
  const citusCheck = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'table_name'::regclass
    ) as is_distributed
  `);
  isCitusDistributed = citusCheck.rows[0]?.is_distributed;
} catch (error) {
  // pg_dist_partition doesn't exist - standard PostgreSQL
  isCitusDistributed = false;
}

if (isCitusDistributed) {
  // Use Citus-specific approach
} else {
  // Use standard PostgreSQL approach
}
```

For new tenant tables, the shared helper `server/migrations/utils/citusDistribution.cjs` wraps this check: `ensureTenantDistribution(knex, 'my_table')` distributes on `tenant` colocated with `tenants`, and is a no-op on plain PostgreSQL or when the table is already distributed. Migrations that distribute must set `exports.config = { transaction: false }`. A new tenant table also needs registration in the query metadata registry — follow the checklist in [tenant-isolation.md](tenant-isolation.md).

**All distribution lives in `server/migrations`, guarded at runtime — never in a separate Citus-only track.** A creation migration distributes its own table in the same file. The former `ee/server/migrations/citus/` directory was never part of the migration workflow (its scripts were run against production manually in 2025) and has been removed; every tenant table it covered — plus the ~10 months of tables created afterwards without distribution — is converged by two catch-up migrations, `20260708120000_distribute_quotes_family_and_tax_reference_tables.cjs` and `20260708130000_distribute_remaining_tenant_tables.cjs`. A table skipped there deliberately (auth-token lookup tables, stripe control-plane, trigger-bearing tables, varchar-tenant families) is documented in the second file's header; do not distribute one without addressing the reason it was deferred.

### Distribution constraints (hard-won, Citus 12.1)

Rules `create_distributed_table` enforces that plain PostgreSQL never exercises — each of these has broken a real migration:

- The `PRIMARY KEY` and **every** UNIQUE constraint/index must include the distribution column (`tenant`), or distribution fails with `cannot create constraint`.
- Distributed tables cannot have triggers; drop them before distributing.
- A composite FK that includes `tenant` cannot use `ON DELETE SET NULL` (it would null the distribution column) — even the PG15 column-limited `SET NULL (col)` form is rejected, both at distribute time and at `ADD CONSTRAINT` time. Recreate such FKs as plain (NO ACTION) before distributing; deletes of the referenced row then block instead of auto-nulling.
- `colocate_with => 'tenants'` requires the distribution column type to match (`uuid`); a `varchar` tenant column cannot join the colocation group.
- Converting a table to a reference table pulls local tables that reference it into citus-local conversion, which fails if those referrers carry FKs to distributed tables. Drop the inbound FKs first, convert, distribute the referrers, then re-add the FKs (distributed → reference FKs are legal).
- FK cycles between tenant tables must be broken (drop one edge) before distributing and re-added afterwards.
- `DROP TRIGGER IF EXISTS` and similar DDL fail wholesale on an already-distributed table — guard repair steps with a `pg_dist_partition` check.

### 2. Use Raw SQL for DDL

Knex's schema builder may not handle Citus correctly. Use raw SQL:

```javascript
// ❌ Avoid
await knex.schema.alterTable('table', (table) => {
  table.string('column').notNullable().alter();
});

// ✅ Prefer
await knex.raw(`ALTER TABLE table ALTER COLUMN column SET NOT NULL`);
```

### 3. Make Migrations Idempotent

Always check if changes already exist:

```javascript
// Check if column exists
const columnExists = await knex.raw(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'table_name'
  AND column_name = 'column_name'
`);

if (columnExists.rows.length === 0) {
  // Add column
}
```

### 4. Verify Across All Shards

Don't just count - query actual data:

```javascript
// ❌ May miss issues
const count = await knex('table').whereNull('column').count();

// ✅ Better - forces distributed query
const rows = await knex.raw(`
  SELECT id FROM table WHERE column IS NULL LIMIT 10
`);
```

### 5. Use Citus Helper Functions

Citus provides functions specifically for distributed operations:

- `run_command_on_shards(table, command)` - Run SQL on all shards
- `run_command_on_all_nodes(command)` - Run on coordinator and all workers
- `run_command_on_workers(command)` - Run on all workers

Example:
```javascript
await knex.raw(`
  SELECT * FROM run_command_on_shards(
    'projects',
    $$UPDATE %s SET column = value WHERE condition$$
  )
`);
```

### 6. Add Appropriate Delays

After bulk updates in Citus, add delays:

```javascript
// After backfilling data
console.log('Waiting for distributed changes to propagate...');
await new Promise(resolve => setTimeout(resolve, 5000));
```

### 7. Truncate Local Data After Distributing a Non-Empty Table

Whenever a migration distributes a table that may already hold rows, follow it immediately with the official cleanup:

```javascript
await knex.raw("SELECT create_distributed_table('x', 'tenant', colocate_with => 'y')");
// REQUIRED follow-up — strands no shadow rows in the coordinator parent heap:
await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', ['x']);
```

Guard it so it stays a no-op on clean installs and re-runs: skip when Citus is absent, when the table is not distributed, or when `pg_relation_size('x'::regclass)` is already 0 (a cleanly-distributed table has a 0-byte parent heap). See Issue 4 for why omitting this surfaces as a confusing `SET NOT NULL` failure later.

## Testing Migrations

### Test on Both PostgreSQL and Citus

1. **Local development**: Usually runs standard PostgreSQL
2. **Staging**: Should mirror production (Citus if prod uses Citus)
3. **Production**: May use Citus

Ensure migrations work in all environments:

```javascript
// Good pattern - works everywhere
const isCitus = await knex.raw(`
  SELECT EXISTS (
    SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'table'::regclass
  ) as is_distributed
`);

if (isCitus.rows[0]?.is_distributed) {
  // Citus-specific logic
} else {
  // Standard PostgreSQL logic
}
```

## Migration Checklist

Before deploying a migration:

- [ ] Migration is idempotent (can be run multiple times safely)
- [ ] New tenant table calls `ensureTenantDistribution` in its creation migration (PK and uniques include `tenant`; no triggers; no composite `SET NULL` FKs — see Distribution constraints)
- [ ] If it distributes a possibly-non-empty table, it calls `truncate_local_data_after_distributing_table()` right after (see Issue 4)
- [ ] Tested on both PostgreSQL and CitusDB
- [ ] Large backfills include delays for propagation
- [ ] DDL changes check for Citus and handle appropriately
- [ ] Uses `exports.config = { transaction: false }` if needed
- [ ] Includes verification steps after data changes
- [ ] Has proper rollback logic in `exports.down`
- [ ] Logs progress for debugging

## References

- [Citus Documentation](https://docs.citusdata.com/)
- [Citus Schema-Based Sharding](https://docs.citusdata.com/en/stable/sharding/data_modeling.html)
- Migration example: `server/migrations/20251113120000_add_project_number.cjs`
