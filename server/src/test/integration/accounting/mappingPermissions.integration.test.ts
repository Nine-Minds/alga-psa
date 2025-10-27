import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../../test-utils/testMocks';
import {
  createExternalEntityMapping,
  updateExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings
} from 'server/src/lib/actions/externalMappingActions';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 120_000;

describe('Accounting mapping permissions', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['tenant_external_entity_mappings'] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    await ctx.db('tenant_external_entity_mappings').where({ tenant: ctx.tenantId }).delete();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('allows finance users with billing_settings update permission to manage mappings', async () => {
    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'finance-role',
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

    const mapping = await createExternalEntityMapping({
      integration_type: 'quickbooks_online',
      alga_entity_type: 'service',
      alga_entity_id: 'svc-finance',
      external_entity_id: 'FIN-001'
    });

    expect(mapping.external_entity_id).toBe('FIN-001');

    const updated = await updateExternalEntityMapping(mapping.id, {
      external_entity_id: 'FIN-002'
    });

    expect(updated.external_entity_id).toBe('FIN-002');

    await deleteExternalEntityMapping(mapping.id);

    const remaining = await getExternalEntityMappings({
      integrationType: 'quickbooks_online',
      algaEntityType: 'service',
      algaEntityId: 'svc-finance'
    });

    expect(remaining).toHaveLength(0);
  });

  it('blocks users without billing_settings permission from modifying mappings while allowing read', async () => {
    const mappingId = uuidv4();
    await ctx.db('tenant_external_entity_mappings').insert({
      id: mappingId,
      tenant: ctx.tenantId,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'service',
      alga_entity_id: 'svc-support',
      external_entity_id: 'SUP-001',
      sync_status: 'synced',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const supportUser = createMockUser('internal', {
      user_id: 'support-user',
      tenant: ctx.tenantId,
      roles: [
        {
          role_id: 'support-role',
          tenant: ctx.tenantId,
          role_name: 'Support Agent',
          permissions: []
        }
      ]
    });

    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: supportUser.user_id,
      user: supportUser,
      permissionCheck: (_user, resource, action) => {
        if (resource === 'billing_settings') {
          return action === 'read';
        }
        return true;
      }
    });
    mockGetCurrentUser(supportUser);

    const visible = await getExternalEntityMappings({
      integrationType: 'quickbooks_online',
      algaEntityType: 'service',
      algaEntityId: 'svc-support'
    });
    expect(visible).toHaveLength(1);

    await expect(
      createExternalEntityMapping({
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: 'svc-support',
        external_entity_id: 'SUP-NEW'
      })
    ).rejects.toThrow('Forbidden');

    await expect(
      updateExternalEntityMapping(mappingId, { external_entity_id: 'SUP-UPDATED' })
    ).rejects.toThrow('Forbidden');

    await expect(deleteExternalEntityMapping(mappingId)).rejects.toThrow('Forbidden');

    const afterAttempts = await getExternalEntityMappings({
      integrationType: 'quickbooks_online',
      algaEntityType: 'service',
      algaEntityId: 'svc-support'
    });
    expect(afterAttempts).toHaveLength(1);
    expect(afterAttempts[0].external_entity_id).toBe('SUP-001');
  });
});
