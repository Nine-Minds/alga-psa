import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { createSeatCatalog, createSeatClient, ensureFixtureTenant, tenantTable } from '../../../test-utils/perSeatFixtures';

let db: Knex;
let tenantId: string;
let allowedPermissions = new Set<string>(['update']);
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let updateConfiguration: typeof import('@alga-psa/billing/actions/contractLineServiceConfigurationActions').updateConfiguration;
let ConfigurationModel: typeof import('@alga-psa/billing/models/contractLineServiceConfiguration').default;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) => action(
      { user_id: 'configuration-identity-test-user', tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
      { tenant: tenantId },
      ...args,
    ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  const { withAuth } = await import('@alga-psa/auth/withAuth');
  return { ...createAuthModuleMock(), withAuth };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, _resource: string, action: string) => allowedPermissions.has(action)),
}));

const HOOK_TIMEOUT = 180_000;

async function createConfigurationFixture() {
  allowedPermissions = new Set(['create', 'update']);
  const [product] = await createSeatCatalog(db, tenantId, [{ name: `Identity ${uuidv4().slice(0, 6)}`, rateCents: 4200 }]);
  await tenantTable(db, tenantId, 'service_catalog')
    .where({ tenant: tenantId, service_id: product.serviceId }).update({ item_kind: 'product' });
  const client = await createSeatClient(db, tenantId);
  const result: any = await createClientContractFromWizard({
    contract_name: `Identity ${uuidv4().slice(0, 6)}`,
    client_id: client.clientId,
    start_date: '2024-12-01',
    end_date: '2099-12-31',
    billing_frequency: 'monthly',
    enable_proration: false,
    fixed_services: [],
    hourly_services: [],
    usage_services: [],
    product_services: [{ service_id: product.serviceId, quantity: 2 }],
  } as any);
  expect(result, JSON.stringify(result)).toHaveProperty('contract_id');
  const line: any = await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_id: result.contract_id }).first();
  const config: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
    .where({ tenant: tenantId, contract_line_id: line.contract_line_id, service_id: product.serviceId }).first();
  await tenantTable(db, tenantId, 'service_catalog')
    .where({ tenant: tenantId, service_id: product.serviceId }).update({ item_kind: 'service' });
  return { lineId: line.contract_line_id as string, configId: config.config_id as string, serviceId: product.serviceId };
}

describe('contract line service configuration identity is immutable on update', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'configuration-identity-test-user', permissionCheck: (_user, _resource, action) => allowedPermissions.has(action ?? '') });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ updateConfiguration } = await import('@alga-psa/billing/actions/contractLineServiceConfigurationActions'));
    ConfigurationModel = (await import('@alga-psa/billing/models/contractLineServiceConfiguration')).default;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('model boundary ignores protected runtime fields while applying mutable values and its own timestamp', async () => {
    const original = await createConfigurationFixture();
    const other = await createConfigurationFixture();
    const before: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, config_id: original.configId }).first();
    const forgedTimestamp = new Date('2099-01-01T00:00:00.000Z');
    const model = new ConfigurationModel(db, tenantId);

    // Runtime input deliberately bypasses the action/service DTO's compile-time boundary.
    await model.update(original.configId, {
      config_id: uuidv4(),
      contract_line_id: other.lineId,
      service_id: other.serviceId,
      configuration_type: 'Hourly',
      tenant: uuidv4(),
      created_at: forgedTimestamp,
      updated_at: forgedTimestamp,
      quantity: 7,
      custom_rate: 1234,
    } as any);

    const after: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, config_id: original.configId }).first();
    expect(after).toMatchObject({
      config_id: before.config_id,
      contract_line_id: original.lineId,
      service_id: original.serviceId,
      configuration_type: before.configuration_type,
      tenant: tenantId,
      quantity: 7,
    });
    expect(Number(after.custom_rate)).toBe(1234);
    expect(new Date(after.created_at).getTime()).toBe(new Date(before.created_at).getTime());
    expect(new Date(after.updated_at).getTime()).not.toBe(forgedTimestamp.getTime());

    // Unreferenced UUIDs must be filtered before SQL, rather than fail at an FK after other fields write.
    await expect(model.update(original.configId, {
      contract_line_id: uuidv4(),
      service_id: uuidv4(),
    } as any)).resolves.toBe(true);
    const membershipRows = await tenantTable(db, tenantId, 'contract_line_services')
      .whereIn('contract_line_id', [original.lineId, other.lineId]).select('contract_line_id', 'service_id');
    expect(membershipRows).toContainEqual(expect.objectContaining({ contract_line_id: original.lineId, service_id: original.serviceId }));
    expect(membershipRows).toContainEqual(expect.objectContaining({ contract_line_id: other.lineId, service_id: other.serviceId }));
  }, HOOK_TIMEOUT);

  it('update-only action cannot rebind membership, and denied callers remain denied', async () => {
    const original = await createConfigurationFixture();
    const other = await createConfigurationFixture();
    const before: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, config_id: original.configId }).first();

    allowedPermissions = new Set(['update']);
    const result: any = await updateConfiguration(original.configId, {
      contract_line_id: other.lineId,
      service_id: other.serviceId,
      configuration_type: 'Hourly',
      tenant: uuidv4(),
      quantity: 2,
    } as any);
    expect(result, JSON.stringify(result)).not.toHaveProperty('actionError');
    const after: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, config_id: original.configId }).first();
    expect(after).toMatchObject({
      contract_line_id: original.lineId,
      service_id: original.serviceId,
      configuration_type: before.configuration_type,
      quantity: 2,
    });
    const memberships = await tenantTable(db, tenantId, 'contract_line_services')
      .whereIn('contract_line_id', [original.lineId, other.lineId]).select('contract_line_id', 'service_id');
    expect(memberships).toContainEqual(expect.objectContaining({ contract_line_id: original.lineId, service_id: original.serviceId }));
    expect(memberships).toContainEqual(expect.objectContaining({ contract_line_id: other.lineId, service_id: other.serviceId }));

    allowedPermissions = new Set();
    const denied: any = await updateConfiguration(original.configId, { quantity: 6 } as any);
    expect(denied).toHaveProperty('permissionError');
    const unchanged: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, config_id: original.configId }).first();
    expect(Number(unchanged.quantity)).toBe(2);
  }, HOOK_TIMEOUT);

  it('update action keeps the source-line authorability restriction', async () => {
    const fixture = await createConfigurationFixture();
    const line: any = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: fixture.lineId }).first();
    await tenantTable(db, tenantId, 'contracts')
      .where({ tenant: tenantId, contract_id: line.contract_id }).update({ is_system_managed_default: true });
    const before: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, config_id: fixture.configId }).first();

    allowedPermissions = new Set(['update']);
    const result: any = await updateConfiguration(fixture.configId, { quantity: 9 } as any);
    expect(result).toHaveProperty('actionError');
    const after: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, config_id: fixture.configId }).first();
    expect(after).toEqual(before);
  }, HOOK_TIMEOUT);
});
