import { describe, expect, it } from 'vitest';
import { sanitizePortalBranding } from './sanitizePortalBranding';

describe('sanitizePortalBranding', () => {
  it('returns only supported branding fields from an unrestricted settings object', () => {
    const branding = sanitizePortalBranding({
      logoUrl: 'https://cdn.example.test/logo.svg',
      primaryColor: '#123456',
      secondaryColor: '#654321',
      clientName: 'Example Client',
      supportEmail: 'support@example.test',
      portalSidebarStyle: 'custom',
      portalSidebarColor: '#101010',
      sso: { privateKey: 'secret' },
      onboarding_data: { clientEmail: 'secret@example.test' },
      unexpected: ['sensitive', 'value'],
    });

    expect(branding).toEqual({
      logoUrl: 'https://cdn.example.test/logo.svg',
      primaryColor: '#123456',
      secondaryColor: '#654321',
      clientName: 'Example Client',
      supportEmail: 'support@example.test',
      portalSidebarStyle: 'custom',
      portalSidebarColor: '#101010',
    });
    expect(branding).not.toHaveProperty('sso');
    expect(branding).not.toHaveProperty('onboarding_data');
  });

  it('preserves supported partial branding while discarding unknown fields', () => {
    expect(sanitizePortalBranding({ logoUrl: 'https://cdn.example.test/logo.svg', credential: 'private' }))
      .toEqual({ logoUrl: 'https://cdn.example.test/logo.svg' });
    expect(sanitizePortalBranding({ primaryColor: '#123456', credential: 'private' }))
      .toEqual({ primaryColor: '#123456' });
  });

  it('fails closed for malformed or entirely unknown branding', () => {
    expect(sanitizePortalBranding(['not', 'an', 'object'])).toBeNull();
    expect(sanitizePortalBranding({ credential: 'private' })).toBeNull();
  });
});
