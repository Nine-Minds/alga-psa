import { afterAll, expect, it } from 'vitest';
import { MockActivityEnvironment } from '@temporalio/testing';
import { randomUUID } from 'node:crypto';
import { destroyAdminConnection, getAdminConnection } from '@alga-psa/db/admin';
import { createTestTenant } from './upgrade-test-fixtures';
import { setupTenantDataInDB, rollbackTenantInDB } from '../tenant-operations';

afterAll(destroyAdminConnection);

it('repeating tenant setup preserves existing settings and completes successfully', async () => {
  const db = await getAdminConnection();
  const activity = new MockActivityEnvironment();
  const { tenantId } = await createTestTenant(db, { name: `Setup retry ${randomUUID()}`, productCode: 'algadesk' });
  try {
    const first = await activity.run(setupTenantDataInDB, { tenantId });
    expect(first.setupSteps).toContain('tenant_settings');
    await db('tenant_settings').where({ tenant: tenantId }).delete();
    const before = await db('tenant_email_settings').where({ tenant: tenantId }).first();
    expect(before).toBeTruthy();
    const second = await activity.run(setupTenantDataInDB, { tenantId });
    expect(second.setupSteps).toContain('tenant_settings');
    expect(await db('tenant_email_settings').where({ tenant: tenantId }).first()).toEqual(before);
    expect((await db('tenant_settings').where({ tenant: tenantId }).first()).onboarding_completed).toBe(false);
  } finally {
    await activity.run(rollbackTenantInDB, tenantId);
  }
});
