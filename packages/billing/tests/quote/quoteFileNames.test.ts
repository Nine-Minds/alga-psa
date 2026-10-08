import { describe, expect, it } from 'vitest';
import { getQuotePdfFileName } from '../../src/lib/quoteFileNames';

describe('getQuotePdfFileName', () => {
  it.each([null, '   '])('falls back for an empty quote title (%j)', (title) => {
    expect(getQuotePdfFileName({ title, quote_number: 'Q-42', quote_id: 'quote-id' })).toBe('Quote_Q-42.pdf');
  });

  it('uses the quote id when the title and quote number are missing', () => {
    expect(getQuotePdfFileName({ title: null, quote_number: null, quote_id: 'quote-id' })).toBe('Quote_quote-id.pdf');
  });

  it('uses the sanitized title when available', () => {
    expect(getQuotePdfFileName({ title: 'Estimate: North', quote_number: 'Q-42', quote_id: 'quote-id' }))
      .toBe('Estimate North.pdf');
  });
});
