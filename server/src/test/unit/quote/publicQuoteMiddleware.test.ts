import { describe, expect, it } from 'vitest';
import { QUOTE_ACCESS_TOKEN_LENGTH } from '@alga-psa/billing/services';
import {
  applyPublicQuoteReviewHeaders,
  isPublicQuoteDecisionPath,
  isPublicQuotePagePath,
  isPublicQuotePdfPath,
  isPublicQuoteReviewPath,
  shouldSkipApiKeyAuth,
} from 'server/src/middleware';

const token = 'A1_-'.repeat(11).slice(0, 43);

describe('public quote review paths', () => {
  it('token length in the matcher matches the card-2 token length', () => {
    expect(token).toHaveLength(QUOTE_ACCESS_TOKEN_LENGTH);
  });

  it('treats /quote/<43-char token> and its PDF as public', () => {
    expect(isPublicQuotePagePath(`/quote/${token}`)).toBe(true);
    expect(isPublicQuotePdfPath(`/api/quote/${token}/pdf`)).toBe(true);
    expect(isPublicQuoteReviewPath(`/api/quote/${token}/pdf`)).toBe(true);
    expect(shouldSkipApiKeyAuth(`/api/quote/${token}/pdf`)).toBe(true);
  });

  it('opens exactly /api/quote/<token>/decision and nothing near it', () => {
    expect(isPublicQuoteDecisionPath(`/api/quote/${token}/decision`)).toBe(true);
    expect(isPublicQuoteReviewPath(`/api/quote/${token}/decision`)).toBe(true);
    expect(shouldSkipApiKeyAuth(`/api/quote/${token}/decision`)).toBe(true);
    const near = [
      `/api/quote/${token}/decision/`,
      `/api/quote/${token}/decision/extra`,
      `/api/quote/${token}/decisions`,
      `/api/quote/${token}/decisionx`,
      `/api/quote/${token}x/decision`,
      `/api/quote/${token.slice(1)}/decision`,
      `/api/quote//decision`,
      `/api/quote-link/${token}/decision`,
      `/api/quote/${token}/x/decision`,
      `/api/quote/${token}`,
    ];
    for (const path of near) {
      expect(isPublicQuoteDecisionPath(path), path).toBe(false);
      expect(isPublicQuoteReviewPath(path), path).toBe(false);
      expect(shouldSkipApiKeyAuth(path), path).toBe(false);
    }
  });

  it('does not treat anything else as public', () => {
    expect(isPublicQuoteReviewPath('/quote/foo/bar')).toBe(false);
    expect(isPublicQuoteReviewPath('/quote/foo')).toBe(false);
    expect(isPublicQuoteReviewPath(`/quote/${token}/extra`)).toBe(false);
    expect(isPublicQuoteReviewPath(`/quote/${token}x`)).toBe(false);
    expect(isPublicQuoteReviewPath(`/quote/${token.slice(1)}`)).toBe(false);
    expect(isPublicQuoteReviewPath('/client-portal/billing/quotes/abc')).toBe(false);
    expect(isPublicQuoteReviewPath(`/client-portal/quote/${token}`)).toBe(false);
    expect(isPublicQuoteReviewPath(`/api/quote/${token}/other`)).toBe(false);
    expect(shouldSkipApiKeyAuth(`/api/quote/${token}/other`)).toBe(false);
  });

  it('sets no-referrer, noindex and no-store headers', () => {
    const res = applyPublicQuoteReviewHeaders({ headers: new Headers() });
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
