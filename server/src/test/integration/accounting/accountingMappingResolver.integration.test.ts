import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../../test-utils/testMocks';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

import { AccountingMappingResolver } from 'server/src/lib/services/accountingMappingResolver';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 120_000;

describe('AccountingMappingResolver integration', () => {
  let ctx: TestContext;
  const adapterType = 'quickbooks_online';

  async function insertServiceCategory(name: string): Promise<string> {
    const categoryId = uuidv4();
    await ctx.db('service_categories').insert({
      category_id: categoryId,
      tenant: ctx.tenantId,
      category_name: name,
      description: `${name} description`
    });
    return categoryId;
  }

  async function insertMapping(options: {
    entityType: string;
    entityId: string;
    externalId: string;
    realmId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    await ctx.db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant: ctx.tenantId,
      integration_type: adapterType,
      alga_entity_type: options.entityType,
      alga_entity_id: options.entityId,
      external_entity_id: options.externalId,
      external_realm_id: options.realmId ?? null,
      metadata: options.metadata ?? null,
      sync_status: 'synced',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['tenant_external_entity_mappings', 'service_catalog', 'service_categories'] });
    setupCommonMocks({ tenantId: ctx.tenantId, userId: ctx.user.user_id, user: ctx.user });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    await ctx.db('tenant_external_entity_mappings').where({ tenant: ctx.tenantId }).delete();
    await ctx.db('service_catalog').where({ tenant: ctx.tenantId }).delete();
    await ctx.db('service_categories').where({ tenant: ctx.tenantId }).delete();

    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'finance-admin-role',
          tenant: ctx.tenantId,
          role_name: 'Finance Admin',
          permissions: []
        }
      ]
    });
    setupCommonMocks({ tenantId: ctx.tenantId, userId: financeUser.user_id, user: financeUser });
    mockGetCurrentUser(financeUser);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('returns direct service mapping when present', async () => {
    const serviceId = await createTestService(ctx, { service_name: 'Resolver Service' });

    await insertMapping({
      entityType: 'service',
      entityId: serviceId,
      externalId: 'QBO-SERVICE-123',
      metadata: { itemCode: 'SERV-123' }
    });

    const resolver = new AccountingMappingResolver(ctx.db);
    const resolution = await resolver.resolveServiceMapping({
      adapterType,
      serviceId,
      targetRealm: null
    });

    expect(resolution).not.toBeNull();
    expect(resolution?.external_entity_id).toBe('QBO-SERVICE-123');
    expect(resolution?.source).toBe('service');
    expect(resolution?.metadata).toEqual({ itemCode: 'SERV-123' });
  });

  it('falls back to category mapping when service mapping missing', async () => {
    const categoryId = await insertServiceCategory('Managed Services');
    const serviceId = await createTestService(ctx, {
      service_name: 'Category Fallback Service',
      category_id: categoryId
    });

    await insertMapping({
      entityType: 'service_category',
      entityId: categoryId,
      externalId: 'QBO-CATEGORY-555',
      metadata: { itemCode: 'CAT-555' }
    });

    const resolver = new AccountingMappingResolver(ctx.db);
    const resolution = await resolver.resolveServiceMapping({
      adapterType,
      serviceId,
      targetRealm: null
    });

    expect(resolution).not.toBeNull();
    expect(resolution?.external_entity_id).toBe('QBO-CATEGORY-555');
    expect(resolution?.source).toBe('service_category');
    expect(resolution?.metadata).toEqual({ itemCode: 'CAT-555' });
  });

  it('prefers realm-specific mapping over category fallback', async () => {
    const categoryId = await insertServiceCategory('Realm Category');
    const serviceId = await createTestService(ctx, {
      service_name: 'Realm Specific Service',
      category_id: categoryId
    });

    await insertMapping({
      entityType: 'service_category',
      entityId: categoryId,
      externalId: 'QBO-CATEGORY-900'
    });

    await insertMapping({
      entityType: 'service',
      entityId: serviceId,
      externalId: 'QBO-REALM-100',
      realmId: 'realm-123',
      metadata: { syncToken: '42' }
    });

    const resolver = new AccountingMappingResolver(ctx.db);

    const realmMatch = await resolver.resolveServiceMapping({
      adapterType,
      serviceId,
      targetRealm: 'realm-123'
    });

    expect(realmMatch?.external_entity_id).toBe('QBO-REALM-100');
    expect(realmMatch?.metadata).toEqual({ syncToken: '42' });
    expect(realmMatch?.source).toBe('service');

    const otherRealm = await resolver.resolveServiceMapping({
      adapterType,
      serviceId,
      targetRealm: 'realm-other'
    });

    expect(otherRealm?.external_entity_id).toBe('QBO-CATEGORY-900');
    expect(otherRealm?.source).toBe('service_category');
  });
});
