import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();

function toDateOnly(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return null;
}

describe('InvoiceService recurring coexistence integration', () => {
  const HOOK_TIMEOUT = 240_000;
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'invoice_charge_details',
        'invoice_charges',
        'invoices',
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();

    await ctx.db('invoice_charge_details').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('T260: DB-backed sanity: mixed historical and canonical invoices remain queryable through the same invoice APIs during staged rollout', async () => {
    const seededService = await ctx.db('service_catalog')
      .where({ tenant: ctx.tenantId })
      .first<{ service_id: string }>('service_id');

    expect(seededService?.service_id).toBeTruthy();
    const serviceId = seededService!.service_id;

    const legacyInvoiceId = uuidv4();
    const canonicalInvoiceId = uuidv4();
    const legacyChargeId = uuidv4();
    const canonicalChargeId = uuidv4();
    const canonicalDetailId = uuidv4();
    const legacyCreatedAt = '2025-01-15T12:00:00.000Z';
    const canonicalCreatedAt = '2025-02-15T12:00:00.000Z';

    await ctx.db('invoices').insert([
      {
        invoice_id: legacyInvoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: 'INV-LEGACY-001',
        invoice_date: '2025-01-15',
        due_date: '2025-01-15',
        subtotal: 5000,
        tax: 0,
        total_amount: 5000,
        status: 'sent',
        currency_code: 'USD',
        is_manual: false,
        billing_period_start: '2025-01-01',
        billing_period_end: '2025-02-01',
        created_at: legacyCreatedAt,
        updated_at: legacyCreatedAt,
      },
      {
        invoice_id: canonicalInvoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: 'INV-CANON-001',
        invoice_date: '2025-02-15',
        due_date: '2025-02-15',
        subtotal: 10000,
        tax: 0,
        total_amount: 10000,
        status: 'sent',
        currency_code: 'USD',
        is_manual: false,
        billing_period_start: '2025-02-01',
        billing_period_end: '2025-03-01',
        created_at: canonicalCreatedAt,
        updated_at: canonicalCreatedAt,
      },
    ]);

    await ctx.db('invoice_charges').insert([
      {
        item_id: legacyChargeId,
        tenant: ctx.tenantId,
        invoice_id: legacyInvoiceId,
        service_id: serviceId,
        description: 'Historical flat recurring line',
        quantity: 1,
        unit_price: 50,
        total_price: 50,
        net_amount: 50,
        tax_amount: 0,
        is_manual: false,
        created_at: legacyCreatedAt,
        updated_at: legacyCreatedAt,
      },
      {
        item_id: canonicalChargeId,
        tenant: ctx.tenantId,
        invoice_id: canonicalInvoiceId,
        service_id: serviceId,
        description: 'Canonical recurring line',
        quantity: 1,
        unit_price: 100,
        total_price: 100,
        net_amount: 100,
        tax_amount: 0,
        is_manual: false,
        created_at: canonicalCreatedAt,
        updated_at: canonicalCreatedAt,
      },
    ]);

    await ctx.db('invoice_charge_details').insert({
      item_detail_id: canonicalDetailId,
      item_id: canonicalChargeId,
      tenant: ctx.tenantId,
      service_id: serviceId,
      config_id: uuidv4(),
      quantity: 1,
      rate: 100,
      service_period_start: '2025-02-01T00:00:00.000Z',
      service_period_end: '2025-03-01T00:00:00.000Z',
      billing_timing: 'arrears',
      created_at: canonicalCreatedAt,
      updated_at: canonicalCreatedAt,
    });

    const service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: ctx.db });

    const context = {
      tenant: ctx.tenantId,
      userId: ctx.userId,
    } as any;

    const [legacyInvoice, canonicalInvoice] = await Promise.all([
      service.getById(legacyInvoiceId, context, { include_items: true, include_client: false }),
      service.getById(canonicalInvoiceId, context, { include_items: true, include_client: false }),
    ]);

    expect(legacyInvoice?.invoice_id).toBe(legacyInvoiceId);
    expect(canonicalInvoice?.invoice_id).toBe(canonicalInvoiceId);
    expect(legacyInvoice?.line_items).toHaveLength(1);
    expect(canonicalInvoice?.line_items).toHaveLength(1);

    expect(legacyInvoice?.line_items?.[0]).toMatchObject({
      item_id: legacyChargeId,
      description: 'Historical flat recurring line',
    });
    expect(Number(legacyInvoice?.line_items?.[0]?.total_price)).toBe(50);
    expect(legacyInvoice?.line_items?.[0]).not.toHaveProperty('recurring_projection');
    expect(legacyInvoice?.line_items?.[0]).not.toHaveProperty('recurring_detail_periods');
    expect(legacyInvoice?.line_items?.[0]).not.toHaveProperty('service_period_start');
    expect(legacyInvoice?.line_items?.[0]).not.toHaveProperty('service_period_end');
    expect(legacyInvoice?.invoice_charges).toEqual(legacyInvoice?.line_items);

    expect(canonicalInvoice?.line_items?.[0]).toMatchObject({
      item_id: canonicalChargeId,
      description: 'Canonical recurring line',
      billing_timing: 'arrears',
      recurring_projection: {
        source: 'canonical_detail_rows',
        detail_period_count: 1,
        parent_period_projection: 'summary_range',
        parent_billing_timing_projection: 'uniform_detail_value_or_null',
        detail_billing_timing_shape: 'uniform',
      },
    });
    expect(Number(canonicalInvoice?.line_items?.[0]?.total_price)).toBe(100);
    expect(toDateOnly(canonicalInvoice?.line_items?.[0]?.service_period_start)).toBe('2025-02-01');
    expect(toDateOnly(canonicalInvoice?.line_items?.[0]?.service_period_end)).toBe('2025-03-01');
    expect(
      canonicalInvoice?.line_items?.[0]?.recurring_detail_periods?.map((period) => ({
        service_period_start: toDateOnly(period.service_period_start),
        service_period_end: toDateOnly(period.service_period_end),
        billing_timing: period.billing_timing,
      }))
    ).toEqual([
      {
        service_period_start: '2025-02-01',
        service_period_end: '2025-03-01',
        billing_timing: 'arrears',
      },
    ]);
    expect(canonicalInvoice?.invoice_charges).toEqual(canonicalInvoice?.line_items);
  }, HOOK_TIMEOUT);
});
