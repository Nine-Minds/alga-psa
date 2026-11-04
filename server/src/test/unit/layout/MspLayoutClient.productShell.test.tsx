// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MspLayoutClient } from '@/app/msp/MspLayoutClient';
import { getTenantSettings } from '@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions';

const mockUsePathname = vi.fn(() => '/msp/tickets');
const mockReplace = vi.fn();
// Match Next's stable router by default; the identity-change regression test
// explicitly replaces it to verify that onboarding is not fetched again.
let mockRouter = { replace: mockReplace };

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => mockRouter,
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
  useTier: () => ({ hasAddOn: () => false, hasFeature: () => true }),
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

vi.mock('@/components/co-managed/CoManagedFeatureBoundary', () => ({
  CoManagedWorkspaceBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/co-managed/CoManagedWorkspaceNotice', () => ({
  default: ({ notice }: { notice: unknown }) => (notice ? <div data-testid="workspace-notice" /> : null),
}));
vi.mock('@/components/co-managed/CoManagedCustomerShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="customer-shell">{children}</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockRouter = { replace: mockReplace };
  mockUsePathname.mockReturnValue('/msp/tickets');
});

const mockGetTenantSettings = vi.mocked(getTenantSettings);

describe('MspLayoutClient product shell behavior', () => {
  it('keeps a co-managed customer out of PSA setup when tenant setup is incomplete', async () => {
    render(
      <MspLayoutClient
        session={{ user: { tenant: 'customer', user_type: 'internal', product_code: 'co_managed' } } as any}
        productCode="co_managed"
        needsOnboarding
        canRunOnboarding
        initialSidebarCollapsed={false}
      >
        <div>customer tickets</div>
      </MspLayoutClient>,
    );

    expect(await screen.findByText('customer tickets')).toBeInTheDocument();
    expect(screen.getByTestId('customer-shell')).toBeInTheDocument();
    expect(screen.queryByText('Taking you to setup')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalledWith('/msp/onboarding');
    expect(mockGetTenantSettings).not.toHaveBeenCalled();
  });

  it.each(['/msp/dashboard', '/msp/onboarding'])('sends co-managed %s visits to tickets without rendering the wizard', async path => {
    mockUsePathname.mockReturnValue(path);
    render(<MspLayoutClient session={{ user: { tenant: 'customer', user_type: 'internal' } } as any}
      productCode="co_managed" needsOnboarding={false} canRunOnboarding initialSidebarCollapsed={false}>
      <div>old route</div>
    </MspLayoutClient>);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/msp/tickets'));
    expect(screen.queryByText('old route')).not.toBeInTheDocument();
    expect(mockGetTenantSettings).not.toHaveBeenCalled();
  });

  it('ignores an in-flight PSA settings response after the product resolves to co-managed', async () => {
    let resolveSettings!: (settings: Awaited<ReturnType<typeof getTenantSettings>>) => void;
    mockGetTenantSettings.mockReturnValue(new Promise(resolve => { resolveSettings = resolve; }));
    const layout = (product: 'psa' | 'co_managed') => <MspLayoutClient
      session={{ user: { tenant: 'customer', user_type: 'internal' } } as any} productCode={product}
      needsOnboarding={false} canRunOnboarding initialSidebarCollapsed={false}><div>Ticket queue</div></MspLayoutClient>;
    const { rerender } = render(layout('psa'));
    rerender(layout('co_managed'));
    await act(async () => resolveSettings({ tenant: 'customer', onboarding_completed: false,
      onboarding_skipped: false, created_at: new Date(), updated_at: new Date() }));
    expect(screen.getByText('Ticket queue')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalledWith('/msp/onboarding');
  });
  it('RT006: renders AlgaDesk shell for allowed AlgaDesk MSP routes', () => {
    render(
      <MspLayoutClient
        session={null}
        productCode="algadesk"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
        canRunOnboarding
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
        canRunOnboarding
      >
        <div>psa content</div>
      </MspLayoutClient>,
    );

    expect(screen.getByTestId('psa-default-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('algadesk-shell')).not.toBeInTheDocument();
  });

  it('co_managed: renders the ended notice inside the customer shell and the boundary on a denied route', () => {
    mockUsePathname.mockReturnValue('/msp/billing');
    render(<MspLayoutClient session={null} productCode="co_managed" needsOnboarding={false} initialSidebarCollapsed={false}
      workspaceNotice={{ kind: 'ended', endedAt: '2026-10-01T00:00:00.000Z', sponsorName: 'Northwind' }}>
      <div>billing page</div>
    </MspLayoutClient>);
    expect(screen.getByTestId('customer-shell')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-notice')).toBeInTheDocument();
    expect(screen.getByTestId('product-route-boundary')).toBeInTheDocument();
    expect(screen.queryByText('billing page')).not.toBeInTheDocument();
  });

  it('psa and algadesk never mount the customer shell or the notice, even if one were passed', () => {
    for (const product of ['psa', 'algadesk'] as const) {
      const { unmount } = render(<MspLayoutClient session={null} productCode={product} needsOnboarding={false} initialSidebarCollapsed={false}
        workspaceNotice={{ kind: 'ended', endedAt: '2026-10-01T00:00:00.000Z', sponsorName: 'x' }}>
        <div>content</div>
      </MspLayoutClient>);
      expect(screen.queryByTestId('customer-shell')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workspace-notice')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('RT006: renders an onboarding redirect fallback instead of a blank screen', () => {
    render(
      <MspLayoutClient
        session={{ user: { tenant: 'tenant-1' } } as any}
        productCode="psa"
        needsOnboarding={true}
        initialSidebarCollapsed={false}
        canRunOnboarding
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
        canRunOnboarding
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
    { label: 'absent', props: {} },
    { label: 'false', props: { canRunOnboarding: false } },
  ])('does not send a user who cannot run setup to the wizard when canRunOnboarding is $label', async ({ props }) => {
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
        needsOnboarding
        initialSidebarCollapsed={false}
        {...props}
      >
        <div>technician content</div>
      </MspLayoutClient>,
    );

    expect(await screen.findByText('technician content')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalledWith('/msp/onboarding');
    expect(mockGetTenantSettings).not.toHaveBeenCalled();
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
        canRunOnboarding
      >
        <div>psa content</div>
      </MspLayoutClient>,
    );

    expect(screen.queryByTestId('license-banner')).not.toBeInTheDocument();
    const banner = await screen.findByTestId('license-banner');
    expect(banner).toBeInTheDocument();

    // The resolved onboarding check must not be re-run by later re-renders,
    // which would unmount the banner that was just shown.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(banner).toBeInTheDocument();
    expect(mockGetTenantSettings).toHaveBeenCalledTimes(1);
  });

  it('checks onboarding once and keeps the license banner mounted across re-renders with a new router identity', async () => {
    mockGetTenantSettings.mockResolvedValue({
      tenant: 'tenant-1',
      onboarding_completed: true,
      onboarding_skipped: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const view = (
      <MspLayoutClient
        session={{ user: { tenant: 'tenant-1' } } as any}
        productCode="psa"
        needsOnboarding={false}
        initialSidebarCollapsed={false}
        selfHostLicensing={true}
        canRunOnboarding
      >
        <div>psa content</div>
      </MspLayoutClient>
    );
    const { rerender } = render(view);

    const banner = await screen.findByTestId('license-banner');
    mockRouter = { replace: mockReplace };
    rerender(React.cloneElement(view));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(banner).toBeInTheDocument();
    expect(mockGetTenantSettings).toHaveBeenCalledTimes(1);
  });

  it('uses newly resolved server onboarding status while a client check is pending', async () => {
    let resolveSettings!: (settings: Awaited<ReturnType<typeof getTenantSettings>>) => void;
    mockGetTenantSettings.mockReturnValue(new Promise((resolve) => {
      resolveSettings = resolve;
    }));
    const session = { user: { tenant: 'tenant-1' } } as any;
    const layout = (resolved: boolean) => (
      <MspLayoutClient
        session={session}
        productCode="psa"
        needsOnboarding={false}
        onboardingResolvedServerSide={resolved}
        initialSidebarCollapsed={false}
        selfHostLicensing={true}
        canRunOnboarding
      >
        <div>psa content</div>
      </MspLayoutClient>
    );
    const { rerender } = render(layout(false));
    expect(mockGetTenantSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('license-banner')).not.toBeInTheDocument();

    rerender(layout(true));
    expect(screen.getByTestId('license-banner')).toBeInTheDocument();

    // A stale client response must not override the authoritative server result.
    await act(async () => {
      resolveSettings({
        tenant: 'tenant-1',
        onboarding_completed: false,
        onboarding_skipped: false,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
    expect(screen.getByTestId('license-banner')).toBeInTheDocument();
    expect(screen.getByText('psa content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockGetTenantSettings).toHaveBeenCalledTimes(1);
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
        canRunOnboarding
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
        canRunOnboarding
      >
        <div>onboarding content</div>
      </MspLayoutClient>,
    );

    expect(screen.queryByTestId('license-banner')).not.toBeInTheDocument();
  });
});
