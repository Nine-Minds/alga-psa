import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { createFixedPlanAssignment, createTestService, setupClientTaxConfiguration, assignServiceTaxRate, ensureClientPlanBundlesTable } from '../../../../../test-utils/billingTestHelpers';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { addManualItemsToInvoice } from '@alga-psa/billing/actions/invoiceModification';
import type { IInvoiceCharge } from 'server/src/interfaces/invoice.interfaces';
import { v4 as uuidv4 } from 'uuid';

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Contract Invoice Manual Credit', () => {
  let context: TestContext;
  let mockedTenantId = '11111111-1111-1111-1111-111111111111';
  let mockedUserId = 'mock-user-id';

  vi.mock('server/src/lib/auth/rbac', () => ({
    hasPermission: vi.fn(() => Promise.resolve(true))
  }));

  vi.mock('server/src/lib/auth/getSession', () => ({
    getSession: vi.fn(async () => ({
      user: {
        id: mockedUserId,
        tenant: mockedTenantId
      }
    }))
  }));

  vi.mock('server/src/lib/analytics/posthog', () => ({
    analytics: {
      capture: vi.fn(),
      identify: vi.fn(),
      trackPerformance: vi.fn(),
      getClient: () => null
    }
  }));

  vi.mock('@alga-psa/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@alga-psa/db')>();
    return {
      ...actual,
      withTransaction: vi.fn(async (knex, callback) => callback(knex)),
      withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
    };
  });

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 10.0
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
    await ensureClientPlanBundlesTable(context);
  }

  async function attachPlanToContract(params: {
    contractId: string;
    clientContractId: string;
    contractLineId: string;
    clientContractLineId: string;
  }) {
    const { contractId, clientContractId, contractLineId, clientContractLineId } = params;

    await context.db('contract_lines')
      .where({
        tenant: context.tenantId,
        contract_line_id: contractLineId
      })
      .update({
        contract_id: contractId,
        display_order: 1,
        custom_rate: null
      });

    await context.db('client_contract_lines')
      .where({
        tenant: context.tenantId,
        client_contract_line_id: clientContractLineId
      })
      .update({
        client_contract_id: clientContractId,
        contract_line_id: contractLineId,
        is_active: true
      });
  }

  async function ensureClientBillingSettings(
    clientId: string,
    overrides: Record<string, unknown> = {}
  ) {
    await context.db('client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .del();

    const now = new Date().toISOString();
    await context.db('client_billing_settings').insert({
      client_id: clientId,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: false,
      created_at: now,
      updated_at: now,
      ...overrides
    });
  }


  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoice_charge_details',
        'invoice_charge_fixed_details',
        'invoices',
        'transactions',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'contracts',
        'client_contracts',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings'
      ],
      clientName: 'Contract Manual Credit Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should retain contract references and isolate manual credit line', async () => {
    const clientId = context.clientId;

    const serviceId = await createTestService(context, {
      service_name: 'Contracted Service',
      billing_method: 'fixed',
      default_rate: 20000,
      tax_region: 'US-NY'
    });

    const startDate = createTestDateISO({ year: 2025, month: 1, day: 1 });

    const { contractLineId, clientContractLineId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Monthly Contract Plan',
      billingFrequency: 'monthly',
      baseRateCents: 20000,
      detailBaseRateCents: 20000,
      quantity: 1,
      startDate,
      billingTiming: 'advance'
    });

    const contractId = await context.createEntity('contracts', {
      contract_name: 'Support Agreement',
      billing_frequency: 'monthly',
      is_active: true
    }, 'contract_id');

    const clientContractId = await context.createEntity('client_contracts', {
      client_id: context.clientId,
      contract_id: contractId,
      start_date: startDate,
      end_date: null,
      is_active: true
    }, 'client_contract_id');

    await attachPlanToContract({
      contractId,
      clientContractId,
      contractLineId,
      clientContractLineId
    });

    await ensureClientBillingSettings(context.clientId);

    const periodStart = startDate;
    const periodEnd = createTestDateISO({ year: 2025, month: 2, day: 1 });

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      period_start_date: periodStart,
      period_end_date: periodEnd,
      effective_date: periodStart
    }, 'billing_cycle_id');

    const generatedInvoice = await generateInvoice(billingCycleId);
    expect(generatedInvoice).not.toBeNull();
    const invoiceId = generatedInvoice!.invoice_id;

    const manualCredit: IInvoiceCharge = {
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: undefined,
      description: 'Goodwill rebate',
      quantity: 1,
      rate: -10000,
      unit_price: -10000,
      total_price: -10000,
      net_amount: -10000,
      tax_amount: 0,
      tax_region: undefined,
      tax_rate: 0,
      is_manual: true,
      is_taxable: false,
      is_discount: true,
      tenant: context.tenantId
    };

    const updatedInvoice = await addManualItemsToInvoice(invoiceId, [manualCredit]);

    const baseSubtotal = Number(generatedInvoice!.subtotal);
    const baseTax = Number(generatedInvoice!.tax);
    expect(baseSubtotal).toBeGreaterThan(0);

    const expectedTax = baseTax;
    const expectedSubtotal = baseSubtotal - 10000;
    const expectedTotal = expectedSubtotal + expectedTax;

    expect(updatedInvoice.subtotal).toBe(expectedSubtotal);
    expect(updatedInvoice.tax).toBe(expectedTax);
    expect(updatedInvoice.total_amount).toBe(expectedTotal);

    const invoiceItems = await context.db('invoice_charges')
      .where({ invoice_id: invoiceId, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(invoiceItems.length).toBeGreaterThanOrEqual(2);

    const contractItem = invoiceItems.find(item =>
      item.is_manual === false && Number(item.net_amount) > 0
    );
    const creditItem = invoiceItems.find(item =>
      item.is_manual === true && Number(item.net_amount) < 0
    );

    expect(contractItem).toBeTruthy();
    expect(creditItem).toBeTruthy();

    const contractDetail = await context.db('invoice_charge_details')
      .where({
        tenant: context.tenantId,
        item_id: contractItem!.item_id
      })
      .first();

    expect(contractDetail).toBeTruthy();

    const linkedContractLine = await context.db('client_contract_lines')
      .where({
        tenant: context.tenantId,
        contract_line_id: contractLineId
      })
      .first();

    expect(linkedContractLine).toBeTruthy();
    expect(contractDetail?.config_id).toBeTruthy();

    expect(creditItem!.is_manual).toBe(true);
    expect(creditItem!.is_discount).toBe(true);
    expect(creditItem!.contract_line_id ?? null).toBeNull();

    const creditDetails = await context.db('invoice_charge_details')
      .where({
        tenant: context.tenantId,
        item_id: creditItem!.item_id
      });

    expect(creditDetails.length).toBe(0);
  });
});
