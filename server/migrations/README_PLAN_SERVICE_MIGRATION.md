# Plan Service Configuration Migration Guide

This document provides information about the Plan Service Configuration Enhancement Project migration process.

## Overview

The Plan Service Configuration Enhancement Project restructures the billing system to move service-specific configuration from plan level to service-within-plan level. This involves:

1. Creating new normalized database tables for service configurations
2. Migrating existing data from the `plan_services` table to the new structure
3. Ensuring CitusDB compatibility throughout the process

## Migration Files

The migration consists of two main files:

1. `20250318200000_create_plan_service_configuration_tables.cjs` - Creates all the new tables
2. `20250318200100_migrate_plan_services_data.cjs` - Migrates data from existing tables to the new structure

## New Database Schema

The new schema includes the following tables:

- `plan_service_configuration` (base table)
- `plan_service_fixed_config`
- `plan_service_hourly_config`
- `plan_service_usage_config`
- `plan_service_bucket_config`
- `plan_service_rate_tiers`
- `user_type_rates` (optional)

### Key Relationships

- `billing_plans` (1) → (n) `plan_service_configuration`
- `plan_service_configuration` (n) ← (1) `service_catalog`
- `plan_service_configuration` (1) → (0/1) `plan_service_fixed_config`
- `plan_service_configuration` (1) → (0/1) `plan_service_hourly_config`
- `plan_service_configuration` (1) → (0/1) `plan_service_usage_config`
- `plan_service_configuration` (1) → (0/1) `plan_service_bucket_config`
- `plan_service_configuration` (1) → (n) `plan_service_rate_tiers`

## CitusDB Compatibility

All tables and migrations follow CitusDB compatibility requirements:

- All tables include the `tenant` column as part of primary key or unique constraints
- All indexes include the tenant column first
- Data migration processes records in batches by tenant
- Transactions are used to ensure data consistency
- All queries include tenant in WHERE clauses

## Running the Migration

To run the migration:

```bash
# From the server directory
npm run migrate
```

## Verifying the Migration

A verification script is provided to check that the migration was successful:

```bash
# From the server directory
node scripts/verify-plan-service-migration.js
```

The script checks:

1. All plan services have been migrated to the new tables
2. Configuration types match the original plan types
3. All required data is present in the type-specific configuration tables

## Rollback Considerations

The schema migration can be rolled back using:

```bash
# From the server directory
npm run migrate:rollback
```

However, the data migration does not have an automatic rollback. If you need to roll back after the data migration has run, you should:

1. Restore from a database backup, or
2. Manually recreate the plan_services data from the new configuration tables

## Next Steps After Migration

After the migration is complete:

1. Update TypeScript interfaces to use the new schema
2. Modify the billing engine to use the new configuration tables
3. Update the UI to handle per-service configurations