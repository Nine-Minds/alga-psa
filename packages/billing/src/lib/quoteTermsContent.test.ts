import { describe, expect, it } from 'vitest';
import {
  isEmptyTermsBlock,
  normalizeQuoteTermsFields,
  prepareQuoteTermsForDb,
  serializeQuoteTermsBlockForDb,
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

describe('prepareQuoteTermsForDb', () => {
  it('JSON-encodes the block for the jsonb boundary while keeping the text projection', () => {
    const input: Record<string, unknown> = { terms_and_conditions_block: twoParagraphs };
    const result = prepareQuoteTermsForDb(input);
    const serialized = result.terms_and_conditions_block as unknown as string;

    expect(typeof serialized).toBe('string');
    expect(JSON.parse(serialized)).toEqual(twoParagraphs);
    expect(result.terms_and_conditions).toBe('First paragraph\nSecond paragraph');
  });

  it('leaves an already-encoded string alone, null stays null, and a plain write clears the block', () => {
    const encoded = JSON.stringify(twoParagraphs);
    expect(serializeQuoteTermsBlockForDb(encoded)).toBe(encoded);
    expect(serializeQuoteTermsBlockForDb(null)).toBeNull();

    const plain = prepareQuoteTermsForDb({
      terms_and_conditions: 'plain',
      terms_and_conditions_block: null,
    });
    expect(plain.terms_and_conditions_block).toBeNull();
    expect(plain.terms_and_conditions).toBe('plain');
  });

  it('does not add terms keys when neither was supplied', () => {
    const input = { title: 'No terms here' };
    expect(prepareQuoteTermsForDb(input)).toBe(input);
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
