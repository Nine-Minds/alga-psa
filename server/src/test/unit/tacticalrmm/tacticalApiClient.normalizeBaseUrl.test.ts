import { describe, expect, it } from 'vitest';

import { normalizeTacticalBaseUrl } from '@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient';

describe('normalizeTacticalBaseUrl', () => {
  it('normalizes protocol and strips trailing slashes', () => {
    expect(normalizeTacticalBaseUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeTacticalBaseUrl('http://example.com////')).toBe('http://example.com');
    expect(normalizeTacticalBaseUrl('example.com')).toBe('https://example.com');
  });

  it('removes a bare /api path segment but preserves deeper API paths', () => {
    expect(normalizeTacticalBaseUrl('https://example.com/api')).toBe('https://example.com');
    expect(normalizeTacticalBaseUrl('https://example.com/api/')).toBe('https://example.com');
    expect(normalizeTacticalBaseUrl('https://example.com/api/v2')).toBe('https://example.com/api/v2');
  });

  it('preserves non-api path prefixes', () => {
    expect(normalizeTacticalBaseUrl('https://example.com/tactical/')).toBe('https://example.com/tactical');
  });
});

