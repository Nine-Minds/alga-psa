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

  it('fails closed for incomplete or malformed branding', () => {
    expect(sanitizePortalBranding({ clientName: 'Missing palette' })).toBeNull();
    expect(sanitizePortalBranding(['not', 'an', 'object'])).toBeNull();
  });
});
