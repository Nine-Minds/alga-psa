# Persistent E2E Test Harness

This guide explains how to use the persistent E2E test harness for faster and more efficient testing.

## Overview

The persistent test harness starts all required services once and keeps them running while you run multiple test suites. This eliminates the overhead of starting/stopping Docker containers for each test run, making E2E tests much faster.

## Architecture

### Services Included
- **PostgreSQL** (port 5433) - Test database
- **Redis** (port 6380) - Test cache and workflow events
- **MailHog** (ports 1025/8025) - Email capture for testing
- **Workflow Worker** (port 4001) - Processes workflow events
- **Webhook Mock** (port 8080) - Mock external webhooks

### Test Optimization
- Services start once and stay running
- Only test data is cleaned between tests
- Database connections are reused
- Faster service health checks
- Reduced timeouts for warm services

## Quick Start

### 1. Start the Test Harness
```bash
npm run test:harness:start
```

This will:
- Start all Docker services
- Wait for health checks to pass
- Display service status
- Keep services running in the background

### 2. Run E2E Tests
```bash
# Run optimized email processing tests
npm test src/test/e2e/email-processing-persistent.test.ts

# Or run any E2E test against the persistent harness
npm test src/test/e2e/
```

### 3. Check Service Status
```bash
npm run test:harness:status
```

### 4. Stop the Test Harness (when done)
```bash
npm run test:harness:stop
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run test:harness:start` | Start all test services |
| `npm run test:harness:stop` | Stop all test services |
| `npm run test:harness:restart` | Restart all test services |
| `npm run test:harness:status` | Check service health status |
| `npm run test:harness:logs` | View logs from all services |
| `npm run test:harness:logs mailhog` | View logs from specific service |
| `npm run test:harness:reset` | Reset test data without restarting services |

## Performance Comparison

### Traditional E2E Tests
- **Setup time**: 30-60 seconds per test suite
- **Teardown time**: 10-20 seconds per test suite
- **Total overhead**: 40-80 seconds per test suite

### Persistent Harness E2E Tests
- **Setup time**: 2-5 seconds per test suite
- **Teardown time**: 1-2 seconds per test suite
- **Total overhead**: 3-7 seconds per test suite

**Result**: 80-90% reduction in test overhead time!

## Usage Patterns

### Development Workflow
```bash
# Start harness once in the morning
npm run test:harness:start

# Run tests throughout the day
npm test src/test/e2e/email-processing-persistent.test.ts
npm test src/test/e2e/workflow-integration.test.ts

# Stop harness at end of day
npm run test:harness:stop
```

### CI/CD Pipeline
```bash
# In your CI script
npm run test:harness:start
npm test src/test/e2e/
npm run test:harness:stop
```

### Debugging
```bash
# Start harness
npm run test:harness:start

# View logs while running tests
npm run test:harness:logs

# Check specific service
npm run test:harness:logs workflow-worker-test
```

## Test Files

### Optimized Tests
- `email-processing-persistent.test.ts` - Email processing with persistent harness
- Use `PersistentE2ETestContext` for faster setup/teardown

### Traditional Tests (still available)
- `email-processing.test.ts` - Email processing with service startup/shutdown
- Use `E2ETestContext` for isolated service management

## Troubleshooting

### Services Not Starting
```bash
# Check Docker is running
docker info

# Check port conflicts
lsof -i :5433  # PostgreSQL
lsof -i :6380  # Redis
lsof -i :8025  # MailHog
lsof -i :4001  # Workflow Worker

# View detailed logs
npm run test:harness:logs
```

### Test Failures
```bash
# Check service health
npm run test:harness:status

# Reset test data
npm run test:harness:reset

# Restart if needed
npm run test:harness:restart
```

### Port Conflicts
If you have conflicts with existing services:

1. Stop conflicting services
2. Or modify ports in `docker-compose.e2e-with-worker.yaml`
3. Update corresponding URLs in test configuration

## Best Practices

### 1. Start Harness Before Development
Always start the harness at the beginning of your development session:
```bash
npm run test:harness:start
```

### 2. Monitor Service Health
Periodically check that services are healthy:
```bash
npm run test:harness:status
```

### 3. Reset Data When Needed
If tests start behaving unexpectedly, reset the data:
```bash
npm run test:harness:reset
```

### 4. Use Persistent Tests
For regular development, use the optimized persistent test files:
```bash
npm test src/test/e2e/email-processing-persistent.test.ts
```

### 5. Clean Shutdown
Always stop the harness when done to free resources:
```bash
npm run test:harness:stop
```

## Configuration

### Service Ports
- PostgreSQL: 5433 (different from production 5432)
- Redis: 6380 (different from production 6379)
- MailHog SMTP: 1025
- MailHog Web: 8025
- Workflow Worker: 4001
- Webhook Mock: 8080

### Environment Variables
The persistent harness automatically sets:
- `DB_HOST=localhost`
- `DB_PORT=5433`
- `DB_NAME_SERVER=server`
- `REDIS_HOST=localhost`
- `REDIS_PORT=6380`
- `EMAIL_HOST=localhost`
- `EMAIL_PORT=1025`

## Extending the Harness

### Adding New Services
1. Add service to `docker-compose.e2e-with-worker.yaml`
2. Add health check to `scripts/test-harness.js`
3. Update `PersistentE2ETestContext.verifyServicesRunning()`

### Custom Test Context
Create your own persistent test context by extending `PersistentE2ETestContext`:

```typescript
import { PersistentE2ETestContext } from './utils/persistent-test-context';

export class MyCustomTestContext extends PersistentE2ETestContext {
  // Add custom setup/teardown logic
}
```