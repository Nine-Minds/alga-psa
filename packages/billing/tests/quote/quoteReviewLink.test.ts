import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildTenantPortalUrlMock = vi.fn();
vi.mock('@alga-psa/tenancy/server', () => ({
  buildTenantPortalUrl: (...args: any[]) => buildTenantPortalUrlMock(...args),
}));

import { QUOTE_REVIEW_LINK_PATH_PREFIX, buildQuoteReviewLink, canBuildQuoteReviewLink } from '../../src/lib/quoteReviewLink';

beforeEach(() => {
  buildTenantPortalUrlMock.mockReset();
  buildTenantPortalUrlMock.mockImplementation(async (_t: string, path: string) => `https://helpdesk.example.com${path}`);
});

describe('buildQuoteReviewLink', () => {
  it('builds /quote/<token> through buildTenantPortalUrl (custom domain aware)', async () => {
    expect(QUOTE_REVIEW_LINK_PATH_PREFIX).toBe('/quote');
    expect(await buildQuoteReviewLink('tenant-1', 'abc_-123')).toBe('https://helpdesk.example.com/quote/abc_-123');
    expect(buildTenantPortalUrlMock).toHaveBeenCalledWith('tenant-1', '/quote/abc_-123');
  });

  it('encodes the token as a path segment', async () => {
    await buildQuoteReviewLink('tenant-1', 'a/b c');
    expect(buildTenantPortalUrlMock).toHaveBeenCalledWith('tenant-1', '/quote/a%2Fb%20c');
  });

  it('is null when the builder returns null or throws', async () => {
    buildTenantPortalUrlMock.mockResolvedValueOnce(null);
    expect(await buildQuoteReviewLink('tenant-1', 'tok')).toBeNull();
    buildTenantPortalUrlMock.mockRejectedValueOnce(new Error('boom'));
    expect(await buildQuoteReviewLink('tenant-1', 'tok')).toBeNull();
  });
});

describe('canBuildQuoteReviewLink', () => {
  it('reflects whether the builder returns a URL', async () => {
    expect(await canBuildQuoteReviewLink('tenant-1')).toBe(true);
    buildTenantPortalUrlMock.mockResolvedValue(null);
    expect(await canBuildQuoteReviewLink('tenant-1')).toBe(false);
  });
});
