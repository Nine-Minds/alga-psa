/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('SidebarWithFeatureFlags product shell composition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useFeatureFlag.mockReturnValue(true);
    getCurrentUserPermissions.mockResolvedValue([]);
    useTier.mockReturnValue({ hasFeature: () => true });
    useProduct.mockReturnValue({ productCode: 'psa' });
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
    useProduct.mockReturnValue({ productCode: 'algadesk' });

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
    useProduct.mockReturnValue({ productCode: 'psa' });

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
    expect(latestProps.appDisplayName).toBe('AlgaPSA');
    expect(latestProps.appLogoAlt).toBe('AlgaPSA Logo');
  });
});
