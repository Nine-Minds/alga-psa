import { describe, expect, it, vi } from 'vitest';
import type { IQuote } from '@alga-psa/types';

vi.mock('@alga-psa/core/lib/formatters', () => ({
  formatCurrency: (value: number, locale: string, currency: string) =>
    new Intl.NumberFormat(locale || 'en-US', { style: 'currency', currency: currency || 'USD' }).format(value),
}));

import {
  buildQuoteSentEmailTemplate,
  buildQuoteReminderEmailTemplate,
  buildQuoteAcceptedConfirmationEmailTemplate,
} from '../../src/lib/quote-email-templates';

const baseQuote: IQuote = {
  tenant: 'tenant-1',
  quote_id: 'q-001',
  quote_number: 'Q-0042',
  client_id: 'c-1',
  title: 'Test Quote',
  quote_date: '2026-03-01T00:00:00.000Z',
  valid_until: '2026-03-31T12:00:00.000Z',
  status: 'sent',
  version: 1,
  subtotal: 1000000,
  discount_total: 0,
  tax: 0,
  total_amount: 1000000, // $10,000.00 in cents
  currency_code: 'USD',
  is_template: false,
};

describe('quote-email-templates', () => {
  describe('buildQuoteSentEmailTemplate', () => {
    it('T250: includes quote number and company name in subject', () => {
      const { subject } = buildQuoteSentEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
      });
      expect(subject).toBe('Quote Q-0042 from Acme Corp');
    });

    it('T251: includes formatted total and valid-until date in HTML', () => {
      const { html } = buildQuoteSentEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
      });
      expect(html).toContain('Q-0042');
      expect(html).toContain('March 31, 2026');
    });

    it('T252: includes custom message when provided', () => {
      const { html, text } = buildQuoteSentEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
        customMessage: 'Looking forward to working with you!',
      });
      expect(html).toContain('Looking forward to working with you!');
      expect(text).toContain('Looking forward to working with you!');
    });

    it('T253: omits custom message and portal link when not provided', () => {
      const { html } = buildQuoteSentEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
      });
      expect(html).not.toContain('client portal');
      expect(html).not.toContain('href=');
    });

    it('T254: includes portal link when provided', () => {
      const { html, text } = buildQuoteSentEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
        portalLink: 'https://portal.example.com/quotes/q-001',
      });
      expect(html).toContain('https://portal.example.com/quotes/q-001');
      expect(text).toContain('https://portal.example.com/quotes/q-001');
    });

    it('T255: falls back to quote_id when quote_number is absent', () => {
      const quoteNoNumber = { ...baseQuote, quote_number: undefined as any };
      const { subject } = buildQuoteSentEmailTemplate({
        quote: quoteNoNumber,
        companyName: 'Acme Corp',
      });
      expect(subject).toContain('q-001');
    });

    it('T256: generates plain text output alongside HTML', () => {
      const { text } = buildQuoteSentEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
      });
      expect(text).toContain('Hello,');
      expect(text).toContain('Q-0042');
      expect(text).toContain('Thank you,');
      expect(text).toContain('Acme Corp');
      // Plain text should NOT contain HTML tags
      expect(text).not.toContain('<p>');
      expect(text).not.toContain('<strong>');
    });
  });

  describe('buildQuoteReminderEmailTemplate', () => {
    it('T257: reminder subject includes quote number and expiry date', () => {
      const { subject } = buildQuoteReminderEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
      });
      expect(subject).toContain('Reminder');
      expect(subject).toContain('Q-0042');
      expect(subject).toContain('March 31, 2026');
    });

    it('T258: reminder HTML mentions expiration', () => {
      const { html } = buildQuoteReminderEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
      });
      expect(html).toContain('reminder');
      expect(html).toContain('expires');
    });

    it('T259: reminder includes custom message when provided', () => {
      const { html } = buildQuoteReminderEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
        customMessage: 'Please review at your earliest convenience.',
      });
      expect(html).toContain('Please review at your earliest convenience.');
    });
  });

  describe('buildQuoteAcceptedConfirmationEmailTemplate', () => {
    it('T260: accepted confirmation subject includes quote number', () => {
      const acceptedQuote = { ...baseQuote, status: 'accepted' as const, accepted_at: '2026-03-15T10:00:00.000Z' };
      const { subject } = buildQuoteAcceptedConfirmationEmailTemplate({
        quote: acceptedQuote,
        companyName: 'Acme Corp',
      });
      expect(subject).toContain('Q-0042');
      expect(subject).toContain('accepted');
    });

    it('T261: accepted confirmation includes accepted date', () => {
      const acceptedQuote = { ...baseQuote, status: 'accepted' as const, accepted_at: '2026-03-15T10:00:00.000Z' };
      const { html } = buildQuoteAcceptedConfirmationEmailTemplate({
        quote: acceptedQuote,
        companyName: 'Acme Corp',
      });
      expect(html).toContain('March 15, 2026');
    });

    it('T262: accepted confirmation shows N/A when accepted_at is missing', () => {
      const { html } = buildQuoteAcceptedConfirmationEmailTemplate({
        quote: baseQuote,
        companyName: 'Acme Corp',
      });
      expect(html).toContain('N/A');
    });
  });
});
