import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  hasTable: true,
  config: true,
  settings: {} as undefined | { sendPaymentConfirmations?: boolean },
  portalUrl: 'https://portal.acme.test/client-portal/billing?tab=invoices&invoiceId=inv-1' as string | null,
  recipientEmail: 'billing@acme.test' as string,
  claimed: new Set<string>(),
  sendError: null as null | Error,
  sent: [] as any[],
}));

vi.mock('../../index', () => ({ getEventBus: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }) }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/db', () => {
  const tenantDb = (_k: unknown, tenant: string) => ({
    table: (name: string) => {
      const b: any = {
        where: () => b,
        orderBy: () => b,
        delete: async () => { state.claimed.clear(); },
        first: async () => {
          if (name === 'payment_provider_configs') return state.config ? { settings: state.settings } : undefined;
          if (name === 'invoice_payments')
            return { invoice_id: 'inv-1', amount: 12500, payment_method: 'stripe', payment_date: '2026-10-01T00:00:00Z' };
          if (name === 'invoices')
            return { invoice_id: 'inv-1', invoice_number: 'INV-1', client_id: 'c-1', billing_profile_id: null, currency_code: 'USD' };
          return undefined;
        },
        insert: (row: any) => {
          const ins: any = {
            onConflict: () => ins,
            ignore: () => ins,
            returning: async () => {
              const key = `${row.tenant}:${row.payment_id}`;
              if (state.claimed.has(key)) return [];
              state.claimed.add(key);
              return [{ payment_id: row.payment_id }];
            },
          };
          return ins;
        },
      };
      return b;
    },
  });
  return {
    tenantDb,
    runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
    createTenantKnex: async () => ({ knex: { schema: { hasTable: async () => state.hasTable } } }),
  };
});
vi.mock('@alga-psa/billing/services', () => ({
  resolveInvoiceBillingRecipient: async () => ({
    clientId: 'c-1', clientName: 'Acme', recipientEmail: state.recipientEmail, recipientName: 'AP', recipientSource: 'billing_email',
  }),
}));
vi.mock('@alga-psa/billing/actions/invoiceEmailLinkContext', () => ({
  buildPortalInvoiceUrl: async () => state.portalUrl,
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getUserInfoForEmail: async () => null,
  resolveEmailLocale: async () => 'fr',
}));
vi.mock('../../../notifications/sendEventEmail', () => ({
  sendEventEmail: async (p: any) => {
    if (state.sendError) throw state.sendError;
    state.sent.push(p);
  },
}));

import { handlePaymentRecordedEvent } from '../paymentConfirmationSubscriber';

const TENANT = '00000000-0000-0000-0000-000000000001';
const PAYMENT = '22222222-2222-2222-2222-222222222222';

function event(source?: string) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    eventType: 'PAYMENT_RECORDED',
    timestamp: '2026-10-01T00:00:00.000Z',
    payload: {
      tenantId: TENANT,
      occurredAt: '2026-10-01T00:00:00.000Z',
      actor: { actorType: 'SYSTEM' },
      paymentId: PAYMENT,
      clientId: '33333333-3333-3333-3333-333333333333',
      amount: '12500',
      currency: 'USD',
      method: 'stripe',
      ...(source ? { source } : {}),
    },
  };
}

