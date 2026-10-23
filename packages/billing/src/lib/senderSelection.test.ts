import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSenderOptions, DEFAULT_SENDER_SELECTION, senderIdForSend } from '@alga-psa/email/senderSelection';

describe('sender selection', () => {
  it('uses a stable default option with the resolved provider address instead of selecting the first saved sender', () => {
    const options = buildSenderOptions([
      { sender_id: 'first', email_address: 'first@example.test' },
      { sender_id: 'second', email_address: 'second@example.test' },
    ], 'provider@example.test', 'Use default');

    expect(options[0]).toEqual({ value: DEFAULT_SENDER_SELECTION, label: 'Use default (provider@example.test)' });
    expect(senderIdForSend(options[0].value)).toBeUndefined();
    expect(senderIdForSend(options[1].value)).toBe('first');
  });

  it('keeps every sender-selection owner on the shared default sentinel behavior', () => {
    const senderSelectionOwners = [
      '../components/billing-dashboard/invoicing/SendInvoiceEmailDialog.tsx',
      '../components/billing-dashboard/quotes/QuoteForm.tsx',
      '../components/billing-dashboard/quotes/QuoteSendDialog.tsx',
    ];
    for (const component of senderSelectionOwners) {
      const source = readFileSync(path.resolve(__dirname, component), 'utf8');
      expect(source).toContain('buildSenderOptions');
      expect(source).toContain('senderIdForSend');
      expect(source).toContain('DEFAULT_SENDER_SELECTION');
    }
  });

  it('keeps both quote send surfaces delegated to the shared dialog', () => {
    const delegatedQuoteSurfaces = [
      '../components/billing-dashboard/quotes/QuoteDetail.tsx',
      '../components/billing-dashboard/quotes/QuotesTab.tsx',
    ];
    for (const component of delegatedQuoteSurfaces) {
      const source = readFileSync(path.resolve(__dirname, component), 'utf8');
      expect(source).toContain("import { QuoteSendDialog");
      expect(source).toContain('<QuoteSendDialog');
      expect(source).toContain('senderId={quoteSenderId}');
      expect(source).toContain('onSenderChange={setQuoteSenderId}');
    }
  });
});
