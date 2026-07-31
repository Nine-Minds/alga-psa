// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MspLayoutClient } from '@/app/msp/MspLayoutClient';
import { getTenantSettings } from '@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions';

const mockUsePathname = vi.fn(() => '/msp/tickets');
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@alga-psa/auth/client', () => ({
  AppSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/tags/context', () => ({
  TagProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/analytics/PostHogUserIdentifier', () => ({
  PostHogUserIdentifier: () => null,
}));

vi.mock('@alga-psa/ui/ui-reflection/ClientUIStateProvider', () => ({
  ClientUIStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/tenancy/components/i18n/I18nWrapper', () => ({
  I18nWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  getTenantSettings: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  detectClientLocale: () => 'en',
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string) => ({
      'onboardingRedirect.title': 'Taking you to setup',
      'onboardingRedirect.description': 'Your workspace needs a quick setup before you can use the dashboard.',
      'onboardingRedirect.action': 'Continue to setup',
    }[key] ?? key),
  }),
}));

vi.mock('@/context/TierContext', () => ({
  TierProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/context/ProductContext', () => ({
  ProductProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/licenses/LicenseBanner', () => ({
  default: () => <div data-testid="license-banner" />,
}));

vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  KeyboardShortcutsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useKeyboardShortcutPreferenceStorage', () => ({
  useKeyboardShortcutPreferenceStorage: () => ({ storage: undefined }),
}));

vi.mock('@/components/layout/DefaultLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="psa-default-layout">{children}</div>,
}));

vi.mock('@/components/layout/AlgaDeskMspShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="algadesk-shell">{children}</div>,
}));

vi.mock('@/components/product/ProductRouteBoundary', () => ({
  ProductRouteBoundary: () => <div data-testid="product-route-boundary" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUsePathname.mockReturnValue('/msp/tickets');
});

const mockGetTenantSettings = vi.mocked(getTenantSettings);

describe('MspLayoutClient product shell behavior', () => {
  it('RT006: renders AlgaDesk shell for allowed AlgaDesk MSP routes', () => {
    render(
      <MspLayoutClient
        session={null}
        productCode="algadesk"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
      >
        <div>algadesk content</div>
      </MspLayoutClient>,
    );

    expect(screen.getByTestId('algadesk-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('psa-default-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('product-route-boundary')).not.toBeInTheDocument();
  });

  it('RT006: preserves PSA layout path for PSA tenants', () => {
    render(
      <MspLayoutClient
        session={null}
        productCode="psa"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
      >
        <div>psa content</div>
      </MspLayoutClient>,
    );

    expect(screen.getByTestId('psa-default-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('algadesk-shell')).not.toBeInTheDocument();
  });

  it('RT006: renders an onboarding redirect fallback instead of a blank screen', () => {
    render(
      <MspLayoutClient
        session={{ user: { tenant: 'tenant-1' } } as any}
        productCode="psa"
        needsOnboarding={true}
        initialSidebarCollapsed={false}
      >
        <div>psa content</div>
      </MspLayoutClient>,
    );

    expect(screen.getByText('Taking you to setup')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to setup' })).toHaveAttribute('href', '/msp/onboarding');
    expect(screen.queryByText('psa content')).not.toBeInTheDocument();
  });

  it('RT006: client fallback redirects AlgaDesk tenants when onboarding is incomplete', async () => {
    mockGetTenantSettings.mockResolvedValue({
      tenant: 'tenant-1',
      onboarding_completed: false,
      onboarding_skipped: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    render(
      <MspLayoutClient
        session={{ user: { tenant: 'tenant-1' } } as any}
        productCode="algadesk"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
      >
        <div>algadesk content</div>
      </MspLayoutClient>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/msp/onboarding');
    });
  });

  it.each([
    { onboarding_completed: true, onboarding_skipped: false, label: 'completed' },
    { onboarding_completed: false, onboarding_skipped: true, label: 'skipped' },
  ])('shows the self-host license banner after onboarding is $label', async (settings) => {
    mockGetTenantSettings.mockResolvedValue({
      tenant: 'tenant-1',
      onboarding_completed: settings.onboarding_completed,
      onboarding_skipped: settings.onboarding_skipped,
      created_at: new Date(),
      updated_at: new Date(),
    });

    render(
      <MspLayoutClient
        session={{ user: { tenant: 'tenant-1' } } as any}
        productCode="psa"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
        selfHostLicensing={true}
      >
        <div>psa content</div>
      </MspLayoutClient>,
    );

    expect(screen.queryByTestId('license-banner')).not.toBeInTheDocument();
    expect(await screen.findByTestId('license-banner')).toBeInTheDocument();
  });

  it('does not show the self-host license banner while onboarding is still required', async () => {
    mockGetTenantSettings.mockResolvedValue({
      tenant: 'tenant-1',
      onboarding_completed: false,
      onboarding_skipped: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    render(
      <MspLayoutClient
        session={{ user: { tenant: 'tenant-1' } } as any}
        productCode="psa"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
        selfHostLicensing={true}
      >
        <div>psa content</div>
      </MspLayoutClient>,
    );

    expect(screen.queryByTestId('license-banner')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/msp/onboarding');
    });
    expect(screen.queryByTestId('license-banner')).not.toBeInTheDocument();
  });

  it('does not show the self-host license banner on the onboarding page', () => {
    mockUsePathname.mockReturnValue('/msp/onboarding');

    render(
      <MspLayoutClient
        session={{ user: { tenant: 'tenant-1' } } as any}
        productCode="psa"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
        selfHostLicensing={true}
      >
        <div>onboarding content</div>
      </MspLayoutClient>,
    );

    expect(screen.queryByTestId('license-banner')).not.toBeInTheDocument();
  });
});
