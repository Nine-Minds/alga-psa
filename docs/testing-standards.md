# Testing Standards

This document outlines testing conventions, file organization, and naming patterns for the Alga PSA codebase.

## Table of Contents

1. [Test Directory Structure](#test-directory-structure)
2. [Test Type Guidelines](#test-type-guidelines)
3. [File Naming Patterns](#file-naming-patterns)
4. [Test Organization Decision Tree](#test-organization-decision-tree)
5. [Running Tests](#running-tests)
6. [Test File Templates](#test-file-templates)
7. [Key Principles](#key-principles)

## Test Directory Structure

```
server/src/test/
├── unit/              # Isolated tests with mocked dependencies
│   ├── components/    # React component tests
│   ├── app/          # App-level tests (mirroring app structure)
│   ├── project-actions/  # Domain-specific action tests
│   └── workflow/     # Workflow-related tests
├── integration/       # Multi-component tests with real database
├── infrastructure/    # Full system scenarios (billing, invoicing, etc.)
├── e2e/              # End-to-end API and workflow tests
│   ├── api/          # REST API endpoint tests
│   ├── email-settings/  # Email workflow tests
│   ├── factories/    # Test data factories
│   ├── fixtures/     # Test fixtures
│   └── utils/        # E2E test utilities
├── mocks/            # Shared mocks
└── utils/            # General test utilities

ee/temporal-workflows/src/__tests__/
├── e2e/              # Temporal workflow E2E tests
└── activities/__tests__/  # Temporal activity tests
```

## Test Type Guidelines

### 1. Unit Tests (`server/src/test/unit/`)

**When to use:** Testing individual functions, classes, or components in isolation

**Naming convention:** `<feature>.test.ts` or `<ComponentName>.test.tsx`

**Location options:**
- **Centralized** (preferred): `server/src/test/unit/`
- **Colocated**: Next to source file (e.g., `lib/auth/sessionCookies.test.ts`)
  - Only use for utilities that are deeply coupled to their implementation

**Examples:**
- `bucketUsageService.test.ts` - Service function tests
- `auth.test.ts` - Authentication logic tests
- `EmailProviderConfiguration.test.tsx` - Component tests

**Characteristics:**
- Heavy use of mocks and stubs via Vitest's `vi.mock()`
- No real database connections
- Fast execution (< 1 second per test)
- Test single responsibility/function
- Use `@vitest-environment jsdom` comment for React component tests

**Subdirectory organization:**
- `components/` - UI component tests
- `app/` - Mirror app directory structure for page/route tests
- Domain-specific folders (e.g., `project-actions/`, `workflow/`)

### 2. Integration Tests (`server/src/test/integration/`)

**When to use:** Testing multiple components working together with real dependencies

**Naming convention:** `<feature>Integration.test.ts` or `<feature><Purpose>.test.ts`

**Examples:**
- `bucketUsageIntegration.test.ts`
- `emailProviderIntegration.test.ts`
- `googleProviderDatabase.test.ts`

**Characteristics:**
- Use real database connections via `createTenantKnex()`
- Test interactions between services, actions, and data layer
- Test data persistence and retrieval
- May use `TestContext` for setup
- Moderate execution time (1-5 seconds per test)

### 3. Infrastructure Tests (`server/src/test/infrastructure/`)

**When to use:** Testing complete business workflows and complex system scenarios

**Naming convention:**
- Simple features: `<feature>.test.ts`
- Complex features: `<feature>_<aspect>.test.ts` (split by concern)

**Examples:**
- `projectManagement.test.ts`
- `billingInvoiceGeneration_tax.test.ts`
- `billingInvoiceGeneration_discounts.test.ts`
- `billingInvoiceGeneration_edgeCases.test.ts`
- `creditExpirationCore.test.ts`

**Characteristics:**
- Full system testing with real database
- Test complete business workflows (billing cycles, invoice generation, etc.)
- Use `TestContext.createHelpers()` for comprehensive setup
- Long-running tests (5-30 seconds per test)
- Often require seed data and complex fixtures
- **Split large test suites** by aspect using underscore notation

**Database bring-up pattern (Billing suites):**
- Override pgbouncer defaults to connect directly to PostgreSQL in test runs (`process.env.DB_PORT = '5432'` and remap `DB_HOST` to `localhost` when necessary).
- Use the shared context harness: `const { beforeAll, beforeEach, afterEach, afterAll } = TestContext.createHelpers();`
- In `beforeAll`, call `setupContext({ runSeeds: true, cleanupTables: [...] })` to provision the tenant, preload reference data, and register table cleanups.
- Refresh the scoped context in `beforeEach` via `resetContext()`, then reseed tenant-scoped data (e.g., tax regions, numbering seeds) needed for each test.
- Roll back with `rollbackContext()` in `afterEach` and tear everything down with `cleanupContext()` in `afterAll` so temporary schemas/tables are dropped cleanly.

**When to split tests:**
- Test file exceeds 500 lines
- Multiple distinct concerns (tax, discounts, edge cases, etc.)
- Different setup requirements per concern
- Example: Invoice generation split into `_tax`, `_discounts`, `_subtotal`, `_edgeCases`, `_consistency`

### 4. E2E Tests (`server/src/test/e2e/`)

**When to use:** Testing complete user workflows, API endpoints, and system integration

**Naming convention:** `<feature>.e2e.test.ts`

**Examples:**
- `companies.e2e.test.ts` - Company API endpoints
- `email-only.e2e.test.ts` - Email workflow
- `oauth-flow.test.ts` - OAuth integration

**Subdirectory organization:**
- `api/` - REST API endpoint tests
  - Follow pattern: `<resource>.e2e.test.ts`
  - Example: `companies.e2e.test.ts`, `tickets.e2e.test.ts`
- `email-settings/` - Email-specific workflow tests
- `utils/` - E2E utilities (e.g., `e2eTestSetup.ts`, `apiTestHelpers.ts`)
- `factories/` - Test data factories for creating realistic test data
- `fixtures/` - Static test data files

**Characteristics:**
- Test complete API request/response cycles
- Authenticate with real API keys (via `x-api-key` header)
- Test full workflows end-to-end
- Use `setupE2ETestEnvironment()` helper
- Moderate to long execution time (5-30 seconds per test)
- Test authentication, authorization, validation, error handling

### 5. Temporal Workflow Tests (`ee/temporal-workflows/src/__tests__/`)

**When to use:** Testing Temporal workflows and activities (Enterprise Edition only)

**Naming convention:**
- E2E: `<workflow>.e2e.test.ts`
- Activities: `<activity>.test.ts` or `<activity>.temporal.test.ts`
- Standalone: `<activity>-standalone.test.ts`

**Examples:**
- `email-only.e2e.test.ts`
- `tenant-creation-workflow.e2e.test.ts`
- `email-activities.temporal.test.ts`
- `email-activities-standalone.test.ts`

**Subdirectory organization:**
- `e2e/` - Full workflow integration tests
- `activities/__tests__/` - Activity unit and integration tests

### 6. Playwright Tests (Browser E2E)

**When to use:** Testing browser-based user interactions (currently limited use)

**Location:** `ee/server/src/__tests__/integration/`

**Configuration:** `playwright.config.ts`

**Note:** Playwright is configured but not widely used. Most E2E testing uses Vitest.

### Playwright E2E (EE) With Fresh DB

For Enterprise Playwright browser tests (VS Code runner and CLI), we keep a clean, migrated, and seeded database at test-session startup. This avoids flakiness and makes tests deterministic.

- Where: `ee/server/src/__tests__/integration/**`
- Config: `ee/server/playwright.config.ts`, `ee/server/playwright.global-setup.ts`
- Bootstrap: `scripts/bootstrap-playwright-db.ts`

How It Works
- Fresh DB per Playwright session, before the web server starts:
  - `ee/server/playwright.config.ts` runs the DB bootstrap script in `webServer.command` before `npm run dev`:
    - `cd ../../ && node --import tsx/esm scripts/bootstrap-playwright-db.ts && NEXT_PUBLIC_EDITION=enterprise npm run dev`
  - In VS Code Playwright UI mode this runs once per “Restart” of the runner (session start). Click “Restart” in the Playwright panel to rebuild the DB.
- The bootstrap script:
  - Drops and recreates the Playwright test database, runs all migrations and seeds.
  - Provisions `app_user` and grants privileges.
  - Reads credentials from `server/.env` (override with `PLAYWRIGHT_DB_*`).
- globalSetup applies Playwright DB env so the dev server connects to the right DB.

Authentication in Playwright (avoiding login flakiness)
- Problem: Interactive login during Playwright runs is slow and brittle (middleware redirects, cookie domain/host, edge-runtime session token decoding, etc.).
- Solution: For UI automation we bypass interactive auth and keep routes accessible in test runs:
  - Add a targeted bypass in middleware for MSP routes when `E2E_AUTH_BYPASS=true`.
    - Code: `server/src/middleware.ts` guards `/msp/*` with `if (process.env.E2E_AUTH_BYPASS === 'true') return NextResponse.next()`.
  - Enable the bypass only for Playwright’s dev server:
    - `ee/server/playwright.config.ts` sets `env: { E2E_AUTH_BYPASS: 'true' }` in `webServer.env`.
  - Keep prod/staging secure: do not set `E2E_AUTH_BYPASS` outside of test/dev.
- Why this approach:
  - Eliminates cookie/host mismatch issues between `localhost` vs. `canonical.localhost`.
  - Avoids edge vs. node token decoding differences.
  - Focuses Playwright on UI correctness instead of auth.

Notes
- If a specific test must exercise auth flows, disable bypass for that test run (unset `E2E_AUTH_BYPASS`) and use a test-only auth helper to seed a valid session cookie on the expected host.
- For API E2E tests prefer `x-api-key` with per-test keys rather than browser sessions.

Test File Pattern (seeded data; no DB writes)
- Use an admin Knex connection to query seed data for test setup (bypasses RLS/ACL).
- Do not create tenants/users in tests. Pick a seeded user and mint a valid Auth.js cookie.

Template
```ts
// ee/server/src/__tests__/integration/my-feature.playwright.test.ts
import { test, expect } from '@playwright/test';
import { encode } from '@auth/core/jwt';
import { knex as createKnex } from 'knex';
import { PLAYWRIGHT_DB_CONFIG } from './utils/playwrightDatabaseConfig';

function adminDb() {
  return createKnex({
    client: 'pg',
    connection: {
      host: PLAYWRIGHT_DB_CONFIG.host,
      port: PLAYWRIGHT_DB_CONFIG.port,
      database: PLAYWRIGHT_DB_CONFIG.database,
      user: PLAYWRIGHT_DB_CONFIG.adminUser,   // admin for read access to seeds
      password: PLAYWRIGHT_DB_CONFIG.adminPassword,
    },
    pool: { min: 0, max: 5 },
  });
}

async function getSeededUser(db, email?: string) {
  if (email) {
    const row = await db('users').where({ email: email.toLowerCase() }).first();
    if (row) return row;
  }
  const any = await db('users').first();
  if (!any) throw new Error('No seeded users found. Check seeds.');
  return any;
}

async function setSessionCookie(page, user) {
  const token = await encode({
    token: {
      sub: user.user_id,
      id: user.user_id,
      email: user.email,
      tenant: user.tenant,
      user_type: user.user_type || 'client',
    },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: 60 * 60,
    salt: 'authjs.session-token',
  });
  await page.context().addCookies([{
    name: 'authjs.session-token',
    value: token,
    url: 'http://localhost:3000',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);
}

test.describe('My Feature', () => {
  test.setTimeout(180_000); // allow time for first-run migrations
  let db;
  test.beforeAll(async () => { db = adminDb(); });
  test.afterAll(async () => { await db?.destroy().catch(() => undefined); });

  test('happy path', async ({ page }) => {
    const seeded = await getSeededUser(db, process.env.CLIENT_PORTAL_TEST_EMAIL);
    await setSessionCookie(page, seeded);
    await page.goto('http://localhost:3000/some/route');
    await expect(page.getByText('Welcome')).toBeVisible();
  });
});
```

Running
- VS Code Playwright panel:
  - Click “Restart” to start a new session; the Runner executes the DB bootstrap and then starts Next. Subsequent runs reuse the server/DB until you restart.
- CLI:
  - `npx playwright test ee/server/src/__tests__/integration/<file>.playwright.test.ts`
  - The DB bootstrap runs before `npm run dev` (per session).

Variations
- Reset every run: set `reuseExistingServer: false` in `ee/server/playwright.config.ts`; the server restarts and the DB bootstrap re-runs on every test run.
- Per‑fixture reset (advanced): add a dev-only reset endpoint and POST it from `beforeAll`. Use only if you need frequent resets while keeping the server running.
## File Naming Patterns

| Test Type | Pattern | Example |
|-----------|---------|---------|
| Unit | `<feature>.test.ts` | `bucketUsageService.test.ts` |
| Unit (Component) | `<ComponentName>.test.tsx` | `EmailProviderConfiguration.test.tsx` |
| Integration | `<feature>Integration.test.ts` | `bucketUsageIntegration.test.ts` |
| Integration (Specific) | `<feature><Purpose>.test.ts` | `googleProviderDatabase.test.ts` |
| Infrastructure | `<feature>.test.ts` | `projectManagement.test.ts` |
| Infrastructure (Split) | `<feature>_<aspect>.test.ts` | `billingInvoiceGeneration_tax.test.ts` |
| E2E | `<feature>.e2e.test.ts` | `companies.e2e.test.ts` |
| Temporal E2E | `<workflow>.e2e.test.ts` | `email-only.e2e.test.ts` |
| Temporal Activity | `<activity>.temporal.test.ts` | `email-activities.temporal.test.ts` |

## Test Organization Decision Tree

```
Is it testing a single function/class/component in isolation?
├─ YES → Unit Test (server/src/test/unit/)
│   ├─ Component? → server/src/test/unit/components/<Component>.test.tsx
│   ├─ App route? → server/src/test/unit/app/<path>/page.test.ts
│   └─ Service/Action? → server/src/test/unit/<feature>.test.ts
│
└─ NO → Does it test multiple components together?
    ├─ YES → Integration Test (server/src/test/integration/)
    │   └─ server/src/test/integration/<feature>Integration.test.ts
    │
    └─ NO → Does it test complete business workflows?
        ├─ YES → Infrastructure Test (server/src/test/infrastructure/)
        │   ├─ Simple? → server/src/test/infrastructure/<feature>.test.ts
        │   └─ Complex? → Split by aspect:
        │       ├─ server/src/test/infrastructure/<feature>_<aspect1>.test.ts
        │       └─ server/src/test/infrastructure/<feature>_<aspect2>.test.ts
        │
        └─ NO → Does it test API endpoints or complete user flows?
            └─ YES → E2E Test (server/src/test/e2e/)
                ├─ API? → server/src/test/e2e/api/<resource>.e2e.test.ts
                └─ Workflow? → server/src/test/e2e/<workflow-name>/<feature>.test.ts
```

## Running Tests

### NPM Scripts

```bash
# All tests
npm test

# By type
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:infrastructure # Infrastructure tests only
npm run test:e2e           # E2E tests only

# Specific suites
npm run test:e2e:email-settings  # Email E2E tests

# Watch mode
npm run test:watch         # Run tests in watch mode

# Local with config
npm run test:local         # Run with local config
```

### Vitest Configuration

Tests use Vitest as the primary test runner, configured in `server/vitest.config.ts`:

- **Environment:** Node (default), jsdom (for React components)
- **Setup files:** `./src/test/setup.ts`
- **Global setup:** `./vitest.globalSetup.js`
- **Execution:** Single fork mode (for database isolation)
- **Timeout:** 20 seconds default

## Test File Templates

### Unit Test Template

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { functionUnderTest } from '@/lib/services/myService';

describe('MyService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('functionUnderTest', () => {
    it('should handle expected input correctly', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe('expected');
    });

    it('should throw error for invalid input', () => {
      // Arrange & Act & Assert
      expect(() => functionUnderTest(null)).toThrow();
    });
  });
});
```

### React Component Unit Test Template

```typescript
/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MyComponent } from '../../../components/MyComponent';

// Mock dependencies
vi.mock('../../../lib/actions/myActions', () => ({
  myAction: vi.fn(),
}));

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with default props', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('should handle user interaction', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);

    await user.click(screen.getByRole('button', { name: /click me/i }));

    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
    });
  });
});
```

### Integration Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { myService } from 'server/src/lib/services/myService';

describe('MyService Integration Tests', () => {
  let knex: Knex;
  let tenant: string;

  beforeAll(async () => {
    const { knex: testKnex, tenant: testTenant } = await createTenantKnex();
    knex = testKnex;
    tenant = testTenant || 'default-test-tenant';
  });

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up test data
    await knex('test_table').where('tenant', tenant).del();
  });

  describe('myService function', () => {
    it('should persist data to database correctly', async () => {
      // Arrange
      const testData = { name: 'test' };

      // Act
      await myService.create(testData);

      // Assert
      const result = await knex('test_table')
        .where('tenant', tenant)
        .first();
      expect(result.name).toBe('test');
    });
  });
});
```

