# Citus Migrations

These migrations are specifically for Citus (distributed PostgreSQL) environments.

## When to Run These Migrations

- **Production**: YES - Run together with base migrations in chronological order
- **Automated Testing (Argo)**: YES - Run together with base migrations in chronological order
- **Local Development**: NO - Skip these unless testing Citus specifically
- **Open Source**: NO - These are EE-only features

## Important: Migration Execution

These migrations use timestamp-based naming (same as main migrations) to ensure proper ordering.
When running in production or test environments:

```bash
# Copy all migrations to a single directory and run in chronological order
cp server/migrations/*.cjs temp_migrations/
cp ee/server/migrations/citus/*.cjs temp_migrations/
# Run migrations from temp_migrations/ in timestamp order
```

## Migration Files

1. `20250805000000_enable_citus_extension.cjs` - Enable Citus extension
2. `20250805000001_create_reference_tables.cjs` - Create reference tables (replicated to all nodes)
3. `20250805000002_distribute_tenant_and_user_tables.cjs` - Distribute foundational tenant/user tables
4. `20250805000003_distribute_company_tables.cjs` - Distribute company-related tables
5. `20250805000004_distribute_billing_and_service_tables.cjs` - Distribute billing and service catalog
6. `20250805000005_distribute_ticket_and_activity_tables.cjs` - Distribute tickets, projects, time tracking
7. `20250805000006_distribute_remaining_tables.cjs` - Distribute remaining tables (invoices, assets, workflows, etc.)

## Features

- **Idempotent**: Each migration checks if tables are already distributed before attempting distribution
- **Safe for partial deployments**: Works with environments that are partially distributed
- **Proper dependency ordering**: Tables are distributed in order of their foreign key dependencies

## Colocation Groups

- **Group 41**: Main distributed tables (tenant-partitioned) - default colocation
- **Group 48**: Reference tables (replicated across all workers)

## Distribution Keys

- Most tables use `tenant` as the distribution column
- Some email-related tables use `tenant_id` as the distribution column
- All distributed tables are colocated with the `tenants` table for efficient JOINs

## Rollback

Each migration includes a `down` function to undistribute tables if needed.
Note: Undistributing tables with large amounts of data can be slow and resource-intensive.