import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const invoiceEmail = require('../utils/templates/email/invoices/invoiceEmail.cjs');
const receipt = require('../utils/templates/email/invoices/invoiceReceiptEmail.cjs');
const migration = require('../20261116120000_add_invoice_receipt_email_template.cjs');

describe('invoice-receipt-email system template', () => {
  it('covers every locale invoice-email has, with no payment call to action', () => {
    const langs = (t: any) => t.getTemplate().translations.map((x: any) => x.language).sort();
    expect(langs(receipt)).toEqual(langs(invoiceEmail));
    for (const t of receipt.getTemplate().translations) {
      expect(t.subject).toContain('{{invoice.number}}');
      expect(t.htmlContent).not.toContain('invoice.paymentUrl');
      expect(t.textContent).not.toContain('invoice.paymentUrl');
    }
  });

  it('migrates data-only: upserts on up, deletes only its own rows on down', async () => {
    const insert = vi.fn(() => ({ onConflict: () => ({ merge: async () => undefined }) }));
    const del = vi.fn(async () => 1);
    const where = vi.fn(() => ({ del, first: async () => ({ id: 'subtype-1' }) }));
    const knex: any = vi.fn((table: string) => ({ insert, where }));
    knex.schema = undefined;

    await migration.up(knex);
    expect(insert).toHaveBeenCalledTimes(1);
    expect((insert.mock.calls[0] as any[])[0]).toHaveLength(9);

    await migration.down(knex);
    expect(where).toHaveBeenLastCalledWith({ name: 'invoice-receipt-email' });
    expect(del).toHaveBeenCalled();
  });
});
