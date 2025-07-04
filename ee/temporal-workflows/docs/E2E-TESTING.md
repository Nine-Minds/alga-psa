# E2E Testing Guide

This guide explains how to run End-to-End (E2E) tests for the Temporal workflows.

## Overview

Our E2E testing strategy uses:
- **Temporal TestWorkflowEnvironment** for time-skipping unit tests
- **temporalio/auto-setup Docker container** for full integration tests
- **Main application database** for realistic data validation
- **Vitest** as the test runner with proper timeout configuration

## Test Types

### 1. Unit Tests (Database Logic)
Location: `src/activities/__tests__/*-simple.test.ts`
- Test database operations without Temporal context
- Fast execution, isolated test data
- Focus on business logic validation

```bash
npm run test:unit
```

### 2. E2E Tests (Full Workflow)
Location: `src/__tests__/e2e/*.e2e.test.ts`
- Test complete workflows with Temporal
- Real activity execution with database operations
- End-to-end validation of business processes

```bash
npm run test:e2e
```

## Prerequisites

1. **Main Application Database**: Must be running on port 5432
   ```bash
   cd /Users/robertisaacs/alga-psa
   docker-compose -f docker-compose.base.yaml up -d postgres
   ```

2. **Node.js 20+**: Required for Temporal SDK compatibility

3. **Docker**: For running Temporal test environment

## Running E2E Tests

### Method 1: Using NPM Scripts (Recommended)

```bash
# Run E2E tests once
npm run test:e2e

# Run E2E tests in watch mode
npm run test:e2e:watch

# Run all tests (unit + E2E)
npm run test:all
```

### Method 2: Manual Docker Setup

```bash
# Start Temporal test environment
npm run docker:test:up

# Wait for services to be ready (check logs)
docker-compose -f docker-compose.test.yml logs -f

# Run tests manually
npm test -- src/__tests__/e2e

# Clean up
npm run docker:test:down
```

### Method 3: Using Test Script

```bash
# Run the comprehensive E2E test script
./scripts/test-e2e.sh

# Run in watch mode
./scripts/test-e2e.sh --watch
```

## Test Environment Configuration

### Environment Files

- `.env.test`: Unit test configuration (uses main app DB)
- `.env.e2e`: E2E test configuration (Temporal + main app DB)

### Docker Services

**docker-compose.test.yml** includes:
- `temporal`: Temporal server with auto-setup
- `postgres`: Dedicated PostgreSQL for Temporal metadata
- `temporal-admin-tools`: CLI tools for debugging

### Ports

- **7233**: Temporal gRPC endpoint
- **8233**: Temporal Web UI (http://localhost:8233)
- **5433**: Temporal PostgreSQL
- **5432**: Main application PostgreSQL (external)

## Test Configuration

### Vitest Settings

```typescript
{
  testTimeout: 120000, // 2 minutes for E2E tests
  hookTimeout: 60000,  // 1 minute for setup/teardown
  pool: 'forks',       // Required for Temporal
  poolOptions: {
    forks: { singleFork: true } // Prevent concurrent environments
  }
}
```

### Temporal Settings

```typescript
{
  address: 'localhost:7233',
  namespace: 'default',
  taskQueue: 'e2e-temporal-workflows'
}
```

## Writing E2E Tests

### Basic Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import * as activities from '../../activities';
import { myWorkflow } from '../../workflows/my-workflow';

describe('My Workflow E2E', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('should complete workflow successfully', async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-queue',
      workflowsPath: require.resolve('../../workflows'),
      activities,
    });

    const handle = await testEnv.client.workflow.start(myWorkflow, {
      args: [{ input: 'test' }],
      taskQueue: 'test-queue',
      workflowId: 'test-' + Date.now(),
    });

    const result = await handle.result();
    expect(result.success).toBe(true);

    await worker.shutdown();
  });
});
```

### Best Practices

1. **Unique Test Data**: Use timestamps to avoid conflicts
   ```typescript
   const timestamp = Date.now();
   const email = `test-${timestamp}@example.com`;
   ```

2. **Proper Cleanup**: Always clean up test data
   ```typescript
   afterEach(async () => {
     await testDb.cleanup();
   });
   ```

3. **Realistic Data**: Use actual database operations
   ```typescript
   // Verify in database, not just workflow result
   const tenant = await testDb.getTenant(result.tenantId);
   expect(tenant.company_name).toBe(input.tenantName);
   ```

4. **Error Testing**: Test failure scenarios
   ```typescript
   await expect(handle.result()).rejects.toThrow('Expected error');
   ```

## Debugging

### Temporal Web UI
Visit http://localhost:8233 when test environment is running to:
- View workflow executions
- Inspect workflow history
- Debug failed workflows

### Logs
```bash
# View Temporal server logs
docker-compose -f docker-compose.test.yml logs temporal

# View PostgreSQL logs
docker-compose -f docker-compose.test.yml logs postgres
```

### Database Inspection
```bash
# Connect to test database
docker exec -it temporal-workflows-postgres-1 psql -U temporal -d temporal

# Connect to main app database
docker exec -it alga-psa-postgres-1 psql -U postgres -d server
```

## Troubleshooting

### Common Issues

1. **Timeout Errors**: Increase test timeouts in vitest.config.ts
2. **Port Conflicts**: Ensure ports 7233, 8233, 5433 are available
3. **Database Connection**: Verify main app database is running
4. **Memory Issues**: Use `singleFork: true` in Vitest pool options

### Error: "Main application database not running"
```bash
cd /Users/robertisaacs/alga-psa
docker-compose -f docker-compose.base.yaml up -d postgres
```

### Error: "Temporal connection failed"
```bash
# Restart test environment
npm run docker:test:down
npm run docker:test:up
```

### Error: "Test timeout"
- Check Temporal Web UI for stuck workflows
- Increase timeouts in vitest.config.ts
- Verify all services are healthy

## Performance

### Expected Test Times
- Basic setup test: ~10-30 seconds
- Simple workflow test: ~30-60 seconds  
- Complex workflow test: ~1-2 minutes

### Optimization Tips
- Use `TestWorkflowEnvironment.createTimeSkipping()` for faster tests
- Minimize database operations in tests
- Use test data factories for consistent setup
- Run tests in single fork mode to avoid conflicts

## Integration with CI/CD

```yaml
# Example GitHub Actions step
- name: Run E2E Tests
  run: |
    docker-compose -f docker-compose.base.yaml up -d postgres
    npm run test:e2e
  env:
    NODE_ENV: test
```

For more details, see the test files in `src/__tests__/e2e/` and the setup utilities in `src/test-utils/`.