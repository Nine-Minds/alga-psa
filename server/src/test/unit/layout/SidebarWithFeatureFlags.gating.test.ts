import { describe, expect, it } from 'vitest';

import { TIER_FEATURES } from '@alga-psa/types';
import { navigationSections, type MenuItem } from '../../../config/menuConfig';
import {
  filterMenuItemsByFeatureAccess,
  filterNavigationSectionsByFeatureAccess,
} from '../../../components/layout/SidebarWithFeatureFlags';

describe('SidebarWithFeatureFlags tier gating', () => {
  it('MenuItem accepts an optional requiredFeature field', () => {
    const item: MenuItem = {
      name: 'Extensions',
      icon: navigationSections[0].items[0].icon,
      requiredFeature: TIER_FEATURES.EXTENSIONS,
    };

    expect(item.requiredFeature).toBe(TIER_FEATURES.EXTENSIONS);
  });

  it('hides Extensions for Solo tenants', () => {
    const filtered = filterNavigationSectionsByFeatureAccess(
      navigationSections,
      (feature) => feature !== TIER_FEATURES.EXTENSIONS && feature !== TIER_FEATURES.WORKFLOW_DESIGNER
    );

    expect(filtered[0].items.some((item) => item.name === 'Extensions')).toBe(false);
  });

  it('hides Workflow Editor recursively for Solo tenants', () => {
    const workflows = navigationSections[0].items.find((item) => item.name === 'Workflows');
    const filtered = filterMenuItemsByFeatureAccess(workflows?.subItems ?? [], () => false);

    expect(filtered.some((item) => item.name === 'Workflow Editor')).toBe(false);
  });

  it('shows Extensions for Pro tenants', () => {
    const filtered = filterNavigationSectionsByFeatureAccess(navigationSections, () => true);

    expect(filtered[0].items.some((item) => item.name === 'Extensions')).toBe(true);
  });

  it('shows all items for Premium tenants', () => {
    const filtered = filterNavigationSectionsByFeatureAccess(navigationSections, () => true);
    const workflows = filtered[0].items.find((item) => item.name === 'Workflows');

    expect(filtered[0].items.some((item) => item.name === 'Extensions')).toBe(true);
    expect(workflows?.subItems?.some((item) => item.name === 'Workflow Editor')).toBe(true);
  });

  it('keeps items without requiredFeature visible', () => {
    const filtered = filterNavigationSectionsByFeatureAccess(navigationSections, () => false);

    expect(filtered[0].items.some((item) => item.name === 'Tickets')).toBe(true);
  });
});
