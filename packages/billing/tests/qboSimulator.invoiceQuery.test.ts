import { describe, expect, it } from 'vitest';
import { QboSimulator } from '../src/services/accountingSync/testing/qboSimulator';

describe('QboSimulator historical invoice queries', () => {
  it('projects CurrencyRef and pages after filtering dates and deleted invoices', async () => {
    const sim = new QboSimulator();
    const customer = sim.seedCustomer({ name: 'Historical Customer' });
    const seed = (docNumber: string, txnDate: string, currency: string) => sim.seedInvoice({
      customerId: customer.Id,
      amountCents: 12500,
      docNumber,
      txnDate,
      currency,
    });
    seed('OLD', '2026-06-30', 'USD');
    const deleted = seed('DELETED', '2026-07-01', 'USD');
    deleted.deleted = true;
    const yen = seed('JPY-1', '2026-07-01', 'JPY');
    const dinar = seed('KWD-1', '2026-07-15', 'KWD');
    const query = "SELECT Id, DocNumber, TotalAmt, SyncToken, CustomerRef, CurrencyRef FROM Invoice WHERE TxnDate >= '2026-07-01'";

    const first = await sim.client.query(`${query} STARTPOSITION 1 MAXRESULTS 1`);
    const second = await sim.client.query(`${query} STARTPOSITION 2 MAXRESULTS 1`);
    expect(first).toEqual([{
      Id: yen.Id, DocNumber: 'JPY-1', TotalAmt: 12500, SyncToken: '0',
      CustomerRef: { value: customer.Id }, CurrencyRef: { value: 'JPY' },
    }]);
    expect(second).toEqual([{
      Id: dinar.Id, DocNumber: 'KWD-1', TotalAmt: 12.5, SyncToken: '0',
      CustomerRef: { value: customer.Id }, CurrencyRef: { value: 'KWD' },
    }]);
    expect(await sim.client.query(`${query} STARTPOSITION 3 MAXRESULTS 1`)).toEqual([]);

    // Query results must not expose mutable references to stored currency data.
    first[0].CurrencyRef.value = 'USD';
    expect((await sim.client.read('Invoice', yen.Id))?.CurrencyRef).toEqual({ value: 'JPY' });
  });

  it('supports unwindowed queries with and without the currency projection', async () => {
    const sim = new QboSimulator();
    const invoice = sim.seedInvoice({ customerId: 'customer-1', amountCents: 12500, currency: 'JPY' });
    const fields = 'SELECT Id, DocNumber, TotalAmt, SyncToken, CustomerRef';
    const suffix = ' FROM Invoice STARTPOSITION 1 MAXRESULTS 1000';

    const withCurrency = await sim.client.query(`${fields}, CurrencyRef${suffix}`);
    expect(withCurrency).toEqual([expect.objectContaining({ Id: invoice.Id, CurrencyRef: { value: 'JPY' } })]);
    const withoutCurrency = await sim.client.query(`${fields}${suffix}`);
    expect(withoutCurrency).toEqual([expect.objectContaining({ Id: invoice.Id, TotalAmt: 12500 })]);
    expect(withoutCurrency[0]).not.toHaveProperty('CurrencyRef');
    await expect(sim.client.query(`${fields}, UnsupportedField${suffix}`)).rejects.toMatchObject({ code: 'SIM_UNSUPPORTED' });
  });
});
