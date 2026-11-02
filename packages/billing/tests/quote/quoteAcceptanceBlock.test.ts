import { describe, expect, it } from 'vitest';
import {
  appendAcceptanceBlockToHtmlDocument,
  buildQuoteViewModelAcceptance,
  renderQuoteAcceptanceBlockHtml,
} from '../../src/lib/quoteAcceptance';

const details = {
  signerName: 'Casey Signer',
  signerEmail: 'casey@example.com',
  signerTitle: 'CTO',
  acceptedAt: '2026-07-18T23:30:00.000Z',
  method: 'email_link',
  ipAddress: '203.0.113.9',
};

describe('quote acceptance block', () => {
  it('shows name, email, title, method label and IP', () => {
    const model = buildQuoteViewModelAcceptance(details, 'Casey Signer')!;
    const html = renderQuoteAcceptanceBlockHtml(model, { timeZone: 'UTC' });
    for (const text of ['Casey Signer', 'casey@example.com', 'CTO', 'Emailed link', '203.0.113.9']) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('email_link');
  });

  it('writes the time in the tenant time zone', () => {
    const model = buildQuoteViewModelAcceptance(details, 'Casey Signer')!;
    const la = renderQuoteAcceptanceBlockHtml(model, { timeZone: 'America/Los_Angeles' });
    const utc = renderQuoteAcceptanceBlockHtml(model, { timeZone: 'UTC' });
    // 23:30Z is 4:30 PM on the 18th in Los Angeles (PDT), 11:30 PM in UTC.
    expect(la).toMatch(/PDT/);
    expect(la).toMatch(/0?4:30/);
    expect(utc).toMatch(/UTC/);
    expect(utc).toMatch(/11:30/);
    expect(la).not.toEqual(utc);
  });

  it('omits empty fields', () => {
    const model = buildQuoteViewModelAcceptance(
      { acceptedAt: details.acceptedAt, method: 'portal', signerEmail: '  ', signerTitle: null, ipAddress: '' },
      'Pat'
    )!;
    const html = renderQuoteAcceptanceBlockHtml(model, { timeZone: 'UTC' });
    expect(html).toContain('Pat');
    expect(html).toContain('Client portal');
    expect(html).not.toContain('Email');
    expect(html).not.toContain('Title');
    expect(html).not.toContain('IP address');
  });

  it('escapes HTML in every value', () => {
    const model = buildQuoteViewModelAcceptance(
      { ...details, signerTitle: '<script>alert(1)</script>', signerEmail: 'a"b@x.com' },
      '<b>Mallory</b> & co'
    )!;
    const html = renderQuoteAcceptanceBlockHtml(model, { timeZone: 'UTC' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Mallory');
    expect(html).toContain('&lt;b&gt;Mallory&lt;/b&gt; &amp; co');
    expect(html).toContain('a&quot;b@x.com');
  });

  it('uses the document label translator when given one', () => {
    const model = buildQuoteViewModelAcceptance(details, 'Casey Signer')!;
    const html = renderQuoteAcceptanceBlockHtml(model, {
      timeZone: 'UTC',
      t: (key, options) => `[${key}|${String(options?.defaultValue)}]`,
    });
    expect(html).toContain('[labels.quoteAcceptance.signedBy|Signed by]');
    expect(html).toContain('[labels.quoteAcceptance.methods.emailLink|Emailed link]');
  });

  it('is appended inside the document body', () => {
    const out = appendAcceptanceBlockToHtmlDocument('<html><body><p>x</p></body></html>', '<section>b</section>');
    expect(out).toBe('<html><body><p>x</p><section>b</section></body></html>');
  });

  it('yields no acceptance for an unparseable timestamp', () => {
    expect(buildQuoteViewModelAcceptance({ ...details, acceptedAt: 'nope' }, 'x')).toBeNull();
  });
});
