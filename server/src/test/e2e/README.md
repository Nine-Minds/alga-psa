# E2E API Testing

These HTTP tests exercise a running application with real API keys and persisted tenant data. For release evidence, start the candidate production build and its migrated, isolated database before running the suite. The fixture connects to that database; it does not recreate it, run migrations, or relax application constraints.

## Running the API suite

Install the repository dependencies using its pinned Node/npm versions. Configure every variable below explicitly for an owned test stack; do not use a shared deployment database.

```bash
export TEST_API_BASE_URL=http://127.0.0.1:3000
export E2E_DATABASE_ISOLATED=true
export E2E_DB_HOST=127.0.0.1
export E2E_DB_PORT=55432
export E2E_DB_NAME=owned_api_test
export E2E_DB_USER=fixture_user
# Set E2E_DB_PASSWORD to the password provisioned for the owned stack.

cd server
npx vitest list --config vitest.api-e2e.config.ts --json=api-collected.json
npx vitest run --config vitest.api-e2e.config.ts \
  --reporter=default --reporter=json --outputFile.json=api-results.json
```

The database name must identify a dedicated test database. Ambient `DB_*`, `PGBOUNCER_*`, and `TEST_DB_NAME` settings do not select this fixture's connection. The URL must use HTTP or HTTPS without embedded credentials. The application must report healthy at `/api/health`; these tests will fail instead of starting a replacement Express server when the candidate is unavailable.

To narrow a local diagnosis, add a file filter such as `src/test/e2e/api/storage.e2e.test.ts`. A filtered run is not evidence that the full suite passed.

This configuration collects HTTP API files only. `xeroCallbackAccessLog.e2e.test.ts` starts Next.js in development mode and asserts development access logs, so it requires a separate runner. Playwright tests also retain their own configurations. Collection does not establish CI assignment or successful execution; that wiring and the full-suite baseline remain tracked in the production regression prevention plan.

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
- Creates a test tenant, client, user, and API key
- Cleans up all test data after each test
- Provides factories for creating test data

## Troubleshooting

- If readiness fails, inspect the candidate application's health and logs before rerunning. Do not substitute a different application build.
- If database connection fails, verify the explicit `E2E_DB_*` settings and that the application uses the same database.
- If a fixture fails on a constraint, fix its data or prove an application migration defect. Do not alter production constraints in test setup.
- Test cleanup must remove only the tenant created for that test and close its connection. Add cleanup for new dependent records when introducing fixtures.
