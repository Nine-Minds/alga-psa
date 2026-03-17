import { describe, expect, it } from 'vitest';

import {
  invoiceItemResponseSchema,
  invoiceResponseSchema,
} from 'server/src/lib/api/schemas/invoiceSchemas';
import { invoiceItemResponseSchema as financialInvoiceItemResponseSchema } from 'server/src/lib/api/schemas/financialSchemas';

const tenantId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const serviceId = '44444444-4444-4444-8444-444444444444';

describe('invoice response schema compatibility', () => {
  it('T198: legacy flat invoice payloads and canonical detail-backed invoice payloads both remain API-schema compatible', () => {
    const legacyFlatInvoice = invoiceResponseSchema.safeParse({
      invoice_id: invoiceId,
      client_id: '55555555-5555-4555-8555-555555555555',
      invoice_date: '2026-03-17',
      due_date: '2026-03-31',
      subtotal: 5000,
      tax: 0,
      total_amount: 5000,
      status: 'draft',
      invoice_number: 'INV-1001',
      credit_applied: 0,
      is_manual: false,
      tenant: tenantId,
      created_at: '2026-03-17T00:00:00.000Z',
      updated_at: '2026-03-17T00:00:00.000Z',
      invoice_items: [
        {
          item_id: itemId,
          invoice_id: invoiceId,
          service_id: serviceId,
          description: 'Legacy managed service',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
          tax_amount: 0,
          net_amount: 5000,
          is_manual: false,
          rate: 5000,
          tenant: tenantId,
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-17T00:00:00.000Z',
          service_period_start: '2026-02-01T00:00:00.000Z',
          service_period_end: '2026-03-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const canonicalDetailBackedInvoice = invoiceResponseSchema.safeParse({
      invoice_id: invoiceId,
      client_id: '55555555-5555-4555-8555-555555555555',
      invoice_date: '2026-03-17',
      due_date: '2026-03-31',
      subtotal: 10000,
      tax: 0,
      total_amount: 10000,
      status: 'draft',
      invoice_number: 'INV-1002',
      credit_applied: 0,
      is_manual: false,
      tenant: tenantId,
      created_at: '2026-03-17T00:00:00.000Z',
      updated_at: '2026-03-17T00:00:00.000Z',
      invoice_charges: [
        {
          item_id: itemId,
          invoice_id: invoiceId,
          service_id: serviceId,
          description: 'Managed services bundle',
          quantity: 1,
          unit_price: 10000,
          total_price: 10000,
          tax_amount: 0,
          net_amount: 10000,
          is_manual: false,
          rate: 10000,
          tenant: tenantId,
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-17T00:00:00.000Z',
          service_period_start: '2026-01-01T00:00:00.000Z',
          service_period_end: '2026-03-01T00:00:00.000Z',
          billing_timing: null,
          recurring_projection: {
            source: 'canonical_detail_rows',
            detail_period_count: 2,
            parent_period_projection: 'summary_range',
            parent_billing_timing_projection: 'uniform_detail_value_or_null',
            detail_billing_timing_shape: 'mixed',
          },
          recurring_detail_periods: [
            {
              service_period_start: '2026-01-01T00:00:00.000Z',
              service_period_end: '2026-02-01T00:00:00.000Z',
              billing_timing: 'arrears',
            },
            {
              service_period_start: '2026-02-01T00:00:00.000Z',
              service_period_end: '2026-03-01T00:00:00.000Z',
              billing_timing: 'advance',
            },
          ],
        },
      ],
    });

    const invalidHalfMigratedCharge = invoiceItemResponseSchema.safeParse({
      item_id: itemId,
      invoice_id: invoiceId,
      service_id: serviceId,
      description: 'Half-migrated recurring line',
      quantity: 1,
      unit_price: 10000,
      total_price: 10000,
      tax_amount: 0,
      net_amount: 10000,
      is_manual: false,
      rate: 10000,
      tenant: tenantId,
      created_at: '2026-03-17T00:00:00.000Z',
      updated_at: '2026-03-17T00:00:00.000Z',
      recurring_detail_periods: [
        {
          service_period_start: '2026-01-01T00:00:00.000Z',
          service_period_end: '2026-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const financialCanonicalCharge = financialInvoiceItemResponseSchema.safeParse({
      item_id: itemId,
      invoice_id: invoiceId,
      service_id: serviceId,
      description: 'Financial API recurring line',
      quantity: 1,
      unit_price: 10000,
      total_price: 10000,
      tax_amount: 0,
      net_amount: 10000,
      is_manual: false,
      rate: 10000,
      tenant: tenantId,
      created_at: '2026-03-17T00:00:00.000Z',
      updated_at: '2026-03-17T00:00:00.000Z',
      service_period_start: '2026-01-01T00:00:00.000Z',
      service_period_end: '2026-03-01T00:00:00.000Z',
      billing_timing: null,
      recurring_projection: {
        source: 'canonical_detail_rows',
        detail_period_count: 2,
        parent_period_projection: 'summary_range',
        parent_billing_timing_projection: 'uniform_detail_value_or_null',
        detail_billing_timing_shape: 'mixed',
      },
      recurring_detail_periods: [
        {
          service_period_start: '2026-01-01T00:00:00.000Z',
          service_period_end: '2026-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          service_period_start: '2026-02-01T00:00:00.000Z',
          service_period_end: '2026-03-01T00:00:00.000Z',
          billing_timing: 'advance',
        },
      ],
    });

    expect(legacyFlatInvoice.success).toBe(true);
    expect(canonicalDetailBackedInvoice.success).toBe(true);
    expect(invalidHalfMigratedCharge.success).toBe(false);
    expect(financialCanonicalCharge.success).toBe(true);
    expect(invalidHalfMigratedCharge.error?.issues[0]?.message).toBe(
      'Legacy flat invoice charges must not expose recurring_detail_periods without recurring_projection.'
    );
  });
});
