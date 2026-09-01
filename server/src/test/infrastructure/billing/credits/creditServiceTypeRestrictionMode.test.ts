import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createPrepaymentInvoice,
  applyCreditToInvoice,
  resolveCreditDrawdownPolicy,
} from '@alga-psa/billing/actions/creditActions';
import { finalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { createInvoiceFromBillingResult } from '@alga-psa/billing/actions/invoiceGeneration';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
} from '../../../../../test-utils/billingTestHelpers';
import type { IBillingCharge, IBillingResult } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { ClientContractLine } from '@alga-psa/billing/models';
import { createTestDate } from '../../../test-utils/dateUtils';
import { createClient } from '../../../../../test-utils/testDataFactory';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any)),
  };
});

vi.mock('@alga-psa/core/logger', () => {
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn(() => logger),
  };
  return { default: logger };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({
      user_id: mockedUserId,
      tenant: mockedTenantId,
      username: 'mock-user',
      first_name: 'Mock',
      last_name: 'User',
      email: 'mock.user@example.com',
      user_type: 'internal',
      roles: [],
    })
  ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

let context: TestContext;

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

async function createServiceType(name: string): Promise<string> {
  const typeId = uuidv4();
  await tenantTable(context, 'service_types').insert({
    id: typeId,
    tenant: context.tenantId,
    name,
    is_active: true,
  });
  return typeId;
}

async function seedTenantRestriction(mode: 'all' | 'restricted', ids: string[] | null) {
  await tenantTable(context, 'default_billing_settings')
    .where({ tenant: context.tenantId })
    .del();
  await tenantTable(context, 'default_billing_settings').insert({
    tenant: context.tenantId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    credit_auto_apply_enabled: true,
    credit_application_order: 'expiration_first',
    credit_service_type_restriction_mode: mode,
    credit_eligible_service_type_ids: ids ? JSON.stringify(ids) : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function seedClientRestriction(
  clientId: string,
  mode: 'all' | 'restricted' | null,
  ids: string[] | null
) {
  await tenantTable(context, 'client_billing_settings')
    .where({ client_id: clientId, tenant: context.tenantId })
    .del();
  await tenantTable(context, 'client_billing_settings').insert({
    client_id: clientId,
    tenant: context.tenantId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    enable_credit_expiration: false,
    credit_service_type_restriction_mode: mode,
    credit_eligible_service_type_ids: ids ? JSON.stringify(ids) : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function createBillingCycle(clientId: string, startDate: string, endDate: string): Promise<string> {
  return context.createEntity(
    'client_billing_cycles',
    {
      client_id: clientId,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate,
    },
    'billing_cycle_id'
  );
}

async function setupDefaultTax(clientId?: string) {
  await setupClientTaxConfiguration(context, {
    clientId,
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'NY State Tax',
    startDate: '2020-01-01T00:00:00.000Z',
    taxPercentage: 10.0,
  });
  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
}

async function generateInvoiceFromChargesForClient(
  clientId: string,
  billingCycleId: string,
  charges: IBillingCharge[]
) {
  const cycleRecord = await tenantTable(context, 'client_billing_cycles')
    .where({ billing_cycle_id: billingCycleId, tenant: context.tenantId })
    .first();

  if (!cycleRecord) {
    throw new Error(`Billing cycle ${billingCycleId} not found`);
  }

  for (const charge of charges) {
    if (!(charge as { config_id?: string }).config_id) {
      (charge as { config_id?: string }).config_id = uuidv4();
    }
    const usageId = (charge as { usageId?: string }).usageId;
    if (charge.type === 'usage' && usageId) {
      await tenantTable(context, 'usage_tracking')
        .insert({
          tenant: context.tenantId,
          usage_id: usageId,
          service_id: (charge as { serviceId?: string }).serviceId,
          client_id: clientId,
          usage_date: (charge as { servicePeriodStart?: string }).servicePeriodStart ?? cycleRecord.period_start_date,
          quantity: (charge as { quantity?: number }).quantity ?? 1,
          invoiced: false,
        })
        .onConflict(['tenant', 'usage_id'])
        .ignore();
    }
  }

  const totalAmount = charges.reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);

  const billingResult: IBillingResult = {
    tenant: context.tenantId,
    charges,
    discounts: [],
    adjustments: [],
    totalAmount,
    finalAmount: totalAmount,
  };

  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    clientId,
    cycleRecord.period_start_date ?? cycleRecord.effective_date,
    cycleRecord.period_end_date ?? cycleRecord.effective_date,
    billingCycleId,
    context.userId
  );

  return createdInvoice.invoice_id;
}

function makeCharge(
  serviceId: string,
  serviceName: string,
  total: number,
  periodStart: string,
  periodEnd: string
): IBillingCharge {
  return {
    tenant: context.tenantId,
    type: 'usage',
    serviceId,
    serviceName,
    quantity: 1,
    rate: total,
    total,
    tax_amount: 0,
    tax_rate: 0,
    tax_region: 'US-NY',
    is_taxable: false,
    usageId: uuidv4(),
    servicePeriodStart: periodStart,
    servicePeriodEnd: periodEnd,
    billingTiming: 'arrears',
  };
}

describe('Credit Service-Type Restriction Mode (Option B)', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'transactions',
        'credit_tracking',
        'credit_allocations',
        'client_billing_cycles',
        'client_contract_lines',
        'service_catalog',
        'service_types',
        'contract_lines',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings',
      ],
      clientName: 'Credit Restriction Mode Client',
      userType: 'internal',
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await setupDefaultTax();
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await setupDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('client mode NULL inherits the tenant restricted list', async () => {
    const laborTypeId = await createServiceType('Labor');

    await seedTenantRestriction('restricted', [laborTypeId]);

    const clientId = await createClient(context.db, context.tenantId, 'Inherit Restricted Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });
    await seedClientRestriction(clientId, null, null);

    const policy = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(policy.serviceTypeRestrictionMode).toBe('restricted');
    expect(policy.eligibleServiceTypeIds).toEqual([laborTypeId]);
  });

  it('client mode NULL inherits the tenant "all" (unrestricted)', async () => {
    await seedTenantRestriction('all', null);

    const clientId = await createClient(context.db, context.tenantId, 'Inherit All Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });
    await seedClientRestriction(clientId, null, null);

    const policy = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(policy.serviceTypeRestrictionMode).toBe('all');
    expect(policy.eligibleServiceTypeIds).toBeNull();
  });

  it('client mode "all" overrides a tenant restricted list (unrestricted override)', async () => {
    const laborTypeId = await createServiceType('Labor');

    await seedTenantRestriction('restricted', [laborTypeId]);

    const clientId = await createClient(context.db, context.tenantId, 'Explicit All Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });
    await seedClientRestriction(clientId, 'all', null);

    const policy = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(policy.serviceTypeRestrictionMode).toBe('all');
    expect(policy.eligibleServiceTypeIds).toBeNull();
  });

  it('client mode "restricted" wins over tenant and never pairs with tenant ids (layer-consistency)', async () => {
    const laborTypeId = await createServiceType('Labor');
    const hardwareTypeId = await createServiceType('Hardware');

    await seedTenantRestriction('restricted', [laborTypeId]);

    const clientId = await createClient(context.db, context.tenantId, 'Client Restricted Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });
    // Client picks a *different* list than the tenant.
    await seedClientRestriction(clientId, 'restricted', [hardwareTypeId]);

    const policy = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(policy.serviceTypeRestrictionMode).toBe('restricted');
    expect(policy.eligibleServiceTypeIds).toEqual([hardwareTypeId]);
    expect(policy.eligibleServiceTypeIds).not.toContain(laborTypeId);
  });

  it('explicit "all" override lets the apply engine draw down against otherwise-ineligible charges', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Explicit All Apply Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });

    await setupDefaultTax(clientId);

    const laborTypeId = await createServiceType('Labor');
    const hardwareTypeId = await createServiceType('Hardware');

    // Tenant restricts credit to labor only; the client explicitly opts out of
    // the restriction ("all"), so the hardware charge is also eligible.
    await seedTenantRestriction('restricted', [laborTypeId]);
    await seedClientRestriction(clientId, 'all', null);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    const anchorServiceId = await createTestService(context, {
      service_name: 'Contract Line Anchor Service',
    });
    await createFixedPlanAssignment(context, anchorServiceId, {
      clientId,
      startDate: periodStart,
      planName: 'Drawdown Test Plan',
    });

    const laborService = await createTestService(context, {
      service_name: 'Labor Service',
      billing_method: 'fixed',
      default_rate: 6000,
      custom_service_type_id: laborTypeId,
    });
    const hardwareService = await createTestService(context, {
      service_name: 'Hardware Service',
      billing_method: 'fixed',
      default_rate: 4000,
      custom_service_type_id: hardwareTypeId,
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const invoiceId = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(laborService, 'Labor Service', 6000, periodStart, periodEnd),
      makeCharge(hardwareService, 'Hardware Service', 4000, periodStart, periodEnd),
    ]);

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();

    // With the client "all" override, both the labor and the hardware charge are
    // eligible, so the full invoice draws down (contrast the restricted case,
    // which caps at the labor 6000 subtotal).
    expect(Number(finalizedInvoice.credit_applied)).toBe(10000);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(0);
  });

  it('manual application honors the explicit "all" override as well', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Explicit All Manual Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });

    await setupDefaultTax(clientId);

    const laborTypeId = await createServiceType('Labor');
    const hardwareTypeId = await createServiceType('Hardware');

    await seedTenantRestriction('restricted', [laborTypeId]);
    await seedClientRestriction(clientId, 'all', null);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    const anchorServiceId = await createTestService(context, {
      service_name: 'Contract Line Anchor Service',
    });
    await createFixedPlanAssignment(context, anchorServiceId, {
      clientId,
      startDate: periodStart,
      planName: 'Drawdown Test Plan',
    });

    const laborService = await createTestService(context, {
      service_name: 'Labor Service',
      billing_method: 'fixed',
      default_rate: 6000,
      custom_service_type_id: laborTypeId,
    });
    const hardwareService = await createTestService(context, {
      service_name: 'Hardware Service',
      billing_method: 'fixed',
      default_rate: 4000,
      custom_service_type_id: hardwareTypeId,
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const invoiceId = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(laborService, 'Labor Service', 6000, periodStart, periodEnd),
      makeCharge(hardwareService, 'Hardware Service', 4000, periodStart, periodEnd),
    ]);

    await finalizeInvoice(invoiceId);

    await applyCreditToInvoice(clientId, invoiceId, 10000);

    const afterManual = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(afterManual.credit_applied)).toBe(10000);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(0);
  });
});
