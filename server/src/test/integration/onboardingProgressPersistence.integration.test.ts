import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { persistTenantOnboardingProgress } from '@alga-psa/tenancy/server';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: Record<string, unknown>;

function tenantTable(tenant: string) {
  return tenantDb(db, tenant).table('tenant_settings');
}

function tenantRows() {
  return tenantDb(db, '__onboarding_progress_test__')
    .unscoped('tenants', 'integration fixture creates and removes tenant rows');
}

async function createTenant(): Promise<string> {
  const tenant = uuidv4();
  tenantsToCleanup.add(tenant);

  await tenantRows().insert({
    tenant,
    ...(Object.prototype.hasOwnProperty.call(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
      : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
    email: `tenant-${tenant.slice(0, 8)}@example.com`,
    ...(Object.prototype.hasOwnProperty.call(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(Object.prototype.hasOwnProperty.call(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return tenant;
}

describe('transaction-safe onboarding progress persistence', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await tenantRows().columnInfo();
  }, 180_000);

  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await tenantTable(tenant).delete().catch(() => undefined);
      await tenantRows().where({ tenant }).delete().catch(() => undefined);
      tenantsToCleanup.delete(tenant);
    }
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('inserts a missing row and atomically shallow-merges patches', async () => {
    const tenant = await createTenant();

    await persistTenantOnboardingProgress(db, tenant, {
      tenantName: 'Original tenant',
      clientName: 'Keep me',
      serviceName: 'Old service',
    });
    await persistTenantOnboardingProgress(db, tenant, {
      tenantName: undefined,
      serviceName: 'New service',
    });

    const row = await tenantTable(tenant).first('onboarding_data');
    expect(row?.onboarding_data).toMatchObject({
      tenantName: 'Original tenant',
      clientName: 'Keep me',
      serviceName: 'New service',
    });

    await tenantTable(tenant).update({ onboarding_data: null });
    await persistTenantOnboardingProgress(db, tenant, { boardName: 'Support' });

    const nullPatchedRow = await tenantTable(tenant).first('onboarding_data');
    expect(nullPatchedRow?.onboarding_data).toEqual({ boardName: 'Support' });
  });

  it('preserves both patches written concurrently by independent connections', async () => {
    const tenant = await createTenant();

    await Promise.all([
      persistTenantOnboardingProgress(db, tenant, { clientName: 'Concurrent client' }),
      persistTenantOnboardingProgress(db, tenant, { boardName: 'Concurrent board' }),
    ]);

    const row = await tenantTable(tenant).first('onboarding_data');
    expect(row?.onboarding_data).toMatchObject({
      clientName: 'Concurrent client',
      boardName: 'Concurrent board',
    });
  });

  it('rolls a progress patch back with its caller-owned transaction', async () => {
    const tenant = await createTenant();

    await expect(
      db.transaction(async (trx) => {
        await persistTenantOnboardingProgress(trx, tenant, { boardName: 'Rolled back' });
        throw new Error('deliberate rollback');
      })
    ).rejects.toThrow('deliberate rollback');

    expect(await tenantTable(tenant).first()).toBeUndefined();
  });
});
