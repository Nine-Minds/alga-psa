import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createTestService,
  createFixedPlanAssignment,
  setLineProvenance,
  updateCatalogPrice,
} from '../../../../test-utils/billingTestHelpers';

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

import { previewRateReclassification, applyRateReclassification } from '@alga-psa/billing/actions/rateReviewActions';
import { updateContractLine } from '@alga-psa/billing/repositories/contractLineRepository';

const REVIEW_PERIOD = { start: '2026-11-01', end: '2026-12-01' };

describe('Catalog price changes reach existing contracts – rate review', () => {
  let context: TestContext;

  async function linkMemberToCatalog(contractLineId: string): Promise<void> {
    // The fixture snapshots the catalog rate into the fixed config. To exercise
    // the catalog-following path, clear that snapshot so the member resolves to
    // the effective service_prices row.
    await context.db.raw(
      `UPDATE contract_line_service_fixed_config AS clsfc
       SET base_rate = NULL, rate_provenance = 'inherited'
       FROM contract_line_service_configuration AS clsc
       WHERE clsc.config_id = clsfc.config_id
         AND clsc.tenant = clsfc.tenant
         AND clsc.tenant = ?
         AND clsc.contract_line_id = ?`,
      [context.tenantId, contractLineId],
    );
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'contract_line_services',
        'contract_line_service_configuration',
        'contract_line_service_fixed_config',
        'service_catalog',
        'service_prices',
        'contract_line_unit_pricing_revisions',
        'contract_pricing_schedules',
        'contract_lines',
        'contracts',
        'client_contracts',
        'client_contract_lines'
      ],
      clientName: 'Catalog Price Test Client',
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

  it('T8: preview proposes inherited for an exact catalog match, and apply is a no-op', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Managed Endpoint',
      billing_method: 'fixed',
      default_rate: 10000
    });
    const { contractLineId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Exact Match Plan',
      baseRateCents: 10000,
      quantity: 1
    });

    await linkMemberToCatalog(contractLineId);
    await setLineProvenance(context, contractLineId, 'unreviewed', 10000);

    const preview = await previewRateReclassification({ period: REVIEW_PERIOD });
    expect('rows' in preview).toBe(true);
    if (!('rows' in preview)) throw new Error('preview failed');
    const row = preview.rows.find((r) => r.contractLineId === contractLineId);
    expect(row?.proposed).toBe('inherited');
    expect(row?.resolvedRateCents).toBe(10000);
    expect(row?.storedRateCents).toBe(10000);
    expect(row?.serviceNames).toContain('Managed Endpoint');

    const result = await applyRateReclassification(
      [{ contractLineId, target: 'inherited' }],
      { period: REVIEW_PERIOD },
    );
    expect('applied' in result).toBe(true);
    if (!('applied' in result)) throw new Error('apply failed');
    expect(result.applied).toHaveLength(1);
    expect(result.refused).toHaveLength(0);

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate', 'rate_provenance');
    expect(line.custom_rate).toBeNull();
    expect(line.rate_provenance).toBe('inherited');
  });

  it('T8b: a line that differs from the catalog is relabelled custom, rate untouched', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Negotiated Endpoint',
      billing_method: 'fixed',
      default_rate: 10000
    });
    const { contractLineId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Negotiated Plan',
      baseRateCents: 4500,
      quantity: 1
    });

    await linkMemberToCatalog(contractLineId);
    await setLineProvenance(context, contractLineId, 'unreviewed', 4500);

    const preview = await previewRateReclassification({ period: REVIEW_PERIOD });
    if (!('rows' in preview)) throw new Error('preview failed');
    const row = preview.rows.find((r) => r.contractLineId === contractLineId);
    expect(row?.proposed).toBe('custom');

    const result = await applyRateReclassification(
      [{ contractLineId, target: 'custom' }],
      { period: REVIEW_PERIOD },
    );
    if (!('applied' in result)) throw new Error('apply failed');
    expect(result.applied).toHaveLength(1);

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate', 'rate_provenance');
    expect(Number(line.custom_rate)).toBe(4500);
    expect(line.rate_provenance).toBe('custom');
  });

  it('T9: apply refuses a row whose catalog rate drifted since preview', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Drifting Service',
      billing_method: 'fixed',
      default_rate: 10000
    });
    const { contractLineId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Drift Plan',
      baseRateCents: 10000,
      quantity: 1
    });

    await linkMemberToCatalog(contractLineId);
    await setLineProvenance(context, contractLineId, 'unreviewed', 10000);

    const preview = await previewRateReclassification({ period: REVIEW_PERIOD });
    if (!('rows' in preview)) throw new Error('preview failed');
    expect(preview.rows.find((r) => r.contractLineId === contractLineId)?.proposed).toBe('inherited');

    // The catalog price moves between preview and apply.
    await updateCatalogPrice(context, serviceId, { rateCents: 12000 });

    const result = await applyRateReclassification(
      [{ contractLineId, target: 'inherited' }],
      { period: REVIEW_PERIOD },
    );
    if (!('applied' in result)) throw new Error('apply failed');
    expect(result.applied).toHaveLength(0);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0].reason).toMatch(/differ|catalog/i);

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate', 'rate_provenance');
    expect(Number(line.custom_rate)).toBe(10000);
    expect(line.rate_provenance).toBe('unreviewed');
  });

  it('T10: a line whose contract currency has no service_prices row is skipped with a reason', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'USD-only Service',
      billing_method: 'fixed',
      default_rate: 10000,
      currency_code: 'USD'
    });
    const { contractLineId, contractId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Euro Plan',
      baseRateCents: 10000,
      quantity: 1
    });

    await context.db('contracts')
      .where({ tenant: context.tenantId, contract_id: contractId })
      .update({ currency_code: 'EUR' });
    await linkMemberToCatalog(contractLineId);
    await setLineProvenance(context, contractLineId, 'unreviewed', 10000);

    const preview = await previewRateReclassification({ period: REVIEW_PERIOD });
    if (!('rows' in preview)) throw new Error('preview failed');
    const row = preview.rows.find((r) => r.contractLineId === contractLineId);
    expect(row?.proposed).toBe('skip');
    expect(row?.skipReason).toBe('no_catalog_price');
    expect(row?.reason).toMatch(/EUR/);

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('rate_provenance');
    expect(line.rate_provenance).toBe('unreviewed');
  });

  it('T17: a partial updateContractLine that omits custom_rate leaves the rate intact', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Partial Update Service',
      billing_method: 'fixed',
      default_rate: 10000
    });
    const { contractLineId, contractId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Partial Update Plan',
      baseRateCents: 4500,
      quantity: 1
    });

    await setLineProvenance(context, contractLineId, 'custom', 4500);

    await updateContractLine(context.db, context.tenantId, contractId, contractLineId, {
      display_order: 7
    });

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate', 'rate_provenance');
    expect(Number(line.custom_rate)).toBe(4500);
    expect(line.rate_provenance).toBe('custom');
  });
});
