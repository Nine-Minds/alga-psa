import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

vi.mock('@alga-psa/shared/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
}));

async function loadInvoiceInboundActions() {
  vi.resetModules();
  await import('@alga-psa/billing/actions/inboundActions');
  return import('@alga-psa/shared/inboundWebhooks/actions/registry');
}

describe('invoice inbound webhook actions', () => {
  let trx: ReturnType<typeof vi.fn> & { fn: { now: ReturnType<typeof vi.fn> } };
  let invoicesQuery: {
    where: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    invoicesQuery = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        invoice_id: 'invoice-1',
        status: 'sent',
        custom_fields: {
          existing: true,
        },
      }),
      update: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([
        {
          invoice_id: 'invoice-1',
          status: 'paid',
        },
      ]),
    };
    trx = Object.assign(
      vi.fn((table: string) => {
        if (table === 'invoices') {
          return invoicesQuery;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      {
        fn: {
          now: vi.fn(() => 'db-now'),
        },
      },
    );
    mocks.createTenantKnex.mockResolvedValue({ knex: 'tenant-knex' });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (transaction: unknown) => unknown) =>
      callback(trx),
    );
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'invoice-1',
      externalEntityId: 'inv-42',
      metadata: {},
    });
  });

  it('T1050: markInvoicePaidByExternalId marks a mapped invoice paid', async () => {
    const { getAction } = await loadInvoiceInboundActions();
    const action = getAction('markInvoicePaidByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'payments',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { invoice: { id: 'inv-42', paymentId: 'pay-99' } },
          idempotencyKey: 'pay-99',
        },
        {
          external_id: 'inv-42',
          paid_at: '2026-05-11T12:30:00.000Z',
          payment_reference: 'pay-99',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'invoice',
      entityId: 'invoice-1',
      externalId: 'inv-42',
      metadata: {
        status: 'paid',
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'payments',
      'invoice',
      'inv-42',
      { knex: trx },
    );
    // Tenant scoping is enforced by the tenantDb facade (where({ tenant })) while
    // the action adds the invoice predicate separately.
    expect(invoicesQuery.where).toHaveBeenCalledWith({ tenant: 'tenant-a' });
    expect(invoicesQuery.where).toHaveBeenCalledWith({ invoice_id: 'invoice-1' });
    expect(invoicesQuery.update).toHaveBeenCalledWith({
      status: 'paid',
      custom_fields: {
        existing: true,
        inbound_webhook_paid_at: '2026-05-11T12:30:00.000Z',
        inbound_webhook_payment_reference: 'pay-99',
        inbound_webhook_delivery_id: 'delivery-1',
      },
      updated_at: 'db-now',
    });
    expect(invoicesQuery.returning).toHaveBeenCalledWith(['invoice_id', 'status']);
  });

  it('T1051: markInvoicePaidByExternalId returns lookup_miss when invoice mapping is absent', async () => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue(null);
    const { getAction } = await loadInvoiceInboundActions();
    const action = getAction('markInvoicePaidByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'payments',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { invoice: { id: 'missing-inv' } },
          idempotencyKey: 'missing-inv',
        },
        {
          external_id: 'missing-inv',
          payment_reference: 'pay-404',
        },
      ),
    ).resolves.toEqual({
      success: false,
      entityType: 'invoice',
      externalId: 'missing-inv',
      message: 'lookup_miss: invoice external_id "missing-inv" is not mapped for webhook "payments"',
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'payments',
      'invoice',
      'missing-inv',
      { knex: trx },
    );
    expect(invoicesQuery.first).not.toHaveBeenCalled();
    expect(invoicesQuery.update).not.toHaveBeenCalled();
  });

  it('T1052: markInvoicePaidByExternalId is idempotent when invoice is already paid', async () => {
    invoicesQuery.first.mockResolvedValue({
      invoice_id: 'invoice-1',
      status: 'paid',
      custom_fields: {
        inbound_webhook_payment_reference: 'pay-99',
      },
    });
    const { getAction } = await loadInvoiceInboundActions();
    const action = getAction('markInvoicePaidByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'payments',
          deliveryId: 'delivery-2',
          headers: {},
          rawBody: { invoice: { id: 'inv-42', paymentId: 'pay-99' } },
          idempotencyKey: 'pay-99',
        },
        {
          external_id: 'inv-42',
          payment_reference: 'pay-99',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'invoice',
      entityId: 'invoice-1',
      externalId: 'inv-42',
      metadata: {
        status: 'paid',
      },
    });

    expect(invoicesQuery.where).toHaveBeenCalledWith({ tenant: 'tenant-a' });
    expect(invoicesQuery.where).toHaveBeenCalledWith({ invoice_id: 'invoice-1' });
    expect(invoicesQuery.first).toHaveBeenCalled();
    expect(invoicesQuery.update).not.toHaveBeenCalled();
    expect(invoicesQuery.returning).not.toHaveBeenCalled();
  });

  it('T1053: updateInvoiceStatusByExternalId updates invoice status from mapped value', async () => {
    invoicesQuery.returning.mockResolvedValue([
      {
        invoice_id: 'invoice-1',
        status: 'overdue',
      },
    ]);
    const { getAction } = await loadInvoiceInboundActions();
    const action = getAction('updateInvoiceStatusByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'accounting-feed',
          deliveryId: 'delivery-3',
          headers: {},
          rawBody: { invoice: { id: 'inv-42', status: 'overdue' } },
          idempotencyKey: 'inv-42:overdue',
        },
        {
          external_id: 'inv-42',
          status: 'overdue',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'invoice',
      entityId: 'invoice-1',
      externalId: 'inv-42',
      metadata: {
        status: 'overdue',
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'accounting-feed',
      'invoice',
      'inv-42',
      { knex: trx },
    );
    expect(invoicesQuery.update).toHaveBeenCalledWith({
      status: 'overdue',
      custom_fields: {
        existing: true,
        inbound_webhook_status_delivery_id: 'delivery-3',
      },
      updated_at: 'db-now',
    });
  });
});
