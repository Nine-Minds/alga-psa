import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';

import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../../test-utils/testMocks';

import {
  getExternalEntityMappings,
  createExternalEntityMapping,
  updateExternalEntityMapping,
  deleteExternalEntityMapping
} from '@alga-psa/integrations/actions';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 120_000;

describe('Accounting Mapping CRUD integration', () => {
  const integrationType = 'quickbooks_online';
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['tenant_external_entity_mappings'] });
    setupCommonMocks({ tenantId: ctx.tenantId, userId: ctx.user.user_id, user: ctx.user });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
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
    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: financeUser.user_id,
      user: financeUser,
      permissionCheck: () => true
    });
    mockGetCurrentUser(financeUser);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('performs create, list, update, and delete for a service mapping', async () => {
    const serviceId = 'svc-001';
    const initialExternalId = 'QBO-ITEM-ABC';

    const created = await createExternalEntityMapping({
      integration_type: integrationType,
      alga_entity_type: 'service',
      alga_entity_id: serviceId,
      external_entity_id: initialExternalId,
      metadata: { source: 'test' }
    });

    expect(created.integration_type).toBe(integrationType);
    expect(created.alga_entity_id).toBe(serviceId);
    expect(created.external_entity_id).toBe(initialExternalId);

    const listed = await getExternalEntityMappings({
      integrationType,
      algaEntityType: 'service',
      algaEntityId: serviceId
    });

    expect(listed).toHaveLength(1);
    expect(listed[0].metadata).toEqual({ source: 'test' });

    const updated = await updateExternalEntityMapping(created.id, {
      external_entity_id: 'QBO-ITEM-XYZ',
      metadata: { source: 'updated' }
    });

    expect(updated.external_entity_id).toBe('QBO-ITEM-XYZ');
    expect(updated.metadata).toEqual({ source: 'updated' });

    await deleteExternalEntityMapping(created.id);

    const finalList = await getExternalEntityMappings({
      integrationType,
      algaEntityType: 'service',
      algaEntityId: serviceId
    });

    expect(finalList).toHaveLength(0);
  });
});
