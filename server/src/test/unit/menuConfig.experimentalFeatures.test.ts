import { describe, expect, it } from 'vitest';

import { settingsNavigationSections } from '../../config/menuConfig';

describe('settingsNavigationSections', () => {
  it('includes Experimental Features tab in Settings navigation', () => {
    const settingsItems = settingsNavigationSections.flatMap((section) => section.items);
    const experimentalFeaturesItem = settingsItems.find(
      (item) => item.name === 'Experimental Features'
    );

    expect(experimentalFeaturesItem).toBeTruthy();
    expect(experimentalFeaturesItem?.href).toBe('/msp/settings?tab=experimental-features');
  });
});

