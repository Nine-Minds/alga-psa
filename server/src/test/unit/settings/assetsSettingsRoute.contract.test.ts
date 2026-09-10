import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { settingsNavigationSections } from '../../../config/menuConfig';
import {
  MIGRATED_SETTINGS_TAB_IDS,
  getSettingsTab,
} from '../../../components/settings/settingsTabsRegistry';

const routeSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/app/msp/settings/assets/page.tsx'),
  'utf8',
);

describe('asset type settings route', () => {
  it('composes AssetTypesManager inside the shared SettingsTab shell', () => {
    expect(routeSource).toContain(
      "import AssetTypesManager from '@alga-psa/assets/components/settings/AssetTypesManager';",
    );
    expect(routeSource).toContain('<SettingsTab tabId="assets">');
    expect(routeSource).toContain('<AssetTypesManager />');
    expect(routeSource).toContain("settingsTabMetadata('assets')");
  });

  it('is reachable from the settings sidebar', () => {
    const assetsItem = settingsNavigationSections
      .flatMap((section) => section.items)
      .find((item) => item.href === '/msp/settings/assets');

    expect(assetsItem).toEqual(
      expect.objectContaining({
        name: 'Assets',
        translationKey: 'settings.tabs.assets',
      }),
    );
  });

  it('registers assets for legacy query-string redirects', () => {
    expect(getSettingsTab('assets')).toEqual(
      expect.objectContaining({ hasOwnRoute: true }),
    );
    expect(MIGRATED_SETTINGS_TAB_IDS.has('assets')).toBe(true);
  });
});
