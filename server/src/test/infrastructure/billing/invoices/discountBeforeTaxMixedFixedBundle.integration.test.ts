import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../test-utils/dbConfig';
import {
  createTestService,
  assignServiceTaxRate,
  setupClientTaxConfiguration,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
} from '../../../../../test-utils/billingTestHelpers';
import { seedBillingCycle } from '../../../../../test-utils/billingProfileTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';

/**
 * Discount-before-tax repair: a consolidated fixed bundle that mixes a taxable
 * and an exempt service must be taxed identically by the billing preview and
 * the generated invoice. Only the taxable component's discounted allocation is
 * taxed; the exempt component takes its pro rata share of the discount and
 * ends with tax 0. Integer cents throughout.
 */

const { authRef, authWrapper } = vi.hoisted(() => {
  const ref = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: 'test-user',
  };
  return {
    authRef: ref,
    authWrapper:
      (fn: (...args: any[]) => any) =>
      (...args: any[]) =>
        fn({ user_id: ref.userId, tenant: ref.tenantId, roles: [] }, { tenant: ref.tenantId }, ...args),
  };
});

let db: Knex;
let tenantId: string;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(() => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(() => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
    withTransaction: vi.fn(async (_knex: unknown, fn: (trx: Knex) => Promise<any>) => fn(db)),
    requireTenantId: vi.fn(async () => tenantId),
    auditLog: vi.fn(async () => undefined),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: authWrapper,
  withOptionalAuth: authWrapper,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: authWrapper,
  withOptionalAuth: authWrapper,
  // test-utils/testMocks.ts re-points these via vi.mocked(...) in setupCommonMocks.
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { capture: vi.fn(), identify: vi.fn(), trackPerformance: vi.fn(), getClient: () => null },
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


const HOOK_TIMEOUT = 180_000;
const PREVIOUS_START = '2024-12-01';
const CURRENT_START = '2025-01-01';
const NEXT_START = '2025-02-01';

type Currency = 'USD' | 'EUR';

let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions')['createClientContractFromWizard'];
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration')['generateInvoice'];
let previewInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration')['previewInvoice'];
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync')['syncRecurringServicePeriodsForContractLine'];

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates the tenant row')
    .first<{ tenant: string }>('tenant');
  if (existing?.tenant) return existing.tenant;
  const created = uuidv4();
  await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates the tenant row')
    .insert({
      tenant: created,
      client_name: 'Fixed Fee Zero Catalog Price Tenant',
      email: 'fixed-fee-zero-catalog@test.co',
      created_at: connection.fn.now(),
      updated_at: connection.fn.now(),
    });
  return created;
}

/** A client with a billing address, default billing settings and two monthly cycles. */
async function createBillableClient(name: string, currency: Currency) {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    default_currency_code: currency,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table('client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Billing Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `${clientId.slice(0, 8)}@billing.test`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const fixture = { db, tenantId, clientId } as any;
  await ensureDefaultBillingSettings(fixture);
  await ensureClientPlanBundlesTable(fixture);

  await seedBillingCycle(db, tenantId, {
    billing_cycle_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: `${PREVIOUS_START}T00:00:00Z`,
    period_start_date: `${PREVIOUS_START}T00:00:00Z`,
    period_end_date: `${CURRENT_START}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const cycleId = uuidv4();
  await seedBillingCycle(db, tenantId, {
    billing_cycle_id: cycleId,
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: `${CURRENT_START}T00:00:00Z`,
    period_start_date: `${CURRENT_START}T00:00:00Z`,
    period_end_date: `${NEXT_START}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return { fixture, clientId, cycleId };
}


function unwrap<T>(result: T): any {
  if (result && typeof result === 'object' && ('actionError' in result || 'permissionError' in result)) {
    throw new Error(JSON.stringify(result));
  }
  return result as any;
}

const sum = (values: Array<number | undefined>) => values.reduce<number>((acc, value) => acc + (value ?? 0), 0);

describe('consolidated fixed bundle mixing taxable and exempt services, with a contract discount', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.E2E_AUTH_BYPASS = 'true';
    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    authRef.tenantId = tenantId;
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice, previewInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('preview tax equals invoice tax equals rate x (taxable allocation - its discount share); exempt detail tax is 0', async () => {
    setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
    const { fixture, clientId, cycleId } = await createBillableClient('Mixed tax bundle client', 'USD');

    // FMV-TAX $100 x1 (taxable, 6%), FMV-NOTAX $300 x3 (no tax rate); line rate $900.
    const taxableService = await createTestService(fixture, {
      service_name: 'FMV-TAX', billing_method: 'fixed', default_rate: 10000, unit_of_measure: 'seat', tax_region: 'US-FL',
    });
    const exemptService = await createTestService(fixture, {
      service_name: 'FMV-NOTAX', billing_method: 'fixed', default_rate: 30000, unit_of_measure: 'seat',
    });
    await setupClientTaxConfiguration(fixture, {
      regionCode: 'US-FL', regionName: 'Florida', taxPercentage: 6, startDate: '2024-01-01T00:00:00.000Z',
    });
    await assignServiceTaxRate(fixture, taxableService, 'US-FL', { onlyUnset: false });
    await table('service_catalog').where({ service_id: exemptService }).update({ tax_rate_id: null });

    const FEE = 90000;
    const created = unwrap(await createClientContractFromWizard({
      contract_name: 'Mixed tax bundle',
      description: 'taxable + exempt fixed bundle',
      client_id: clientId,
      start_date: PREVIOUS_START,
      end_date: null,
      billing_frequency: 'monthly',
      currency_code: 'USD',
      enable_proration: false,
      fixed_base_rate: FEE,
      fixed_services: [
        { service_id: taxableService, quantity: 1 },
        { service_id: exemptService, quantity: 3 },
      ],
      hourly_services: [],
      usage_services: [],
      po_required: false,
      discounts: [{ discount_name: 'Contract $90', discount_type: 'fixed', value: 90, start_date: PREVIOUS_START }],
    } as any));
    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId, contractLineId: created.contract_line_id as string, sourceRunPrefix: 'integration-fixture',
      });
    });

    const preview = unwrap(await previewInvoice(cycleId));
    expect(preview.success).not.toBe(false);
    const previewTax = Number((preview.data ?? preview).tax);

    const generated = unwrap(await generateInvoice(cycleId));
    const invoice = await table('invoices').where({ invoice_id: generated.invoice_id }).first();
    const charges = await table('invoice_charges').where({ invoice_id: generated.invoice_id });
    const parent = charges.find((c: any) => !c.is_discount)!;
    const details = await table('invoice_charge_details as d')
      .join('invoice_charge_fixed_details as f', function () {
        this.on('f.item_detail_id', 'd.item_detail_id').andOn('f.tenant', 'd.tenant');
      })
      .where('d.item_id', parent.item_id)
      .select('d.service_id', 'f.allocated_amount', 'f.tax_amount', 'f.is_taxable', 'f.tax_region');
    const taxDetail = details.find((d: any) => d.service_id === taxableService)!;
    const exemptDetail = details.find((d: any) => d.service_id === exemptService)!;

    // Persisted per-component taxability.
    expect(taxDetail.is_taxable).toBe(true);
    expect(taxDetail.tax_region).toBe('US-FL');
    expect(exemptDetail.is_taxable).toBe(false);

    // $900 split by FMV 100:900 -> 9000 taxable / 81000 exempt; $90 spread pro rata -> 900 / 8100.
    const taxAlloc = Number(taxDetail.allocated_amount);
    const exemptAlloc = Number(exemptDetail.allocated_amount);
    expect(taxAlloc + exemptAlloc).toBe(FEE);
    const discountTotal = 9000;
    const taxShare = Math.round((discountTotal * taxAlloc) / FEE);
    const expectedTax = Math.ceil(((taxAlloc - taxShare) * 6) / 100);
    expect(expectedTax).toBe(486);

    expect(previewTax).toBe(expectedTax);
    expect(Number(invoice.tax)).toBe(expectedTax);
    expect(Number(taxDetail.tax_amount)).toBe(expectedTax);
    expect(Number(exemptDetail.tax_amount)).toBe(0);
    expect(Number(parent.tax_amount)).toBe(sum(details.map((d: any) => Number(d.tax_amount))));

    // Sum invariants.
    const lineNet = sum(charges.map((c: any) => Number(c.net_amount)));
    const lineTax = sum(charges.map((c: any) => Number(c.tax_amount)));
    expect(Number(invoice.subtotal)).toBe(lineNet);
    expect(Number(invoice.subtotal)).toBe(FEE - discountTotal);
    expect(Number(invoice.tax)).toBe(lineTax);
    expect(Number(invoice.total_amount)).toBe(Number(invoice.subtotal) + Number(invoice.tax));
  }, HOOK_TIMEOUT);
});
