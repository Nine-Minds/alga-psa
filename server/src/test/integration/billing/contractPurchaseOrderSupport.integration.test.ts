import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  assignServiceTaxRate,
  ensureDefaultBillingSettings,
  setupClientTaxConfiguration,
} from '../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;

let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let getPurchaseOrderConsumedCents: typeof import('server/src/lib/services/purchaseOrderService').getPurchaseOrderConsumedCents;
let computePurchaseOrderOverage: typeof import('server/src/lib/services/purchaseOrderService').computePurchaseOrderOverage;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

describe('Contract Purchase Order Support', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, userId: 'po-test-user', permissionCheck: () => true });

    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ getPurchaseOrderConsumedCents, computePurchaseOrderOverage } = await import(
      'server/src/lib/services/purchaseOrderService'
    ));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('T001: invoices table includes po_number + client_contract_id', async () => {
    expect(await db.schema.hasColumn('invoices', 'po_number')).toBe(true);
    expect(await db.schema.hasColumn('invoices', 'client_contract_id')).toBe(true);
  });

  it('T002: invoice creation snapshots client_contracts.po_number onto invoices.po_number', async () => {
    const { clientId, billingCycleId } = await createClientWithBillingCycle();
    const { serviceTypeId, serviceId } = await createFixedService();

    await setupBillingPrereqs(clientId);

    const poNumber = `PO-${uuidv4().slice(0, 8)}`;
    await createClientContractFromWizard({
      contract_name: 'PO Snapshot Contract',
      description: 'Contract used to validate invoice PO snapshot behavior',
      client_id: clientId,
      start_date: '2024-12-01',
      end_date: undefined,
      billing_frequency: 'monthly',
      currency_code: 'USD',
      po_required: false,
      po_number: poNumber,
      po_amount: null,
      fixed_base_rate: 10000,
      enable_proration: false,
      fixed_services: [{ service_id: serviceId, quantity: 1, bucket_overlay: null }],
      product_services: [],
      hourly_services: [],
      usage_services: [],
      minimum_billable_time: undefined,
      round_up_to_nearest: undefined,
    });

    const invoice = await generateInvoice(billingCycleId);
    expect(invoice).toBeTruthy();

    const invoiceRow = await db('invoices')
      .where({ tenant: tenantId, invoice_id: invoice!.invoice_id })
      .select(['po_number', 'client_contract_id'])
      .first();
    expect(invoiceRow?.po_number).toBe(poNumber);
    expect(invoiceRow?.client_contract_id).toBeTruthy();

    const contractRow = await db('client_contracts')
      .where({ tenant: tenantId, client_id: clientId })
      .orderBy('created_at', 'desc')
      .first();
    expect(invoiceRow?.client_contract_id).toBe(contractRow?.client_contract_id);

    void serviceTypeId;
    void serviceId;
  }, HOOK_TIMEOUT);

  it('T003: invoice generation blocks when po_required=true and po_number is missing', async () => {
    const { clientId, billingCycleId } = await createClientWithBillingCycle('PO Required Client');
    const { serviceTypeId, serviceId } = await createFixedService('PO Required Service');

    await setupBillingPrereqs(clientId);

    await createClientContractFromWizard({
      contract_name: 'PO Required Contract',
      description: 'Contract used to validate PO required enforcement',
      client_id: clientId,
      start_date: '2024-12-01',
      end_date: undefined,
      billing_frequency: 'monthly',
      currency_code: 'USD',
      po_required: true,
      po_number: undefined,
      po_amount: null,
      fixed_base_rate: 10000,
      enable_proration: false,
      fixed_services: [{ service_id: serviceId, quantity: 1, bucket_overlay: null }],
      product_services: [],
      hourly_services: [],
      usage_services: [],
      minimum_billable_time: undefined,
      round_up_to_nearest: undefined,
    });

    await expect(() => generateInvoice(billingCycleId)).rejects.toThrow(/Purchase Order is required/i);

    void serviceTypeId;
    void serviceId;
  }, HOOK_TIMEOUT);

  it('T004: PO consumption sums finalized invoices and unconsumes when status changes away from finalized', async () => {
    const clientContractId = uuidv4();
    const otherClientContractId = uuidv4();
    const clientId = uuidv4();

    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Consumption Client ${clientId.slice(0, 6)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const sentInvoiceId = await createInvoiceRow({
      invoiceId: uuidv4(),
      clientId,
      clientContractId,
      totalAmount: 10000,
      status: 'sent',
      finalizedAt: new Date().toISOString(),
    });
    await createInvoiceRow({
      invoiceId: uuidv4(),
      clientId,
      clientContractId,
      totalAmount: 5000,
      status: 'draft',
      finalizedAt: null,
    });
    await createInvoiceRow({
      invoiceId: uuidv4(),
      clientId,
      clientContractId,
      totalAmount: 5000,
      status: 'pending',
      finalizedAt: null,
    });
    await createInvoiceRow({
      invoiceId: uuidv4(),
      clientId,
      clientContractId,
      totalAmount: 2000,
      status: 'paid',
      finalizedAt: null,
    });
    await createInvoiceRow({
      invoiceId: uuidv4(),
      clientId,
      clientContractId,
      totalAmount: 3000,
      status: 'draft',
      finalizedAt: new Date().toISOString(),
    });
    await createInvoiceRow({
      invoiceId: uuidv4(),
      clientId,
      clientContractId: otherClientContractId,
      totalAmount: 9999,
      status: 'sent',
      finalizedAt: new Date().toISOString(),
    });

    const consumed1 = await getPurchaseOrderConsumedCents({
      knex: db,
      tenant: tenantId,
      clientContractId,
    });
    expect(consumed1).toBe(10000 + 2000 + 3000);

    await db('invoices')
      .where({ tenant: tenantId, invoice_id: sentInvoiceId })
      .update({ status: 'draft', finalized_at: null, updated_at: db.fn.now() });

    const consumed2 = await getPurchaseOrderConsumedCents({
      knex: db,
      tenant: tenantId,
      clientContractId,
    });
    expect(consumed2).toBe(2000 + 3000);
  }, HOOK_TIMEOUT);

  it('T005: overage calculation uses invoice total_amount and contract po_amount (authorized total spend)', async () => {
    expect(
      computePurchaseOrderOverage({
        authorizedCents: 10000,
        consumedCents: 3000,
        invoiceTotalCents: 4000,
      })
    ).toMatchObject({ remainingCents: 7000, overageCents: 0 });

    expect(
      computePurchaseOrderOverage({
        authorizedCents: 10000,
        consumedCents: 9000,
        invoiceTotalCents: 4000,
      })
    ).toMatchObject({ remainingCents: 1000, overageCents: 3000 });
  });

  async function setupBillingPrereqs(clientId: string): Promise<void> {
    const ctx = { db, tenantId, clientId } as any;
    await ensureDefaultBillingSettings(ctx);
    await setupClientTaxConfiguration(ctx, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875,
      clientId,
    });
    await assignServiceTaxRate(ctx, '*', 'US-NY', { onlyUnset: true });
  }

  async function createClientWithBillingCycle(
    clientName = 'PO Billing Client'
  ): Promise<{ clientId: string; billingCycleId: string }> {
    const clientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: clientName,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('client_locations').insert({
      location_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      location_name: 'Billing',
      address_line1: '1 Test St',
      city: 'Testville',
      state_province: 'NY',
      postal_code: '10001',
      country_code: 'US',
      country_name: 'United States',
      is_billing_address: true,
      is_default: true,
      email: 'billing@test.invalid',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const billingCycleId = uuidv4();
    await db('client_billing_cycles').insert({
      billing_cycle_id: billingCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-01-01T00:00:00Z',
      period_start_date: '2025-01-01T00:00:00Z',
      period_end_date: '2025-02-01T00:00:00Z',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    return { clientId, billingCycleId };
  }

  async function createFixedService(
    serviceName = 'PO Fixed Service'
  ): Promise<{ serviceTypeId: string; serviceId: string }> {
    const serviceTypeId = uuidv4();
    await db('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `Fixed Type ${serviceName}`,
      billing_method: 'fixed',
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const serviceId = uuidv4();
    await db('service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: serviceName,
      description: 'Fixed service for PO tests',
      default_rate: 10000,
      unit_of_measure: 'month',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null,
    });

    return { serviceTypeId, serviceId };
  }

  async function createInvoiceRow(options: {
    invoiceId: string;
    clientId: string;
    clientContractId: string;
    totalAmount: number;
    status: string;
    finalizedAt: string | null;
  }): Promise<string> {
    await db('invoices').insert({
      invoice_id: options.invoiceId,
      tenant: tenantId,
      client_id: options.clientId,
      client_contract_id: options.clientContractId,
      invoice_number: `INV-${options.invoiceId.slice(0, 8)}`,
      total_amount: options.totalAmount,
      subtotal: options.totalAmount,
      tax: 0,
      status: options.status,
      currency_code: 'USD',
      credit_applied: 0,
      invoice_date: new Date().toISOString(),
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      finalized_at: options.finalizedAt,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    return options.invoiceId;
  }
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Contract PO Integration Tenant',
    email: 'contract-po@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}
