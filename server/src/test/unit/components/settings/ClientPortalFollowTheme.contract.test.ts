import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const settingsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/settings/general/ClientPortalSettings.tsx'),
  'utf8',
);

const layoutSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');
const appearancePageSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/app/msp/settings/appearance/page.tsx'),
  'utf8',
);
const sidebarSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/layout/SidebarWithFeatureFlags.tsx'),
  'utf8',
);

describe('client portal follows the organization theme', () => {
  it('defaults existing tenants to their own portal branding', () => {
    expect(settingsSource).toContain('useState<boolean>(false)');
    expect(settingsSource).toContain('brandingSettings.portalFollowsTheme ?? false');
  });

  it('persists the switch alongside the rest of the branding payload', () => {
    expect(settingsSource).toContain('portalFollowsTheme: updates.portalFollowsTheme ?? portalFollowsTheme');
    expect(settingsSource).toContain('data-automation-id="client-portal-follow-theme-switch"');
  });

  it('keeps the advanced appearance UI behind Enterprise and the v1.5 release flag', () => {
    expect(settingsSource).toContain("useFeatureFlag(RELEASE_V1_5_FLAG, { defaultValue: false })");
    expect(settingsSource).toContain('isEEAvailable && releaseV15Flag.enabled');
    expect(settingsSource).toMatch(
      /<ClientPortalDomainSettings\s+headerAction=\{advancedAppearanceEnabled \? \(\s*<CopyClientPortalLinkButton/,
    );
    expect(settingsSource).not.toMatch(
      /advancedAppearanceEnabled && \(\s*<div className="flex justify-end">\s*<CopyClientPortalLinkButton/,
    );
    expect(settingsSource).not.toContain('clientPortal.branding.help.companyLogoMsp');
    expect(appearancePageSource).toContain("'release-v1-5-feature'");
    expect(appearancePageSource).toContain('isEnterprise && await checkFeatureFlag');
    expect(sidebarSource).toContain("useFeatureFlag('release-v1-5-feature', { defaultValue: false })");
  });

  it('keeps the CE logo variants and client-portal sidebar color available', () => {
    expect(settingsSource).toContain("uploadTenantLogo(entityId, formData, 'dark')");
    expect(settingsSource).toContain('id="client-portal-sidebar-style"');
    expect(settingsSource).toContain('data-automation-id="client-portal-sidebar-color-picker"');
  });

  it('previews the theme colors while the portal follows the theme', () => {
    expect(settingsSource).toContain('const themeColors = advancedAppearanceEnabled && portalFollowsTheme');
    expect(settingsSource).toContain("themeTokens?.[isDark ? 'dark' : 'light']");
    expect(settingsSource).toContain('themeColors?.primary || primaryColor');
    expect(settingsSource).toContain('themeColors.sidebarBg');
  });

  it('keeps the Enterprise MSP shell on its own white-label switch', () => {
    expect(layoutSource).not.toContain('getTenantBrandingByTenantId');
    expect(layoutSource).not.toContain("surface: 'msp'");
  });

  it('translates the switch in every MSP locale', () => {
    const localeRoot = path.resolve(process.cwd(), 'public/locales');

    for (const locale of fs.readdirSync(localeRoot)) {
      const localeFile = path.join(localeRoot, locale, 'msp/settings.json');
      if (!fs.existsSync(localeFile)) continue;
      const settings = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
      expect(settings.clientPortal.branding.fields.followTheme, locale).toBeTruthy();
      expect(settings.clientPortal.branding.help.followTheme, locale).toBeTruthy();
      expect(settings.clientPortal.branding.help.followThemeActive, locale).toBeTruthy();
    }
  });
});
