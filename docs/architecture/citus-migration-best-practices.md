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
