import { describe, expect, it } from 'vitest';
import { buildTenantPortalSlug, getSlugParts, isValidTenantSlug } from '@shared/utils/tenantSlug';

describe('tenant slug utilities', () => {
  it('builds slug from tenant UUID deterministically', () => {
    const tenantId = '123e4567-e89b-12d3-a456-426614174000';
    const slug = buildTenantPortalSlug(tenantId);
    expect(slug).toBe('123e45174000');
  });

  it('validates slug formats correctly', () => {
    expect(isValidTenantSlug('abcdef123456')).toBe(true);
    expect(isValidTenantSlug('ABCDEF123456')).toBe(true);
    expect(isValidTenantSlug('abc123')).toBe(false);
    expect(isValidTenantSlug('not-a-slug')).toBe(false);
  });

  it('throws when requesting parts for invalid slug', () => {
    expect(() => getSlugParts('invalid')).toThrowError('Invalid tenant slug');
  });
});
