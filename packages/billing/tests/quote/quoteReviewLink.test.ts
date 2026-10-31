import { afterEach, describe, expect, it } from 'vitest';
import { QUOTE_REVIEW_LINK_PATH_PREFIX, buildQuoteReviewLink } from '../../src/lib/quoteReviewLink';

const saved = { b: process.env.NEXT_PUBLIC_BASE_URL, n: process.env.NEXTAUTH_URL, h: process.env.HOST };
afterEach(() => {
  for (const [k, v] of [['NEXT_PUBLIC_BASE_URL', saved.b], ['NEXTAUTH_URL', saved.n], ['HOST', saved.h]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('buildQuoteReviewLink', () => {
  it('builds /quote/<token> on the public base URL', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.com/';
    expect(QUOTE_REVIEW_LINK_PATH_PREFIX).toBe('/quote');
    expect(buildQuoteReviewLink('abc_-123')).toBe('https://app.example.com/quote/abc_-123');
  });

  it('is null when no valid public origin exists', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL; delete process.env.NEXTAUTH_URL; delete process.env.HOST;
    expect(buildQuoteReviewLink('tok')).toBeNull();
  });
});
