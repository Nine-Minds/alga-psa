// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MspLayoutClient } from '@/app/msp/MspLayoutClient';
import { getTenantSettings } from '@alga-psa/tenancy/actions';

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

vi.mock('@alga-psa/tenancy/components', () => ({
  I18nWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  getTenantSettings: vi.fn(),
}));

vi.mock('@/context/TierContext', () => ({
  TierProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/context/ProductContext', () => ({
  ProductProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
});
