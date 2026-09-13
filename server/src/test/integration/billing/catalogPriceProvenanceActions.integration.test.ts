import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

// The contract wizard imports withAuth from the subpath, not the barrel.
vi.mock('@alga-psa/auth/withAuth', async () => {
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

import { addContractLine } from '@alga-psa/billing/repositories/contractLineRepository';
import { createClientContractFromWizard } from '@alga-psa/billing/actions/contractWizardActions';
import { createPricingSchedule } from '@alga-psa/billing/actions/contractPricingScheduleActions';
import { previewServicePriceChange } from '@alga-psa/billing/actions/servicePriceRolloutActions';
import { updateCatalogPrice } from '../../../../test-utils/billingTestHelpers';

describe('Catalog price provenance — clone, wizard, constraints and schedule overlap', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'contract_line_services',
        'contract_line_service_configuration',
        'contract_line_service_fixed_config',
        'contract_template_line_services',
        'contract_template_line_service_configuration',
        'contract_template_lines',
        'contract_templates',
        'service_catalog',
        'service_prices',
        'contract_lines',
        'contracts',
        'client_contracts',
        'client_contract_lines',
        'contract_pricing_schedules'
      ],
      clientName: 'Catalog Provenance Actions Client',
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

  /**
   * Set up a template line plus the live contract it will be cloned into. The
   * template stores its rate on `contract_template_lines.custom_rate` (the
   * line-level snapshot source) and one fixed service config so the cloned live
   * line carries a config to resolve against.
   */
  async function seedTemplateAndContract(options: {
    serviceId: string;
    templateCustomRate: number | null;
    configCustomRate?: number | null;
  }) {
    const { serviceId, templateCustomRate, configCustomRate = null } = options;

    const templateId = uuidv4();
    const templateLineId = uuidv4();
    const templateConfigId = uuidv4();
    await context.db('contract_templates').insert({
      tenant: context.tenantId,
      template_id: templateId,
      template_name: `Template ${templateId.slice(0, 6)}`
    });
    await context.db('contract_template_lines').insert({
      tenant: context.tenantId,
      template_line_id: templateLineId,
      template_id: templateId,
      template_line_name: 'Template Fixed line',
      billing_frequency: 'monthly',
      line_type: 'Fixed',
      custom_rate: templateCustomRate,
      display_order: 0
    });
    await context.db('contract_template_line_services').insert({
      tenant: context.tenantId,
      template_line_id: templateLineId,
      service_id: serviceId,
      quantity: 1,
      custom_rate: configCustomRate
    });
    await context.db('contract_template_line_service_configuration').insert({
      tenant: context.tenantId,
      config_id: templateConfigId,
      template_line_id: templateLineId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      custom_rate: configCustomRate,
      quantity: 1
    });

    const contractId = await context.createEntity('contracts', {
      contract_name: `Live contract ${templateId.slice(0, 6)}`,
      billing_frequency: 'monthly',
      is_active: true,
      status: 'active',
      is_template: false,
      currency_code: 'USD',
      owner_client_id: context.clientId
    }, 'contract_id');
    await context.createEntity('client_contracts', {
      client_id: context.clientId,
      contract_id: contractId,
      start_date: '2023-01-01',
      end_date: null,
      is_active: true,
      status: 'pending'
    }, 'client_contract_id');

    return { templateId, templateLineId, contractId };
  }

  it('T11: an inherited template line clones to NULL/inherited and a later catalog change reaches it', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'T11 Service',
      billing_method: 'fixed',
      default_rate: 10000
    });
    const { templateLineId, contractId } = await seedTemplateAndContract({
      serviceId,
      templateCustomRate: null,
      configCustomRate: null
    });

    const mapping = await addContractLine(
      context.transaction!,
      context.tenantId,
      contractId,
      templateLineId,
    );
    const liveLineId = mapping.contract_line_id;
    expect(liveLineId).toBeTruthy();

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: liveLineId })
      .first('custom_rate', 'rate_provenance', 'is_template');
    expect(line.custom_rate).toBeNull();
    expect(line.rate_provenance).toBe('inherited');
    expect(line.is_template).toBe(false);

    // No member snapshot was written, so the line resolves to the catalog.
    const configs = await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: liveLineId });
    expect(configs.length).toBeGreaterThan(0);
    const fixedConfigs = await context.db('contract_line_service_fixed_config')
      .whereIn('config_id', configs.map((config) => config.config_id));
    expect(fixedConfigs).toHaveLength(0);

    await updateCatalogPrice(context, serviceId, { rateCents: 12000, effectiveDate: '2023-02-01' });
    const preview = await previewServicePriceChange(serviceId, 12000, '2023-02-01');
    if (!('willChange' in preview)) throw new Error('preview failed');
    expect(preview.willChange.some((row) => row.contractLineId === liveLineId)).toBe(true);
  });

  it('T12: a custom template line clones to custom, and a later template edit does not move it', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'T12 Service',
      billing_method: 'fixed',
      default_rate: 10000
    });
    const { templateLineId, contractId } = await seedTemplateAndContract({
      serviceId,
      templateCustomRate: 5000
    });

    const mapping = await addContractLine(
      context.transaction!,
      context.tenantId,
      contractId,
      templateLineId,
    );
    const liveLineId = mapping.contract_line_id;

    const cloned = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: liveLineId })
      .first('custom_rate', 'rate_provenance');
    expect(Number(cloned.custom_rate)).toBe(5000);
    expect(cloned.rate_provenance).toBe('custom');

    // A later template price edit is provenance-only for an existing live line.
    await context.db('contract_template_lines')
      .where({ tenant: context.tenantId, template_line_id: templateLineId })
      .update({ custom_rate: 9999 });

    const afterEdit = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: liveLineId })
      .first('custom_rate', 'rate_provenance');
    expect(Number(afterEdit.custom_rate)).toBe(5000);
    expect(afterEdit.rate_provenance).toBe('custom');

    // And a catalog change does not reach it either.
    await updateCatalogPrice(context, serviceId, { rateCents: 12000, effectiveDate: '2023-02-01' });
    const preview = await previewServicePriceChange(serviceId, 12000, '2023-02-01');
    if (!('willChange' in preview)) throw new Error('preview failed');
    expect(preview.custom.some((row) => row.contractLineId === liveLineId)).toBe(true);
    expect(preview.willChange.some((row) => row.contractLineId === liveLineId)).toBe(false);
  });

  it('T13: a wizard-created fixed line is inherited with no member snapshot', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'T13 Service',
      billing_method: 'fixed',
      default_rate: 10000
    });

    const result = await createClientContractFromWizard({
      contract_name: 'T13 Wizard Contract',
      description: 'T13',
      client_id: context.clientId,
      start_date: '2023-01-01',
      end_date: null,
      billing_frequency: 'monthly',
      currency_code: 'USD',
      enable_proration: false,
      // No explicit fixed_base_rate: the operator did not choose a rate.
      fixed_services: [{ service_id: serviceId, quantity: 1 }],
      hourly_services: [],
      usage_services: [],
      po_required: false,
    });
    if ('actionError' in result || 'permissionError' in result) {
      throw new Error(JSON.stringify(result));
    }
    const contractLineId = result.contract_line_id;
    expect(contractLineId).toBeTruthy();

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate', 'rate_provenance');
    expect(line.custom_rate).toBeNull();
    expect(line.rate_provenance).toBe('inherited');

    const configs = await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .select('config_id');
    const fixedConfigs = await context.db('contract_line_service_fixed_config')
      .whereIn('config_id', configs.map((config) => config.config_id))
      .select('base_rate', 'rate_provenance');
    expect(fixedConfigs).toHaveLength(1);
    // The catalog must not be snapshotted into the member.
    expect(fixedConfigs[0].base_rate).toBeNull();
    expect(fixedConfigs[0].rate_provenance).toBe('inherited');
  });

  it('T14: the CHECK constraints reject inherited + a rate and custom + no rate', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'T14 Service',
      billing_method: 'fixed',
      default_rate: 10000
    });
    const contractId = await context.createEntity('contracts', {
      contract_name: 'T14 Contract',
      billing_frequency: 'monthly',
      is_active: true,
      status: 'active',
      is_template: false,
      currency_code: 'USD'
    }, 'contract_id');
    const lineId = await context.createEntity('contract_lines', {
      contract_id: contractId,
      contract_line_name: 'T14 line',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      is_template: false,
      is_active: true,
      custom_rate: 5000,
      rate_provenance: 'unreviewed'
    }, 'contract_line_id');

    // A failed statement aborts the surrounding test transaction, so bound each
    // attempt with a savepoint and roll back to it.
    await context.db.raw('SAVEPOINT t14_inherited_with_rate');
    await expect(
      context.db('contract_lines')
        .where({ tenant: context.tenantId, contract_line_id: lineId })
        .update({ rate_provenance: 'inherited', custom_rate: 5 }),
    ).rejects.toThrow(/check/i);
    await context.db.raw('ROLLBACK TO SAVEPOINT t14_inherited_with_rate');

    await context.db.raw('SAVEPOINT t14_custom_without_rate');
    await expect(
      context.db('contract_lines')
        .where({ tenant: context.tenantId, contract_line_id: lineId })
        .update({ rate_provenance: 'custom', custom_rate: null }),
    ).rejects.toThrow(/check/i);
    await context.db.raw('ROLLBACK TO SAVEPOINT t14_custom_without_rate');

    // The member-level constraint has the same two invariants.
    const configId = uuidv4();
    await context.db('contract_line_service_configuration').insert({
      tenant: context.tenantId,
      config_id: configId,
      contract_line_id: lineId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      quantity: 1,
      custom_rate: null
    });
    await context.db('contract_line_service_fixed_config').insert({
      tenant: context.tenantId,
      config_id: configId,
      base_rate: 5000,
      rate_provenance: 'unreviewed'
    });

    await context.db.raw('SAVEPOINT t14_member_inherited_with_rate');
    await expect(
      context.db('contract_line_service_fixed_config')
        .where({ tenant: context.tenantId, config_id: configId })
        .update({ rate_provenance: 'inherited', base_rate: 5 }),
    ).rejects.toThrow(/check/i);
    await context.db.raw('ROLLBACK TO SAVEPOINT t14_member_inherited_with_rate');

    await context.db.raw('SAVEPOINT t14_member_custom_without_rate');
    await expect(
      context.db('contract_line_service_fixed_config')
        .where({ tenant: context.tenantId, config_id: configId })
        .update({ rate_provenance: 'custom', base_rate: null }),
    ).rejects.toThrow(/check/i);
    await context.db.raw('ROLLBACK TO SAVEPOINT t14_member_custom_without_rate');
  });

  it('T18: overlapping schedules are rejected by the action and by the DB constraint', async () => {
    const contractId = await context.createEntity('contracts', {
      contract_name: 'T18 Contract',
      billing_frequency: 'monthly',
      is_active: true,
      status: 'active',
      is_template: false,
      currency_code: 'USD'
    }, 'contract_id');

    // A bounded existing schedule: Feb 1 – Mar 1.
    await createPricingSchedule({
      contract_id: contractId,
      effective_date: '2023-02-01',
      end_date: '2023-03-01',
      custom_rate: 10000,
    });

    // The case the old pre-check missed: a new unbounded schedule that starts
    // *before* the existing bounded one and so fully contains it.
    const overlapping = await createPricingSchedule({
      contract_id: contractId,
      effective_date: '2023-01-01',
      end_date: null,
      custom_rate: 12000,
    });
    expect('actionError' in overlapping).toBe(true);

    // The DB EXCLUDE constraint is the backstop: a direct insert that bypasses
    // the action is rejected too.
    await context.db.raw('SAVEPOINT t18_db_overlap');
    await expect(
      context.db('contract_pricing_schedules').insert({
        schedule_id: uuidv4(),
        tenant: context.tenantId,
        contract_id: contractId,
        contract_line_id: null,
        effective_date: '2023-01-15',
        end_date: null,
        custom_rate: 13000,
      }),
    ).rejects.toThrow(/exclusion|conflict|overlap|no_overlap/i);
    await context.db.raw('ROLLBACK TO SAVEPOINT t18_db_overlap');

    // A non-overlapping schedule still lands.
    const adjacent = await createPricingSchedule({
      contract_id: contractId,
      effective_date: '2023-03-01',
      end_date: '2023-04-01',
      custom_rate: 14000,
    });
    expect('actionError' in adjacent).toBe(false);
  });
});
