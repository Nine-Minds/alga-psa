'use strict';

import { test as base } from '@playwright/test';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../../lib/testing/tenant-test-factory';

export type { TenantTestData };

type DbFixtures = {
  db: Knex;
  tenant: TenantTestData;
};

export const test = base.extend<DbFixtures>({
  // Provide a shared DB connection per worker
  db: [async ({}, use) => {
    const db = createTestDbConnection();
    await use(db);
    await db.destroy().catch(() => undefined);
  }, { scope: 'worker' } as any],

  // Create a unique tenant per worker to isolate tests without resetting DB
  tenant: [async ({ db }, use, workerInfo) => {
    const tenant = await createTestTenant(db, {
      companyName: `PW Tenant ${workerInfo.workerIndex}-${Date.now()}`,
    });
    await use(tenant);
    // Optional: do not rollback to keep artifacts for debugging; tests should clean their own data
    // If needed, you can import rollbackTenant and call it here.
  }, { scope: 'worker' } as any],
});

export const expect = test.expect;

