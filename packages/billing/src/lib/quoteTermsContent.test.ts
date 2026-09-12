import { describe, expect, it } from 'vitest';
import {
  isEmptyTermsBlock,
  normalizeQuoteTermsFields,
} from './quoteTermsContent';

const twoParagraphs = [
  { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
];

describe('normalizeQuoteTermsFields', () => {
  it('projects structured block content into the plain-text column', () => {
    const result = normalizeQuoteTermsFields({
      terms_and_conditions_block: twoParagraphs,
      terms_and_conditions: 'stale plain text',
    });

    expect(result.terms_and_conditions_block).toBe(twoParagraphs);
    expect(result.terms_and_conditions).toBe('First paragraph\nSecond paragraph');
  });

  it('clears the block column and keeps the written string on a plain-text write', () => {
    const result = normalizeQuoteTermsFields({
      terms_and_conditions: 'Written through the API',
      terms_and_conditions_block: null,
    });

    expect(result.terms_and_conditions_block).toBeNull();
    expect(result.terms_and_conditions).toBe('Written through the API');
  });

  it('clears both columns when the rich value is cleared', () => {
    const result = normalizeQuoteTermsFields({
      terms_and_conditions_block: [],
      terms_and_conditions: null,
    });

    expect(result.terms_and_conditions_block).toBeNull();
    expect(result.terms_and_conditions).toBeNull();
  });

  it('leaves both columns untouched when neither key is supplied', () => {
    const input = { title: 'Just a title' };
    expect(normalizeQuoteTermsFields(input)).toBe(input);
  });
});

describe('isEmptyTermsBlock', () => {
  it('treats null, undefined, empty arrays, empty objects and blank strings as empty', () => {
    expect(isEmptyTermsBlock(null)).toBe(true);
    expect(isEmptyTermsBlock(undefined)).toBe(true);
    expect(isEmptyTermsBlock([])).toBe(true);
    expect(isEmptyTermsBlock({})).toBe(true);
    expect(isEmptyTermsBlock('   ')).toBe(true);
    expect(isEmptyTermsBlock(twoParagraphs)).toBe(false);
  });
});
