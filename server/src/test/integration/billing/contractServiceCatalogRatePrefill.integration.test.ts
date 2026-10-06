import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../test-utils/testContext';
import { createTestService, createFixedPlanAssignment } from '../../../../test-utils/billingTestHelpers';
import { createTenant } from '../../../../test-utils/testDataFactory';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowEventModel: { create: vi.fn() },
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({ publishEvent: vi.fn() }),
  toStreamEvent: (event: unknown) => event,
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

import { addServiceToContractLine } from '@alga-psa/billing/actions/contractLineServiceActions';
import { resolveContractAuthoringRate } from '@alga-psa/billing/lib/contractAuthoringRate';

const isActionError = (value: unknown): value is { actionError: string } =>
  typeof value === 'object' && value !== null && typeof (value as { actionError?: unknown }).actionError === 'string';

describe('Contract service catalog-rate prefill persistence', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'contract_line_services',
        'contract_line_service_configuration',
        'contract_line_service_fixed_config',
        'contract_line_service_hourly_config',
        'contract_line_service_usage_config',
        'contract_line_service_bucket_config',
        'service_catalog',
        'service_prices',
        'contract_lines',
        'contracts',
        'client_contracts',
        'client_contract_lines'
      ],
      clientName: 'Catalog Rate Prefill Client',
      userType: 'internal'
    });

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
  }, 60000);

  afterEach(async () => {
    await rollbackContext();
  }, 60000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('T008: persists a fallback-resolved catalog default rate as integer minor units', async () => {
    const hostServiceId = await createTestService(context, {
      service_name: 'Host Fixed Service',
      billing_method: 'fixed',
      default_rate: 5000
    });

    const { contractLineId } = await createFixedPlanAssignment(context, hostServiceId, {
      planName: 'Catalog Rate Prefill Plan',
      baseRateCents: 5000,
      quantity: 1
    });

    // The added service has no contract-currency service_prices row, so the
    // shared authoring resolver falls back to the catalog default_rate.
    const addedServiceId = await createTestService(context, {
      service_name: 'Fallback Priced Service',
      billing_method: 'fixed',
      default_rate: 18000,
      seedServicePrice: false
    });

    const resolved = resolveContractAuthoringRate(
      { prices: [], default_rate: 18000 },
      'USD'
    );
    expect(resolved).toEqual({ rate: 18000, source: 'catalog-default' });

    const configId = await addServiceToContractLine(
      contractLineId,
      addedServiceId,
      1,
      resolved.rate as number,
      'Fixed',
      { base_rate: resolved.rate as number }
    );
    expect(isActionError(configId)).toBe(false);
    expect(typeof configId).toBe('string');

    const membership = await context.db('contract_line_services')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId, service_id: addedServiceId })
      .first();
    expect(membership).toBeTruthy();

    const config = await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, config_id: configId as string })
      .first();
    expect(Number(config.custom_rate)).toBe(18000);
    expect(Number.isInteger(Number(config.custom_rate))).toBe(true);

    const fixedConfig = await context.db('contract_line_service_fixed_config')
      .where({ tenant: context.tenantId, config_id: configId as string })
      .first();
    expect(Number(fixedConfig.base_rate)).toBe(18000);
    expect(Number.isInteger(Number(fixedConfig.base_rate))).toBe(true);
  });

  it('T009: rejects a cross-tenant service and writes no configuration row for the target line', async () => {
    const hostServiceId = await createTestService(context, {
      service_name: 'Tenant A Host Service',
      billing_method: 'fixed',
      default_rate: 5000
    });

    const { contractLineId } = await createFixedPlanAssignment(context, hostServiceId, {
      planName: 'Cross Tenant Guard Plan',
      baseRateCents: 5000,
      quantity: 1
    });

    const foreignTenantId = await createTenant(context.db, 'Foreign Catalog Tenant');
    const foreignServiceId = await createTestService(
      { db: context.db, tenantId: foreignTenantId, clientId: context.clientId, createEntity: context.createEntity.bind(context) },
      {
        service_name: 'Foreign Tenant Service',
        billing_method: 'fixed',
        default_rate: 9000
      }
    );

    const result = await addServiceToContractLine(
      contractLineId,
      foreignServiceId,
      1,
      9000,
      'Fixed',
      { base_rate: 9000 }
    );

    expect(isActionError(result)).toBe(true);

    const membership = await context.db('contract_line_services')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId, service_id: foreignServiceId });
    expect(membership).toHaveLength(0);

    const config = await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId, service_id: foreignServiceId });
    expect(config).toHaveLength(0);
  });
});
