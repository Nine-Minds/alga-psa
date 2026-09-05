import { describe, expect, it } from 'vitest';
import { QboSimulator, QboSimError } from './qboSimulator';

describe('QboSimulator — QBO semantics the sync engine depends on', () => {
  it('computes document totals from lines, ignoring the caller-supplied TotalAmt', async () => {
    const sim = new QboSimulator();
    const invoice = await sim.client.create('Invoice', {
      CustomerRef: { value: 'c-1' },
      TotalAmt: 999.99, // lies — QBO recomputes
      Line: [
        { DetailType: 'SalesItemLineDetail', Amount: 100.0 },
        { DetailType: 'SalesItemLineDetail', Amount: 50.5 }
      ]
    });

    expect(invoice.TotalAmt).toBe(150.5);
    expect(invoice.Balance).toBe(150.5);
    expect(invoice.SyncToken).toBe('0');
  });

  it('taxAdjustmentCents models AST changing the total at create time', async () => {
    const sim = new QboSimulator({ taxAdjustmentCents: 825 });
    const invoice = await sim.client.create('Invoice', {
      CustomerRef: { value: 'c-1' },
      Line: [{ DetailType: 'SalesItemLineDetail', Amount: 100.0 }]
    });

    // What Alga transformed is not what QBO stored — the drift-baseline trap.
    expect(invoice.TotalAmt).toBe(108.25);
  });

  it('rejects updates carrying a stale SyncToken (5010) and increments on success', async () => {
    const sim = new QboSimulator();
    const invoice = await sim.client.create('Invoice', {
      CustomerRef: { value: 'c-1' },
      Line: [{ DetailType: 'SalesItemLineDetail', Amount: 10 }]
    });

    const updated = await sim.client.update('Invoice', { Id: invoice.Id, SyncToken: '0', DocNumber: 'INV-2' });
    expect(updated.SyncToken).toBe('1');

    await expect(
      sim.client.update('Invoice', { Id: invoice.Id, SyncToken: '0', DocNumber: 'INV-3' })
    ).rejects.toMatchObject({ code: '5010' });
  });

  it('enforces DisplayName uniqueness across ACTIVE AND INACTIVE customers (6240)', async () => {
    const sim = new QboSimulator();
    sim.seedCustomer({ name: 'Smith & Sons, Inc.', active: false });

    await expect(
      sim.client.create('Customer', { DisplayName: 'Smith & Sons, Inc.' })
    ).rejects.toMatchObject({ code: '6240' });
  });

  it('name queries return ACTIVE customers only — the auto-provision blind spot', async () => {
    const sim = new QboSimulator();
    sim.seedCustomer({ name: 'Dormant LLC', active: false });

    const byQuery = await sim.client.query("SELECT Id FROM Customer WHERE DisplayName = 'Dormant LLC'");
    const byHelper = await sim.client.findCustomerByDisplayName('Dormant LLC');

    expect(byQuery).toHaveLength(0);
    expect(byHelper).toBeNull();
    // ...so createOrUpdateCustomer walks straight into the duplicate-name wall.
    await expect(sim.client.createOrUpdateCustomer({ name: 'Dormant LLC' })).rejects.toBeInstanceOf(QboSimError);
  });

  it('payments reduce linked document balances and reject over-application', async () => {
    const sim = new QboSimulator();
    const customer = sim.seedCustomer({ name: 'Acme' });
    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 20000 });

    sim.receivePaymentInQbo({ invoiceId: invoice.Id, amountCents: 15000 });
    expect((await sim.client.read('Invoice', invoice.Id))!.Balance).toBe(50);

    expect(() => sim.receivePaymentInQbo({ invoiceId: invoice.Id, amountCents: 10000 })).toThrow(/exceeds open balance/);
  });

  it('CDC returns only changes after the cursor, with latest state and deleted flags', async () => {
    const sim = new QboSimulator();
    const customer = sim.seedCustomer({ name: 'Acme' });
    const cm = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 5000 });

    const cursor = sim.now();
    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 10000 });
    await sim.client.deleteCreditMemo(cm.Id, cm.SyncToken);

    const changeSet = await sim.client.fetchChanges(cursor);
    const types = changeSet.changes.map((c) => `${c.entityType}:${c.deleted}`);

    expect(types).toContain('Invoice:false');
    expect(types).toContain('CreditMemo:true');
    // The customer predates the cursor and did not change.
    expect(changeSet.changes.find((c) => c.entityType === 'Customer')).toBeUndefined();
    expect(changeSet.changes.find((c) => c.externalId === invoice.Id)!.payload.TotalAmt).toBe(100);
  });

  it('voidInvoice zeroes amounts and stamps a Voided note (the drift-detector heuristic shape)', async () => {
    const sim = new QboSimulator();
    const customer = sim.seedCustomer({ name: 'Acme' });
    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 10000 });

    await sim.client.voidInvoice(invoice.Id, invoice.SyncToken);
    const voided = (await sim.client.read('Invoice', invoice.Id))!;

    expect(voided.TotalAmt).toBe(0);
    expect(voided.Balance).toBe(0);
    expect(String(voided.PrivateNote)).toMatch(/voided/i);
  });

  it('autoApplyCredits consumes open customer credit the moment an invoice is created', async () => {
    const sim = new QboSimulator({ autoApplyCredits: true });
    const customer = sim.seedCustomer({ name: 'Acme' });
    const cm = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 10000 });

    const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

    expect((sim.entities('Payment'))).toHaveLength(1);
    expect((sim.entities('Payment'))[0].TotalAmt).toBe(0);
    expect((sim.entities('CreditMemo'))[0].Balance).toBe(0);
    expect((sim.entities('Invoice'))[0].Balance).toBe(50);
    expect(cm.Id).toBeDefined();
    expect(invoice.Id).toBeDefined();
  });

  it('getPreferences reports the AutoApplyCredit preference', async () => {
    const on = new QboSimulator({ autoApplyCredits: true });
    const off = new QboSimulator();

    expect((await on.client.getPreferences()).SalesFormsPrefs.AutoApplyCredit).toBe(true);
    expect((await off.client.getPreferences()).SalesFormsPrefs.AutoApplyCredit).toBe(false);
  });
  // ── Automated Sales Tax ─────────────────────────────────────────────────

  /** A US AST company: one jurisdiction built from three rate components. */
  function astSimulator() {
    const sim = new QboSimulator({ automatedSalesTax: { defaultTaxCodeId: 'tc-ca-sc' } });
    const state = sim.seedTaxRate({ id: 'r-state', name: 'California State', ratePercent: 6.25 });
    const county = sim.seedTaxRate({ id: 'r-county', name: 'Santa Clara County', ratePercent: 1 });
    const district = sim.seedTaxRate({ id: 'r-district', name: 'Santa Clara District', ratePercent: 1.75 });
    sim.seedTaxCode({
      id: 'tc-ca-sc',
      name: 'CA-Santa Clara-Santa Clara',
      taxRateIds: [state.Id, county.Id, district.Id]
    });
    sim.seedTaxCode({ id: 'TAX', name: 'TAX', pseudo: true });
    sim.seedTaxCode({ id: 'NON', name: 'NON', pseudo: true });
    return sim;
  }

  function invoiceWith(taxCodeValue: string | undefined, amount: number) {
    return {
      CustomerRef: { value: 'customer-1' },
      Line: [
        {
          Amount: amount,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: {
            ItemRef: { value: 'item-1' },
            ...(taxCodeValue ? { TaxCodeRef: { value: taxCodeValue } } : {})
          }
        }
      ]
    };
  }

  it('the TAX pseudo code makes AST tax the line at the resolved jurisdiction rate', async () => {
    const sim = astSimulator();

    const invoice: any = await sim.client.create('Invoice', invoiceWith('TAX', 200));

    // 200 * (6.25 + 1 + 1.75)% = 18.00
    expect(invoice.TxnTaxDetail.TotalTax).toBe(18);
    expect(invoice.TotalAmt).toBe(218);
    expect(invoice.TxnTaxDetail.TaxLine.map((line: any) => line.Amount)).toEqual([12.5, 2, 3.5]);
  });

  it('a mapped tax code is taxed at that code, not the AST default', async () => {
    const sim = astSimulator();
    sim.seedTaxRate({ id: 'r-flat', name: 'Flat', ratePercent: 10 });
    sim.seedTaxCode({ id: 'tc-flat', name: 'Flat 10', taxRateIds: ['r-flat'] });

    const invoice: any = await sim.client.create('Invoice', invoiceWith('tc-flat', 200));

    expect(invoice.TxnTaxDetail.TotalTax).toBe(20);
  });

  it('the NON pseudo code exempts the line', async () => {
    const sim = astSimulator();

    const invoice: any = await sim.client.create('Invoice', invoiceWith('NON', 200));

    expect(invoice.TxnTaxDetail.TotalTax).toBe(0);
    expect(invoice.TotalAmt).toBe(200);
  });

  it('an omitted tax code is taxed, not exempted — the 2018 AST behavior change', async () => {
    const sim = astSimulator();

    const invoice: any = await sim.client.create('Invoice', invoiceWith(undefined, 200));

    // This is why the exporter must send NON explicitly for non-taxable lines.
    expect(invoice.TxnTaxDetail.TotalTax).toBe(18);
  });

  it('AST overwrites the transaction-level tax code with its own', async () => {
    const sim = astSimulator();

    const invoice: any = await sim.client.create('Invoice', {
      ...invoiceWith('TAX', 100),
      TxnTaxDetail: { TxnTaxCodeRef: { value: 'whatever-the-app-sent' } }
    });

    expect(invoice.TxnTaxDetail.TxnTaxCodeRef).toEqual({ value: 'tc-ca-sc' });
  });

  it('without the AST option, invoices carry no TxnTaxDetail at all', async () => {
    const sim = new QboSimulator();

    const invoice: any = await sim.client.create('Invoice', invoiceWith('TAX', 200));

    expect(invoice.TxnTaxDetail).toBeUndefined();
    expect(invoice.TotalAmt).toBe(200);
  });

  it('serves the tax-code catalog queries the mapping UI issues', async () => {
    const sim = astSimulator();

    const taxCodes = await sim.client.query<any>('SELECT * FROM TaxCode STARTPOSITION 1 MAXRESULTS 1000');
    const taxRates = await sim.client.query<any>('SELECT Id, RateValue FROM TaxRate STARTPOSITION 1 MAXRESULTS 1000');

    expect(taxCodes.map((code) => code.Id)).toEqual(['tc-ca-sc', 'TAX', 'NON']);
    expect(taxCodes[0].SalesTaxRateList.TaxRateDetail).toHaveLength(3);
    // Intuit returns the pseudo codes with no Active field — a server-side
    // Active filter would drop exactly these two.
    expect(taxCodes[1]).not.toHaveProperty('Active');
    expect(taxRates).toEqual([
      { Id: 'r-state', RateValue: 6.25 },
      { Id: 'r-county', RateValue: 1 },
      { Id: 'r-district', RateValue: 1.75 }
    ]);
  });

  it('pages the tax-code catalog like QBO does', async () => {
    const sim = new QboSimulator();
    for (let index = 0; index < 5; index += 1) {
      sim.seedTaxCode({ id: `tc-${index}`, name: `Region ${index}` });
    }

    const firstPage = await sim.client.query<any>('SELECT * FROM TaxCode STARTPOSITION 1 MAXRESULTS 2');
    const secondPage = await sim.client.query<any>('SELECT * FROM TaxCode STARTPOSITION 3 MAXRESULTS 2');

    expect(firstPage.map((code) => code.Id)).toEqual(['tc-0', 'tc-1']);
    expect(secondPage.map((code) => code.Id)).toEqual(['tc-2', 'tc-3']);
  });
});
