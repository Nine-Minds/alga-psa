/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TIER_FEATURES } from '@alga-psa/types';

import SidebarWithFeatureFlags, {
  collectRequiredPermissionKeys,
  filterNavigationSectionsByEdition,
  filterNavigationSectionsByFeatureAccess,
  filterNavigationSectionsByPermission,
} from '../../../components/layout/SidebarWithFeatureFlags';
import type { NavigationSection } from '../../../config/menuConfig';

const useFeatureFlag = vi.fn();
const heldPermissions = vi.fn();
const useTier = vi.fn();
const useProduct = vi.fn();
const sidebarPropsSpy = vi.fn();
const getLicenseStatus = vi.fn();

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlag(...args),
  useCapability: () => ({ enabled: false, admitted: false, resolved: true }),
  useServedCapabilities: () => new Set(),
}));

vi.mock('../../../lib/auth/currentUserGrants', () => ({
  // The user holds `heldPermissions()`; the gate asks only about the keys it needs.
  resolveCurrentUserGrants: async (keys: readonly string[]) =>
    ((await heldPermissions()) as string[]).filter((key) => keys.includes(key)),
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

describe('SidebarWithFeatureFlags product shell composition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useFeatureFlag.mockReturnValue(true);
    heldPermissions.mockResolvedValue([]);
    useTier.mockReturnValue({ hasFeature: () => true });
    useProduct.mockReturnValue({ productCode: 'psa', edition: 'enterprise' });
    getLicenseStatus.mockResolvedValue({ selfHostMode: false });
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
    heldPermissions.mockResolvedValue([]);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(heldPermissions).toHaveBeenCalled());
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
    heldPermissions.mockResolvedValue(['accounting_integrations:exports_execute']);

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
    heldPermissions.mockResolvedValue([]);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(heldPermissions).toHaveBeenCalled());
    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        menuSections: Array<{ items: Array<{ name: string; subItems?: Array<{ name: string }> }> }>;
      };
      const tickets = latestProps.menuSections.flatMap((section) => section.items).find((item) => item.name === 'Tickets');
      expect(tickets?.subItems?.map((item) => item.name)).toEqual(['All Tickets']);
    });
  });

  it('shows the Recurring Tickets sub-item with recurring_ticket:read', async () => {
    heldPermissions.mockResolvedValue(['recurring_ticket:read']);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        menuSections: Array<{ items: Array<{ name: string; subItems?: Array<{ name: string }> }> }>;
      };
      const tickets = latestProps.menuSections.flatMap((section) => section.items).find((item) => item.name === 'Tickets');
      expect(tickets?.subItems?.map((item) => item.name)).toEqual(['All Tickets', 'Recurring Tickets']);
    });
  });

  it('shows Submit on behalf of… to a default Technician grant set (no user:read) and asks only for gated keys', async () => {
    heldPermissions.mockResolvedValue(['ticket:create', 'ticket:read', 'client:read', 'contact:read']);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        menuSections: Array<{ items: Array<{ name: string; subItems?: Array<{ name: string }> }> }>;
      };
      const serviceRequests = latestProps.menuSections.flatMap((section) => section.items).find((item) => item.name === 'Service Requests');
      expect(serviceRequests?.subItems?.map((item) => item.name)).toEqual(['Manage Requests', 'Submit on behalf of…']);
    });
  });

  it('hides Submit on behalf of… when ticket:create is missing', async () => {
    heldPermissions.mockResolvedValue(['ticket:read', 'client:read', 'contact:read']);

    render(<SidebarWithFeatureFlags sidebarOpen={true} setSidebarOpen={vi.fn()} />);

    await waitFor(() => expect(heldPermissions).toHaveBeenCalled());
    await waitFor(() => {
      const latestProps = sidebarPropsSpy.mock.calls.at(-1)?.[0] as {
        menuSections: Array<{ items: Array<{ name: string; subItems?: Array<{ name: string }> }> }>;
      };
      const serviceRequests = latestProps.menuSections.flatMap((section) => section.items).find((item) => item.name === 'Service Requests');
      expect(serviceRequests?.subItems?.map((item) => item.name)).toEqual(['Manage Requests']);
    });
  });

  it('collects every requiredPermission key in the menu tree, including multi-key items', () => {
    const Icon = () => null;
    const keys = collectRequiredPermissionKeys([
      {
        title: '',
        items: [
          { name: 'A', icon: Icon, href: '/a', requiredPermission: 'a:read' },
          { name: 'G', icon: Icon, subItems: [{ name: 'B', icon: Icon, href: '/b', requiredPermission: ['b:create', 'a:read'] }] },
        ],
      },
    ], ['workflow:admin']);
    expect(keys).toEqual(['a:read', 'b:create', 'workflow:admin']);
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
});
