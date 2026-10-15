/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TIER_FEATURES } from '@alga-psa/types';

import SidebarWithFeatureFlags, {
  filterNavigationSectionsByEdition,
  filterNavigationSectionsByFeatureAccess,
  filterNavigationSectionsByPermission,
} from '../../../components/layout/SidebarWithFeatureFlags';
import type { NavigationSection } from '../../../config/menuConfig';

const useFeatureFlag = vi.fn();
const getCurrentUserPermissions = vi.fn();
const useTier = vi.fn();
const useProduct = vi.fn();
const sidebarPropsSpy = vi.fn();
const getLicenseStatus = vi.fn();
const useCoManagedWorkSignals = vi.fn();
const getCoManagedDelegatedAdministration = vi.fn();
type NavItem = { href?: string; name: string; subItems?: NavItem[] };
const flattenNav = (sections: NavigationSection[]): NavItem[] => sections
  .flatMap((section) => section.items as NavItem[])
  .flatMap((item) => [item, ...(item.subItems ?? [])]);
const hasHref = (sections: NavigationSection[], href: string) => flattenNav(sections).some((item) => item.href === href);

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlag(...args),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUserPermissions: (...args: unknown[]) => getCurrentUserPermissions(...args),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUserPermissions: (...args: unknown[]) => getCurrentUserPermissions(...args),
}));

vi.mock('../../../context/TierContext', () => ({
  useTier: (...args: unknown[]) => useTier(...args),
}));

vi.mock('../../../context/ProductContext', () => ({
  useProduct: (...args: unknown[]) => useProduct(...args),
}));

vi.mock('../../../components/co-managed/CoManagedWorkSignalsProvider', () => ({
  useCoManagedWorkSignals: (...args: unknown[]) => useCoManagedWorkSignals(...args),
}));

