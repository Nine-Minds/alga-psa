/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('../../../components/layout/Body', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../components/layout/RightSidebar', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="right-sidebar" data-open={isOpen ? 'true' : 'false'} />
  ),
}));

vi.mock('server/src/components/chat/QuickAskOverlay', () => ({
  default: () => null,
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

describe('DefaultLayout sidebar chat shortcut gating', () => {
  it('ignores the Sidebar Chat shortcut (⌘L/Ctrl+L) when aiAssistant is disabled', async () => {
    vi.mocked(isExperimentalFeatureEnabled).mockResolvedValueOnce(false);
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

    const metaEvent = new KeyboardEvent('keydown', { key: 'l', metaKey: true });
    const metaPreventDefaultSpy = vi.spyOn(metaEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(metaEvent);
    });
    expect(metaPreventDefaultSpy).not.toHaveBeenCalled();

    const ctrlEvent = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true });
    const ctrlPreventDefaultSpy = vi.spyOn(ctrlEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(ctrlEvent);
    });
    expect(ctrlPreventDefaultSpy).not.toHaveBeenCalled();
  });

  it('does not render the RightSidebar when aiAssistant is disabled', async () => {
    vi.mocked(isExperimentalFeatureEnabled).mockResolvedValueOnce(false);
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

    expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument();
  });
});
