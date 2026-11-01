/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      let text = typeof opts === 'string' ? opts : (opts?.defaultValue ?? key);
      for (const [k, v] of Object.entries(opts && typeof opts === 'object' ? opts : {})) text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
  }),
  useFormatters: () => ({ formatDate: (d: string) => `D(${d})` }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/ui/hooks/useQuoteEnumOptions', () => ({ useFormatQuoteStatus: () => (s: string) => s }));
vi.mock('@alga-psa/ui/editor', () => ({ QuoteTermsContent: () => null, hasQuoteTermsContent: () => false }));

import { PublicQuoteReview } from './PublicQuoteReview';

afterEach(cleanup);

const TOKEN = 'T'.repeat(43);
const agreement = { version: 'v1', text: 'I agree to this.', hash: 'abc' };
const base = (extra: Record<string, unknown> = {}) => ({
  quote_item_id: 'i1', description: 'Firewall', quantity: 1, unit_price: 1000, total_price: 1000,
  display_order: 0, is_optional: false, is_selected: true, is_discount: false, location_id: null,
  tax_amount_if_included: 100, ...extra,
});
const props = {
  quote: { quote_id: 'q1', title: 'T', currency_code: 'EUR', status: 'sent', subtotal: 1000, discount_total: 0, tax: 100, total_amount: 1100 },
  items: [base(), base({ quote_item_id: 'i2', description: 'Extra', is_optional: true, is_selected: false, display_order: 1 })],
  locations: [], locale: 'en', branding: { name: null, logoUrl: null }, pdfHref: '/p', decidedNotice: null,
  token: TOKEN, agreement, quoteFingerprint: 'fp-123',
} as any;

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

function fill() {
  fireEvent.change(document.getElementById('quote-link-signer-name')!, { target: { value: 'Jane Doe' } });
  fireEvent.click(document.getElementById('quote-link-agree')!);
}

describe('PublicQuoteReview decision panel', () => {
  it('accept stays disabled until name + agreement, then posts the exact decision path with the selection', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'decided', decision: 'accepted', decidedAt: '2026-10-31T00:00:00Z' }) });
    render(<PublicQuoteReview {...props} />);
    const accept = document.getElementById('quote-link-accept') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fill();
    expect(accept.disabled).toBe(false);
    fireEvent.click(accept);
    await waitFor(() => expect(document.getElementById('quote-link-decided')).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/quote/${TOKEN}/decision`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ action: 'accept', signerName: 'Jane Doe', agreed: true, agreementVersion: 'v1', agreementTextHash: 'abc', quoteFingerprint: 'fp-123' });
    expect(body.selectedOptionalQuoteItemIds).toEqual([]);
    expect(screen.getByText('Quote accepted')).toBeTruthy();
    expect(document.getElementById('quote-link-accept')).toBeNull();
  });

  it('already_decided shows the decision date; changed and invalid show their own states', async () => {
    for (const [resp, id, text] of [
      [{ status: 'already_decided', decision: 'accepted', decidedAt: '2026-10-30' }, 'quote-link-decided', 'This quote was accepted on D(2026-10-30).'],
      [{ status: 'changed' }, 'quote-link-changed', 'This quote has changed since you opened it. Please contact us.'],
      [{ status: 'invalid_link' }, 'quote-link-invalid', "This link isn't available"],
    ] as const) {
      cleanup();
      fetchMock.mockResolvedValue({ json: async () => resp });
      render(<PublicQuoteReview {...props} />);
      fill();
      fireEvent.click(document.getElementById('quote-link-accept')!);
      await waitFor(() => expect(document.getElementById(id)).toBeTruthy());
      expect(document.body.textContent).toContain(text);
    }
  });

  it('does not mount the panel for a decided quote', () => {
    render(<PublicQuoteReview {...props} quote={{ ...props.quote, status: 'accepted' }} decidedNotice="accepted" />);
    expect(document.getElementById('quote-link-decision-panel')).toBeNull();
  });

  it('optional toggle drives the committed selection', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'decided', decision: 'accepted', decidedAt: 'x' }) });
    render(<PublicQuoteReview {...props} />);
    const toggle = document.querySelector('[role="switch"], input[type="checkbox"][id*="optional"], [id*="optional"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    fill();
    fireEvent.click(document.getElementById('quote-link-accept')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).selectedOptionalQuoteItemIds).toEqual(['i2']);
  });

  it('renders no read-only notice while the decision form is active', () => {
    render(<PublicQuoteReview {...props} />);
    expect(document.getElementById('quote-link-decision-panel')).toBeTruthy();
    expect(document.body.textContent).not.toContain('read-only');
    expect(document.getElementById('public-quote-notice')).toBeNull();
  });

  it('keeps the read-only notice when no decision is possible', () => {
    render(<PublicQuoteReview {...props} token={undefined} />);
    expect(document.body.textContent).toContain('read-only view');
  });

  it('the status badge follows the server-confirmed outcome, not the clicked button', async () => {
    // Server says it was already rejected although the signer clicked Accept.
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'already_decided', decision: 'rejected', decidedAt: '2026-10-30' }) });
    render(<PublicQuoteReview {...props} />);
    expect(document.body.textContent).toContain('sent');
    fill();
    fireEvent.click(document.getElementById('quote-link-accept')!);
    await waitFor(() => expect(document.getElementById('quote-link-decided')).toBeTruthy());
    expect(document.querySelector('h1')!.parentElement!.parentElement!.textContent).toContain('rejected');
    expect(document.querySelector('h1')!.parentElement!.parentElement!.textContent).not.toContain('sent');
  });

  it('badge becomes accepted after a decided accept; a changed result leaves it as sent', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'decided', decision: 'accepted', decidedAt: 'x' }) });
    render(<PublicQuoteReview {...props} />);
    fill();
    fireEvent.click(document.getElementById('quote-link-accept')!);
    await waitFor(() => expect(document.getElementById('quote-link-decided')).toBeTruthy());
    expect(document.querySelector('h1')!.parentElement!.parentElement!.textContent).toContain('accepted');

    cleanup();
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'changed' }) });
    render(<PublicQuoteReview {...props} />);
    fill();
    fireEvent.click(document.getElementById('quote-link-accept')!);
    await waitFor(() => expect(document.getElementById('quote-link-changed')).toBeTruthy());
    expect(document.querySelector('h1')!.parentElement!.parentElement!.textContent).toContain('sent');
  });

  describe('totals after a settled decision', () => {
    // Preview with Extra on = 2000 + 200 tax -> 2200? (base 1000 + extra 1000 = 2000 + tax 200)
    const withOptional = () => ({
      ...props,
      items: [base(), base({ quote_item_id: 'i2', description: 'Extra', is_optional: true, is_selected: false, display_order: 1 })],
    });
    const totalsText = () => document.body.textContent ?? '';
    // Every "Total" label (header card + totals block) with the amount beside it.
    const totalAmounts = () =>
      [...document.querySelectorAll('p, span')]
        .filter((el) => el.children.length === 0 && el.textContent === 'Total')
        .map((el) => el.parentElement!.textContent ?? '');
    const headerTotal = () => totalAmounts().join('|');
    const toggleExtra = () => {
      const toggle = document.querySelector('[role="switch"], input[type="checkbox"][id*="optional"], [id*="optional"]') as HTMLElement;
      fireEvent.click(toggle);
    };
    const settle = async (resp: unknown, id: string) => {
      fetchMock.mockResolvedValue({ json: async () => resp });
      render(<PublicQuoteReview {...withOptional()} />);
      toggleExtra();
      expect(headerTotal()).toContain('€22.00');
      fill();
      fireEvent.click(document.getElementById('quote-link-accept')!);
      await waitFor(() => expect(document.getElementById(id)).toBeTruthy());
    };

    it('decided/accepted renders the committed snapshot in the totals block and the header card', async () => {
      // Committed deliberately differs from the local preview-equivalent only by being the server's numbers.
      await settle({
        status: 'decided', decision: 'accepted', decidedAt: 'x',
        committed: { subtotal: 2000, discount_total: 0, tax: 200, total_amount: 2200, selectedOptionalQuoteItemIds: ['i2'] },
      }, 'quote-link-decided');
      expect(headerTotal()).toContain('€22.00');
      expect(totalAmounts()).toHaveLength(2);
      for (const t of totalAmounts()) expect(t).toContain('€22.00');
      expect(totalsText()).not.toContain('€11.00');
    });

    it('decided/accepted shows the server numbers even if they differ from the local preview', async () => {
      await settle({
        status: 'decided', decision: 'accepted', decidedAt: 'x',
        committed: { subtotal: 2000, discount_total: 0, tax: 250, total_amount: 2250, selectedOptionalQuoteItemIds: ['i2'] },
      }, 'quote-link-decided');
      expect(headerTotal()).toContain('€22.50');
      expect(totalsText()).not.toContain('€22.00');
    });

    it.each([
      ['decided/rejected', { status: 'decided', decision: 'rejected', decidedAt: 'x', committed: { subtotal: 1000, discount_total: 0, tax: 100, total_amount: 1100, selectedOptionalQuoteItemIds: [] } }, 'quote-link-decided'],
      ['already_decided', { status: 'already_decided', decision: 'accepted', decidedAt: '2026-10-30' }, 'quote-link-decided'],
      ['changed', { status: 'changed' }, 'quote-link-changed'],
    ])('%s restores the original selection and totals', async (_n, resp, id) => {
      await settle(resp, id);
      expect(headerTotal()).toContain('€11.00');
      expect(headerTotal()).not.toContain('€22.00');
      expect(totalsText()).not.toContain('€22.00');
    });
  });
});