vi.mock('../../../lib/actions/coManagedDelegatedAdministrationActions', () => ({
  getCoManagedDelegatedAdministration: (...args: unknown[]) => getCoManagedDelegatedAdministration(...args),
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

describe('SidebarWithFeatureFlags product shell composition', () => {
  it.each([false, true])('shows co-managed navigation only after the release flag resolves enabled=%s', async (enabled) => {
    useFeatureFlag.mockImplementation((key: string) => key === 'release-v1-6-feature'
      ? { enabled, loading: false, error: null } : { enabled: true, loading: false, error: null });
    useTier.mockReturnValue({ hasFeature: () => true, isPro: true });
    getCurrentUserPermissions.mockResolvedValue(['co_management:read']);
    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);
    await waitFor(() => {
      const props = sidebarPropsSpy.mock.calls.at(-1)?.[0];
      expect(hasHref(props?.menuSections ?? [], '/msp/co-managed')).toBe(enabled);
    });
  });

  it.each([
    ['co_managed', true, ['co_management:manage'], true],
    ['co_managed', false, ['co_management:manage'], false],
    ['co_managed', true, ['co_management:read'], false],
    ['psa', true, ['co_management:manage'], false],
    ['algadesk', true, ['co_management:manage'], false],
  ])('shows customer access navigation for product=%s flag=%s and live permissions', async (productCode, enabled, permissions, expected) => {
    useProduct.mockReturnValue({ productCode, edition: 'enterprise' });
    useFeatureFlag.mockImplementation((key: string) => ({ enabled: key === 'release-v1-6-feature' ? enabled : true, loading: false, error: null }));
    useTier.mockReturnValue({ hasFeature: () => true, isPro: false });
    getCurrentUserPermissions.mockResolvedValue(permissions);
    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);
    await waitFor(() => {
      const props = sidebarPropsSpy.mock.calls.at(-1)?.[0];
      expect(hasHref(props?.menuSections ?? [], '/msp/co-management')).toBe(expected);
    });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    useFeatureFlag.mockReturnValue(true);
    getCurrentUserPermissions.mockResolvedValue([]);
    useTier.mockReturnValue({ hasFeature: () => true });
    useProduct.mockReturnValue({ productCode: 'psa', edition: 'enterprise' });
    getLicenseStatus.mockResolvedValue({ selfHostMode: false });
    useCoManagedWorkSignals.mockReturnValue({ available: false, viewerId: null, escalatedUnassigned: 0, awaitingReply: 0, total: 0 });
    getCoManagedDelegatedAdministration.mockResolvedValue({ side: 'directory', workspaces: [] });
  });

  it.each([false, true])('gates independent tenant license navigation with release enabled=%s', async enabled => {
    getLicenseStatus.mockResolvedValue({ selfHostMode: true, scope: 'tenant' });
    useFeatureFlag.mockImplementation((name: string) => name === 'release-v1-6-feature' ? { enabled } : true);
    await act(async () => { render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />); });
    const props = sidebarPropsSpy.mock.calls.at(-1)?.[0];
    const names = props.settingsSectionsOverride.flatMap((section: NavigationSection) => section.items.map(item => item.name));
    expect(names.includes('License')).toBe(enabled);
  });

  it('shows License settings only for self-hosted installs', async () => {
    getLicenseStatus.mockResolvedValue({ selfHostMode: true });

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        settingsSectionsOverride: Array<{ items: Array<{ name: string }> }>;
      };
      const names = latestProps.settingsSectionsOverride.flatMap((section) => section.items.map((item) => item.name));
      expect(names).toContain('License');
    });
  });

  it('does not flash License settings before self-host status resolves', async () => {
    getLicenseStatus.mockReturnValue(new Promise(() => {}));

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());
    const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
      settingsSectionsOverride: Array<{ items: Array<{ name: string }> }>;
    };
    const names = latestProps.settingsSectionsOverride.flatMap((section) => section.items.map((item) => item.name));
    expect(names).not.toContain('License');
  });

  it('T005: AlgaDesk shell keeps only allowed nav and uses AlgaDesk branding labels', async () => {
    useProduct.mockReturnValue({ productCode: 'algadesk', edition: 'enterprise' });

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());

    const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
      menuSections: Array<{ items: Array<{ name: string }> }>;
      appDisplayName: string;
      appLogoAlt: string;
    };

    const names = latestProps.menuSections.flatMap((section) => section.items.map((item) => item.name));
    expect(names).toContain('Home');
    expect(names).toContain('Tickets');
    expect(names).toContain('Clients');
    expect(names).toContain('Contacts');
    expect(names).not.toContain('Billing');
    expect(names).not.toContain('Projects');
    expect(names).not.toContain('Assets');
    expect(latestProps.appDisplayName).toBe('AlgaDesk');
    expect(latestProps.appLogoAlt).toBe('AlgaDesk Logo');
  });

  it('T005: PSA shell remains unchanged and uses AlgaPSA branding labels', async () => {
    useProduct.mockReturnValue({ productCode: 'psa', edition: 'enterprise' });

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());

    const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
      menuSections: Array<{ items: Array<{ name: string }> }>;
      appDisplayName: string;
      appLogoAlt: string;
    };

    const names = latestProps.menuSections.flatMap((section) => section.items.map((item) => item.name));
    expect(names).toContain('Billing');
    expect(names).toContain('Projects');
    expect(names).toContain('Assets');
    expect(names.indexOf('Workflows')).toBeLessThan(names.indexOf('System Monitoring'));
    expect(names.indexOf('System Monitoring')).toBeLessThan(names.indexOf('Extensions'));
    expect(latestProps.appDisplayName).toBe('AlgaPSA');
    expect(latestProps.appLogoAlt).toBe('AlgaPSA Logo');
  });

  it('hides EE-only navigation in CE and removes the empty Workflows group', async () => {
    useProduct.mockReturnValue({ productCode: 'psa', edition: 'community' });

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());

    const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
      menuSections: Array<{ items: Array<{ name: string }> }>;
      settingsSectionsOverride: Array<{ items: Array<{ name: string }> }>;
      extensionsSectionsOverride: Array<{ items: Array<{ name: string }> }>;
    };
    const mainNames = latestProps.menuSections.flatMap((section) => section.items.map((item) => item.name));
    const settingsNames = latestProps.settingsSectionsOverride.flatMap((section) =>
      section.items.map((item) => item.name),
    );

    expect(mainNames).not.toContain('Workflows');
    expect(mainNames).not.toContain('Extensions');
    expect(settingsNames).not.toContain('Extensions');
    expect(settingsNames).not.toContain('Appearance');
    expect(latestProps.extensionsSectionsOverride).toEqual([]);
  });

  it('shows Appearance and Passwords in the enterprise shell', async () => {
    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        menuSections: Array<{ items: Array<{ name: string }> }>;
        settingsSectionsOverride: Array<{ items: Array<{ name: string }> }>;
      };
      const menuNames = latestProps.menuSections.flatMap((section) => section.items.map((item) => item.name));
      const settingsNames = latestProps.settingsSectionsOverride.flatMap((section) =>
        section.items.map((item) => item.name),
      );
      expect(menuNames).toContain('Passwords');
      expect(settingsNames).toContain('Appearance');
    });
  });

  it('hides Accounting Exports billing navigation without exports_execute', async () => {
    getCurrentUserPermissions.mockResolvedValue([]);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(getCurrentUserPermissions).toHaveBeenCalled());
    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        billingSectionsOverride: Array<{ items: Array<{ name: string }> }>;
      };
      const billingNames = latestProps.billingSectionsOverride.flatMap((section) =>
        section.items.map((item) => item.name),
      );
      expect(billingNames).not.toContain('Accounting Exports');
    });
  });

  it('shows Accounting Exports billing navigation with exports_execute', async () => {
    getCurrentUserPermissions.mockResolvedValue(['accounting_integrations:exports_execute']);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        billingSectionsOverride: Array<{ items: Array<{ name: string }> }>;
      };
      const billingNames = latestProps.billingSectionsOverride.flatMap((section) =>
        section.items.map((item) => item.name),
      );
      expect(billingNames).toContain('Accounting Exports');
    });
  });

  it('recursively keeps CE-visible children and still applies feature access', () => {
    const Icon = () => null;
    const sections: NavigationSection[] = [
      {
        title: 'Mixed',
        items: [
          {
            name: 'Parent',
            icon: Icon,
            subItems: [
              { name: 'CE child', icon: Icon, href: '/ce' },
              { name: 'EE child', icon: Icon, href: '/ee', availableEditions: ['enterprise'] },
              { name: 'Feature child', icon: Icon, href: '/feature', requiredFeature: TIER_FEATURES.EXTENSIONS },
            ],
          },
        ],
      },
    ];

    const editionFiltered = filterNavigationSectionsByEdition(sections, 'community');
    const featureFiltered = filterNavigationSectionsByFeatureAccess(editionFiltered, () => false);

    expect(featureFiltered[0].items[0].subItems?.map((item) => item.name)).toEqual(['CE child']);
  });

  it('hides the Recurring Tickets sub-item without recurring_ticket:read and keeps All Tickets', async () => {
    getCurrentUserPermissions.mockResolvedValue([]);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(getCurrentUserPermissions).toHaveBeenCalled());
    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        menuSections: Array<{ items: Array<{ name: string; subItems?: Array<{ name: string }> }> }>;
      };
      const tickets = latestProps.menuSections.flatMap((section) => section.items).find((item) => item.name === 'Tickets');
      expect(tickets?.subItems?.map((item) => item.name)).toEqual(['All Tickets']);
    });
  });

  it('shows the Recurring Tickets sub-item with recurring_ticket:read', async () => {
    getCurrentUserPermissions.mockResolvedValue(['recurring_ticket:read']);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        menuSections: Array<{ items: Array<{ name: string; subItems?: Array<{ name: string }> }> }>;
      };
      const tickets = latestProps.menuSections.flatMap((section) => section.items).find((item) => item.name === 'Tickets');
      expect(tickets?.subItems?.map((item) => item.name)).toEqual(['All Tickets', 'Recurring Tickets']);
    });
  });

  it('drops a nav group whose sub-items are all permission-gated away', () => {
    const Icon = () => null;
    const sections: NavigationSection[] = [
      {
        title: '',
        items: [
          {
            name: 'Gated group',
            icon: Icon,
            subItems: [{ name: 'Gated child', icon: Icon, href: '/gated', requiredPermission: 'x:read' }],
          },
        ],
      },
    ];

    expect(filterNavigationSectionsByPermission(sections, [])).toEqual([]);
    expect(filterNavigationSectionsByPermission(sections, ['x:read'])[0].items[0].subItems).toHaveLength(1);
  });

  // --- T024: grouping and presentation gating (2026-10-14 amendment) --------

  const renderPsa = async (opts: { flag?: boolean; isPro?: boolean; productCode?: string; available?: boolean; permissions?: string[]; directory?: unknown[] } = {}) => {
    const { flag = true, isPro = true, productCode = 'psa', available = true, permissions = ['co_management:read', 'recurring_ticket:read'], directory = [{ operationId: 'op', name: 'Customer IT' }] } = opts;
    useProduct.mockReturnValue({ productCode, edition: 'enterprise' });
    useTier.mockReturnValue({ hasFeature: () => true, isPro });
    useFeatureFlag.mockImplementation((key: string) => key === 'release-v1-6-feature'
      ? { enabled: flag, loading: false, error: null } : { enabled: true, loading: false, error: null });
    useCoManagedWorkSignals.mockReturnValue({ available, viewerId: 'u', escalatedUnassigned: 1, awaitingReply: 1, total: 2 });
    getCurrentUserPermissions.mockResolvedValue(permissions);
    getCoManagedDelegatedAdministration.mockResolvedValue({ side: 'directory', workspaces: directory });
    await act(async () => { render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />); });
    await waitFor(() => expect(sidebarPropsSpy).toHaveBeenCalled());
    return sidebarPropsSpy.mock.calls.at(-1)![0].menuSections as NavigationSection[];
  };

  it('T024: groups Tickets, Projects and one Co-managed IT group when everything is available', async () => {
    const sections = await renderPsa();
    const items = sections.flatMap((section) => section.items as NavItem[]);
    const sub = (name: string) => (items.find((item) => item.name === name)?.subItems ?? []).map((item) => item.name);
    expect(sub('Tickets')).toEqual(['All Tickets', 'Customer Tickets', 'Recurring Tickets']);
    expect(sub('Projects')).toEqual(['All Projects', 'Shared Tasks', 'Templates']);
    await waitFor(() => {
      const latest = (sidebarPropsSpy.mock.calls.at(-1)![0].menuSections as NavigationSection[]).flatMap((section) => section.items as NavItem[]);
      expect((latest.find((item) => item.name === 'Co-managed IT')?.subItems ?? []).map((item) => item.name))
        .toEqual(['Overview', 'Delegated administration']);
    });
    // The three former top-level co-managed entries are gone.
    expect(items.filter((item) => ['Delegated administration', 'Co-managed access'].includes(item.name))).toEqual([]);
  });

  it.each([
    ['the release flag is off', { flag: false }],
    ['the tenant is not Pro', { isPro: false }],
    ['the reader reports no assigned relationship', { available: false }],
  ])('T024: hides Customer Tickets and Shared Tasks when %s', async (_name, opts) => {
    const sections = await renderPsa(opts);
    expect(hasHref(sections, '/msp/tickets/customer')).toBe(false);
    expect(hasHref(sections, '/msp/co-management/tasks')).toBe(false);
    expect(hasHref(sections, '/msp/tickets')).toBe(true);
    expect(hasHref(sections, '/msp/projects')).toBe(true);
  });

  it('T024: shows Customer Tickets and Shared Tasks only when all three conditions hold', async () => {
    const sections = await renderPsa();
    expect(hasHref(sections, '/msp/tickets/customer')).toBe(true);
    expect(hasHref(sections, '/msp/co-management/tasks')).toBe(true);
  });

  it('T024: hides Customer Tickets and Shared Tasks for a customer workspace even if the provider says available', async () => {
    const sections = await renderPsa({ productCode: 'co_managed', isPro: false, available: true, permissions: ['co_management:manage'] });
    // The provider itself is empty outside a sponsoring PSA tenant; the nav keeps this off the group regardless.
    expect(hasHref(sections, '/msp/co-managed')).toBe(false);
    expect(hasHref(sections, '/msp/co-management')).toBe(true);
  });

  it('T024: shows PSA Delegated administration only for a non-empty directory', async () => {
    const empty = await renderPsa({ directory: [] });
    expect(hasHref(empty, '/msp/co-management/administration')).toBe(false);
    expect(hasHref(empty, '/msp/co-managed')).toBe(true);
    sidebarPropsSpy.mockClear();
    const populated = await renderPsa({ directory: [{ operationId: 'op', name: 'Customer IT' }] });
    await waitFor(() => expect(hasHref(sidebarPropsSpy.mock.calls.at(-1)![0].menuSections, '/msp/co-management/administration')).toBe(true));
    expect(populated).toBeDefined();
  });

  it('T024: never asks for the directory when the flag is off or the tenant is not Pro', async () => {
    await renderPsa({ flag: false });
    expect(getCoManagedDelegatedAdministration).not.toHaveBeenCalled();
  });
});
