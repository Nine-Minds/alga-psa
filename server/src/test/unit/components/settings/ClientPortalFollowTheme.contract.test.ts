import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const settingsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/settings/general/ClientPortalSettings.tsx'),
  'utf8',
);

const layoutSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');

describe('client portal follows the organization theme', () => {
  it('defaults existing tenants to their own portal branding', () => {
    expect(settingsSource).toContain('useState<boolean>(false)');
    expect(settingsSource).toContain('brandingSettings.portalFollowsTheme ?? false');
  });

  it('persists the switch alongside the rest of the branding payload', () => {
    expect(settingsSource).toContain('portalFollowsTheme: updates.portalFollowsTheme ?? portalFollowsTheme');
    expect(settingsSource).toContain('data-automation-id="client-portal-follow-theme-switch"');
  });

  it('previews the theme colors while the portal follows the theme', () => {
    expect(settingsSource).toContain(
      "const themeColors = portalFollowsTheme ? themeTokens?.[isDark ? 'dark' : 'light'] : undefined",
    );
    expect(settingsSource).toContain('themeColors?.primary || primaryColor');
    expect(settingsSource).toContain('themeColors.sidebarBg');
  });

  it('keeps the Enterprise MSP shell on its own white-label switch', () => {
    expect(layoutSource).toContain("generateBrandingStyles(branding, { surface: 'msp' })");
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