### Infrastructure Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext } from '../../test-utils/testContext';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';

describe('Invoice Generation Infrastructure Tests', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'time_entries',
        'company_contract_lines'
      ],
      companyName: 'Test Company',
      userType: 'internal'
    });
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  describe('Complete Invoice Generation Workflow', () => {
    it('should generate invoice with correct tax calculations', async () => {
      // Arrange - Create complete test scenario
      const company = await context.createEntity('companies', {
        company_name: 'Test Company'
      });

      // Act - Execute business workflow
      const invoice = await generateInvoice(company.company_id);

      // Assert - Verify complete workflow results
      expect(invoice.total).toBeGreaterThan(0);
      expect(invoice.tax_amount).toBeDefined();
    });
  });
});
```

### E2E Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupE2ETestEnvironment, E2ETestEnvironment } from '../utils/e2eTestSetup';

describe('Companies API E2E Tests', () => {
  let env: E2ETestEnvironment;
  let createdCompanyIds: string[] = [];

  beforeAll(async () => {
    env = await setupE2ETestEnvironment({
      companyName: 'E2E Test Company',
      userName: 'e2e_test_user'
    });
  });

  afterAll(async () => {
    // Clean up created resources
    for (const id of createdCompanyIds) {
      try {
        await env.apiClient.delete(`/api/v1/companies/${id}`);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    await env.cleanup();
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await env.apiClient.get('/api/v1/companies');
      expect(response.status).toBe(401);
    });
  });

  describe('CRUD Operations', () => {
    it('should create a company', async () => {
      const response = await env.apiClient.post('/api/v1/companies', {
        company_name: 'New Company'
      });

      expect(response.status).toBe(201);
      expect(response.data.company_name).toBe('New Company');

      createdCompanyIds.push(response.data.company_id);
    });
  });
});
```

