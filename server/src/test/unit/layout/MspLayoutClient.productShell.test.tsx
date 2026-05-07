// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MspLayoutClient } from '@/app/msp/MspLayoutClient';

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

vi.mock('@/context/TierContext', () => ({
  TierProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/context/ProductContext', () => ({
  ProductProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/DefaultLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="psa-default-layout">{children}</div>,
}));

vi.mock('@/components/layout/AlgadeskMspShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="algadesk-shell">{children}</div>,
}));

vi.mock('@/components/product/ProductRouteBoundary', () => ({
  ProductRouteBoundary: () => <div data-testid="product-route-boundary" />,
}));

afterEach(() => {
  cleanup();
});

describe('MspLayoutClient product shell behavior', () => {
  it('RT006: renders Algadesk shell for allowed Algadesk MSP routes', () => {
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
});
