import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `recropTenantLogo` cuts the new mark from whatever the server decides the
 * mark came from — the original square upload when there was one. A screen that
 * shows the wide wordmark in the crop dialog while the server cuts the square
 * would save something the admin never saw, so every screen offering "Adjust
 * mark" has to hand the component the same source the server will use.
 */
const componentRoots = [
  path.resolve(process.cwd(), 'src'),
  path.resolve(process.cwd(), '../ee/server/src'),
].filter((root) => fs.existsSync(root));

const isProductionSource = (entry: string) => (entry.endsWith('.tsx') || entry.endsWith('.ts'))
  && !entry.includes('.test.')
  && !entry.includes('__tests__')
  && !entry.split(path.sep).includes('test');

const sourceFiles = componentRoots.flatMap((root) => fs
  .readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(isProductionSource)
  .map((entry) => path.join(root, entry)));

const recropCallers = sourceFiles
  .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
  .filter(({ source }) => source.includes('recropTenantLogo('));

describe('tenant logo crop source contract', () => {
  it('finds the screens that offer "Adjust mark"', () => {
    const names = recropCallers.map(({ file }) => path.basename(file)).sort();
    expect(names).toEqual(['AppearanceSettings.tsx', 'ClientPortalSettings.tsx']);
  });

  it.each(recropCallers.map(({ file, source }) => [path.basename(file), source]))(
    '%s crops from the image the server re-cuts, not always the wide logo',
    (_name, source) => {
      // The slot's real source comes from the server, never from the wide URL alone.
      expect(source).toContain('getTenantLogoInfoAction');
      expect(source).toContain("cropSourceUrl={logoInfo?.default.cropSourceUrl ?? null}");
      expect(source).toContain("cropSourceUrl={logoInfo?.dark.cropSourceUrl ?? null}");

      // Both mark slots keep a recrop action, so neither loses the dialog.
      expect(source).toContain("recropAction={handleLogoRecrop('default')}");
      expect(source).toContain("recropAction={handleLogoRecrop('dark')}");

      // A crop cut from the square upload leaves no wide logo to reassure about.
      expect(source).toContain("cropHelpText={markCropHelp('default')}");
      expect(source).toContain("cropHelpText={markCropHelp('dark')}");

      // The names and sources are stale the moment a slot changes.
      expect(source).toMatch(/const result = await recropTenantLogo\(entityId, variant, crop\);[\s\S]{0,200}refreshLogoInfo\(\)/);
    },
  );

  it('translates the square-source crop help in every MSP locale', () => {
    const localeRoot = path.resolve(process.cwd(), 'public/locales');

    for (const locale of fs.readdirSync(localeRoot)) {
      const localeFile = path.join(localeRoot, locale, 'msp/settings.json');
      if (!fs.existsSync(localeFile)) continue;
      const settings = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
      expect(settings.clientPortal.branding.cropHelpFromSquare, locale).toBeTruthy();
      expect(settings.appearance.whiteLabel.cropHelpFromSquare, locale).toBeTruthy();
    }
  });
});
