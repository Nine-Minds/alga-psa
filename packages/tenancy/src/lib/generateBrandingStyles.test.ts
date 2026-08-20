import { describe, expect, it } from 'vitest';
import { generateBrandingStyles, scopeBrandingToEdition } from './generateBrandingStyles';
import type { TenantBranding } from '../actions/tenant-actions/tenantBrandingActions';

const baseBranding: TenantBranding = {
  logoUrl: '',
  primaryColor: '#8B5CF6',
  secondaryColor: '#6366F1',
  clientName: 'Acme',
};

const SIDEBAR_SELECTOR = '[data-automation-id="client-portal-sidebar"]';

describe('generateBrandingStyles portal sidebar tint', () => {
  it('emits byte-identical CSS when no sidebar style is configured', () => {
    const baseline = generateBrandingStyles(baseBranding);

    expect(generateBrandingStyles({ ...baseBranding, portalSidebarStyle: undefined })).toBe(baseline);
    expect(generateBrandingStyles({ ...baseBranding, portalSidebarStyle: 'default' })).toBe(baseline);
    expect(baseline).not.toContain('--color-sidebar-bg');
  });

  it('scopes primary sidebar overrides to the portal sidebar, never :root', () => {
    const css = generateBrandingStyles({ ...baseBranding, portalSidebarStyle: 'primary' });

    expect(css).toContain(`${SIDEBAR_SELECTOR} {`);
    expect(css).toContain(`html.dark ${SIDEBAR_SELECTOR} {`);
    expect(css).toContain('--color-sidebar-bg');
    expect(css).toContain('--color-sidebar-hover');
    expect(css).toContain('--color-sidebar-icon');

    const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('html.dark {'));
    expect(rootBlock).not.toContain('--color-sidebar');
  });

  it('uses the secondary palette when the secondary option is chosen', () => {
    const primaryCss = generateBrandingStyles({ ...baseBranding, portalSidebarStyle: 'primary' });
    const secondaryCss = generateBrandingStyles({ ...baseBranding, portalSidebarStyle: 'secondary' });

    expect(secondaryCss).toContain(`${SIDEBAR_SELECTOR} {`);
    expect(secondaryCss).not.toBe(primaryCss);
    // secondary #6366F1 -> shade 800 is each channel at 50%
    expect(secondaryCss).toContain('--color-sidebar-bg: 50 51 121');
  });

  it('tints from an arbitrary color when the custom option is chosen', () => {
    const css = generateBrandingStyles({
      ...baseBranding,
      portalSidebarStyle: 'custom',
      portalSidebarColor: '#6366F1',
    });

    expect(css).toContain(`${SIDEBAR_SELECTOR} {`);
    // Same 800 shade the secondary palette would produce for the same hex.
    expect(css).toContain('--color-sidebar-bg: 50 51 121');
  });

  it('ignores the custom option until a color is picked', () => {
    const baseline = generateBrandingStyles(baseBranding);

    expect(generateBrandingStyles({ ...baseBranding, portalSidebarStyle: 'custom' })).toBe(baseline);
    expect(
      generateBrandingStyles({ ...baseBranding, portalSidebarStyle: 'custom', portalSidebarColor: '' }),
    ).toBe(baseline);
  });

  it('keeps returning nothing when the tenant has no colors at all', () => {
    expect(
      generateBrandingStyles({
        ...baseBranding,
        primaryColor: '',
        secondaryColor: '',
        portalSidebarStyle: 'primary',
      }),
    ).toBe('');
  });
});

describe('generateBrandingStyles portal theme opt-in', () => {
  it('leaves branding in charge of the portal by default', () => {
    const baseline = generateBrandingStyles(baseBranding);

    expect(baseline).not.toBe('');
    expect(generateBrandingStyles({ ...baseBranding, portalFollowsTheme: undefined })).toBe(baseline);
    expect(generateBrandingStyles({ ...baseBranding, portalFollowsTheme: false })).toBe(baseline);
  });

  it('drops the portal accents once the tenant follows the organization theme', () => {
    expect(
      generateBrandingStyles({
        ...baseBranding,
        portalSidebarStyle: 'primary',
        portalFollowsTheme: true,
      }),
    ).toBe('');
  });

  it('still paints the Enterprise MSP shell, which has its own switch', () => {
    const branded = generateBrandingStyles({ ...baseBranding, portalFollowsTheme: true }, { surface: 'msp' });

    expect(branded).toBe(generateBrandingStyles(baseBranding, { surface: 'msp' }));
    expect(branded).toContain('--color-primary-500');
  });
});

describe('scopeBrandingToEdition', () => {
  it('preserves Enterprise theme-follow branding unchanged', () => {
    const branding = { ...baseBranding, portalFollowsTheme: true };

    expect(scopeBrandingToEdition(branding, true)).toBe(branding);
  });

  it('keeps CE sidebar branding but removes organization-theme access', () => {
    const branding: TenantBranding = {
      ...baseBranding,
      logoDarkUrl: '/dark-logo.png',
      portalSidebarStyle: 'custom',
      portalSidebarColor: '#123456',
      portalFollowsTheme: true,
      computedStyles: '',
    };

    const scoped = scopeBrandingToEdition(branding, false);

    expect(scoped).toMatchObject({
      logoDarkUrl: '/dark-logo.png',
      portalSidebarStyle: 'custom',
      portalSidebarColor: '#123456',
      portalFollowsTheme: false,
    });
    expect(scoped?.computedStyles).toContain('--color-sidebar-bg');
    expect(scoped?.computedStyles).toContain('--color-primary-500');
  });
});
