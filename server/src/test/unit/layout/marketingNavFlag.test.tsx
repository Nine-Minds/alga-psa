/**
 * @vitest-environment jsdom
 *
 * T012 — marketing navigation feature-flag gating.
 *
 * - menuConfig contains exactly one 'Marketing' item with the seven expected
 *   sub-item hrefs (calendar/posts/content/campaigns/sequences/forms/channels).
 * - SidebarWithFeatureFlags hides the 'Marketing' item when the
 *   'marketing-module' flag resolves false and shows it when true. The
 *   Sidebar child is stubbed so the test asserts on the menuSections prop the
 *   component computes (same pattern as
 *   SidebarWithFeatureFlags.productShell.test.tsx).
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { navigationSections } from '../../../config/menuConfig';
import SidebarWithFeatureFlags from '../../../components/layout/SidebarWithFeatureFlags';

const useFeatureFlag = vi.fn();
const getCurrentUserPermissions = vi.fn();
const useTier = vi.fn();
const useProduct = vi.fn();
const sidebarPropsSpy = vi.fn();
const getLicenseStatus = vi.fn();

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlag(...args),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUserPermissions: (...args: unknown[]) => getCurrentUserPermissions(...args),
}));

vi.mock('../../../context/TierContext', () => ({
  useTier: (...args: unknown[]) => useTier(...args),
}));

vi.mock('../../../context/ProductContext', () => ({
  useProduct: (...args: unknown[]) => useProduct(...args),
}));

vi.mock('../../../components/layout/Sidebar', () => ({
  default: (props: unknown) => {
    sidebarPropsSpy(props);
    return <div data-testid="sidebar-shell" />;
  },
}));

vi.mock('../../../lib/actions/licenseManagementActions', () => ({
  getLicenseStatus: (...args: unknown[]) => getLicenseStatus(...args),
}));

const MARKETING_SUBITEM_HREFS = [
  '/msp/marketing/calendar',
  '/msp/marketing/posts',
  '/msp/marketing/content',
  '/msp/marketing/campaigns',
  '/msp/marketing/sequences',
  '/msp/marketing/forms',
  '/msp/marketing/channels',
];

function latestMenuSectionItemNames(): string[] {
  const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
    menuSections: Array<{ items: Array<{ name: string }> }>;
  };
  return latestProps.menuSections.flatMap((section) => section.items.map((item) => item.name));
}

describe('T012: marketing nav menuConfig', () => {
  it('contains exactly one Marketing item with the seven expected sub-item hrefs', () => {
    const allItems = navigationSections.flatMap((section) => section.items);
    const marketingItems = allItems.filter((item) => item.name === 'Marketing');

    expect(marketingItems).toHaveLength(1);
    expect(marketingItems[0].subItems?.map((subItem) => subItem.href)).toEqual(MARKETING_SUBITEM_HREFS);
  });
});

describe('T012: SidebarWithFeatureFlags marketing flag gating', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getCurrentUserPermissions.mockResolvedValue([]);
    useTier.mockReturnValue({ hasFeature: () => true });
    useProduct.mockReturnValue({ productCode: 'psa' });
    getLicenseStatus.mockResolvedValue({ selfHostMode: false });
  });

  it('hides the Marketing nav item when the marketing-module flag is off', async () => {
    useFeatureFlag.mockImplementation((flag: string) => flag !== 'marketing-module');

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());
    expect(latestMenuSectionItemNames()).not.toContain('Marketing');
    // Other nav items are unaffected by the marketing flag.
    expect(latestMenuSectionItemNames()).toContain('Opportunities');
  });

  it('shows the Marketing nav item with all seven sub-items when the flag is on', async () => {
    useFeatureFlag.mockImplementation(() => true);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());
    expect(latestMenuSectionItemNames()).toContain('Marketing');

    const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
      menuSections: Array<{ items: Array<{ name: string; subItems?: Array<{ href?: string }> }> }>;
    };
    const marketingItem = latestProps.menuSections
      .flatMap((section) => section.items)
      .find((item) => item.name === 'Marketing');
    expect(marketingItem?.subItems?.map((subItem) => subItem.href)).toEqual(MARKETING_SUBITEM_HREFS);
  });

  it('resolves the marketing-module flag with a secure default of off', async () => {
    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());
    expect(useFeatureFlag).toHaveBeenCalledWith('marketing-module', { defaultValue: false });
  });
});
