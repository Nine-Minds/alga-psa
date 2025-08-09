# Email Settings Integration Tests

This directory contains integration tests for the email settings functionality, including OAuth flows, webhook processing, and email threading.

## Running the Tests

### Prerequisites

1. Start the test infrastructure:
```bash
# From the project root
docker-compose -f docker-compose.e2e-with-worker.yaml up -d
```

2. Wait for all services to be healthy:
```bash
docker-compose -f docker-compose.e2e-with-worker.yaml ps
```

### Running Tests

```bash
# Run all email settings tests
npm run test:e2e:email-settings

# Run specific test file
npm run test:e2e -- src/test/e2e/email-settings/oauth-flow.test.ts

# Run with debug output
DEBUG=* npm run test:e2e:email-settings

# Run specific test by name
npm run test:e2e:email-settings -- --grep "Microsoft OAuth"
```

### Test Structure

- **oauth-flow.test.ts**: Tests OAuth authorization flows for Microsoft and Google
- **webhook-processing.test.ts**: Tests webhook reception and validation
- **email-threading.test.ts**: Tests email to ticket creation and threading

### Debugging

1. **View MailHog emails**: http://localhost:8025
2. **View WireMock OAuth mocks**: http://localhost:8081/__admin
3. **View WireMock webhook mocks**: http://localhost:8080/__admin
4. **Check service logs**:
   ```bash
   docker-compose -f docker-compose.e2e-with-worker.yaml logs -f oauth-mock
   docker-compose -f docker-compose.e2e-with-worker.yaml logs -f workflow-worker-test
   ```

### Cleanup

```bash
# Stop and remove all test containers
docker-compose -f docker-compose.e2e-with-worker.yaml down -v
```

## Test Implementation Status

Many tests are written to handle cases where the actual OAuth and webhook endpoints aren't implemented yet. They will:
- Skip tests if endpoints return 404
- Create manual test data where needed
- Log warnings about unimplemented features

As the actual implementation progresses, these tests will automatically start validating the real functionality.