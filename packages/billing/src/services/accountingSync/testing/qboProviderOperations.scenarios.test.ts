import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QboSimulator } from './qboSimulator';

/**
 * QBO regressions driven through the new provider-operation interface
 * (`QuickBooksOnlineAdapter.providerOperations()`), not the legacy
 * no-adapter fallback. This is the path shared appliers use at runtime.
 */

const simRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    QboClientService: {
      ...actual.QboClientService,
      create: vi.fn(async () => simRef.current.client)
    },
    getDefaultQboRealmId: vi.fn(async () => 'realm-sim')
  };
});

import { QuickBooksOnlineAdapter } from '../../../adapters/accounting/quickBooksOnlineAdapter';

const TENANT = 'tenant-sim';
const REALM = 'realm-sim';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QBO providerOperations against the simulator', () => {
  it('records a payment that applies to the Simulator invoice and returns a sync token', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;

    const customer = sim.seedCustomer({ name: 'Acme Corp' });
    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 5000 });

    const adapter = new QuickBooksOnlineAdapter();
    const ops = await adapter.providerOperations(TENANT, REALM);

    const result = await ops.recordPayment({
      externalInvoiceId: invoice.Id,
      externalCustomerId: customer.Id,
      amountCents: 5000,
      reference: 'STRIPE-1'
    });

    expect(result.externalPaymentId).toBeTruthy();
    expect(result.syncToken).toBeTruthy();
    expect(sim.entities('Payment')).toHaveLength(1);
    expect((await sim.client.read('Invoice', invoice.Id))!.Balance).toBe(0);
  });

  it('applies a credit through the provider interface', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;

    const customer = sim.seedCustomer({ name: 'Acme Corp' });
    const creditMemo = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 10000 });
    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

    const adapter = new QuickBooksOnlineAdapter();
    const ops = await adapter.providerOperations(TENANT, REALM);

    expect(await ops.getCreditRemainingCents(creditMemo.Id)).toBe(10000);

    const applied = await ops.applyCredit({
      externalCreditNoteId: creditMemo.Id,
      externalInvoiceId: invoice.Id,
      externalCustomerId: customer.Id,
      amountCents: 10000
    });

    expect(applied.externalPaymentId).toBeTruthy();
    expect((await sim.client.read('CreditMemo', creditMemo.Id))!.Balance).toBe(0);
  });

  it('voids an invoice through the provider interface', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;

    const customer = sim.seedCustomer({ name: 'Acme Corp' });
    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 5000 });

    const adapter = new QuickBooksOnlineAdapter();
    const ops = await adapter.providerOperations(TENANT, REALM);

    await ops.voidDocument({ externalId: invoice.Id, externalEntityType: 'Invoice' });

    const voided = sim.entities('Invoice').find((row: any) => row.Id === invoice.Id);
    expect(voided?.TotalAmt).toBe(0);
    expect(voided?.PrivateNote).toMatch(/voided/i);
  });
});
