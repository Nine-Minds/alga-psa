# E2E API Testing

This directory contains end-to-end tests for the REST API endpoints.

## Prerequisites

1. **Node.js**: Version 20.0.0 or higher is required
2. **Database**: Ensure PostgreSQL is running and properly configured
3. **Environment**: Set up your `.env` file with test database credentials
4. **Dependencies**: Install all npm dependencies

## Running E2E Tests

E2E tests require a running API server. Follow these steps:

### Step 1: Start the Development Server (Optional)

When running through Vitest, the E2E suite will try to start `npm run start:express` automatically if it does not detect a local server at `http://127.0.0.1:3000`. Starting the server manually is still recommended for faster feedback when iterating:

```bash
cd server
npm run dev
```

Wait for the server to start (usually at http://localhost:3000)

### Step 2: Run the E2E Tests

In another terminal, run the tests:

```bash
cd server
npm run test:local -- src/test/e2e/api/contacts.e2e.test.ts
```

## Test Structure

```
src/test/e2e/
├── api/
│   └── contacts.e2e.test.ts    # Contact API tests
├── utils/
│   ├── apiTestHelpers.ts       # API client and test utilities
│   ├── contactTestDataFactory.ts # Test data generators
│   ├── e2eTestSetup.ts         # Test environment setup
│   └── utilities.test.ts       # Utility function tests
└── README.md                   # This file
```

## Writing New E2E Tests

1. Create a new test file in `src/test/e2e/api/`
2. Use the test utilities from `utils/` directory
3. Follow the pattern established in `contacts.e2e.test.ts`

Example test structure:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';

describe('Your API E2E Tests', () => {
  let env;

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
  });

  afterEach(async () => {
    if (env) await env.cleanup();
  });

  it('should test your endpoint', async () => {
    const response = await env.apiClient.get('/api/v1/your-endpoint');
    expect(response.status).toBe(200);
  });
});
```

## Test Data Management

The test suite automatically:
- Creates a test tenant, company, user, and API key
- Cleans up all test data after each test
- Provides factories for creating test data

## Troubleshooting

### Tests fail with "ECONNREFUSED"
- The API server is not running
- Start the server with `npm run dev` before running tests

### Database connection errors
- Check your `.env` file has correct database credentials
- Ensure PostgreSQL is running
- Verify the test database exists

### API key errors
- The test setup automatically creates API keys
- Check the `api_keys` table is properly migrated

## Environment Variables

You can configure the test environment with:

- `TEST_API_BASE_URL`: Override the default API URL (default: http://localhost:3000)
- `DB_NAME_SERVER`: Test database name
- `DB_HOST`, `DB_PORT`, `DB_USER_ADMIN`, `DB_PASSWORD_ADMIN`: Database connection
