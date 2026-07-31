import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const settingsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/settings/general/ClientPortalSettings.tsx'),
  'utf8',
);

describe('ClientPortalSettings dashboard hero gradient contract', () => {
  it('defaults existing tenants to the established primary-shades gradient', () => {
    expect(settingsSource).toContain(
      "const DEFAULT_PORTAL_HERO_GRADIENT: PortalHeroGradient = 'primary-shades'",
    );
    expect(settingsSource).toContain(
      'brandingSettings.portalHeroGradient ?? DEFAULT_PORTAL_HERO_GRADIENT',
    );
  });

  it('previews and persists the explicit primary-to-secondary option', () => {
    expect(settingsSource).toContain("value: 'primary-secondary'");
    expect(settingsSource).toContain("portalHeroGradient === 'primary-secondary'");
    expect(settingsSource).toContain('portalHeroGradient: updates.portalHeroGradient ?? portalHeroGradient');
    expect(settingsSource).toContain('className="!w-fit"');
    expect(settingsSource).toContain('linear-gradient(90deg');
  });

  it('provides the gradient setting translations in every MSP locale', () => {
    const localeRoot = path.resolve(process.cwd(), 'public/locales');
    const locales = fs.readdirSync(localeRoot);

    for (const locale of locales) {
      const localeFile = path.join(localeRoot, locale, 'msp/settings.json');
      if (!fs.existsSync(localeFile)) continue;
      const settings = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
      expect(settings.clientPortal.branding.fields.heroGradient, locale).toBeTruthy();
      expect(settings.clientPortal.branding.help.heroGradient, locale).toBeTruthy();
      expect(settings.clientPortal.branding.heroGradient.primaryShades, locale).toBeTruthy();
      expect(settings.clientPortal.branding.heroGradient.primarySecondary, locale).toBeTruthy();
    }
  });
});
