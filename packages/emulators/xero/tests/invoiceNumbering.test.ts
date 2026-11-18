import { describe, expect, it } from 'vitest';
import { XeroEmulatorCore } from '../src/core';
import { parseWhere } from '../src/whereClause';

function newCore(): XeroEmulatorCore {
  let seed = 1;
  return new XeroEmulatorCore({
    clock: { now: () => new Date('2026-11-18T12:00:00Z') },
    rng: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
    log: () => undefined,
  });
}

function invoice(core: XeroEmulatorCore, extra: Record<string, unknown> = {}) {
  return core.upsertInvoice(core.defaultTenantId, {
    Type: 'ACCREC',
    Contact: { ContactID: 'contact-1' },
    LineItems: [{ Description: 'Line', Quantity: 1, UnitAmount: 10, LineAmount: 10 }],
    ...extra,
  });
}

describe('xero emulator: organisation-assigned invoice numbers', () => {
  it('numbers an unnumbered create from the organisation sequence and keeps a sent number', () => {
    const core = newCore();
    expect(invoice(core).InvoiceNumber).toBe('INV-0001');
    expect(invoice(core, { InvoiceNumber: 'ALGA-7' }).InvoiceNumber).toBe('ALGA-7');
    expect(invoice(core).InvoiceNumber).toBe('INV-0002');
  });

  it('continues the sequence where set-invoice-number-sequence says, with its own prefix and padding', () => {
    const core = newCore();
    expect(core.setInvoiceNumberSequence({ next: 1043, prefix: 'EQ-', padding: 5 })).toEqual({ nextInvoiceNumber: 'EQ-01043' });
    expect(invoice(core).InvoiceNumber).toBe('EQ-01043');
    expect(invoice(core).InvoiceNumber).toBe('EQ-01044');
  });

  it('an update by InvoiceID without a number keeps the stored number', () => {
    const core = newCore();
    const created = invoice(core);
    const updated = invoice(core, { InvoiceID: created.InvoiceID, Reference: 'changed' });
    expect(updated.InvoiceNumber).toBe(created.InvoiceNumber);
  });

  it('filters GET /Invoices by the Reference clause shape the Alga client sends, including escaped quotes', () => {
    const core = newCore();
    const first = invoice(core, { Reference: 'INV-00012' });
    const quoted = invoice(core, { Reference: 'PO "7" INV-00013' });
    invoice(core, { Reference: 'INV-00099' });
    invoice(core, { Type: 'ACCPAY', Reference: 'INV-00012' });

    const where = 'Type=="ACCREC" AND (Reference=="INV-00012" OR Reference=="PO \\"7\\" INV-00013")';
    const found = core.queryInvoices(core.defaultTenantId, where).map((row) => row.InvoiceID);
    expect(found.sort()).toEqual([first.InvoiceID, quoted.InvoiceID].sort());
    expect(core.queryInvoices(core.defaultTenantId)).toHaveLength(4);
  });

  it('rejects a where clause outside the modelled subset instead of matching everything', () => {
    expect(() => parseWhere('Total > 5')).toThrow(/cannot parse/);
    expect(() => parseWhere('Reference=="unterminated')).toThrow(/unterminated/);
    expect(parseWhere('Contact.ContactID!="x"')({ Contact: { ContactID: 'y' } })).toBe(true);
  });

  it('keeps contact lookup by Name working through the shared parser', () => {
    const core = newCore();
    core.upsertContact(core.defaultTenantId, { Name: 'Equit "Pty" Ltd' });
    core.upsertContact(core.defaultTenantId, { Name: 'Other' });
    expect(core.queryContacts(core.defaultTenantId, 'Name=="Equit \\"Pty\\" Ltd"').map((c) => c.Name)).toEqual(['Equit "Pty" Ltd']);
  });

  it('rename-invoice changes the number as a Xero user would', () => {
    const core = newCore();
    const created = invoice(core);
    const tenantId = core.organisationOfInvoice(String(created.InvoiceID));
    expect(core.renameInvoice(tenantId, String(created.InvoiceID), 'INV-0500').InvoiceNumber).toBe('INV-0500');
    expect(core.getInvoice(tenantId, String(created.InvoiceID)).InvoiceNumber).toBe('INV-0500');
  });

  it('snapshot/restore round-trips invoices, consent, tokens and the sequence', () => {
    const core = newCore();
    core.registerApplication({ type: 'confidential', clientId: 'app', clientSecret: 's', redirectUris: ['http://x/cb'] });
    core.setConnections('app', [core.defaultTenantId]);
    core.setInvoiceNumberSequence({ next: 20, padding: 5 });
    const created = invoice(core, { Reference: 'R-1' });

    const copy = newCore();
    copy.restore(JSON.parse(JSON.stringify(core.snapshot())));
    expect(copy.getInvoice(copy.defaultTenantId, String(created.InvoiceID)).InvoiceNumber).toBe('INV-00020');
    expect(copy.connections('app').map((org) => org.tenantId)).toEqual([core.defaultTenantId]);
    expect(invoice(copy).InvoiceNumber).toBe('INV-00021');
  });
});
