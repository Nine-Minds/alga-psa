import { describe, expect, it } from 'vitest';

import {
  buildSalesOrderConfirmationEmailContent,
  dedupeRecipients,
} from './salesOrderConfirmationEmail';

describe('Sales Order confirmation email (F205)', () => {
  describe('dedupeRecipients', () => {
    it('trims, drops empties/nullish, and de-duplicates', () => {
      expect(
        dedupeRecipients(['  a@x.com ', '', null, undefined, 'a@x.com', 'b@x.com']),
      ).toEqual(['a@x.com', 'b@x.com']);
    });

    it('returns an empty list when no usable address is present (the no-recipient guard)', () => {
      expect(dedupeRecipients(['', '   ', null, undefined])).toEqual([]);
    });
  });

  describe('buildSalesOrderConfirmationEmailContent', () => {
    it('names the SO in the subject and the PDF attachment filename', () => {
      const c = buildSalesOrderConfirmationEmailContent({ soNumber: 'SO-DEMO-001' });
      expect(c.subject).toBe('Order Confirmation SO-DEMO-001');
      expect(c.attachmentFilename).toBe('SO-DEMO-001.pdf');
      expect(c.text).toContain('SO-DEMO-001');
      expect(c.html).toContain('SO-DEMO-001');
    });

    it('greets the client by name and signs off with the tenant company name', () => {
      const c = buildSalesOrderConfirmationEmailContent({
        soNumber: 'SO-1',
        clientName: 'Emerald City',
        companyName: 'Oz Supplies',
      });
      expect(c.text).toContain('Hello Emerald City,');
      expect(c.html).toContain('Hello Emerald City,');
      expect(c.text.trimEnd().endsWith('Oz Supplies')).toBe(true);
      expect(c.html).toContain('Oz Supplies');
    });

    it('falls back to a neutral greeting / company when names are absent', () => {
      const c = buildSalesOrderConfirmationEmailContent({ soNumber: 'SO-1', clientName: '  ' });
      expect(c.text).toContain('Hello,');
      expect(c.html).toContain('<p>Hello,</p>');
      expect(c.html).toContain('Your Company');
    });

    it('includes an optional custom note, and escapes HTML in free-text fields', () => {
      const c = buildSalesOrderConfirmationEmailContent({
        soNumber: 'SO-1',
        clientName: 'Tom & Jerry <Co>',
        message: 'Ship to <dock> & call',
      });
      expect(c.html).toContain('Tom &amp; Jerry &lt;Co&gt;');
      expect(c.html).toContain('Ship to &lt;dock&gt; &amp; call');
      // the plain-text part keeps the raw note
      expect(c.text).toContain('Ship to <dock> & call');
    });

    it('omits the note paragraph entirely when no message is given', () => {
      const c = buildSalesOrderConfirmationEmailContent({ soNumber: 'SO-1' });
      // exactly two <p> from greeting + body + signoff line; no extra note <p>
      expect(c.html).not.toContain('<p></p>');
    });
  });
});