## Key Principles

### 1. Tests Should NOT Be Colocated by Default
- Use centralized test directories (`server/src/test/`)
- Only colocate in rare cases where test is deeply coupled to implementation
- Exception: Small utility functions that are rarely changed

### 2. Mirror Source Structure Within Test Directories
- Use subdirectories to organize by feature area
- Example: `test/unit/components/` for component tests
- Example: `test/e2e/api/` for API endpoint tests

### 3. Use Clear, Descriptive File Names
- Include `.e2e` suffix for E2E tests
- Include `Integration` or `<Purpose>` for integration tests
- Split complex features with underscore: `feature_aspect.test.ts`

### 4. Split Large Test Suites
- When test file exceeds 500 lines, split by concern
- Use underscore naming: `billingInvoiceGeneration_tax.test.ts`
- Keep related tests together: `feature_core.test.ts`, `feature_edgeCases.test.ts`

### 5. Follow the Test Type Hierarchy
- Start with unit tests (fast, isolated)
- Add integration tests (multi-component)
- Use infrastructure tests for complete workflows
- E2E tests for full API/user flows

### 6. Use Appropriate Test Utilities
- **Unit:** `vi.mock()` for mocking dependencies
- **Integration/Infrastructure:** `TestContext.createHelpers()` for database setup
- **E2E:** `setupE2ETestEnvironment()` for full environment setup

