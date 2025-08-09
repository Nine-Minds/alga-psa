# Temporal Workflows Database Migration Plan

## Intro / Rationale

This plan outlines the migration of temporal workflows from using their own database connection logic (`/ee/temporal-workflows/src/db/connection.ts`) to using the shared database libraries (`/shared/db/admin.ts`). The primary goals are:

- **Simplify database connection management** by removing duplicate connection logic
- **Standardize environment variables** by eliminating ALGA_DB_* variables in favor of standard DB_* variables
- **Improve maintainability** by using the shared Knex-based connection pool
- **Reduce configuration complexity** in Kubernetes deployments

### Success Criteria
- All temporal workflow database operations use the shared admin connection
- No ALGA_DB_* environment variables remain in the codebase
- All raw SQL queries are converted to Knex queries
- Temporal workflows continue to function correctly with the new connection method

## Phased Implementation Checklist

### Phase 1: Pre-Migration Verification
- [x] Verify that shared/db/admin.ts is available in temporal workflow container
  - [x] Check Dockerfile includes shared directory - Fixed to build from project root
  - [x] Verify TypeScript compilation includes shared modules - Updated tsconfig.json
- [x] Update Docker build process to include shared directory - Updated deploy.sh
- [ ] Test shared database connection in a development environment

### Phase 2: Code Migration - Database Operations
- [x] Update temporal-workflows package.json to ensure shared dependencies are included - Already has knex
- [x] Migrate `src/db/tenant-operations.ts`:
  - [x] Import `getAdminConnection` from shared/db/admin.ts
  - [x] Convert `createTenantInDB` to use Knex queries
  - [x] Convert `setupTenantDataInDB` to use Knex queries
  - [x] Convert `rollbackTenantInDB` to use Knex queries
  - [x] Remove executeTransaction wrapper, use Knex transactions
- [x] Migrate `src/db/user-operations.ts`:
  - [x] Import `getAdminConnection` from shared/db/admin.ts
  - [x] Convert `createAdminUserInDB` to use Knex queries
  - [x] Convert `rollbackUserInDB` to use Knex queries
  - [ ] Update password hashing to use proper bcrypt implementation - TODO later
- [x] Delete `src/db/connection.ts` file entirely
- [ ] Run unit tests to verify query conversions

### Phase 3: Environment Variable Updates
- [x] Update temporal-workflows Kubernetes deployment (`k8s/deployment.yaml`):
  - [x] Remove all ALGA_DB_* environment variables (lines 40-59)
  - [x] Add standard DB_* environment variables:
    - [x] DB_HOST
    - [x] DB_PORT
    - [x] DB_NAME_SERVER
    - [x] DB_USER_SERVER
    - [x] DB_PASSWORD_SERVER (from secret)
    - [x] DB_USER_ADMIN
    - [x] DB_PASSWORD_ADMIN (from secret)
  - [x] Update secret references to use correct keys
- [x] Search entire codebase for any remaining ALGA_DB_* references
  - [x] None found except in this migration plan
  - [x] No other configuration files need updating


## Background Details / Investigation / Implementation Advice

### Current Architecture
The temporal workflows currently use a custom PostgreSQL connection pool (`pg` library) with these characteristics:
- Direct PostgreSQL connections using `pg.Pool`
- Custom transaction wrapper functions
- Support for both regular and admin database connections
- Environment variables prefixed with ALGA_DB_*

### Target Architecture
The shared database connection uses:
- Knex.js as the query builder and connection manager
- Built-in connection pooling with configurable limits
- Standard DB_* environment variables
- Integrated secret management via `getSecret()`

### Code Conversion Examples

#### Converting Raw SQL to Knex

**Current (Raw SQL):**
```typescript
const result = await client.query(
  'SELECT user_id FROM users WHERE email = $1 AND tenant = $2',
  [input.email, input.tenantId]
);
```

**Target (Knex):**
```typescript
const result = await knex('users')
  .select('user_id')
  .where({ email: input.email, tenant: input.tenantId });
```

#### Converting Transactions

**Current (pg transaction):**
```typescript
await executeTransaction(adminDb, async (client) => {
  await client.query('BEGIN');
  // operations
  await client.query('COMMIT');
});
```

**Target (Knex transaction):**
```typescript
await knex.transaction(async (trx) => {
  // operations using trx instead of client
});
```

### Environment Variable Mapping
- `ALGA_DB_HOST` → `DB_HOST`
- `ALGA_DB_PORT` → `DB_PORT`
- `ALGA_DB_NAME` → `DB_NAME_SERVER`
- `ALGA_DB_USER` → `DB_USER_SERVER`
- `ALGA_DB_PASSWORD` → `DB_PASSWORD_SERVER`
- `ALGA_DB_ADMIN_USER` → `DB_USER_ADMIN`
- `ALGA_DB_ADMIN_PASSWORD` → `DB_PASSWORD_ADMIN`

### Potential Pitfalls
1. **Import paths**: Ensure correct relative imports from temporal-workflows to shared directory
2. **TypeScript compilation**: Verify shared modules are included in the build
3. **Connection pooling**: Monitor pool size as shared connection has different defaults
4. **Error handling**: Knex errors have different structure than pg errors
5. **Query result format**: Knex returns arrays directly, not `{ rows: [...] }`

### Testing Strategy
1. Unit tests with mocked database connections
2. Integration tests against test database
3. End-to-end workflow tests in Temporal

## Implementer's Scratch Pad

### Implementation Notes
_Space for tracking observations during implementation_

---

### Issues Encountered
_Document any problems and their resolutions_

---

### Deviations from Plan
_Record any changes from the original plan and why_

---

### Performance Metrics
_Before and after metrics_

- Connection pool size:
- Average query time:
- Workflow execution time:
- Memory usage:

---

### Questions for Review
_Items needing clarification or decisions_

---

### Test Results
_Summary of test outcomes_

- Development environment:
- Staging environment:
- Load test results:

---

### Deployment Log
_Track deployment progress_

- [ ] Development: Date/Time/Version
- [ ] Staging: Date/Time/Version
- [ ] Production: Date/Time/Version

---

### Post-Deployment Observations
_24-hour monitoring results_

---