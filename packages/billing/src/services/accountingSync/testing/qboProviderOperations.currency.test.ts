import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QboSimulator } from './qboSimulator';

/**
 * Minor-unit scaling across the QBO provider boundary, driven through the
 * simulator so both directions are exercised: Alga minor units → QBO decimal
 * amounts on the way out, QBO decimals → Alga minor units on the way back.
 * JPY has no fraction digits, so 10000 yen must travel as 10000 (not 100);
 * USD stays cents ↔ dollars exactly as before.
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

describe('QBO provider operations scale by the document currency', () => {
  it('round-trips a JPY payment at whole-yen amounts and a USD payment at cents', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;
    const customer = sim.seedCustomer({ name: 'Tokyo KK' });
    const jpyInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 10000, currency: 'JPY' });
    const usdInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 5000 });
    expect(jpyInvoice.TotalAmt).toBe(10000);
    expect(usdInvoice.TotalAmt).toBe(50);

    const adapter = new QuickBooksOnlineAdapter();
    const ops = await adapter.providerOperations(TENANT, REALM);
    const cursor = sim.now();

    await ops.recordPayment({
      externalInvoiceId: jpyInvoice.Id,
      externalCustomerId: customer.Id,
      amountCents: 10000,
      reference: 'JPY-1',
      currency: 'JPY'
    });
    await ops.recordPayment({
      externalInvoiceId: usdInvoice.Id,
      externalCustomerId: customer.Id,
      amountCents: 5000,
      reference: 'USD-1',
      currency: 'USD'
    });

    const [jpyPayment, usdPayment] = sim.entities('Payment');
    expect(jpyPayment.CurrencyRef).toEqual({ value: 'JPY' });
    expect(jpyPayment.TotalAmt).toBe(10000);
    expect(jpyPayment.Line[0].Amount).toBe(10000);
    expect(usdPayment.TotalAmt).toBe(50);
    expect(usdPayment.Line[0].Amount).toBe(50);
    expect((await sim.client.read('Invoice', jpyInvoice.Id))!.Balance).toBe(0);
    expect((await sim.client.read('Invoice', usdInvoice.Id))!.Balance).toBe(0);

    // Read back through the adapter's change feed: the normalized payment
    // must reconcile to the exact minor units Alga sent.
    const changes = await adapter.fetchChanges(TENANT, cursor, REALM);
    const normalizedJpy = changes.changes.find((c) => c.externalId === jpyPayment.Id)?.normalized as any;
    const normalizedUsd = changes.changes.find((c) => c.externalId === usdPayment.Id)?.normalized as any;
    expect(normalizedJpy).toMatchObject({
      currency: 'JPY',
      totalCents: 10000,
      allocations: [{ externalInvoiceId: jpyInvoice.Id, amountCents: 10000 }]
    });
    expect(normalizedUsd).toMatchObject({
      currency: 'USD',
      totalCents: 5000,
      allocations: [{ externalInvoiceId: usdInvoice.Id, amountCents: 5000 }]
    });
  });

  it('reads JPY credit remaining in yen and applies JPY credit at whole-yen amounts', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;
    const customer = sim.seedCustomer({ name: 'Tokyo KK' });
    const creditMemo = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 3000, currency: 'JPY' });
    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 10000, currency: 'JPY' });

    const adapter = new QuickBooksOnlineAdapter();
    const ops = await adapter.providerOperations(TENANT, REALM);

    expect(await ops.getCreditRemainingCents(creditMemo.Id)).toBe(3000);

    await ops.applyCredit({
      externalCreditNoteId: creditMemo.Id,
      externalInvoiceId: invoice.Id,
      externalCustomerId: customer.Id,
      amountCents: 3000,
      currency: 'JPY'
    });

    const payment = sim.entities('Payment')[0];
    expect(payment.Line.map((line: any) => line.Amount)).toEqual([3000, 3000]);
    expect((await sim.client.read('CreditMemo', creditMemo.Id))!.Balance).toBe(0);
    expect((await sim.client.read('Invoice', invoice.Id))!.Balance).toBe(7000);
    expect(await ops.getCreditRemainingCents(creditMemo.Id)).toBe(0);
  });
});