### 7. Database Testing Best Practices
- Always filter by tenant in all queries
- Clean up test data in `afterEach` or `afterAll`
- Use transactions where possible for isolation
- Ensure tests can run in any order
- For REST/E2E suites that need real HTTP semantics:
  - Spin up a lightweight HTTP server (e.g. Node's `http.createServer`) that delegates incoming requests to the Next.js route handlers using `NextRequest`.
  - Use `ApiTestClient` (or similar API helper) to exercise the endpoints the same way the product does, including headers, auth, and query parameters.
  - Manage the server lifecycle in `beforeAll`/`afterAll` so the listener is available across tests and shut down cleanly.
- When the test flow requires overlaid storage/migration behavior without a running application:
  - Ensure required tables exist by inspecting the schema and creating or altering tables as needed inside the test setup.
  - Create or update database roles (e.g. `app_user`) and grant privileges so the real connection pool can authenticate exactly as the application would.
- For isolation between tests while still hitting the live handlers:
  - Use `TestContext.createHelpers()` to wrap each test in a database transaction; perform per-test seeding after `beforeEach()` so every test sees a clean, consistent state.
  - If tests need to override service configuration (quotas, limits, etc.), use `vi.spyOn` to swap implementations temporarily, and restore them in `finally` blocks.

### 8. Mock External Dependencies
- Mock external APIs (email providers, payment gateways, etc.)
- Use `vi.mock()` for module-level mocks
- Create reusable mock fixtures in `test/mocks/`

### 9. Test Naming Conventions
- Describe what is being tested: `describe('MyService')`
- Use "should" statements: `it('should return correct value')`
- Be specific about scenarios: `it('should throw error for invalid input')`

### 10. Assertion Best Practices
- Use descriptive assertions: `expect(result.name).toBe('expected')`
- Test both happy path and error cases
- Verify side effects (database changes, API calls, etc.)
- Use `toThrow()` for error testing

### 11. Use Updated Billing Terminology
- Refer to billing `contract lines` and `contracts` instead of the legacy `plans` and `bundles`.
- When bringing in legacy helpers (e.g., `createFixedPlanAssignment`), alias them to the new naming in your test files so intent stays aligned with the schema.

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library Documentation](https://testing-library.com/)
- [Contact API E2E Test Plan](./contact-api-e2e-test-plan.md) - Example E2E test implementation
- [Inbound Email Testing Guide](./inbound-email/development/testing.md) - Email workflow testing examples