describe('paymentConfirmationSubscriber', () => {
  beforeEach(() => {
    state.hasTable = true;
    state.config = true;
    state.settings = {};
    state.portalUrl = 'https://portal.acme.test/client-portal/billing?tab=invoices&invoiceId=inv-1';
    state.recipientEmail = 'billing@acme.test';
    state.claimed.clear();
    state.sendError = null;
    state.sent = [];
  });

  it('sends the localized payment-received email when enabled and provenance is online_payment', async () => {
    await handlePaymentRecordedEvent(event('online_payment'));
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      template: 'payment-received', to: 'billing@acme.test', locale: 'fr', tenantId: TENANT, recipientClientId: 'c-1',
    });
    expect(state.sent[0].context.invoice).toMatchObject({ number: 'INV-1', clientName: 'Acme', paymentMethod: 'stripe' });
  });

  it('sends for manual provenance', async () => {
    await handlePaymentRecordedEvent(event('manual'));
    expect(state.sent).toHaveLength(1);
  });

  it('does not send when sendPaymentConfirmations is false', async () => {
    state.settings = { sendPaymentConfirmations: false };
    await handlePaymentRecordedEvent(event('online_payment'));
    expect(state.sent).toHaveLength(0);
  });

  it('does not send when the payment_provider_configs table is absent (CE)', async () => {
    state.hasTable = false;
    await handlePaymentRecordedEvent(event('online_payment'));
    expect(state.sent).toHaveLength(0);
    expect(state.claimed.size).toBe(0);
  });

  it('does not send when no enabled provider config exists', async () => {
    state.config = false;
    await handlePaymentRecordedEvent(event('manual'));
    expect(state.sent).toHaveLength(0);
    expect(state.claimed.size).toBe(0);
  });

  it('sends when an enabled config leaves sendPaymentConfirmations absent', async () => {
    state.settings = {};
    await handlePaymentRecordedEvent(event('manual'));
    expect(state.sent).toHaveLength(1);
  });

  it('passes the portal-domain URL from buildPortalInvoiceUrl into context.invoice.url', async () => {
    await handlePaymentRecordedEvent(event('manual'));
    expect(state.sent[0].context.invoice.url).toBe(
      'https://portal.acme.test/client-portal/billing?tab=invoices&invoiceId=inv-1',
    );
  });

  it('still sends without a url when buildPortalInvoiceUrl returns null', async () => {
    state.portalUrl = null;
    await handlePaymentRecordedEvent(event('manual'));
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].context.invoice.url).toBeUndefined();
  });

  it('does not send for accounting_sync provenance', async () => {
    await handlePaymentRecordedEvent(event('accounting_sync'));
    expect(state.sent).toHaveLength(0);
  });

  it('does not send for missing provenance', async () => {
    await handlePaymentRecordedEvent(event());
    expect(state.sent).toHaveLength(0);
  });

  it('does not send (and does not throw) for unknown provenance', async () => {
    await expect(handlePaymentRecordedEvent(event('mystery'))).resolves.toBeUndefined();
    expect(state.sent).toHaveLength(0);
  });

  it('does not send and does not throw when there is no recipient, and does not consume the marker', async () => {
    state.recipientEmail = '';
    await expect(handlePaymentRecordedEvent(event('manual'))).resolves.toBeUndefined();
    expect(state.sent).toHaveLength(0);
    expect(state.claimed.size).toBe(0);
  });

  it('a second delivery of the same payment_id sends nothing', async () => {
    await handlePaymentRecordedEvent(event('online_payment'));
    await handlePaymentRecordedEvent(event('online_payment'));
    expect(state.sent).toHaveLength(1);
  });

  it('concurrent deliveries send at most one email', async () => {
    await Promise.all([handlePaymentRecordedEvent(event('manual')), handlePaymentRecordedEvent(event('manual'))]);
    expect(state.sent).toHaveLength(1);
  });

  it('releases the claim and rethrows on a retryable provider failure so redelivery can send', async () => {
    state.sendError = Object.assign(new Error('429'), { isRetryable: true });
    await expect(handlePaymentRecordedEvent(event('manual'))).rejects.toThrow('429');
    state.sendError = null;
    await handlePaymentRecordedEvent(event('manual'));
    expect(state.sent).toHaveLength(1);
  });

  it('keeps the claim and does not throw on a non-retryable failure', async () => {
    state.sendError = new Error('rejected');
    await expect(handlePaymentRecordedEvent(event('manual'))).resolves.toBeUndefined();
    state.sendError = null;
    await handlePaymentRecordedEvent(event('manual'));
    expect(state.sent).toHaveLength(0);
  });
});
