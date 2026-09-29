import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { MockActivityEnvironment } from '@temporalio/testing';
import { randomUUID } from 'node:crypto';
import { destroyAdminConnection, getAdminConnection } from '@alga-psa/db/admin';
import { createTenant, setupTenantData, rollbackTenant } from '../tenant-activities';
import type { CreateTenantActivityInput } from '../../types/workflow-types';

const activity = new MockActivityEnvironment();
const owned = new Set<string>();
const input = (patch: Partial<CreateTenantActivityInput> = {}): CreateTenantActivityInput => {
  const tenantId = randomUUID();
  owned.add(tenantId);
  return { tenantId, tenantName: `Activity tenant ${tenantId}`, email: `ADMIN-${tenantId}@example.test`, ...patch };
};
afterEach(async () => {
  for (const tenantId of owned) await activity.run(rollbackTenant, tenantId);
  owned.clear();
});
afterAll(destroyAdminConnection);

describe('Tenant activities against migrated schema', () => {
  it.each([
    { companyName: 'Company', clientName: 'MSP client', expectedTenant: 'Company', expectedClient: 'MSP client' },
    { companyName: 'Fallback company', expectedTenant: 'Fallback company', expectedClient: 'Fallback company' },
    { expectedTenant: undefined, expectedClient: undefined },
  ])('persists tenant and optional client for $expectedClient', async ({ expectedTenant, expectedClient, ...names }) => {
    const request = input(names);
    const result = await activity.run(createTenant, request);
    const db = await getAdminConnection();
    expect(result.tenantId).toBe(request.tenantId);
    expect(await db('tenants').where({ tenant: result.tenantId }).first()).toMatchObject({
      client_name: expectedTenant ?? request.tenantName, email: request.email.toLowerCase(),
    });
    const clients = await db('clients').where({ tenant: result.tenantId });
    if (expectedClient) {
      expect(clients).toEqual([expect.objectContaining({ client_id: result.clientId, client_name: expectedClient })]);
    } else {
      expect(result.clientId).toBeUndefined();
      expect(clients).toEqual([]);
    }
  });

  it('allows separate tenants with the same name', async () => {
    const first = await activity.run(createTenant, input({ tenantName: 'Shared display name' }));
    const second = await activity.run(createTenant, input({ tenantName: 'Shared display name' }));
    expect(first.tenantId).not.toBe(second.tenantId);
    const db = await getAdminConnection();
    expect(await db('tenants').whereIn('tenant', [first.tenantId, second.tenantId])).toHaveLength(2);
  });

  it('sets up email, onboarding and client association and preserves them on retry', async () => {
    const { tenantId, clientId } = await activity.run(createTenant, input({ clientName: 'Setup MSP' }));
    const request = { tenantId, clientId, adminUserId: randomUUID() };
    const first = await activity.run(setupTenantData, request);
    expect(first.setupSteps).toEqual(expect.arrayContaining(['email_settings', 'tenant_settings', 'tenant_client_association']));
    const db = await getAdminConnection();
    expect(await db('tenant_companies').where({ tenant: tenantId }).first()).toMatchObject({ client_id: clientId, is_default: true });
    const email = await db('tenant_email_settings').where({ tenant: tenantId }).first();
    expect(email).toMatchObject({ email_provider: 'resend' });
    expect(await db('tenant_settings').where({ tenant: tenantId }).first()).toMatchObject({ onboarding_completed: false });
    await db('tenant_settings').where({ tenant: tenantId }).update({ onboarding_completed: true });
    await activity.run(setupTenantData, request);
    expect(await db('tenant_email_settings').where({ tenant: tenantId }).first()).toEqual(email);
    expect(await db('tenant_companies').where({ tenant: tenantId })).toHaveLength(1);
    expect(await db('tenant_settings').where({ tenant: tenantId }).first()).toMatchObject({ onboarding_completed: true });
  });

  it('rolls back tenant data without removing another tenant', async () => {
    const target = await activity.run(createTenant, input({ clientName: 'Rollback MSP' }));
    const survivor = await activity.run(createTenant, input({ clientName: 'Surviving MSP' }));
    await activity.run(setupTenantData, { ...target, adminUserId: randomUUID() });
    await activity.run(rollbackTenant, target.tenantId);
    const db = await getAdminConnection();
    for (const table of ['tenants', 'clients', 'tenant_settings', 'tenant_email_settings', 'tenant_companies']) {
      expect(await db(table).where({ tenant: target.tenantId })).toEqual([]);
    }
    expect(await db('tenants').where({ tenant: survivor.tenantId }).first()).toBeTruthy();
    expect(await db('clients').where({ tenant: survivor.tenantId })).toHaveLength(1);
    await expect(activity.run(rollbackTenant, target.tenantId)).resolves.toBeUndefined();
  });

  it('rolls back the tenant insert when a later client write fails', async () => {
    const request = input({ clientName: 'invalid\u0000client' });
    await expect(activity.run(createTenant, request)).rejects.toThrow('invalid byte sequence');
    const db = await getAdminConnection();
    expect(await db('tenants').where({ tenant: request.tenantId })).toEqual([]);
    expect(await db('clients').where({ tenant: request.tenantId })).toEqual([]);
  });

  it.each(['', '   '])('rejects blank tenant name %j without persisting a tenant', async (tenantName) => {
    const request = input({ tenantName });
    await expect(activity.run(createTenant, request)).rejects.toMatchObject({ type: 'ValidationError', nonRetryable: true });
    const db = await getAdminConnection();
    expect(await db('tenants').where({ tenant: request.tenantId })).toEqual([]);
  });
});
