import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTenantBrandingByDomainMock = vi.fn();
const generateBrandingStylesMock = vi.fn();

vi.mock('@alga-psa/tenancy/actions', () => ({
  getTenantBrandingByDomain: getTenantBrandingByDomainMock,
}));

vi.mock('@alga-psa/tenancy', () => ({
  generateBrandingStyles: generateBrandingStylesMock,
}));

const { getPortalBranding, getPortalDomain, PortalBrandingStyles } = await import(
  'server/src/lib/auth/portalBranding'
);

describe('portal branding helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not query branding without a usable portal domain', async () => {
    await expect(getPortalBranding({})).resolves.toBeNull();
    await expect(getPortalBranding({ portalDomain: '   ' })).resolves.toBeNull();
    expect(getTenantBrandingByDomainMock).not.toHaveBeenCalled();
  });

  it('resolves branding using a normalized portal domain', async () => {
    const branding = {
      logoUrl: 'https://example.com/logo.png',
      primaryColor: '#112233',
      secondaryColor: '#445566',
      clientName: 'Example',
    };
    getTenantBrandingByDomainMock.mockResolvedValue(branding);

    await expect(getPortalBranding({ portalDomain: ' portal.example.com ' })).resolves.toBe(branding);
    expect(getPortalDomain({ portalDomain: ' portal.example.com ' })).toBe('portal.example.com');
    expect(getTenantBrandingByDomainMock).toHaveBeenCalledWith('portal.example.com');
  });

  it('returns null when the domain lookup cannot resolve branding', async () => {
    getTenantBrandingByDomainMock.mockResolvedValue(null);

    await expect(getPortalBranding({ portalDomain: 'unknown.example.com' })).resolves.toBeNull();
  });

  it('renders generated branding CSS using the shared server style id', () => {
    const branding = {
      logoUrl: '',
      primaryColor: '#112233',
      secondaryColor: '#445566',
      clientName: 'Example',
    };
    generateBrandingStylesMock.mockReturnValue(':root { --test: 1; }');

    const style = PortalBrandingStyles({ branding });

    expect(style?.props.id).toBe('server-tenant-branding-styles');
    expect(style?.props.dangerouslySetInnerHTML).toEqual({ __html: ':root { --test: 1; }' });
  });
});
