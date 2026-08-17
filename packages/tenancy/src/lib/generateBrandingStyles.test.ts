import { describe, expect, it } from 'vitest';
import { generateBrandingStyles } from './generateBrandingStyles';
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
