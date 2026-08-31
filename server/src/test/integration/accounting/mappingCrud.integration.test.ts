import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../../test-utils/testMocks';

import {
  getExternalEntityMappings,
  createExternalEntityMapping,
  updateExternalEntityMapping,
  deleteExternalEntityMapping
} from '@alga-psa/integrations/actions';

const helpers = TestContext.createHelpers();

const authRef = vi.hoisted(() => ({
  tenantId: '',
  userId: 'mapping-test-user',
}));

// The mapping actions authenticate through @alga-psa/auth; inject the test
// user directly so per-test tenant rotation can't leave a stale session user.
vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        { user_id: authRef.userId, tenant: authRef.tenantId, roles: [] },
        { tenant: authRef.tenantId },
        ...args
      ),
  withOptionalAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        { user_id: authRef.userId, tenant: authRef.tenantId, roles: [] },
        { tenant: authRef.tenantId },
        ...args
      ),
  withAuthCheck:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn({ user_id: authRef.userId, tenant: authRef.tenantId, roles: [] }, ...args),
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
}));

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
    authRef.tenantId = ctx.tenantId;
    authRef.userId = ctx.user.user_id;

    // The mapping actions resolve their connection via @alga-psa/db; pin it to
    // the test context so they see rows seeded on ctx.db.
    const algaDbModule = await import('@alga-psa/db');
    vi.spyOn(algaDbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });
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

  it('drops forbidden fields from an update payload — a service row cannot be converted into an invoice mapping', async () => {
    // The TypeScript signature of updateExternalEntityMapping only admits the
    // editable fields, but a direct server-action call can carry extra JSON
    // keys. The action must pick the editable fields instead of spreading the
    // caller's object, so alga_entity_type/tenant/integration_type/id in a
    // payload are dropped — a non-invoice row can never be rewritten into an
    // invoice-typed mapping (which would need the shared invoice lock and a
    // cancelled check).
    const serviceId = 'svc-immutable';
    const created = await createExternalEntityMapping({
      integration_type: integrationType,
      alga_entity_type: 'service',
      alga_entity_id: serviceId,
      external_entity_id: 'QBO-ITEM-FIXED',
      external_realm_id: 'realm-1',
    });

    const updated = await updateExternalEntityMapping(created.id, {
      external_entity_id: 'QBO-ITEM-MOVED',
      ...({ alga_entity_type: 'invoice', tenant: 'tenant-999', integration_type: 'xero', id: 'forged-id' } as Record<string, unknown>),
    });

    // Editable field applied; every forbidden column unchanged.
    expect(updated.external_entity_id).toBe('QBO-ITEM-MOVED');
    expect(updated.alga_entity_type).toBe('service');
    expect(updated.tenant).toBe(ctx.tenantId);
    expect(updated.integration_type).toBe(integrationType);
    expect(updated.id).toBe(created.id);

    // The persisted row agrees — the invoice-lock invariant was not bypassed.
    const row = await ctx.db('tenant_external_entity_mappings').where({ id: created.id }).first();
    expect(row.alga_entity_type).toBe('service');
    expect(row.tenant).toBe(ctx.tenantId);
    expect(row.integration_type).toBe(integrationType);
    expect(row.external_entity_id).toBe('QBO-ITEM-MOVED');
  });

  it('refuses an update payload that only carried forbidden fields', async () => {
    const serviceId = 'svc-forged-only';
    const created = await createExternalEntityMapping({
      integration_type: integrationType,
      alga_entity_type: 'service',
      alga_entity_id: serviceId,
      external_entity_id: 'QBO-ITEM-UNTOUCHED',
    });

    const result = await updateExternalEntityMapping(created.id, {
      ...({ alga_entity_type: 'invoice', tenant: 'tenant-999' } as Record<string, unknown>),
    });

    expect(result).toMatchObject({ actionError: 'No update data provided.', messageKey: 'msp/integrations:errors.mappings.noUpdateData' });

    const row = await ctx.db('tenant_external_entity_mappings').where({ id: created.id }).first();
    expect(row.alga_entity_type).toBe('service');
    expect(row.tenant).toBe(ctx.tenantId);
  });
});
