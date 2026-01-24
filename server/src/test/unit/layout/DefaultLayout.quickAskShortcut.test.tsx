/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../../../components/layout/DefaultLayout';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';

vi.mock('next/navigation', () => ({
  usePathname: () => '/msp/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../components/layout/SidebarWithFeatureFlags', () => ({ default: () => null }));
vi.mock('../../../components/layout/Header', () => ({ default: () => null }));
vi.mock('../../../components/layout/Body', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../components/layout/RightSidebar', () => ({ default: () => null }));

vi.mock('server/src/components/chat/QuickAskOverlay', () => ({
  default: () => <div data-testid="quick-ask-overlay" />,
}));

vi.mock('@alga-psa/workflows/components', () => ({
  ActivityDrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui', () => ({
  DrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/lib', () => ({
  savePreference: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

describe('DefaultLayout AI Assistant gating', () => {
  it('ignores the Quick Ask shortcut when aiAssistant is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );

    render(
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quick-ask-overlay')).not.toBeInTheDocument();
  });
});

