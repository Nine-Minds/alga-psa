import { describe, expect, it } from 'vitest';

import { shouldSkipApiKeyAuth } from 'server/src/middleware';

describe('shouldSkipApiKeyAuth', () => {
  it('allows the Teams package download route to use session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/teams/package/download')).toBe(true);
  });

  it('allows document preview routes to use session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/documents/123/preview')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/documents/123/thumbnail')).toBe(true);
  });

  it('allows public appointment calendar downloads from email links', () => {
    expect(shouldSkipApiKeyAuth('/api/calendar/appointment/2187d639-b796-4b0e-b760-8a2576bb435f.ics')).toBe(true);
  });

  it('still requires an API key for unrelated API routes', () => {
    expect(shouldSkipApiKeyAuth('/api/teams/package/upload')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/instanceinfo')).toBe(false);
  });
});
